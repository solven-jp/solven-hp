import path from "node:path";
import net from "node:net";

function booleanValue(value, fallback) {
  if (value === undefined || value === "") return fallback;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new TypeError("invalid_boolean_environment_value");
}

const integerValue = (value, fallback) => value === undefined || value === "" ? fallback : Number(value);
const listValue = (value, fallback = []) => value === undefined || value === "" ? fallback : String(value).split(",").map((item) => item.trim()).filter(Boolean);

function errorIf(errors, condition, code) {
  if (condition) errors.push(code);
}

function validOrigin(value) {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) && parsed.origin === value.replace(/\/$/, "");
  } catch { return false; }
}

function validHost(value) {
  const host = String(value || "");
  if (!host || /[\s/@\\]/.test(host)) return false;
  if (net.isIP(host) > 0) return true;
  try {
    const parsed = new URL(`http://${host}`);
    return Boolean(parsed.hostname) && !parsed.port && parsed.pathname === "/" && !parsed.search && !parsed.hash;
  } catch { return false; }
}

function validReferenceName(value) {
  return value === "" || /^[A-Za-z0-9_./:-]{1,200}$/.test(String(value));
}

export function validateRuntimeConfiguration(config) {
  const errors = [];
  errorIf(errors, !["local", "staging", "production"].includes(config.runtimeEnvironment), "runtime_environment_invalid");
  errorIf(errors, !validOrigin(config.publicOrigin), "public_origin_invalid");
  errorIf(errors, !Array.isArray(config.allowedHosts) || config.allowedHosts.length === 0, "allowed_hosts_required");
  errorIf(errors, config.allowedHosts.some((host) => host !== "*" && !validHost(host)), "allowed_host_invalid");
  errorIf(errors, !["off", "explicit", "edge"].includes(config.trustedProxyMode), "trusted_proxy_mode_invalid");
  errorIf(errors, config.trustedProxyMode === "explicit" && config.trustedProxyAddresses.length === 0, "trusted_proxy_addresses_required");
  errorIf(errors, config.trustedProxyAddresses.some((address) => net.isIP(address) === 0), "trusted_proxy_address_invalid");
  errorIf(errors, !["Strict", "Lax"].includes(config.cookieSameSite), "cookie_same_site_invalid");
  errorIf(errors, !/^[a-z0-9_]{3,40}$/.test(config.sessionCookieName), "session_cookie_name_invalid");
  errorIf(errors, !["cookie", "header"].includes(config.sessionTransport), "session_transport_invalid");
  errorIf(errors, config.runtimeEnvironment !== "staging" && config.sessionTransport !== "cookie", "header_session_transport_staging_only");
  errorIf(errors, !Number.isInteger(config.sessionTtlSeconds) || config.sessionTtlSeconds < 300 || config.sessionTtlSeconds > 86_400, "session_ttl_invalid");
  errorIf(errors, !Number.isInteger(config.maxBodyBytes) || config.maxBodyBytes < 1 || config.maxBodyBytes > 32_768, "request_body_limit_invalid");
  errorIf(errors, config.corsMode !== "same-origin", "cors_mode_invalid");
  errorIf(errors, [config.contentSecurityPolicy, config.referrerPolicy, config.permissionsPolicy].some((value) => /[\r\n]/.test(value)), "security_header_invalid");
  errorIf(errors, !/(?:^|;)\s*frame-ancestors\s+'none'\s*(?:;|$)/i.test(config.contentSecurityPolicy), "csp_frame_ancestors_required");
  errorIf(errors, !/(?:^|;)\s*base-uri\s+'none'\s*(?:;|$)/i.test(config.contentSecurityPolicy), "csp_base_uri_required");
  errorIf(errors, !/(?:^|;)\s*form-action\s+'self'\s*(?:;|$)/i.test(config.contentSecurityPolicy), "csp_form_action_required");
  errorIf(errors, config.logPii !== false, "pii_logging_must_be_disabled");
  errorIf(errors, !/^x-[a-z0-9-]{1,38}$/.test(config.incidentCorrelationHeader), "incident_correlation_header_invalid");
  errorIf(errors, !Number.isInteger(config.retentionDays) || config.retentionDays < 1 || config.retentionDays > 3650, "retention_days_invalid");
  errorIf(errors, config.runtimeEnvironment === "staging" && config.firestoreProjectId !== "solven-owned-site-stg-d3e6", "staging_firestore_project_required");
  errorIf(errors, !/^[A-Za-z0-9._-]{1,80}$/.test(config.releaseId), "release_id_invalid");
  errorIf(errors, !/^[a-f0-9]{7,64}$/i.test(config.sourceCommitSha), "source_commit_sha_invalid");
  errorIf(errors, [
    config.secretManagerRef,
    config.secretNamespace,
    config.leadStoreSecretRef,
    config.notificationSecretRef,
    config.notificationDestinationRef,
    config.ga4MeasurementIdRef,
    config.backupTargetRef
  ].some((value) => !validReferenceName(value)), "reference_name_invalid");

  if (config.runtimeEnvironment === "production") {
    const hostname = validOrigin(config.publicOrigin) ? new URL(config.publicOrigin).hostname : "";
    errorIf(errors, !config.publicOrigin.startsWith("https://") || ["localhost", "127.0.0.1", "::1"].includes(hostname), "production_https_origin_required");
    errorIf(errors, config.allowedHosts.some((host) => ["*", "localhost", "127.0.0.1", "::1"].includes(host)), "production_allowed_hosts_unsafe");
    errorIf(errors, !config.allowedHosts.includes(hostname), "production_origin_host_not_allowed");
    errorIf(errors, !config.requireHttps, "production_https_required");
    errorIf(errors, !config.secureCookies, "production_secure_cookie_required");
    errorIf(errors, !config.csrfEnabled, "production_csrf_required");
    errorIf(errors, config.hstsMaxAge < 31_536_000, "production_hsts_required");
    errorIf(errors, config.leadStoreAdapter !== "production-approved", "production_lead_store_required");
    errorIf(errors, config.outboxAdapter !== "production-approved", "production_outbox_required");
    errorIf(errors, config.notificationAdapter !== "production-approved", "production_notification_required");
    errorIf(errors, config.sessionAdapter !== "distributed-approved", "production_distributed_session_required");
    errorIf(errors, !["distributed-approved", "edge-approved"].includes(config.rateLimiterAdapter), "production_distributed_rate_limiter_required");
    errorIf(errors, !config.secretManagerRef || !config.secretNamespace || !config.leadStoreSecretRef || !config.notificationSecretRef, "production_secret_references_required");
    errorIf(errors, !config.notificationDestinationRef || !config.backupTargetRef, "production_destination_and_backup_refs_required");
    errorIf(errors, !config.secretNamespace.startsWith("production/") || [
      config.secretManagerRef,
      config.leadStoreSecretRef,
      config.notificationSecretRef,
      config.notificationDestinationRef,
      config.backupTargetRef
    ].some((value) => value.startsWith("staging/")), "production_secret_scope_unsafe");
    errorIf(errors, config.staging || config.noindex, "production_staging_flags_forbidden");
    errorIf(errors, config.releaseId === "local-development" || /^(?:replace|example|placeholder)/i.test(config.releaseId), "production_release_id_placeholder_forbidden");
    errorIf(errors, /^0{7,64}$/.test(config.sourceCommitSha), "production_source_sha_placeholder_forbidden");
  }

  if (config.runtimeEnvironment === "staging") {
    const hostname = validOrigin(config.publicOrigin) ? new URL(config.publicOrigin).hostname : "";
    errorIf(errors, !config.publicOrigin.startsWith("https://"), "staging_https_origin_required");
    errorIf(errors, !config.allowedHosts.includes(hostname), "staging_origin_host_not_allowed");
    errorIf(errors, !config.staging || !config.noindex, "staging_safety_flags_required");
    errorIf(errors, config.ga4Enabled, "staging_ga4_must_be_disabled");
    errorIf(errors, config.leadStoreAdapter !== "staging-approved", "staging_lead_store_required");
    errorIf(errors, config.outboxAdapter !== "staging-approved", "staging_outbox_required");
    errorIf(errors, config.notificationAdapter !== "disabled", "staging_notification_adapter_unsafe");
    errorIf(errors, !["distributed-approved", "edge-approved"].includes(config.rateLimiterAdapter), "staging_distributed_rate_limiter_required");
    errorIf(errors, config.sessionAdapter !== "distributed-approved", "staging_distributed_session_required");
    errorIf(errors, config.sessionCookieName === "solven_session", "staging_dedicated_cookie_required");
    errorIf(errors, config.sessionTransport !== "header", "staging_header_session_transport_required");
    errorIf(errors, !config.csrfEnabled, "staging_csrf_required");
    errorIf(errors, config.retentionDays > 90, "staging_retention_days_invalid");
    errorIf(errors, !config.secretNamespace.startsWith("staging/"), "staging_secret_namespace_required");
    errorIf(errors, !config.secretManagerRef.startsWith("staging/") || !config.leadStoreSecretRef.startsWith("staging/") || !config.backupTargetRef.startsWith("staging/"), "staging_secret_references_required");
    errorIf(errors, config.releaseId === "local-development" || /^(?:replace|example|placeholder)/i.test(config.releaseId), "staging_release_id_placeholder_forbidden");
    errorIf(errors, /^0{7,64}$/.test(config.sourceCommitSha), "staging_source_sha_placeholder_forbidden");
  }

  if (config.ga4Enabled) errorIf(errors, !config.ga4MeasurementIdRef, "ga4_measurement_id_reference_required");
  if (errors.length) throw Object.assign(new Error(`unsafe_runtime_configuration:${errors.join(",")}`), { codes: errors });
  return config;
}

export function loadRuntimeConfiguration(env = process.env, overrides = {}) {
  const runtimeEnvironment = overrides.runtimeEnvironment || env.SOLVEN_RUNTIME_ENVIRONMENT || "local";
  const config = {
    runtimeEnvironment,
    publicOrigin: overrides.publicOrigin || env.SOLVEN_PUBLIC_ORIGIN || "http://127.0.0.1:4178",
    allowedHosts: overrides.allowedHosts || listValue(env.SOLVEN_ALLOWED_HOSTS, ["127.0.0.1", "localhost"]),
    trustedProxyMode: overrides.trustedProxyMode || env.SOLVEN_TRUSTED_PROXY_MODE || "off",
    trustedProxyAddresses: overrides.trustedProxyAddresses || listValue(env.SOLVEN_TRUSTED_PROXY_ADDRESSES),
    requireHttps: overrides.requireHttps ?? booleanValue(env.SOLVEN_REQUIRE_HTTPS, false),
    secureCookies: overrides.secureCookies ?? booleanValue(env.SOLVEN_SECURE_COOKIES, false),
    cookieSameSite: overrides.cookieSameSite || env.SOLVEN_COOKIE_SAME_SITE || "Strict",
    sessionCookieName: overrides.sessionCookieName || env.SOLVEN_SESSION_COOKIE_NAME || "solven_session",
    sessionTransport: overrides.sessionTransport || env.SOLVEN_SESSION_TRANSPORT || "cookie",
    sessionTtlSeconds: overrides.sessionTtlSeconds ?? integerValue(env.SOLVEN_SESSION_TTL_SECONDS, 1800),
    csrfEnabled: overrides.csrfEnabled ?? booleanValue(env.SOLVEN_CSRF_ENABLED, true),
    maxBodyBytes: overrides.maxBodyBytes ?? integerValue(env.SOLVEN_MAX_BODY_BYTES, 32768),
    corsMode: overrides.corsMode || env.SOLVEN_CORS_MODE || "same-origin",
    contentSecurityPolicy: overrides.contentSecurityPolicy || env.SOLVEN_CONTENT_SECURITY_POLICY || "default-src 'self'; img-src 'self' data: https://www.google-analytics.com; style-src 'self'; script-src 'self' https://www.googletagmanager.com; connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    referrerPolicy: overrides.referrerPolicy || env.SOLVEN_REFERRER_POLICY || "strict-origin-when-cross-origin",
    permissionsPolicy: overrides.permissionsPolicy || env.SOLVEN_PERMISSIONS_POLICY || "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    hstsMaxAge: overrides.hstsMaxAge ?? integerValue(env.SOLVEN_HSTS_MAX_AGE, 0),
    hstsIncludeSubDomains: overrides.hstsIncludeSubDomains ?? booleanValue(env.SOLVEN_HSTS_INCLUDE_SUBDOMAINS, false),
    logPii: overrides.logPii ?? booleanValue(env.SOLVEN_LOG_PII, false),
    incidentCorrelationHeader: overrides.incidentCorrelationHeader || env.SOLVEN_INCIDENT_CORRELATION_HEADER || "x-request-id",
    leadStoreAdapter: overrides.leadStoreAdapter || env.SOLVEN_LEAD_STORE_ADAPTER || "local-file",
    outboxAdapter: overrides.outboxAdapter || env.SOLVEN_OUTBOX_ADAPTER || "local-file",
    notificationAdapter: overrides.notificationAdapter || env.SOLVEN_NOTIFICATION_ADAPTER || "local-file",
    sessionAdapter: overrides.sessionAdapter || env.SOLVEN_SESSION_ADAPTER || "local-memory",
    rateLimiterAdapter: overrides.rateLimiterAdapter || env.SOLVEN_RATE_LIMITER_ADAPTER || "local-memory",
    secretManagerRef: overrides.secretManagerRef || env.SOLVEN_SECRET_MANAGER_REF || "",
    secretNamespace: overrides.secretNamespace || env.SOLVEN_SECRET_NAMESPACE || "",
    leadStoreSecretRef: overrides.leadStoreSecretRef || env.SOLVEN_LEAD_STORE_SECRET_REF || "",
    notificationSecretRef: overrides.notificationSecretRef || env.SOLVEN_NOTIFICATION_SECRET_REF || "",
    notificationDestinationRef: overrides.notificationDestinationRef || env.SOLVEN_NOTIFICATION_DESTINATION_REF || "",
    ga4Enabled: overrides.ga4Enabled ?? booleanValue(env.SOLVEN_GA4_ENABLED, false),
    ga4MeasurementIdRef: overrides.ga4MeasurementIdRef || env.SOLVEN_GA4_MEASUREMENT_ID_REF || "",
    retentionDays: overrides.retentionDays ?? integerValue(env.SOLVEN_RETENTION_DAYS, 730),
    firestoreProjectId: overrides.firestoreProjectId || env.SOLVEN_FIRESTORE_PROJECT_ID || "",
    backupTargetRef: overrides.backupTargetRef || env.SOLVEN_BACKUP_TARGET_REF || "",
    staging: overrides.staging ?? booleanValue(env.SOLVEN_STAGING, false),
    noindex: overrides.noindex ?? booleanValue(env.SOLVEN_NOINDEX, runtimeEnvironment !== "production"),
    releaseId: overrides.releaseId || env.SOLVEN_RELEASE_ID || "local-development",
    sourceCommitSha: overrides.sourceCommitSha || env.SOLVEN_SOURCE_COMMIT_SHA || "0000000",
    runtimeDir: path.resolve(overrides.runtimeDir || env.SOLVEN_SITE_RUNTIME_DIR || path.join(process.cwd(), "runtime")),
    publicRoot: path.resolve(overrides.publicRoot || env.SOLVEN_PUBLIC_ROOT || path.join(process.cwd(), "public"))
  };
  return validateRuntimeConfiguration(config);
}
