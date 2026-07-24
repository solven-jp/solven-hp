import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOwnedSiteServer } from "../server.mjs";
import { LocalFileLeadStore, RECEIPT_ID_RANDOM_BITS } from "../src/adapters/local-file-lead-store.mjs";
import { LocalFileNotificationOutbox } from "../src/adapters/local-file-notification-outbox.mjs";
import { LocalMemoryRateLimiter } from "../src/adapters/local-memory-rate-limiter.mjs";
import { LocalMemorySessionStore } from "../src/adapters/local-memory-session-store.mjs";
import { createSafeLogger } from "../src/security/safe-logger.mjs";

const receiptPattern = /^SV-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{5}$/;

async function fixture(options = {}) {
  const runtimeDir = options.runtimeDir || fs.mkdtempSync(path.join(os.tmpdir(), "solven-owned-site-test-"));
  const server = createOwnedSiteServer({ runtimeDir, now: () => new Date("2026-07-18T00:00:00.000Z"), ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  if (options.skipSession) {
    return { base, runtimeDir, headers: {}, close: () => new Promise((resolve) => server.close(resolve)) };
  }
  const session = await fetch(`${base}/api/session`);
  const cookie = session.headers.get("set-cookie").split(";")[0];
  const { csrf_token } = await session.json();
  return {
    base,
    runtimeDir,
    headers: { "content-type": "application/json", "x-solven-csrf": csrf_token, cookie },
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

function approvedFixtureAdapter(adapter, name) {
  adapter.name = name;
  return adapter;
}

async function stagingHeaderFixture() {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "solven-owned-site-staging-header-test-"));
  let currentMs = Date.parse("2026-07-18T00:00:00.000Z");
  const server = createOwnedSiteServer({
    runtimeDir,
    now: () => new Date(currentMs),
    nowMs: () => currentMs,
    config: {
      runtimeEnvironment: "staging",
      publicOrigin: "https://staging.example.invalid",
      allowedHosts: ["staging.example.invalid", "127.0.0.1"],
      trustedProxyMode: "off",
      requireHttps: false,
      secureCookies: true,
      cookieSameSite: "Strict",
      sessionCookieName: "solven_staging_session",
      sessionTransport: "header",
      sessionTtlSeconds: 1800,
      csrfEnabled: true,
      maxBodyBytes: 32768,
      corsMode: "same-origin",
      leadStoreAdapter: "staging-approved",
      outboxAdapter: "staging-approved",
      notificationAdapter: "disabled",
      sessionAdapter: "distributed-approved",
      rateLimiterAdapter: "edge-approved",
      firestoreProjectId: "solven-owned-site-stg-d3e6",
      retentionDays: 30,
      secretManagerRef: "staging/manager",
      secretNamespace: "staging/solven-owned-site",
      leadStoreSecretRef: "staging/lead",
      backupTargetRef: "staging/backup",
      staging: true,
      noindex: true,
      ga4Enabled: false,
      releaseId: "staging-header-fixture",
      sourceCommitSha: "c".repeat(40)
    },
    leadStore: approvedFixtureAdapter(new LocalFileLeadStore({ runtimeDir }), "fixture-distributed-lead"),
    outbox: approvedFixtureAdapter(new LocalFileNotificationOutbox({ runtimeDir }), "fixture-distributed-outbox"),
    notifier: { name: "disabled", async notify() { return { status: "DISABLED" }; } },
    rateLimiter: approvedFixtureAdapter(new LocalMemoryRateLimiter(), "fixture-distributed-rate"),
    sessionStore: approvedFixtureAdapter(new LocalMemorySessionStore({ nowMs: () => currentMs }), "fixture-distributed-session")
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/session`);
  const session = await response.json();
  return {
    base,
    runtimeDir,
    sessionResponse: response,
    session,
    headers: {
      "content-type": "application/json",
      origin: "https://staging.example.invalid",
      "x-solven-session": session.session_id,
      "x-solven-csrf": session.csrf_token
    },
    expireSession: () => { currentMs += 1_801_000; },
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

const validLead = {
  company: "テスト事業者",
  name: "テスト担当",
  email: "test@example.com",
  phone: "",
  service: "HP",
  timing: "未定",
  message: "問い合わせ受付の正常系を確認するテスト内容です。",
  website: "",
  privacy_consent: true,
  utm_source: "local-test",
  landing_page: "/",
  referrer: ""
};

test("staging header transport issues no cookie and disables public lead collection", async () => {
  const f = await stagingHeaderFixture();
  try {
    assert.equal(f.sessionResponse.status, 200);
    assert.equal(f.sessionResponse.headers.get("set-cookie"), null);
    assert.equal(f.session.session_transport, "header");
    assert.match(f.session.session_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(typeof f.session.csrf_token, "string");

    const cookieOnly = await fetch(`${f.base}/api/leads`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://staging.example.invalid", cookie: "solven_staging_session=invalid", "x-solven-csrf": f.session.csrf_token, "idempotency-key": "header-cookie-reject" },
      body: JSON.stringify(validLead)
    });
    assert.equal(cookieOnly.status, 403);

    const invalidOrigin = await fetch(`${f.base}/api/leads`, {
      method: "POST",
      headers: { ...f.headers, origin: "https://untrusted.example.invalid", "idempotency-key": "header-origin-reject" },
      body: JSON.stringify(validLead)
    });
    assert.equal(invalidOrigin.status, 403);

    const missingCsrf = await fetch(`${f.base}/api/leads`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://staging.example.invalid", "x-solven-session": f.session.session_id, "idempotency-key": "header-csrf-reject" },
      body: JSON.stringify(validLead)
    });
    assert.equal(missingCsrf.status, 403);

    const blockedSubmission = await fetch(`${f.base}/api/leads`, {
      method: "POST",
      headers: { ...f.headers, "idempotency-key": "header-staging-disabled", "x-solven-staging-synthetic": "true" },
      body: JSON.stringify(validLead)
    });
    assert.equal(blockedSubmission.status, 403);
    assert.equal((await blockedSubmission.json()).error, "staging_lead_collection_disabled");
  } finally { await f.close(); }
});

test("staging header transport rejects an expired session", async () => {
  const f = await stagingHeaderFixture();
  try {
    f.expireSession();
    const response = await fetch(`${f.base}/api/leads`, {
      method: "POST",
      headers: { ...f.headers, "idempotency-key": "header-expired-session" },
      body: JSON.stringify(validLead)
    });
    assert.equal(response.status, 403);
  } finally { await f.close(); }
});

test("records a lead before a PII-free local notification", async () => {
  const f = await fixture();
  try {
    const response = await fetch(`${f.base}/api/leads`, { method: "POST", headers: { ...f.headers, "idempotency-key": "normal-1" }, body: JSON.stringify(validLead) });
    assert.equal(response.status, 201);
    const responseText = await response.text();
    assert.doesNotMatch(responseText, /lead_id|LEAD-/);
    const body = JSON.parse(responseText);
    assert.match(body.receipt_id, receiptPattern);
    assert.equal(body.status, "NEW");
    assert.equal(body.notification_status, "LOCAL_RECORDED");
    const saved = JSON.parse(fs.readFileSync(path.join(f.runtimeDir, "leads", "LEAD-2026-0001.json"), "utf8"));
    assert.equal(saved.lead_id, "LEAD-2026-0001");
    assert.equal(saved.receipt_id, body.receipt_id);
    assert.notEqual(saved.lead_id, saved.receipt_id);
    assert.equal(saved.email, validLead.email);
    assert.equal(saved.notification_status, "LOCAL_RECORDED");
    const notification = fs.readFileSync(path.join(f.runtimeDir, "notifications", "LEAD-2026-0001.json"), "utf8");
    assert.doesNotMatch(notification, /test@example\.com|テスト担当|問い合わせ受付/);
    assert.match(notification, /"contains_pii": false/);
    const events = fs.readFileSync(path.join(f.runtimeDir, "events.jsonl"), "utf8");
    assert.match(events, /lead_recorded/);
    assert.match(events, /notification_recorded/);
  } finally { await f.close(); }
});

test("accepts an inquiry without an optional company name", async () => {
  const f = await fixture();
  try {
    const response = await fetch(`${f.base}/api/leads`, {
      method: "POST",
      headers: { ...f.headers, "idempotency-key": "optional-company-1" },
      body: JSON.stringify({ ...validLead, company: "" })
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal("lead_id" in body, false);
    assert.match(body.receipt_id, receiptPattern);
    const saved = JSON.parse(fs.readFileSync(path.join(f.runtimeDir, "leads", "LEAD-2026-0001.json"), "utf8"));
    assert.equal(saved.company, "");
  } finally { await f.close(); }
});

test("generates independent non-sequential receipt ids with at least 64 bits of randomness", async () => {
  const f = await fixture();
  try {
    assert.equal(RECEIPT_ID_RANDOM_BITS >= 64, true);
    const first = await fetch(`${f.base}/api/leads`, { method: "POST", headers: { ...f.headers, "idempotency-key": "receipt-random-1" }, body: JSON.stringify(validLead) });
    const second = await fetch(`${f.base}/api/leads`, { method: "POST", headers: { ...f.headers, "idempotency-key": "receipt-random-2" }, body: JSON.stringify(validLead) });
    const firstBody = await first.json();
    const secondBody = await second.json();
    assert.match(firstBody.receipt_id, receiptPattern);
    assert.match(secondBody.receipt_id, receiptPattern);
    assert.notEqual(firstBody.receipt_id, secondBody.receipt_id);
    assert.equal(fs.readdirSync(path.join(f.runtimeDir, "leads")).length, 2);
  } finally { await f.close(); }
});

test("keeps the lead and creates a PII-free retry outbox when notification fails", async () => {
  const notifier = { name: "test-failing", async notify() { const error = new Error("sensitive provider message"); error.code = "temporary_unavailable"; throw error; } };
  const f = await fixture({ notifier });
  try {
    const response = await fetch(`${f.base}/api/leads`, { method: "POST", headers: { ...f.headers, "idempotency-key": "failure-1" }, body: JSON.stringify(validLead) });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).notification_status, "RETRY_PENDING");
    assert.equal(fs.existsSync(path.join(f.runtimeDir, "leads", "LEAD-2026-0001.json")), true);
    const outbox = fs.readFileSync(path.join(f.runtimeDir, "outbox", "NOTIFY-LEAD-2026-0001.json"), "utf8");
    assert.match(outbox, /temporary_unavailable/);
    assert.doesNotMatch(outbox, /test@example\.com|テスト担当|sensitive provider message/);
  } finally { await f.close(); }
});

test("rejects missing consent and honeypot submissions", async () => {
  const f = await fixture();
  try {
    const noConsent = await fetch(`${f.base}/api/leads`, { method: "POST", headers: { ...f.headers, "idempotency-key": "invalid-1" }, body: JSON.stringify({ ...validLead, privacy_consent: false }) });
    assert.equal(noConsent.status, 400);
    const spam = await fetch(`${f.base}/api/leads`, { method: "POST", headers: { ...f.headers, "idempotency-key": "invalid-2" }, body: JSON.stringify({ ...validLead, website: "https://spam.invalid" }) });
    assert.equal(spam.status, 400);
    assert.equal(fs.existsSync(path.join(f.runtimeDir, "leads")), false);
  } finally { await f.close(); }
});

test("accepts only the JSON media type and an optional UTF-8 charset", async () => {
  const f = await fixture();
  try {
    for (const contentType of ["application/jsonp", "application/json; profile=unsafe", "text/json"]) {
      const response = await fetch(`${f.base}/api/leads`, {
        method: "POST",
        headers: { ...f.headers, "content-type": contentType, "idempotency-key": `media-${contentType}` },
        body: JSON.stringify(validLead)
      });
      assert.equal(response.status, 415);
    }
    const accepted = await fetch(`${f.base}/api/leads`, {
      method: "POST",
      headers: { ...f.headers, "content-type": "application/json; charset=UTF-8", "idempotency-key": "media-valid" },
      body: JSON.stringify(validLead)
    });
    assert.equal(accepted.status, 201);
  } finally { await f.close(); }
});

test("requires CSRF and returns a durable idempotent response", async () => {
  const f = await fixture();
  const runtimeDir = f.runtimeDir;
  let receiptId;
  try {
    const rejected = await fetch(`${f.base}/api/leads`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "csrf-1" }, body: JSON.stringify(validLead) });
    assert.equal(rejected.status, 403);
    const first = await fetch(`${f.base}/api/leads`, { method: "POST", headers: { ...f.headers, "idempotency-key": "same-key" }, body: JSON.stringify(validLead) });
    assert.equal(first.status, 201);
    const firstBody = await first.json();
    receiptId = firstBody.receipt_id;
    assert.match(receiptId, receiptPattern);
    assert.equal("lead_id" in firstBody, false);
  } finally { await f.close(); }

  const restarted = await fixture({ runtimeDir });
  try {
    const second = await fetch(`${restarted.base}/api/leads`, { method: "POST", headers: { ...restarted.headers, "idempotency-key": "same-key" }, body: JSON.stringify(validLead) });
    assert.equal(second.status, 200);
    const responseText = await second.text();
    assert.doesNotMatch(responseText, /lead_id|LEAD-/);
    const secondBody = JSON.parse(responseText);
    assert.equal(secondBody.receipt_id, receiptId);
    assert.equal(secondBody.notification_status, "LOCAL_RECORDED");
    assert.equal(fs.readdirSync(path.join(runtimeDir, "leads")).length, 1);
    const saved = JSON.parse(fs.readFileSync(path.join(runtimeDir, "leads", "LEAD-2026-0001.json"), "utf8"));
    assert.equal(saved.lead_id, "LEAD-2026-0001");
    assert.equal(saved.receipt_id, receiptId);
  } finally { await restarted.close(); }
});

test("rejects oversized JSON without terminating the response socket", async () => {
  const f = await fixture();
  try {
    const response = await fetch(`${f.base}/api/leads`, {
      method: "POST",
      headers: { ...f.headers, "idempotency-key": "oversized-1" },
      body: JSON.stringify({ ...validLead, message: "x".repeat(40_000) })
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "payload_too_large" });
    assert.equal(fs.existsSync(path.join(f.runtimeDir, "leads")), false);
  } finally { await f.close(); }
});

test("serves static files with security headers and blocks traversal", async () => {
  const f = await fixture();
  try {
    const response = await fetch(`${f.base}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
    assert.match(response.headers.get("permissions-policy"), /payment=\(\)/);
    assert.match(await response.text(), /中小企業のWebを/);
    const robots = await fetch(`${f.base}/robots.txt`);
    assert.equal(robots.status, 200);
    assert.equal(robots.headers.get("content-type"), "text/plain; charset=utf-8");
    const sitemap = await fetch(`${f.base}/sitemap.xml`);
    assert.equal(sitemap.status, 200);
    assert.equal(sitemap.headers.get("content-type"), "application/xml; charset=utf-8");
    assert.equal((await fetch(`${f.base}/..%2fserver.mjs`)).status, 404);
  } finally { await f.close(); }
});

test("static serving refuses a symlink that resolves outside the public root", async () => {
  const publicRoot = fs.mkdtempSync(path.join(os.tmpdir(), "solven-public-root-"));
  const outside = path.join(os.tmpdir(), `solven-outside-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(outside, "outside");
  fs.symlinkSync(outside, path.join(publicRoot, "escape.txt"));
  const f = await fixture({ publicRoot, skipSession: true });
  try {
    assert.equal((await fetch(`${f.base}/escape.txt`)).status, 404);
  } finally {
    await f.close();
    fs.unlinkSync(outside);
  }
});

test("health is non-sensitive and secure-cookie mode is explicit", async () => {
  const f = await fixture({ secureCookies: true });
  try {
    const health = await (await fetch(`${f.base}/api/health`)).json();
    assert.deepEqual(health, { status: "ok" });
    const session = await fetch(`${f.base}/api/session`);
    assert.match(session.headers.get("set-cookie"), /; Secure/);
    assert.doesNotMatch(JSON.stringify(health), /runtime|credential|secret|email/);
  } finally { await f.close(); }
});

test("rate-limit rejection returns status 429 and a bounded Retry-After", async () => {
  const rateLimiter = { name: "fixture-distributed", async consume() { return { allowed: false, retryAfterSeconds: 17 }; } };
  const f = await fixture({ rateLimiter });
  try {
    const response = await fetch(`${f.base}/api/leads`, { method: "POST", headers: { ...f.headers, "idempotency-key": "rate-limited" }, body: JSON.stringify(validLead) });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "17");
    assert.deepEqual(await response.json(), { error: "rate_limited" });
    assert.equal(fs.existsSync(path.join(f.runtimeDir, "leads")), false);
  } finally { await f.close(); }
});

test("store provider errors fail closed without returning or logging PII", async () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "solven-store-failure-test-"));
  class FailingStore extends LocalFileLeadStore {
    create() { throw new Error("provider secret detail fixture@example.invalid"); }
  }
  const logs = [];
  const f = await fixture({ runtimeDir, leadStore: new FailingStore({ runtimeDir }), logger: createSafeLogger((entry) => logs.push(entry)) });
  try {
    const response = await fetch(`${f.base}/api/leads`, { method: "POST", headers: { ...f.headers, "idempotency-key": "provider-failure" }, body: JSON.stringify(validLead) });
    assert.equal(response.status, 500);
    const serialized = `${await response.text()}${JSON.stringify(logs)}`;
    assert.doesNotMatch(serialized, /fixture@example\.invalid|provider secret detail|テスト担当/);
    assert.equal(fs.existsSync(path.join(runtimeDir, "leads")), false);
  } finally { await f.close(); }
});

test("explicit Origin and Host policies reject mismatches", async () => {
  const f = await fixture();
  try {
    const origin = await fetch(`${f.base}/api/leads`, { method: "POST", headers: { ...f.headers, origin: "https://untrusted.example.invalid", "idempotency-key": "origin-reject" }, body: JSON.stringify(validLead) });
    assert.equal(origin.status, 403);
    assert.deepEqual(await origin.json(), { error: "origin_rejected" });
  } finally { await f.close(); }

  const blocked = await fixture({ config: { allowedHosts: ["owned.example.invalid"] }, skipSession: true });
  try {
    const response = await fetch(`${blocked.base}/api/health`);
    assert.equal(response.status, 421);
    assert.deepEqual(await response.json(), { error: "host_not_allowed" });
  } finally { await blocked.close(); }
});

test("production cannot relabel injected development adapters as approved", () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "solven-production-adapter-reject-"));
  const config = {
    runtimeEnvironment: "production",
    publicOrigin: "https://owned.example.invalid",
    allowedHosts: ["owned.example.invalid"],
    trustedProxyMode: "edge",
    requireHttps: true,
    secureCookies: true,
    hstsMaxAge: 31_536_000,
    leadStoreAdapter: "production-approved",
    outboxAdapter: "production-approved",
    notificationAdapter: "production-approved",
    sessionAdapter: "distributed-approved",
    rateLimiterAdapter: "edge-approved",
    secretManagerRef: "production/manager",
    secretNamespace: "production/solven-owned-site",
    leadStoreSecretRef: "production/lead-store",
    notificationSecretRef: "production/notification",
    notificationDestinationRef: "production/destination",
    backupTargetRef: "production/backup",
    staging: false,
    noindex: false,
    releaseId: "release-fixture",
    sourceCommitSha: "a".repeat(40)
  };
  assert.throws(() => createOwnedSiteServer({
    runtimeDir,
    config,
    leadStore: new LocalFileLeadStore({ runtimeDir }),
    outbox: new LocalFileNotificationOutbox({ runtimeDir }),
    notifier: { name: "local-file", async notify() { return { status: "LOCAL_RECORDED" }; } },
    rateLimiter: new LocalMemoryRateLimiter(),
    sessionStore: new LocalMemorySessionStore()
  }), /development_adapter_forbidden:production/);
});
