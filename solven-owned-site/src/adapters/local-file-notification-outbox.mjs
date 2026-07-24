import fs from "node:fs";
import path from "node:path";
import { notificationOutboxId } from "../contracts/notification-outbox.mjs";
import { atomicWrite, safeCode, safeJson, withRuntimeLock } from "./local-file-utils.mjs";

const outboxIdPattern = /^NOTIFY-LEAD-\d{4}-\d{4,}$/;

function validateId(value) {
  if (!outboxIdPattern.test(String(value))) throw new TypeError("invalid_outbox_id");
  return value;
}

export class LocalFileNotificationOutbox {
  name = "local-file";

  constructor({ runtimeDir }) {
    if (!path.isAbsolute(runtimeDir)) throw new Error("runtime_dir_must_be_absolute");
    this.runtimeDir = runtimeDir;
  }

  file(outboxId) {
    return path.join(this.runtimeDir, "outbox", `${validateId(outboxId)}.json`);
  }

  read(outboxId) {
    const file = this.file(outboxId);
    return fs.existsSync(file) ? safeJson(file) : null;
  }

  write(item) {
    atomicWrite(this.file(item.outbox_id), `${JSON.stringify(item, null, 2)}\n`);
    if (item.idempotency_key_digest) {
      const transactionFile = path.join(this.runtimeDir, "transactions", `${item.idempotency_key_digest}.json`);
      if (fs.existsSync(transactionFile)) {
        const transaction = safeJson(transactionFile);
        transaction.outbox = item;
        atomicWrite(transactionFile, `${JSON.stringify(transaction, null, 2)}\n`);
      }
    }
    return item;
  }

  enqueue(item) {
    return withRuntimeLock(this.runtimeDir, "lead-store", () => {
      const existing = this.read(item.outbox_id);
      if (existing) return existing;
      if (!/^LEAD-\d{4}-\d{4,}$/.test(String(item.lead_id))) throw new TypeError("invalid_outbox_lead_id");
      if (!/^[a-f0-9]{64}$/.test(String(item.idempotency_key_digest))) throw new TypeError("invalid_outbox_idempotency_digest");
      if (!/^[A-Za-z0-9._:-]{1,100}$/.test(String(item.delivery_key))) throw new TypeError("invalid_outbox_delivery_key");
      if (typeof item.next_attempt_at !== "string" || Number.isNaN(Date.parse(item.next_attempt_at))) throw new TypeError("invalid_outbox_next_attempt_at");
      const safe = {
        outbox_id: validateId(item.outbox_id),
        lead_id: item.lead_id,
        idempotency_key_digest: item.idempotency_key_digest,
        delivery_key: item.delivery_key,
        status: "pending",
        attempts: 0,
        next_attempt_at: item.next_attempt_at,
        claim: null
      };
      return this.write(safe);
    });
  }

  claim(outboxId, { workerId, now = new Date(), leaseMs = 30_000, force = false }) {
    if (!/^[A-Za-z0-9._:-]{1,80}$/.test(String(workerId))) throw new TypeError("invalid_worker_id");
    return withRuntimeLock(this.runtimeDir, "lead-store", () => {
      const item = this.read(outboxId);
      if (!item || ["delivered", "dead_letter"].includes(item.status)) return null;
      if (!force && item.next_attempt_at && new Date(item.next_attempt_at).getTime() > now.getTime()) return null;
      if (item.status === "claimed" && item.claim && new Date(item.claim.expires_at).getTime() > now.getTime()) return null;
      item.status = "claimed";
      item.claim = { worker_id: workerId, expires_at: new Date(now.getTime() + leaseMs).toISOString() };
      return this.write(item);
    });
  }

  recordSendResult(outboxId, { attempts, status, at = new Date() }) {
    return withRuntimeLock(this.runtimeDir, "lead-store", () => {
      const item = this.read(outboxId);
      if (!item) throw new Error("outbox_not_found");
      item.status = "delivered";
      item.attempts = attempts;
      item.delivery_status = safeCode(status, "DELIVERED").toUpperCase();
      item.resolved_at = at.toISOString();
      item.next_attempt_at = null;
      item.claim = null;
      delete item.last_error_code;
      return this.write(item);
    });
  }

  scheduleRetry(outboxId, { attempts, reasonCode, nextAttemptAt }) {
    return withRuntimeLock(this.runtimeDir, "lead-store", () => {
      const item = this.read(outboxId);
      if (!item) throw new Error("outbox_not_found");
      item.status = "pending";
      item.attempts = attempts;
      item.last_error_code = safeCode(reasonCode);
      item.next_attempt_at = nextAttemptAt;
      item.claim = null;
      return this.write(item);
    });
  }

  moveToDeadLetter(outboxId, { attempts, reasonCode, at = new Date() }) {
    return withRuntimeLock(this.runtimeDir, "lead-store", () => {
      const item = this.read(outboxId);
      if (!item) throw new Error("outbox_not_found");
      item.status = "dead_letter";
      item.attempts = attempts;
      item.last_error_code = safeCode(reasonCode);
      item.dead_lettered_at = at.toISOString();
      item.next_attempt_at = null;
      item.claim = null;
      return this.write(item);
    });
  }

  manualRetry(outboxId, { at = new Date() } = {}) {
    return withRuntimeLock(this.runtimeDir, "lead-store", () => {
      const item = this.read(outboxId);
      if (!item) throw new Error("outbox_not_found");
      item.status = "pending";
      item.attempts = 0;
      item.manual_retry_count = (item.manual_retry_count || 0) + 1;
      item.next_attempt_at = at.toISOString();
      item.claim = null;
      delete item.dead_lettered_at;
      return this.write(item);
    });
  }

  getStatus(outboxId) {
    const item = this.read(outboxId);
    if (!item) return null;
    return {
      outbox_id: item.outbox_id,
      status: item.status,
      attempts: item.attempts,
      next_attempt_at: item.next_attempt_at || null,
      ...(item.delivery_status ? { delivery_status: item.delivery_status } : {})
    };
  }

  listPending({ now = new Date(), includeFuture = false } = {}) {
    const directory = path.join(this.runtimeDir, "outbox");
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory)
      .filter((name) => outboxIdPattern.test(name.replace(/\.json$/, "")))
      .map((name) => safeJson(path.join(directory, name)))
      .filter((item) => item.status === "pending" || (item.status === "claimed" && item.claim && new Date(item.claim.expires_at).getTime() <= now.getTime()))
      .filter((item) => includeFuture || !item.next_attempt_at || new Date(item.next_attempt_at).getTime() <= now.getTime());
  }
}

export { notificationOutboxId };
