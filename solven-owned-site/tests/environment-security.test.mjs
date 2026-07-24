import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntimeConfiguration, validateRuntimeConfiguration } from "../src/config/environment.mjs";
import { createSafeLogger, redactLogEvent } from "../src/security/safe-logger.mjs";

function productionConfig(overrides = {}) {
  const local = loadRuntimeConfiguration();
  return validateRuntimeConfiguration({
    ...local,
    runtimeEnvironment: "production",
    publicOrigin: "https://owned.example.invalid",
    allowedHosts: ["owned.example.invalid"],
    trustedProxyMode: "edge",
    requireHttps: true,
    secureCookies: true,
    hstsMaxAge: 31_536_000,
    sessionTransport: "cookie",
    leadStoreAdapter: "production-approved",
    outboxAdapter: "production-approved",
    notificationAdapter: "production-approved",
    sessionAdapter: "distributed-approved",
    rateLimiterAdapter: "edge-approved",
    secretManagerRef: "production/manager",
    secretNamespace: "production/solven-owned-site",
    leadStoreSecretRef: "production/lead",
    notificationSecretRef: "production/notification",
    notificationDestinationRef: "production/destination",
    backupTargetRef: "production/backup",
    staging: false,
    noindex: false,
    releaseId: "release-fixture",
    sourceCommitSha: "a".repeat(40),
    ...overrides
  });
}

function stagingConfig(overrides = {}) {
  const local = loadRuntimeConfiguration();
  return validateRuntimeConfiguration({
    ...local,
    runtimeEnvironment: "staging",
    publicOrigin: "https://staging.example.invalid",
    allowedHosts: ["staging.example.invalid"],
    trustedProxyMode: "edge",
    requireHttps: true,
    secureCookies: true,
    hstsMaxAge: 31_536_000,
    sessionCookieName: "solven_staging_session",
    sessionTransport: "header",
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
    releaseId: "staging-release-fixture",
    sourceCommitSha: "b".repeat(40),
    ...overrides
  });
}

test("production refuses local adapters and unsafe defaults at startup validation", () => {
  assert.throws(
    () => loadRuntimeConfiguration({ SOLVEN_RUNTIME_ENVIRONMENT: "production" }),
    (error) => error.codes.includes("production_lead_store_required") && error.codes.includes("production_secure_cookie_required")
  );
});

test("environment booleans and release placeholders fail closed", () => {
  assert.throws(() => loadRuntimeConfiguration({ SOLVEN_CSRF_ENABLED: "yes" }), /invalid_boolean_environment_value/);
  const local = loadRuntimeConfiguration();
  assert.throws(() => validateRuntimeConfiguration({
    ...local,
    runtimeEnvironment: "production",
    publicOrigin: "https://owned.example.invalid",
    allowedHosts: ["owned.example.invalid"],
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
    leadStoreSecretRef: "production/lead",
    notificationSecretRef: "production/notification",
    notificationDestinationRef: "production/destination",
    backupTargetRef: "production/backup",
    noindex: false,
    releaseId: "replace-with-release-id",
    sourceCommitSha: "0000000"
  }), (error) => error.codes.includes("production_release_id_placeholder_forbidden") && error.codes.includes("production_source_sha_placeholder_forbidden"));
});

test("deployment reference names and environment secret scopes fail closed", () => {
  assert.throws(() => productionConfig({ secretManagerRef: "reference with spaces" }), /reference_name_invalid/);
  assert.throws(() => productionConfig({ secretNamespace: "staging/owned-site" }), /production_secret_scope_unsafe/);
  assert.throws(() => stagingConfig({ backupTargetRef: "production/backup" }), /staging_secret_references_required/);
  assert.throws(() => stagingConfig({ notificationAdapter: "sandbox" }), /staging_notification_adapter_unsafe/);
  assert.throws(() => stagingConfig({ firestoreProjectId: "production-project" }), /staging_firestore_project_required/);
  assert.throws(() => stagingConfig({ retentionDays: 91 }), /staging_retention_days_invalid/);
});

test("CSP deployment contract requires anti-framing, base URI, and same-origin form directives", () => {
  const local = loadRuntimeConfiguration();
  assert.throws(() => validateRuntimeConfiguration({ ...local, contentSecurityPolicy: "default-src 'self'" }), (error) => (
    error.codes.includes("csp_frame_ancestors_required")
    && error.codes.includes("csp_base_uri_required")
    && error.codes.includes("csp_form_action_required")
  ));
});

test("staging refuses GA4, production data adapters, and the shared cookie default", () => {
  const unsafe = loadRuntimeConfiguration({}, { runtimeEnvironment: "local" });
  assert.throws(() => validateRuntimeConfiguration({
    ...unsafe,
    runtimeEnvironment: "staging",
    publicOrigin: "https://staging.example.invalid",
    staging: true,
    noindex: true,
    ga4Enabled: true,
    leadStoreAdapter: "production-approved",
    outboxAdapter: "production-approved",
    notificationAdapter: "production-approved",
    sessionAdapter: "local-memory",
    rateLimiterAdapter: "local-memory"
  }), /unsafe_runtime_configuration/);
});

test("session transport is explicit and header transport is confined to staging", () => {
  assert.equal(loadRuntimeConfiguration().sessionTransport, "cookie");
  assert.equal(productionConfig().sessionTransport, "cookie");
  assert.equal(stagingConfig().sessionTransport, "header");
  assert.throws(() => validateRuntimeConfiguration({ ...loadRuntimeConfiguration(), sessionTransport: "header" }), (error) => error.codes.includes("header_session_transport_staging_only"));
  assert.throws(() => productionConfig({ sessionTransport: "header" }), (error) => error.codes.includes("header_session_transport_staging_only"));
  assert.throws(() => stagingConfig({ sessionTransport: "cookie" }), (error) => error.codes.includes("staging_header_session_transport_required"));
  assert.throws(() => stagingConfig({ csrfEnabled: false }), (error) => error.codes.includes("staging_csrf_required"));
});

test("PII and arbitrary provider text are removed from application logs", () => {
  const raw = {
    event: "notification_failed",
    correlation_id: "correlation-123",
    lead_id: "LEAD-2026-0001",
    adapter: "mail-provider",
    reason_code: "temporary_unavailable",
    email: "fixture@example.invalid",
    name: "Fixture Person",
    message: "Do not log this",
    provider_body: "credential material"
  };
  const redacted = redactLogEvent(raw);
  assert.deepEqual(Object.keys(redacted).sort(), ["adapter", "correlation_id", "event", "lead_id", "reason_code"].sort());
  assert.doesNotMatch(JSON.stringify(redacted), /example\.invalid|Fixture Person|Do not log|credential material/);
  const entries = [];
  createSafeLogger((entry) => entries.push(entry)).event(raw);
  assert.equal(entries.length, 1);
  assert.doesNotMatch(JSON.stringify(entries), /example\.invalid|provider_body/);
  assert.deepEqual(redactLogEvent({ event: "x", at: "Fixture Person", attempts: "7" }), { event: "x" });
});
