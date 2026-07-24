import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalFileLeadStore } from "../src/adapters/local-file-lead-store.mjs";
import { LocalFileNotificationOutbox, notificationOutboxId } from "../src/adapters/local-file-notification-outbox.mjs";
import { NotificationCoordinator } from "../src/services/notification-coordinator.mjs";

function leadFixture() {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "solven-notification-test-"));
  const leadStore = new LocalFileLeadStore({ runtimeDir });
  const { record } = leadStore.create({
    receivedAt: new Date("2026-07-18T00:00:00.000Z"),
    idempotencyKey: "notification-test-key",
    lead: {
      company: "合成テスト",
      name: "合成担当",
      email: "notification@example.com",
      phone: "",
      service: "HP",
      timing: "",
      message: "通知再送の合成テスト用問い合わせです。",
      website: "",
      privacy_consent: true,
      utm_source: "",
      utm_medium: "",
      utm_campaign: "",
      utm_content: "",
      landing_page: "/",
      referrer: ""
    }
  });
  const outbox = new LocalFileNotificationOutbox({ runtimeDir });
  return { runtimeDir, leadStore, outbox, record };
}

test("retry resolves a PII-free outbox without creating a second lead", async () => {
  const f = leadFixture();
  let attempts = 0;
  const notifier = {
    name: "test-recovering",
    async notify() {
      attempts += 1;
      if (attempts === 1) { const error = new Error("provider details"); error.code = "temporary_unavailable"; throw error; }
      return { status: "TEST_DELIVERED" };
    }
  };
  const coordinator = new NotificationCoordinator({ leadStore: f.leadStore, outbox: f.outbox, notifier, now: () => new Date("2026-07-18T00:01:00.000Z") });
  assert.equal((await coordinator.deliver(f.record)).status, "RETRY_PENDING");
  assert.equal((await coordinator.retryPending({ force: true }))[0].status, "TEST_DELIVERED");
  const outbox = fs.readFileSync(path.join(f.runtimeDir, "outbox", `${notificationOutboxId(f.record.lead_id)}.json`), "utf8");
  assert.match(outbox, /"status": "delivered"/);
  assert.doesNotMatch(outbox, /notification@example\.com|合成担当|provider details/);
  assert.equal(fs.readdirSync(path.join(f.runtimeDir, "leads")).length, 1);
});

test("initial attempt plus five retries ends in dead letter", async () => {
  const f = leadFixture();
  let attempts = 0;
  const notifier = { name: "test-terminal", async notify() { attempts += 1; const error = new Error("hidden"); error.code = "temporary_unavailable"; throw error; } };
  const coordinator = new NotificationCoordinator({ leadStore: f.leadStore, outbox: f.outbox, notifier, now: () => new Date("2026-07-18T00:01:00.000Z") });
  await coordinator.deliver(f.record);
  for (let retry = 0; retry < 5; retry += 1) await coordinator.retryPending({ force: true });
  assert.equal(attempts, 6);
  assert.equal(f.leadStore.findByLeadId(f.record.lead_id).notification_status, "DEAD_LETTER");
  assert.equal(f.outbox.listPending().length, 0);
  assert.equal(f.outbox.getStatus(notificationOutboxId(f.record.lead_id)).status, "dead_letter");
});

test("untrusted adapter metadata is normalized and never persisted verbatim", async () => {
  const f = leadFixture();
  const notifier = {
    name: "provider\nsecret=value",
    async notify() { return { status: "DELIVERED\ncredential=value" }; }
  };
  const coordinator = new NotificationCoordinator({ leadStore: f.leadStore, outbox: f.outbox, notifier, now: () => new Date("2026-07-18T00:01:00.000Z") });
  assert.equal((await coordinator.deliver(f.record)).status, "RETRY_PENDING");
  const serialized = fs.readFileSync(path.join(f.runtimeDir, "events.jsonl"), "utf8")
    + fs.readFileSync(path.join(f.runtimeDir, "outbox", `${notificationOutboxId(f.record.lead_id)}.json`), "utf8");
  assert.doesNotMatch(serialized, /secret=value|credential=value/);
  assert.match(serialized, /invalid_adapter_result/);
});

test("observability sink failure does not duplicate a delivered notification", async () => {
  const f = leadFixture();
  let deliveries = 0;
  const notifier = { name: "test-delivered", async notify() { deliveries += 1; return { status: "TEST_DELIVERED" }; } };
  const coordinator = new NotificationCoordinator({
    leadStore: f.leadStore,
    outbox: f.outbox,
    notifier,
    eventSink: async () => { throw new Error("log sink unavailable"); },
    now: () => new Date("2026-07-18T00:01:00.000Z")
  });
  assert.equal((await coordinator.deliver(f.record)).status, "TEST_DELIVERED");
  assert.equal(deliveries, 1);
  assert.equal(f.outbox.getStatus(notificationOutboxId(f.record.lead_id)).status, "delivered");
});

test("a Lead status projection failure does not requeue a delivered notification", async () => {
  const f = leadFixture();
  let deliveries = 0;
  let projectionAttempts = 0;
  const originalUpdate = f.leadStore.updateNotificationState.bind(f.leadStore);
  f.leadStore.updateNotificationState = (...args) => {
    projectionAttempts += 1;
    if (projectionAttempts === 1) throw new Error("projection unavailable");
    return originalUpdate(...args);
  };
  const coordinator = new NotificationCoordinator({
    leadStore: f.leadStore,
    outbox: f.outbox,
    notifier: { name: "test-delivered", async notify() { deliveries += 1; return { status: "TEST_DELIVERED" }; } },
    now: () => new Date("2026-07-18T00:01:00.000Z")
  });
  assert.equal((await coordinator.deliver(f.record)).status, "TEST_DELIVERED");
  assert.equal((await coordinator.deliver(f.record)).status, "TEST_DELIVERED");
  assert.equal(deliveries, 1);
  assert.equal(f.outbox.getStatus(notificationOutboxId(f.record.lead_id)).status, "delivered");
  assert.equal(f.leadStore.findByLeadId(f.record.lead_id).notification_status, "TEST_DELIVERED");
});
