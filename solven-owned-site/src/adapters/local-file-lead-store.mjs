import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { redactLogEvent } from "../security/safe-logger.mjs";
import { atomicWrite, safeCode, safeJson, withRuntimeLock } from "./local-file-utils.mjs";

const leadIdPattern = /^LEAD-\d{4}-\d{4,}$/;
const receiptIdPattern = /^SV-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{5}$/;
const receiptAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const RECEIPT_ID_RANDOM_BITS = 64;

export function generateReceiptId(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(RECEIPT_ID_RANDOM_BITS / 8);
  if (!Buffer.isBuffer(bytes) || bytes.length !== RECEIPT_ID_RANDOM_BITS / 8) throw new Error("invalid_receipt_randomness");
  let value = bytes.readBigUInt64BE();
  let encoded = "";
  for (let index = 0; index < 13; index += 1) {
    encoded = receiptAlphabet[Number(value & 31n)] + encoded;
    value >>= 5n;
  }
  return `SV-${encoded.slice(0, 4)}-${encoded.slice(4, 8)}-${encoded.slice(8)}`;
}

function keyDigest(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function outboxId(leadId) {
  return `NOTIFY-${leadId}`;
}

export class LocalFileLeadStore {
  name = "local-file";

  constructor({ runtimeDir, randomBytes = crypto.randomBytes }) {
    if (!path.isAbsolute(runtimeDir)) throw new Error("runtime_dir_must_be_absolute");
    this.runtimeDir = runtimeDir;
    this.randomBytes = randomBytes;
  }

  leadFile(leadId) {
    if (!leadIdPattern.test(String(leadId))) throw new Error("invalid_lead_id");
    return path.join(this.runtimeDir, "leads", `${leadId}.json`);
  }

  transactionFile(digest) {
    if (!/^[a-f0-9]{64}$/.test(String(digest))) throw new Error("invalid_idempotency_digest");
    return path.join(this.runtimeDir, "transactions", `${digest}.json`);
  }

  writeRecord(record) {
    atomicWrite(this.leadFile(record.lead_id), `${JSON.stringify(record, null, 2)}\n`);
  }

  writeTransaction(transaction) {
    atomicWrite(this.transactionFile(transaction.idempotency_key_digest), `${JSON.stringify(transaction, null, 2)}\n`);
  }

  materializeTransaction(transaction) {
    const leadFile = this.leadFile(transaction.record.lead_id);
    const outboxFile = path.join(this.runtimeDir, "outbox", `${transaction.outbox.outbox_id}.json`);
    const indexFile = path.join(this.runtimeDir, "idempotency", `${transaction.idempotency_key_digest}.json`);
    if (!fs.existsSync(leadFile)) this.writeRecord(transaction.record);
    if (!fs.existsSync(outboxFile)) atomicWrite(outboxFile, `${JSON.stringify(transaction.outbox, null, 2)}\n`);
    if (!fs.existsSync(indexFile)) atomicWrite(indexFile, `${JSON.stringify({ lead_id: transaction.record.lead_id }, null, 2)}\n`);
  }

  findTransactionByLeadId(leadId) {
    const directory = path.join(this.runtimeDir, "transactions");
    if (!fs.existsSync(directory)) return null;
    for (const name of fs.readdirSync(directory).filter((item) => /^[a-f0-9]{64}\.json$/.test(item))) {
      const transaction = safeJson(path.join(directory, name));
      if (transaction.record?.lead_id === leadId) return transaction;
    }
    return null;
  }

  updateTransactionRecord(record) {
    const digest = record.idempotency_key_digest;
    if (!digest) return;
    const file = this.transactionFile(digest);
    if (!fs.existsSync(file)) return;
    const transaction = safeJson(file);
    transaction.record = record;
    this.writeTransaction(transaction);
  }

  findByIdempotencyKey(key) {
    const digest = keyDigest(key);
    return withRuntimeLock(this.runtimeDir, "lead-store", () => {
      const transactionFile = this.transactionFile(digest);
      if (fs.existsSync(transactionFile)) {
        const transaction = safeJson(transactionFile);
        this.materializeTransaction(transaction);
        return transaction.record;
      }
      const indexFile = path.join(this.runtimeDir, "idempotency", `${digest}.json`);
      if (fs.existsSync(indexFile)) return this.findByLeadId(safeJson(indexFile).lead_id);
      const directory = path.join(this.runtimeDir, "leads");
      if (!fs.existsSync(directory)) return null;
      for (const name of fs.readdirSync(directory).filter((item) => leadIdPattern.test(item.replace(/\.json$/, "")))) {
        const candidate = safeJson(path.join(directory, name));
        if (candidate.idempotency_key_digest === digest) return candidate;
      }
      return null;
    });
  }

  findByLeadId(leadId) {
    const file = this.leadFile(leadId);
    if (fs.existsSync(file)) return safeJson(file);
    const transaction = this.findTransactionByLeadId(leadId);
    if (!transaction) return null;
    this.materializeTransaction(transaction);
    return transaction.record;
  }

  receiptExists(receiptId) {
    const reservation = path.join(this.runtimeDir, "receipt-reservations", `${receiptId}.json`);
    if (fs.existsSync(reservation)) return true;
    const directory = path.join(this.runtimeDir, "leads");
    if (!fs.existsSync(directory)) return false;
    return fs.readdirSync(directory)
      .filter((name) => leadIdPattern.test(name.replace(/\.json$/, "")))
      .some((name) => safeJson(path.join(directory, name)).receipt_id === receiptId);
  }

  reserveReceiptId() {
    return withRuntimeLock(this.runtimeDir, "lead-store", () => this.reserveReceiptIdUnlocked());
  }

  reserveReceiptIdUnlocked() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const receiptId = generateReceiptId(this.randomBytes);
      if (!receiptIdPattern.test(receiptId) || this.receiptExists(receiptId)) continue;
      atomicWrite(path.join(this.runtimeDir, "receipt-reservations", `${receiptId}.json`), `${JSON.stringify({ receipt_id: receiptId, state: "reserved" })}\n`);
      return receiptId;
    }
    throw new Error("receipt_id_collision_limit");
  }

  nextLeadIdUnlocked(now) {
    const year = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Tokyo", year: "numeric" }).format(now));
    const counterFile = path.join(this.runtimeDir, "lead-sequence.json");
    let sequence = { year, value: 0 };
    if (fs.existsSync(counterFile)) {
      const parsed = safeJson(counterFile);
      if (parsed.year === year && Number.isInteger(parsed.value)) sequence = parsed;
    }
    sequence.value += 1;
    atomicWrite(counterFile, `${JSON.stringify(sequence)}\n`);
    return `LEAD-${year}-${String(sequence.value).padStart(4, "0")}`;
  }

  create({ lead, receivedAt, idempotencyKey }) {
    if (!(receivedAt instanceof Date) || Number.isNaN(receivedAt.getTime())) throw new TypeError("received_at_invalid");
    const digest = keyDigest(idempotencyKey);
    return withRuntimeLock(this.runtimeDir, "lead-store", () => {
      const transactionFile = this.transactionFile(digest);
      if (fs.existsSync(transactionFile)) {
        const transaction = safeJson(transactionFile);
        this.materializeTransaction(transaction);
        return { record: transaction.record, created: false };
      }
      const leadId = this.nextLeadIdUnlocked(receivedAt);
      const receiptId = this.reserveReceiptIdUnlocked();
      const record = {
        ...lead,
        lead_id: leadId,
        receipt_id: receiptId,
        received_at: receivedAt.toISOString(),
        consent_version: "PRIVACY_POLICY_v1.2.0",
        status: "NEW",
        notification_status: "PENDING",
        idempotency_key_digest: digest
      };
      const outbox = {
        outbox_id: outboxId(leadId),
        lead_id: leadId,
        idempotency_key_digest: digest,
        delivery_key: leadId,
        status: "pending",
        attempts: 0,
        next_attempt_at: record.received_at,
        claim: null
      };
      const transaction = { schema_version: 1, idempotency_key_digest: digest, record, outbox };

      // This single commit record is authoritative. Projections are repaired from it after interruption.
      this.writeTransaction(transaction);
      this.materializeTransaction(transaction);
      atomicWrite(path.join(this.runtimeDir, "receipt-reservations", `${receiptId}.json`), `${JSON.stringify({ receipt_id: receiptId, state: "allocated", lead_id: leadId })}\n`);
      this.recordEvent({ event: "lead_recorded", lead_id: leadId, at: record.received_at });
      return { record, created: true };
    });
  }

  updateNotificationState(leadId, notificationStatus) {
    return withRuntimeLock(this.runtimeDir, "lead-store", () => {
      const record = this.findByLeadId(leadId);
      if (!record) throw new Error("lead_not_found");
      record.notification_status = safeCode(notificationStatus, "UNKNOWN").toUpperCase();
      delete record.notification_retry;
      this.writeRecord(record);
      this.updateTransactionRecord(record);
      return record;
    });
  }

  markRetry(leadId, { attempts, reasonCode, nextAttemptAt }) {
    return withRuntimeLock(this.runtimeDir, "lead-store", () => {
      const record = this.findByLeadId(leadId);
      if (!record) throw new Error("lead_not_found");
      record.notification_status = "RETRY_PENDING";
      record.notification_retry = { attempts, reason_code: safeCode(reasonCode), next_attempt_at: nextAttemptAt };
      this.writeRecord(record);
      this.updateTransactionRecord(record);
      return record;
    });
  }

  moveToDeadLetter(leadId, { attempts, reasonCode }) {
    return withRuntimeLock(this.runtimeDir, "lead-store", () => {
      const record = this.findByLeadId(leadId);
      if (!record) throw new Error("lead_not_found");
      record.notification_status = "DEAD_LETTER";
      record.notification_retry = { attempts, reason_code: safeCode(reasonCode), next_attempt_at: null };
      this.writeRecord(record);
      this.updateTransactionRecord(record);
      return record;
    });
  }

  listRetentionCandidates({ before, limit = 100 }) {
    const threshold = before instanceof Date ? before.getTime() : new Date(before).getTime();
    if (!Number.isFinite(threshold) || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new TypeError("retention_query_invalid");
    const directory = path.join(this.runtimeDir, "leads");
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory)
      .filter((name) => leadIdPattern.test(name.replace(/\.json$/, "")))
      .map((name) => safeJson(path.join(directory, name)))
      .filter((record) => new Date(record.received_at).getTime() < threshold)
      .slice(0, limit)
      .map((record) => ({ lead_id: record.lead_id, received_at: record.received_at, status: record.status }));
  }

  deleteOrAnonymize(leadId, { mode = "anonymize", at = new Date() } = {}) {
    if (!["anonymize", "delete"].includes(mode)) throw new TypeError("retention_mode_invalid");
    return withRuntimeLock(this.runtimeDir, "lead-store", () => {
      const record = this.findByLeadId(leadId);
      if (!record) return false;
      const transaction = this.findTransactionByLeadId(leadId);
      if (mode === "anonymize") {
        for (const field of ["company", "name", "email", "phone", "message", "utm_source", "utm_medium", "utm_campaign", "utm_content", "landing_page", "referrer"]) record[field] = "";
        record.pii_anonymized_at = at.toISOString();
        this.writeRecord(record);
        this.updateTransactionRecord(record);
      } else {
        for (const file of [
          this.leadFile(leadId),
          path.join(this.runtimeDir, "outbox", `${outboxId(leadId)}.json`),
          transaction ? this.transactionFile(transaction.idempotency_key_digest) : null,
          transaction ? path.join(this.runtimeDir, "idempotency", `${transaction.idempotency_key_digest}.json`) : null
        ].filter(Boolean)) {
          try { fs.unlinkSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
        }
        atomicWrite(
          path.join(this.runtimeDir, "receipt-reservations", `${record.receipt_id}.json`),
          `${JSON.stringify({ receipt_id: record.receipt_id, state: "retired" })}\n`
        );
      }
      this.recordEvent({ event: mode === "delete" ? "lead_deleted" : "lead_anonymized", lead_id: leadId, at: at.toISOString() });
      return true;
    });
  }

  recordEvent(event) {
    const redacted = redactLogEvent(event);
    if (!redacted.event || !redacted.lead_id) throw new TypeError("unsafe_event");
    const file = path.join(this.runtimeDir, "events.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.appendFileSync(file, `${JSON.stringify(redacted)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}
