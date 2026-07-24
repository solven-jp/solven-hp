import assert from "node:assert/strict";
import { assertLeadStore } from "../../src/contracts/lead-store.mjs";
import { assertNotificationOutbox } from "../../src/contracts/notification-outbox.mjs";
import { assertRateLimiter } from "../../src/contracts/rate-limiter.mjs";

export const contractLead = Object.freeze({
  company: "Contract Fixture",
  name: "Fixture Person",
  email: "fixture@example.invalid",
  phone: "",
  service: "HP",
  timing: "",
  message: "Provider contract fixture. Never use as customer data.",
  website: "",
  privacy_consent: true,
  utm_source: "",
  utm_medium: "",
  utm_campaign: "",
  utm_content: "",
  landing_page: "/",
  referrer: ""
});

export async function verifyProviderContracts({ leadStore, outbox, rateLimiter }) {
  assertLeadStore(leadStore);
  assertNotificationOutbox(outbox);
  assertRateLimiter(rateLimiter);

  const receivedAt = new Date("2026-07-18T00:00:00.000Z");
  const reservedReceiptId = await leadStore.reserveReceiptId();
  assert.match(reservedReceiptId, /^SV-/);
  const first = await leadStore.create({ lead: contractLead, receivedAt, idempotencyKey: "provider-contract-idempotency" });
  assert.equal(first.created, true);
  assert.notEqual(first.record.lead_id, first.record.receipt_id);
  assert.match(first.record.receipt_id, /^SV-/);
  assert.equal((await leadStore.findByIdempotencyKey("provider-contract-idempotency")).lead_id, first.record.lead_id);
  assert.equal((await leadStore.findByLeadId(first.record.lead_id)).receipt_id, first.record.receipt_id);

  const duplicate = await leadStore.create({ lead: contractLead, receivedAt, idempotencyKey: "provider-contract-idempotency" });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.record.lead_id, first.record.lead_id);
  assert.equal(duplicate.record.receipt_id, first.record.receipt_id);

  const outboxId = `NOTIFY-${first.record.lead_id}`;
  const enqueued = await outbox.enqueue({
    outbox_id: outboxId,
    lead_id: first.record.lead_id,
    idempotency_key_digest: first.record.idempotency_key_digest,
    delivery_key: first.record.lead_id,
    next_attempt_at: first.record.received_at
  });
  assert.equal(enqueued.outbox_id, outboxId);
  assert.equal((await outbox.getStatus(outboxId)).status, "pending");
  assert.equal((await outbox.listPending({ now: receivedAt })).some((item) => item.outbox_id === outboxId), true);
  assert.ok(await outbox.claim(outboxId, { workerId: "contract-worker", now: receivedAt }));
  assert.equal(await outbox.claim(outboxId, { workerId: "contract-worker", now: receivedAt }), null);
  assert.equal(await outbox.claim(outboxId, { workerId: "second-worker", now: receivedAt }), null);
  await outbox.scheduleRetry(outboxId, { attempts: 1, reasonCode: "temporary_unavailable", nextAttemptAt: "2026-07-18T00:01:00.000Z" });
  await leadStore.markRetry(first.record.lead_id, { attempts: 1, reasonCode: "temporary_unavailable", nextAttemptAt: "2026-07-18T00:01:00.000Z" });
  assert.equal((await leadStore.findByLeadId(first.record.lead_id)).notification_status, "RETRY_PENDING");
  await leadStore.updateNotificationState(first.record.lead_id, "DELIVERED");
  assert.equal((await leadStore.findByLeadId(first.record.lead_id)).notification_status, "DELIVERED");
  await outbox.moveToDeadLetter(outboxId, { attempts: 6, reasonCode: "retry_exhausted", at: receivedAt });
  await leadStore.moveToDeadLetter(first.record.lead_id, { attempts: 6, reasonCode: "retry_exhausted" });
  assert.equal((await outbox.getStatus(outboxId)).status, "dead_letter");
  assert.equal((await outbox.manualRetry(outboxId, { at: receivedAt })).status, "pending");

  const candidates = await leadStore.listRetentionCandidates({ before: new Date("2026-07-19T00:00:00.000Z") });
  assert.equal(candidates.some((item) => item.lead_id === first.record.lead_id), true);
  assert.equal(await leadStore.deleteOrAnonymize(first.record.lead_id, { mode: "anonymize", at: receivedAt }), true);
  assert.equal((await leadStore.findByLeadId(first.record.lead_id)).email, "");

  const allowed = await rateLimiter.consume({
    key: "a".repeat(64),
    dimensions: { session: "b".repeat(64), network: "c".repeat(64) },
    client: { address: "192.0.2.1", hasSession: true }
  });
  assert.equal(allowed.allowed, true);
  return { lead_id: first.record.lead_id, receipt_id: first.record.receipt_id };
}
