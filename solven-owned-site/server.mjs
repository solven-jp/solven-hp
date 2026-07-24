#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LocalFileLeadStore } from "./src/adapters/local-file-lead-store.mjs";
import { LocalFileNotificationOutbox } from "./src/adapters/local-file-notification-outbox.mjs";
import { LocalFileNotificationAdapter } from "./src/adapters/local-file-notifier.mjs";
import { LocalMemoryRateLimiter, deriveRateLimitKeys, trustedClientAddress, trustsProxyHeaders } from "./src/adapters/local-memory-rate-limiter.mjs";
import { LocalMemorySessionStore } from "./src/adapters/local-memory-session-store.mjs";
import { createFirestoreStagingAdapters } from "./src/adapters/firestore-staging.mjs";
import { loadRuntimeConfiguration } from "./src/config/environment.mjs";
import { assertLeadStore, publicLeadReceipt } from "./src/contracts/lead-store.mjs";
import { assertNotificationOutbox } from "./src/contracts/notification-outbox.mjs";
import { assertRateLimiter, assertRateLimitResult } from "./src/contracts/rate-limiter.mjs";
import { validateLead, cleanString } from "./src/domain/lead.mjs";
import { correlationId, createSafeLogger } from "./src/security/safe-logger.mjs";
import { NotificationCoordinator } from "./src/services/notification-coordinator.mjs";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

function securityHeaders(config, contentType) {
  return {
    ...(contentType ? { "content-type": contentType } : {}),
    "content-security-policy": config.contentSecurityPolicy,
    "referrer-policy": config.referrerPolicy,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "permissions-policy": config.permissionsPolicy,
    "cross-origin-opener-policy": "same-origin",
    ...(config.hstsMaxAge > 0 ? { "strict-transport-security": `max-age=${config.hstsMaxAge}${config.hstsIncludeSubDomains ? "; includeSubDomains" : ""}` } : {})
  };
}

function json(res, config, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.length,
    ...securityHeaders(config),
    ...headers
  });
  res.end(payload);
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((part) => part.trim()).filter(Boolean).flatMap((part) => {
    const index = part.indexOf("=");
    if (index <= 0) return [];
    try { return [[part.slice(0, index), decodeURIComponent(part.slice(index + 1))]]; } catch { return []; }
  }));
}

const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requestSessionId(req, config) {
  if (config.sessionTransport === "header") {
    const candidate = req.headers["x-solven-session"];
    return typeof candidate === "string" && sessionIdPattern.test(candidate) ? candidate : "";
  }
  return parseCookies(req)[config.sessionCookieName] || "";
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes && !exceeded) {
        exceeded = true;
        reject(Object.assign(new Error("payload_too_large"), { status: 413 }));
        return;
      }
      if (!exceeded) chunks.push(chunk);
    });
    req.on("end", () => { if (!exceeded) resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
  });
}

function staticFile(publicRoot, urlPath) {
  let relative;
  try { relative = decodeURIComponent(urlPath.split("?")[0]); } catch { return null; }
  if (relative.endsWith("/")) relative += "index.html";
  relative = relative.replace(/^\/+/, "");
  const candidate = path.resolve(publicRoot, relative || "index.html");
  if (!candidate.startsWith(`${publicRoot}${path.sep}`)) return null;
  try {
    const realRoot = fs.realpathSync(publicRoot);
    const realCandidate = fs.realpathSync(candidate);
    return realCandidate.startsWith(`${realRoot}${path.sep}`) ? realCandidate : null;
  } catch {
    return null;
  }
}

function contentType(file) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png"
  })[path.extname(file)] || "application/octet-stream";
}

function requestHost(req) {
  try { return new URL(`http://${req.headers.host}`).hostname; } catch { return ""; }
}

function isHttps(req, config) {
  if (req.socket.encrypted) return true;
  return trustsProxyHeaders(req, config) && String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

function originAllowed(req, config) {
  const origin = String(req.headers.origin || "");
  if (!origin) return config.runtimeEnvironment === "local";
  return origin === config.publicOrigin;
}

function assertDeploymentAdapter(config, adapter, localNames) {
  if (config.runtimeEnvironment === "local") return adapter;
  const name = String(adapter?.name || "");
  if (!/^[A-Za-z0-9._-]{2,80}$/.test(name) || localNames.includes(name)) {
    throw new Error(`development_adapter_forbidden:${config.runtimeEnvironment}`);
  }
  return adapter;
}

function adapters(config, runtimeDir, now, nowMs, options) {
  const needsStagingAdapters = config.runtimeEnvironment === "staging" && ["leadStore", "outbox", "notifier", "rateLimiter", "sessionStore"].some((key) => !options[key]);
  const staging = needsStagingAdapters ? createFirestoreStagingAdapters({ projectId: config.firestoreProjectId, retentionDays: config.retentionDays }) : {};
  const localLeadStore = config.leadStoreAdapter === "local-file" ? new LocalFileLeadStore({ runtimeDir }) : null;
  const leadStore = assertLeadStore(options.leadStore || staging.leadStore || localLeadStore);
  if (!options.leadStore && !staging.leadStore && !localLeadStore) throw new Error(`lead_store_adapter_not_connected:${config.leadStoreAdapter}`);

  const localOutbox = config.outboxAdapter === "local-file" ? new LocalFileNotificationOutbox({ runtimeDir }) : null;
  const outbox = assertNotificationOutbox(options.outbox || staging.outbox || localOutbox);
  if (!options.outbox && !staging.outbox && !localOutbox) throw new Error(`outbox_adapter_not_connected:${config.outboxAdapter}`);

  let notifier = options.notifier || staging.notifier;
  if (!notifier && config.notificationAdapter === "local-file") notifier = new LocalFileNotificationAdapter({ runtimeDir });
  if (!notifier && config.notificationAdapter === "disabled") notifier = { name: "disabled", async notify() { return { status: "DISABLED" }; } };
  if (!notifier || typeof notifier.notify !== "function") throw new Error(`notification_adapter_not_connected:${config.notificationAdapter}`);

  const localRateLimiter = config.rateLimiterAdapter === "local-memory" ? new LocalMemoryRateLimiter({ nowMs }) : null;
  const rateLimiter = assertRateLimiter(options.rateLimiter || staging.rateLimiter || localRateLimiter);
  if (!options.rateLimiter && !staging.rateLimiter && !localRateLimiter) throw new Error(`rate_limiter_adapter_not_connected:${config.rateLimiterAdapter}`);

  const localSessionStore = config.sessionAdapter === "local-memory" ? new LocalMemorySessionStore({ nowMs }) : null;
  const sessionStore = options.sessionStore || staging.sessionStore || localSessionStore;
  if (!sessionStore || !["create", "get", "deleteExpired"].every((name) => typeof sessionStore[name] === "function")) {
    throw new Error(`session_adapter_not_connected:${config.sessionAdapter}`);
  }

  assertDeploymentAdapter(config, leadStore, ["local-file"]);
  assertDeploymentAdapter(config, outbox, ["local-file"]);
  assertDeploymentAdapter(config, notifier, ["local-file"]);
  assertDeploymentAdapter(config, rateLimiter, ["local-memory"]);
  assertDeploymentAdapter(config, sessionStore, ["local-memory"]);

  return {
    leadStore,
    outbox,
    notifier,
    rateLimiter,
    sessionStore,
    notifications: new NotificationCoordinator({ leadStore, outbox, notifier, now })
  };
}

export function createOwnedSiteServer(options = {}) {
  const runtimeDir = path.resolve(options.runtimeDir || process.env.SOLVEN_SITE_RUNTIME_DIR || path.join(appRoot, "runtime"));
  const publicRoot = path.resolve(options.publicRoot || process.env.SOLVEN_PUBLIC_ROOT || path.join(appRoot, "public"));
  const now = options.now || (() => new Date());
  const nowMs = options.nowMs || (() => Date.now());
  const config = loadRuntimeConfiguration(options.environment || process.env, { runtimeDir, publicRoot, ...options.config, ...(options.secureCookies === undefined ? {} : { secureCookies: options.secureCookies }) });
  const logger = options.logger || createSafeLogger();
  const { leadStore, notifications, rateLimiter, sessionStore } = adapters(config, runtimeDir, now, nowMs, options);

  return http.createServer(async (req, res) => {
    const requestCorrelationId = correlationId(req.headers[config.incidentCorrelationHeader]);
    const commonHeaders = { [config.incidentCorrelationHeader]: requestCorrelationId };
    try {
      if (!config.allowedHosts.includes(requestHost(req))) return json(res, config, 421, { error: "host_not_allowed" }, commonHeaders);
      if (config.requireHttps && !isHttps(req, config)) return json(res, config, 400, { error: "https_required" }, commonHeaders);
      const requestUrl = new URL(req.url || "/", config.publicOrigin);

      if (req.method === "GET" && requestUrl.pathname === "/api/health") {
        return json(res, config, 200, { status: "ok" }, { ...commonHeaders, "cache-control": "no-store" });
      }

      if (req.method === "GET" && requestUrl.pathname === "/api/session") {
        await sessionStore.deleteExpired();
        const sessionId = crypto.randomUUID();
        const csrf = crypto.randomBytes(24).toString("base64url");
        await sessionStore.create(sessionId, { csrf, expires: nowMs() + config.sessionTtlSeconds * 1000 });
        const session = { csrf_token: csrf, session_transport: config.sessionTransport };
        const headers = { ...commonHeaders, "cache-control": "no-store" };
        if (config.sessionTransport === "header") session.session_id = sessionId;
        else {
          const secure = config.secureCookies ? "; Secure" : "";
          headers["set-cookie"] = `${config.sessionCookieName}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=${config.cookieSameSite}; Max-Age=${config.sessionTtlSeconds}${secure}`;
        }
        return json(res, config, 200, session, headers);
      }

      if (req.method === "POST" && requestUrl.pathname === "/api/leads") {
        if (config.runtimeEnvironment === "staging") return json(res, config, 403, { error: "staging_lead_collection_disabled" }, commonHeaders);
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(String(req.headers["content-type"] || "").trim())) return json(res, config, 415, { error: "json_required" }, commonHeaders);
        if (!originAllowed(req, config)) return json(res, config, 403, { error: "origin_rejected" }, commonHeaders);
        const sessionId = requestSessionId(req, config);
        const session = await sessionStore.get(sessionId);
        if (!session || (config.csrfEnabled && req.headers["x-solven-csrf"] !== session.csrf)) return json(res, config, 403, { error: "csrf_rejected" }, commonHeaders);
        const rateLimitKeys = deriveRateLimitKeys(req, sessionId, config);
        const rateLimit = assertRateLimitResult(await rateLimiter.consume({
          key: rateLimitKeys.composite,
          dimensions: { session: rateLimitKeys.session, network: rateLimitKeys.network },
          client: { address: trustedClientAddress(req, config), hasSession: true },
          correlationId: requestCorrelationId
        }));
        if (!rateLimit.allowed) return json(res, config, 429, { error: "rate_limited" }, { ...commonHeaders, "retry-after": String(rateLimit.retryAfterSeconds) });

        const key = cleanString(req.headers["idempotency-key"], 200);
        if (!key) return json(res, config, 400, { error: "idempotency_key_required" }, commonHeaders);
        const prior = await leadStore.findByIdempotencyKey(key);
        if (prior) {
          const notificationStatus = await notifications.notificationStatus(prior);
          return json(res, config, 200, publicLeadReceipt({ ...prior, notification_status: notificationStatus }), { ...commonHeaders, "cache-control": "no-store" });
        }

        let input;
        try { input = JSON.parse(await readBody(req, config.maxBodyBytes)); } catch (error) { return json(res, config, error.status || 400, { error: error.message === "payload_too_large" ? error.message : "invalid_json" }, commonHeaders); }
        const validation = validateLead(input);
        if (validation.error) return json(res, config, validation.status, { error: validation.error }, commonHeaders);

        const created = await leadStore.create({ lead: validation.lead, receivedAt: now(), idempotencyKey: key });
        if (!created.created) {
          const notificationStatus = await notifications.notificationStatus(created.record);
          return json(res, config, 200, publicLeadReceipt({ ...created.record, notification_status: notificationStatus }), { ...commonHeaders, "cache-control": "no-store" });
        }
        const notification = await notifications.deliver(created.record);
        return json(res, config, 201, publicLeadReceipt({ ...created.record, notification_status: notification.status }), { ...commonHeaders, "cache-control": "no-store" });
      }

      if ((req.method === "GET" || req.method === "HEAD") && requestUrl.pathname === "/data/runtime-config.json") {
        return json(res, config, 200, {
          analytics: { enabled: config.ga4Enabled, provider: "ga4", measurementId: "" },
          environment: config.runtimeEnvironment
        }, { ...commonHeaders, "cache-control": "no-store" });
      }

      if (req.method !== "GET" && req.method !== "HEAD") return json(res, config, 405, { error: "method_not_allowed" }, commonHeaders);
      const file = staticFile(publicRoot, requestUrl.pathname);
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, config, 404, { error: "not_found" }, commonHeaders);
      const data = fs.readFileSync(file);
      res.writeHead(200, {
        ...securityHeaders(config, contentType(file)),
        ...commonHeaders,
        "content-length": data.length,
        "cache-control": file.endsWith(".html") || file.endsWith("runtime-config.json") ? "no-store" : "public, max-age=300"
      });
      if (req.method === "HEAD") return res.end();
      return res.end(data);
    } catch {
      logger.event({ event: "request_failed", correlation_id: requestCorrelationId, status: "internal_error" });
      if (!res.headersSent) return json(res, config, 500, { error: "internal_error" }, commonHeaders);
      return res.end();
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4178);
  const host = process.env.HOST || "127.0.0.1";
  createOwnedSiteServer().listen(port, host, () => process.stdout.write(`Solven owned-site local: http://${host}:${port}\n`));
}
