import crypto from "node:crypto";
import net from "node:net";
import { assertRateLimitResult } from "../contracts/rate-limiter.mjs";

function normalizeIp(value) {
  const candidate = String(value || "").trim().replace(/^::ffff:/, "");
  return net.isIP(candidate) ? candidate.toLowerCase() : null;
}

function networkBucket(ip) {
  if (!ip) return "unknown";
  if (net.isIP(ip) === 4) return ip.split(".").slice(0, 3).join(".") + ".0/24";
  const sections = ip.split("::");
  const left = sections[0] ? sections[0].split(":").filter(Boolean) : [];
  const right = sections.length > 1 && sections[1] ? sections[1].split(":").filter(Boolean) : [];
  const expanded = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
    .slice(0, 8)
    .map((part) => part.padStart(4, "0"));
  return `${expanded.slice(0, 4).join(":")}::/64`;
}

export function trustsProxyHeaders(req, { trustedProxyMode = "off", trustedProxyAddresses = [] } = {}) {
  const peer = normalizeIp(req.socket?.remoteAddress);
  return trustedProxyMode === "edge" || (trustedProxyMode === "explicit" && peer && trustedProxyAddresses.map(normalizeIp).includes(peer));
}

export function trustedClientAddress(req, proxyConfig = {}) {
  const peer = normalizeIp(req.socket?.remoteAddress);
  if (!trustsProxyHeaders(req, proxyConfig)) return peer;
  const leftmost = String(req.headers?.["x-forwarded-for"] || "").split(",")[0];
  return normalizeIp(leftmost) || peer;
}

export function deriveRateLimitKey(req, sessionId, proxyConfig = {}) {
  return deriveRateLimitKeys(req, sessionId, proxyConfig).composite;
}

export function deriveRateLimitKeys(req, sessionId, proxyConfig = {}) {
  const address = trustedClientAddress(req, proxyConfig);
  const session = String(sessionId || "no-session");
  const network = networkBucket(address);
  const digest = (scope, value) => crypto.createHash("sha256").update(`${scope}|${value}`).digest("hex");
  return {
    composite: digest("composite", `${session}|${network}`),
    session: digest("session", session),
    network: digest("network", network)
  };
}

export class LocalMemoryRateLimiter {
  name = "local-memory";

  constructor({ limit = 5, sessionLimit = limit, networkLimit = Math.max(limit * 6, 30), windowMs = 60_000, nowMs = () => Date.now() } = {}) {
    this.limit = limit;
    this.sessionLimit = sessionLimit;
    this.networkLimit = networkLimit;
    this.windowMs = windowMs;
    this.nowMs = nowMs;
    this.entries = new Map();
  }

  async consume({ key, dimensions }) {
    if (!/^[a-f0-9]{64}$/.test(String(key))) throw new TypeError("invalid_rate_limit_key");
    const now = this.nowMs();
    const policies = dimensions ? [
      ["session", dimensions.session, this.sessionLimit],
      ["network", dimensions.network, this.networkLimit]
    ] : [["generic", key, this.limit]];
    const activePolicies = policies.map(([scope, dimensionKey, limit]) => {
      if (!/^[a-f0-9]{64}$/.test(String(dimensionKey)) || !Number.isInteger(limit) || limit < 1) {
        throw new TypeError("invalid_rate_limit_dimension");
      }
      const storageKey = `${scope}:${dimensionKey}`;
      return { storageKey, limit, active: (this.entries.get(storageKey) || []).filter((stamp) => now - stamp < this.windowMs) };
    });
    const blocked = activePolicies.filter(({ active, limit }) => active.length >= limit);
    if (blocked.length > 0) {
      const retryAfterSeconds = Math.max(...blocked.map(({ active }) => Math.max(1, Math.ceil((this.windowMs - (now - active[0])) / 1000))));
      return assertRateLimitResult({ allowed: false, retryAfterSeconds });
    }
    for (const policy of activePolicies) {
      policy.active.push(now);
      this.entries.set(policy.storageKey, policy.active);
    }
    return assertRateLimitResult({ allowed: true, retryAfterSeconds: 0 });
  }
}
