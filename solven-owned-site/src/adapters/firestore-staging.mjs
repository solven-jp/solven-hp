import crypto from "node:crypto";
import { Firestore } from "@google-cloud/firestore";
import { generateReceiptId } from "./local-file-lead-store.mjs";

const leadIdPattern = /^LEAD-\d{4}-\d{4,}$/;
const outboxIdPattern = /^NOTIFY-LEAD-\d{4}-\d{4,}$/;
const projectIdPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
export const STAGING_FIRESTORE_PROJECT_ID = "solven-owned-site-stg-d3e6";
const defaultRetentionDays = 30;
const maxRetentionDays = 90;
const millisecondsPerDay = 24 * 60 * 60 * 1000;
const keyDigest = (key) => crypto.createHash("sha256").update(String(key)).digest("hex");
const clone = (value) => structuredClone(value);

function requireRetentionDays(value = defaultRetentionDays) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > maxRetentionDays) throw new TypeError("staging_retention_days_invalid");
  return days;
}

function expiresAt(receivedAt, retentionDays) {
  return new Date(receivedAt.getTime() + (requireRetentionDays(retentionDays) * millisecondsPerDay));
}

function safeCode(value, fallback = "UNKNOWN") {
  const candidate = String(value || "").toUpperCase();
  return /^[A-Z0-9_:-]{1,80}$/.test(candidate) ? candidate : fallback;
}

function validDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function toRecord(snapshot) {
  return snapshot?.exists ? clone(snapshot.data()) : null;
}

function stagingCollections(firestore) {
  return {
    leads: firestore.collection("solven_owned_site_staging_leads"),
    idempotency: firestore.collection("solven_owned_site_staging_idempotency"),
    receipts: firestore.collection("solven_owned_site_staging_receipts"),
    outbox: firestore.collection("solven_owned_site_staging_outbox"),
    counters: firestore.collection("solven_owned_site_staging_counters"),
    sessions: firestore.collection("solven_owned_site_staging_sessions"),
    rateLimits: firestore.collection("solven_owned_site_staging_rate_limits")
  };
}

function japanYear(now) {
  return Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Tokyo", year: "numeric" }).format(now));
}

function requireLeadId(value) {
  if (!leadIdPattern.test(String(value))) throw new TypeError("invalid_lead_id");
  return String(value);
}

function requireOutboxId(value) {
  if (!outboxIdPattern.test(String(value))) throw new TypeError("invalid_outbox_id");
  return String(value);
}

export function createStagingFirestore({ projectId = process.env.SOLVEN_FIRESTORE_PROJECT_ID } = {}) {
  if (!projectIdPattern.test(String(projectId || "")) || projectId !== STAGING_FIRESTORE_PROJECT_ID) {
    throw new Error("staging_firestore_project_id_required");
  }
  return new Firestore({ projectId });
}

export class FirestoreStagingLeadStore {
  name = "firestore-staging";

  constructor({ firestore, randomBytes = crypto.randomBytes, retentionDays = defaultRetentionDays } = {}) {
    if (!firestore || typeof firestore.runTransaction !== "function" || typeof firestore.collection !== "function") {
      throw new TypeError("firestore_required");
    }
    this.firestore = firestore;
    this.collections = stagingCollections(firestore);
    this.randomBytes = randomBytes;
    this.retentionDays = requireRetentionDays(retentionDays);
  }

  async findByIdempotencyKey(key) {
    const index = toRecord(await this.collections.idempotency.doc(keyDigest(key)).get());
    return index?.lead_id ? this.findByLeadId(index.lead_id) : null;
  }

  async findByLeadId(leadId) {
    return toRecord(await this.collections.leads.doc(requireLeadId(leadId)).get());
  }

  async reserveReceiptId() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const receiptId = generateReceiptId(this.randomBytes);
      const reserved = await this.firestore.runTransaction(async (transaction) => {
        const reference = this.collections.receipts.doc(receiptId);
        if ((await transaction.get(reference)).exists) return false;
        transaction.create(reference, { receipt_id: receiptId, state: "reserved", purge_at: expiresAt(new Date(), this.retentionDays) });
        return true;
      });
      if (reserved) return receiptId;
    }
    throw new Error("receipt_id_collision_limit");
  }

  async create({ lead, receivedAt, idempotencyKey }) {
    if (!(receivedAt instanceof Date) || Number.isNaN(receivedAt.getTime())) throw new TypeError("received_at_invalid");
    const digest = keyDigest(idempotencyKey);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const receiptId = generateReceiptId(this.randomBytes);
      try {
        return await this.firestore.runTransaction(async (transaction) => {
          const idempotencyReference = this.collections.idempotency.doc(digest);
          const existingIndex = toRecord(await transaction.get(idempotencyReference));
          if (existingIndex?.lead_id) {
            const existing = toRecord(await transaction.get(this.collections.leads.doc(existingIndex.lead_id)));
            if (!existing) throw new Error("idempotency_projection_missing");
            return { record: existing, created: false };
          }

          const receiptReference = this.collections.receipts.doc(receiptId);
          if ((await transaction.get(receiptReference)).exists) throw Object.assign(new Error("receipt_id_collision"), { code: "receipt_id_collision" });
          const year = japanYear(receivedAt);
          const purgeAt = expiresAt(receivedAt, this.retentionDays);
          const counterReference = this.collections.counters.doc(`lead-sequence-${year}`);
          const counter = toRecord(await transaction.get(counterReference));
          const next = (Number.isInteger(counter?.value) ? counter.value : 0) + 1;
          const leadId = `LEAD-${year}-${String(next).padStart(4, "0")}`;
          const record = {
            ...clone(lead),
            lead_id: leadId,
            receipt_id: receiptId,
            received_at: receivedAt.toISOString(),
            consent_version: "PRIVACY_POLICY_v1.2.0",
            status: "NEW",
            notification_status: "PENDING",
            idempotency_key_digest: digest,
            purge_at: purgeAt
          };
          const outbox = {
            outbox_id: `NOTIFY-${leadId}`,
            lead_id: leadId,
            idempotency_key_digest: digest,
            delivery_key: leadId,
            status: "pending",
            attempts: 0,
            next_attempt_at: record.received_at,
            claim: null,
            purge_at: purgeAt
          };
          transaction.set(counterReference, { year, value: next });
          transaction.create(receiptReference, { receipt_id: receiptId, state: "allocated", lead_id: leadId, purge_at: purgeAt });
          transaction.create(this.collections.leads.doc(leadId), record);
          transaction.create(this.collections.outbox.doc(outbox.outbox_id), outbox);
          transaction.create(idempotencyReference, { lead_id: leadId, idempotency_key_digest: digest, purge_at: purgeAt });
          return { record, created: true };
        });
      } catch (error) {
        if (error?.code !== "receipt_id_collision") throw error;
      }
    }
    throw new Error("receipt_id_collision_limit");
  }

  async updateNotificationState(leadId, notificationStatus) {
    const reference = this.collections.leads.doc(requireLeadId(leadId));
    const record = await this.firestore.runTransaction(async (transaction) => {
      const current = toRecord(await transaction.get(reference));
      if (!current) throw new Error("lead_not_found");
      const next = { ...current, notification_status: safeCode(notificationStatus) };
      delete next.notification_retry;
      transaction.set(reference, next);
      return next;
    });
    return record;
  }

  async markRetry(leadId, { attempts, reasonCode, nextAttemptAt }) {
    return this.#setNotificationRetry(leadId, { attempts, reasonCode, nextAttemptAt, status: "RETRY_PENDING" });
  }

  async moveToDeadLetter(leadId, { attempts, reasonCode }) {
    return this.#setNotificationRetry(leadId, { attempts, reasonCode, nextAttemptAt: null, status: "DEAD_LETTER" });
  }

  async #setNotificationRetry(leadId, { attempts, reasonCode, nextAttemptAt, status }) {
    if (!Number.isInteger(attempts) || attempts < 1 || (nextAttemptAt !== null && !validDate(nextAttemptAt))) throw new TypeError("notification_retry_invalid");
    const reference = this.collections.leads.doc(requireLeadId(leadId));
    return this.firestore.runTransaction(async (transaction) => {
      const current = toRecord(await transaction.get(reference));
      if (!current) throw new Error("lead_not_found");
      const next = {
        ...current,
        notification_status: status,
        notification_retry: { attempts, reason_code: safeCode(reasonCode), next_attempt_at: nextAttemptAt }
      };
      transaction.set(reference, next);
      return next;
    });
  }

  async listRetentionCandidates({ before, limit = 100 }) {
    const cutoff = before instanceof Date ? before.toISOString() : new Date(before).toISOString();
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new TypeError("retention_query_invalid");
    const snapshot = await this.collections.leads.where("received_at", "<", cutoff).limit(limit).get();
    return snapshot.docs.map((item) => toRecord(item)).filter(Boolean).map((record) => ({ lead_id: record.lead_id, received_at: record.received_at, status: record.status }));
  }

  async deleteOrAnonymize(leadId, { mode = "anonymize", at = new Date() } = {}) {
    if (!["anonymize", "delete"].includes(mode)) throw new TypeError("retention_mode_invalid");
    const reference = this.collections.leads.doc(requireLeadId(leadId));
    return this.firestore.runTransaction(async (transaction) => {
      const record = toRecord(await transaction.get(reference));
      if (!record) return false;
      if (mode === "anonymize") {
        const next = { ...record, pii_anonymized_at: at.toISOString() };
        for (const field of ["company", "name", "email", "phone", "message", "utm_source", "utm_medium", "utm_campaign", "utm_content", "landing_page", "referrer"]) next[field] = "";
        transaction.set(reference, next);
      } else {
        transaction.delete(reference);
        transaction.delete(this.collections.outbox.doc(`NOTIFY-${record.lead_id}`));
        transaction.delete(this.collections.idempotency.doc(record.idempotency_key_digest));
        transaction.set(this.collections.receipts.doc(record.receipt_id), { receipt_id: record.receipt_id, state: "retired", purge_at: record.purge_at || expiresAt(at, this.retentionDays) });
      }
      return true;
    });
  }

  async recordEvent() {
    // Staging deliberately avoids an additional event sink that could retain customer payloads.
  }
}

export class FirestoreStagingOutbox {
  name = "firestore-staging";

  constructor({ firestore, retentionDays = defaultRetentionDays } = {}) {
    if (!firestore || typeof firestore.runTransaction !== "function" || typeof firestore.collection !== "function") throw new TypeError("firestore_required");
    this.firestore = firestore;
    this.collection = stagingCollections(firestore).outbox;
    this.retentionDays = requireRetentionDays(retentionDays);
  }

  async enqueue(item) {
    const outboxId = requireOutboxId(item.outbox_id);
    if (!leadIdPattern.test(String(item.lead_id)) || !/^[a-f0-9]{64}$/.test(String(item.idempotency_key_digest)) || !validDate(item.next_attempt_at)) throw new TypeError("invalid_outbox_item");
    const reference = this.collection.doc(outboxId);
    return this.firestore.runTransaction(async (transaction) => {
      const existing = toRecord(await transaction.get(reference));
      if (existing) return existing;
      const next = { outbox_id: outboxId, lead_id: item.lead_id, idempotency_key_digest: item.idempotency_key_digest, delivery_key: String(item.delivery_key), status: "pending", attempts: 0, next_attempt_at: item.next_attempt_at, claim: null, purge_at: expiresAt(new Date(item.next_attempt_at), this.retentionDays) };
      transaction.create(reference, next);
      return next;
    });
  }

  async claim(outboxId, { workerId, now = new Date(), leaseMs = 30_000, force = false } = {}) {
    if (!/^[A-Za-z0-9._:-]{1,80}$/.test(String(workerId)) || !Number.isInteger(leaseMs) || leaseMs < 1) throw new TypeError("invalid_outbox_claim");
    const reference = this.collection.doc(requireOutboxId(outboxId));
    return this.firestore.runTransaction(async (transaction) => {
      const item = toRecord(await transaction.get(reference));
      if (!item || ["delivered", "dead_letter"].includes(item.status)) return null;
      if (!force && item.next_attempt_at && Date.parse(item.next_attempt_at) > now.getTime()) return null;
      if (item.status === "claimed" && item.claim && Date.parse(item.claim.expires_at) > now.getTime()) return null;
      const next = { ...item, status: "claimed", claim: { worker_id: String(workerId), expires_at: new Date(now.getTime() + leaseMs).toISOString() } };
      transaction.set(reference, next);
      return next;
    });
  }

  async recordSendResult(outboxId, { attempts, status, at = new Date() }) {
    return this.#update(outboxId, (item) => ({ ...item, status: "delivered", attempts, delivery_status: safeCode(status, "DELIVERED"), resolved_at: at.toISOString(), next_attempt_at: null, claim: null, last_error_code: undefined }));
  }

  async scheduleRetry(outboxId, { attempts, reasonCode, nextAttemptAt }) {
    if (!validDate(nextAttemptAt)) throw new TypeError("invalid_outbox_next_attempt_at");
    return this.#update(outboxId, (item) => ({ ...item, status: "pending", attempts, last_error_code: safeCode(reasonCode), next_attempt_at: nextAttemptAt, claim: null }));
  }

  async moveToDeadLetter(outboxId, { attempts, reasonCode, at = new Date() }) {
    return this.#update(outboxId, (item) => ({ ...item, status: "dead_letter", attempts, last_error_code: safeCode(reasonCode), dead_lettered_at: at.toISOString(), next_attempt_at: null, claim: null }));
  }

  async manualRetry(outboxId, { at = new Date() } = {}) {
    return this.#update(outboxId, (item) => ({ ...item, status: "pending", attempts: 0, manual_retry_count: (item.manual_retry_count || 0) + 1, next_attempt_at: at.toISOString(), claim: null, dead_lettered_at: undefined }));
  }

  async getStatus(outboxId) {
    const item = toRecord(await this.collection.doc(requireOutboxId(outboxId)).get());
    return item ? { outbox_id: item.outbox_id, status: item.status, attempts: item.attempts, next_attempt_at: item.next_attempt_at || null, ...(item.delivery_status ? { delivery_status: item.delivery_status } : {}) } : null;
  }

  async listPending({ now = new Date(), includeFuture = false } = {}) {
    const [pending, claimed] = await Promise.all([this.collection.where("status", "==", "pending").get(), this.collection.where("status", "==", "claimed").get()]);
    return [...pending.docs, ...claimed.docs].map((item) => toRecord(item)).filter(Boolean)
      .filter((item) => item.status === "pending" || (item.claim && Date.parse(item.claim.expires_at) <= now.getTime()))
      .filter((item) => includeFuture || !item.next_attempt_at || Date.parse(item.next_attempt_at) <= now.getTime());
  }

  async #update(outboxId, mapper) {
    const reference = this.collection.doc(requireOutboxId(outboxId));
    return this.firestore.runTransaction(async (transaction) => {
      const item = toRecord(await transaction.get(reference));
      if (!item) throw new Error("outbox_not_found");
      const next = mapper(item);
      for (const [key, value] of Object.entries(next)) if (value === undefined) delete next[key];
      transaction.set(reference, next);
      return next;
    });
  }
}

export class FirestoreStagingSessionStore {
  name = "firestore-staging";

  constructor({ firestore } = {}) {
    if (!firestore || typeof firestore.collection !== "function") throw new TypeError("firestore_required");
    this.collection = stagingCollections(firestore).sessions;
  }

  async create(id, session) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id)) || typeof session?.csrf !== "string" || !Number.isFinite(session?.expires)) throw new TypeError("invalid_session");
    await this.collection.doc(id).set({ id, csrf: session.csrf, expires: session.expires, purge_at: new Date(session.expires) });
  }

  async get(id) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
    const record = toRecord(await this.collection.doc(id).get());
    if (!record || !Number.isFinite(record.expires) || record.expires <= Date.now()) {
      if (record) await this.collection.doc(id).delete();
      return null;
    }
    return { csrf: record.csrf, expires: record.expires };
  }

  async deleteExpired() {
    const snapshot = await this.collection.where("expires", "<=", Date.now()).limit(100).get();
    await Promise.all(snapshot.docs.map((item) => item.ref.delete()));
  }
}

export class FirestoreStagingRateLimiter {
  name = "firestore-staging";

  constructor({ firestore, limit = 5, sessionLimit = limit, networkLimit = Math.max(limit * 6, 30), windowMs = 60_000, nowMs = () => Date.now() } = {}) {
    if (!firestore || typeof firestore.runTransaction !== "function" || typeof firestore.collection !== "function") throw new TypeError("firestore_required");
    this.firestore = firestore;
    this.collection = stagingCollections(firestore).rateLimits;
    this.sessionLimit = sessionLimit;
    this.networkLimit = networkLimit;
    this.windowMs = windowMs;
    this.nowMs = nowMs;
  }

  async consume({ key, dimensions }) {
    if (!/^[a-f0-9]{64}$/.test(String(key)) || !dimensions || !/^[a-f0-9]{64}$/.test(String(dimensions.session)) || !/^[a-f0-9]{64}$/.test(String(dimensions.network))) throw new TypeError("invalid_rate_limit_key");
    const now = this.nowMs();
    const policies = [
      { id: `session-${dimensions.session}`, limit: this.sessionLimit },
      { id: `network-${dimensions.network}`, limit: this.networkLimit }
    ];
    return this.firestore.runTransaction(async (transaction) => {
      const active = [];
      for (const policy of policies) {
        const record = toRecord(await transaction.get(this.collection.doc(policy.id)));
        active.push({ ...policy, stamps: Array.isArray(record?.stamps) ? record.stamps.filter((stamp) => Number.isFinite(stamp) && now - stamp < this.windowMs) : [] });
      }
      const blocked = active.filter((policy) => policy.stamps.length >= policy.limit);
      if (blocked.length) {
        return { allowed: false, retryAfterSeconds: Math.max(...blocked.map((policy) => Math.max(1, Math.ceil((this.windowMs - (now - policy.stamps[0])) / 1000)))) };
      }
      for (const policy of active) transaction.set(this.collection.doc(policy.id), { stamps: [...policy.stamps, now], purge_at: new Date(now + this.windowMs) });
      return { allowed: true, retryAfterSeconds: 0 };
    });
  }
}

export function createFirestoreStagingAdapters({ firestore, projectId, retentionDays = process.env.SOLVEN_RETENTION_DAYS || defaultRetentionDays } = {}) {
  const resolvedFirestore = firestore || createStagingFirestore({ projectId });
  const resolvedRetentionDays = requireRetentionDays(retentionDays);
  return {
    leadStore: new FirestoreStagingLeadStore({ firestore: resolvedFirestore, retentionDays: resolvedRetentionDays }),
    outbox: new FirestoreStagingOutbox({ firestore: resolvedFirestore, retentionDays: resolvedRetentionDays }),
    notifier: { name: "staging-disabled", async notify() { return { status: "DISABLED" }; } },
    sessionStore: new FirestoreStagingSessionStore({ firestore: resolvedFirestore }),
    rateLimiter: new FirestoreStagingRateLimiter({ firestore: resolvedFirestore })
  };
}
