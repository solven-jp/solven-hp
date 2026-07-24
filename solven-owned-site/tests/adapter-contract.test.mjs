import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LocalFileLeadStore } from "../src/adapters/local-file-lead-store.mjs";
import { LocalFileNotificationOutbox } from "../src/adapters/local-file-notification-outbox.mjs";
import { LocalMemoryRateLimiter } from "../src/adapters/local-memory-rate-limiter.mjs";
import { contractLead, verifyProviderContracts } from "./contracts/provider-contract.mjs";

function runtime(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function worker(script, runtimeDir, key) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, runtimeDir, key], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(`worker_failed:${code}:${stderr}`)));
  });
}

function asyncBoundary(adapter) {
  return new Proxy(adapter, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? async (...args) => value.apply(target, args) : value;
    }
  });
}

test("local adapters pass the provider-neutral contract suite", async () => {
  const runtimeDir = runtime("solven-provider-contract-");
  await verifyProviderContracts({
    leadStore: new LocalFileLeadStore({ runtimeDir }),
    outbox: new LocalFileNotificationOutbox({ runtimeDir }),
    rateLimiter: new LocalMemoryRateLimiter({ limit: 10 })
  });
});

test("Promise-returning provider adapters pass the same contract suite", async () => {
  const runtimeDir = runtime("solven-provider-async-contract-");
  await verifyProviderContracts({
    leadStore: asyncBoundary(new LocalFileLeadStore({ runtimeDir })),
    outbox: asyncBoundary(new LocalFileNotificationOutbox({ runtimeDir })),
    rateLimiter: asyncBoundary(new LocalMemoryRateLimiter({ limit: 10 }))
  });
});

test("concurrent processes create exactly one lead for one idempotency key", async () => {
  const runtimeDir = runtime("solven-concurrent-idempotency-");
  const script = fileURLToPath(new URL("./helpers/create-lead-worker.mjs", import.meta.url));
  const results = await Promise.all(Array.from({ length: 8 }, () => worker(script, runtimeDir, "same-concurrent-key")));
  assert.equal(new Set(results.map((item) => item.lead_id)).size, 1);
  assert.equal(new Set(results.map((item) => item.receipt_id)).size, 1);
  assert.equal(results.filter((item) => item.created).length, 1);
  assert.equal(fs.readdirSync(path.join(runtimeDir, "leads")).length, 1);
  assert.equal(fs.readdirSync(path.join(runtimeDir, "transactions")).length, 1);
});

test("receipt reservation retries a collision and remains unique", () => {
  const runtimeDir = runtime("solven-receipt-collision-");
  const values = [Buffer.alloc(8, 0), Buffer.alloc(8, 0), Buffer.alloc(8, 1)];
  const store = new LocalFileLeadStore({ runtimeDir, randomBytes: () => values.shift() });
  const first = store.create({ lead: contractLead, receivedAt: new Date("2026-07-18T00:00:00.000Z"), idempotencyKey: "collision-one" }).record;
  const second = store.create({ lead: contractLead, receivedAt: new Date("2026-07-18T00:00:00.000Z"), idempotencyKey: "collision-two" }).record;
  assert.notEqual(first.receipt_id, second.receipt_id);
});

test("a deleted Lead leaves a receipt tombstone that prevents reassignment", () => {
  const runtimeDir = runtime("solven-receipt-tombstone-");
  const firstBytes = Buffer.alloc(8, 2);
  const nextBytes = Buffer.alloc(8, 3);
  const values = [firstBytes, firstBytes, nextBytes];
  const store = new LocalFileLeadStore({ runtimeDir, randomBytes: () => values.shift() });
  const first = store.create({ lead: contractLead, receivedAt: new Date("2026-07-18T00:00:00.000Z"), idempotencyKey: "delete-one" }).record;
  assert.equal(store.deleteOrAnonymize(first.lead_id, { mode: "delete", at: new Date("2026-07-19T00:00:00.000Z") }), true);
  const tombstone = JSON.parse(fs.readFileSync(path.join(runtimeDir, "receipt-reservations", `${first.receipt_id}.json`), "utf8"));
  assert.deepEqual(tombstone, { receipt_id: first.receipt_id, state: "retired" });
  const second = store.create({ lead: contractLead, receivedAt: new Date("2026-07-19T00:00:00.000Z"), idempotencyKey: "delete-two" }).record;
  assert.notEqual(second.receipt_id, first.receipt_id);
});

test("transaction commit preserves the lead and initial outbox together", () => {
  const runtimeDir = runtime("solven-transactional-outbox-");
  const store = new LocalFileLeadStore({ runtimeDir });
  const result = store.create({ lead: contractLead, receivedAt: new Date("2026-07-18T00:00:00.000Z"), idempotencyKey: "transaction-one" });
  const transaction = JSON.parse(fs.readFileSync(path.join(runtimeDir, "transactions", `${result.record.idempotency_key_digest}.json`), "utf8"));
  assert.equal(transaction.record.lead_id, result.record.lead_id);
  assert.equal(transaction.outbox.lead_id, result.record.lead_id);
  assert.equal(transaction.outbox.status, "pending");
});
