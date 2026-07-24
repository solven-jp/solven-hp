import assert from "node:assert/strict";
import test from "node:test";
import { LocalMemoryRateLimiter, deriveRateLimitKey, deriveRateLimitKeys, trustedClientAddress, trustsProxyHeaders } from "../src/adapters/local-memory-rate-limiter.mjs";
import { assertRateLimiter } from "../src/contracts/rate-limiter.mjs";

function request(peer, forwarded) {
  return { socket: { remoteAddress: peer }, headers: forwarded ? { "x-forwarded-for": forwarded } : {} };
}

test("untrusted forwarded addresses are ignored and explicit trusted proxies are honored", () => {
  const forged = request("192.0.2.10", "198.51.100.20");
  assert.equal(trustedClientAddress(forged, { trustedProxyMode: "off" }), "192.0.2.10");
  assert.equal(trustedClientAddress(forged, { trustedProxyMode: "explicit", trustedProxyAddresses: ["192.0.2.10"] }), "198.51.100.20");
  assert.equal(trustedClientAddress(request("192.0.2.10", "invalid, 198.51.100.20"), { trustedProxyMode: "explicit", trustedProxyAddresses: ["192.0.2.10"] }), "192.0.2.10");
  assert.equal(trustedClientAddress(forged, { trustedProxyMode: "edge" }), "198.51.100.20");
  assert.equal(trustsProxyHeaders(request("192.0.2.10"), { trustedProxyMode: "explicit", trustedProxyAddresses: ["192.0.2.10"] }), true);
  assert.notEqual(deriveRateLimitKey(forged, "session-a", { trustedProxyMode: "off" }), deriveRateLimitKey(forged, "session-b", { trustedProxyMode: "off" }));
  assert.equal(
    deriveRateLimitKey(request("2001:db8:1:2::1"), "session-a"),
    deriveRateLimitKey(request("2001:0db8:0001:0002:ffff::2"), "session-a")
  );
});

test("local limiter returns 429-compatible Retry-After semantics without permanent rejection", async () => {
  let now = 1_000;
  const limiter = new LocalMemoryRateLimiter({ limit: 2, windowMs: 1_000, nowMs: () => now });
  const key = "b".repeat(64);
  assert.equal((await limiter.consume({ key })).allowed, true);
  assert.equal((await limiter.consume({ key })).allowed, true);
  const denied = await limiter.consume({ key });
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 1);
  now += 1_001;
  assert.equal((await limiter.consume({ key })).allowed, true);
});

test("rotating sessions cannot bypass the higher network-prefix budget", async () => {
  let now = 1_000;
  const limiter = new LocalMemoryRateLimiter({ sessionLimit: 1, networkLimit: 2, windowMs: 1_000, nowMs: () => now });
  const first = deriveRateLimitKeys(request("192.0.2.10"), "session-a");
  const second = deriveRateLimitKeys(request("192.0.2.99"), "session-b");
  const third = deriveRateLimitKeys(request("192.0.2.200"), "session-c");
  assert.notEqual(first.session, second.session);
  assert.equal(first.network, second.network);
  assert.equal((await limiter.consume({ key: first.composite, dimensions: first })).allowed, true);
  assert.equal((await limiter.consume({ key: second.composite, dimensions: second })).allowed, true);
  const denied = await limiter.consume({ key: third.composite, dimensions: third });
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 1);
  now += 1_001;
  assert.equal((await limiter.consume({ key: third.composite, dimensions: third })).allowed, true);
});

test("distributed limiter boundary shares state across adapter instances", async () => {
  const shared = new Map();
  class DistributedFixture {
    async consume({ key }) {
      const count = shared.get(key) || 0;
      shared.set(key, count + 1);
      return count < 1 ? { allowed: true, retryAfterSeconds: 0 } : { allowed: false, retryAfterSeconds: 30 };
    }
  }
  const first = assertRateLimiter(new DistributedFixture());
  const second = assertRateLimiter(new DistributedFixture());
  const key = "c".repeat(64);
  assert.equal((await first.consume({ key })).allowed, true);
  assert.equal((await second.consume({ key })).allowed, false);
});
