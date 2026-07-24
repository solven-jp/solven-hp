import assert from "node:assert/strict";
import test from "node:test";
import { validateBrowserE2ETarget } from "./browser-e2e-target-policy.mjs";

test("local browser E2E targets require no remote approval", () => {
  assert.equal(validateBrowserE2ETarget("http://127.0.0.1:4178/path"), "http://127.0.0.1:4178");
  assert.equal(validateBrowserE2ETarget("http://localhost:4178"), "http://localhost:4178");
});

test("remote browser E2E refuses an unapproved or non-HTTPS target", () => {
  assert.throws(() => validateBrowserE2ETarget("https://staging.example.invalid"), /remote_e2e_target_requires/);
  assert.throws(() => validateBrowserE2ETarget("http://staging.example.invalid", {
    SOLVEN_E2E_ALLOW_REMOTE: "true",
    SOLVEN_E2E_ALLOWED_REMOTE_ORIGINS: "http://staging.example.invalid"
  }), /remote_e2e_target_requires/);
});

test("remote browser E2E requires exact-origin allowlisting", () => {
  assert.throws(() => validateBrowserE2ETarget("https://other.example.invalid", {
    SOLVEN_E2E_ALLOW_REMOTE: "true",
    SOLVEN_E2E_ALLOWED_REMOTE_ORIGINS: "https://staging.example.invalid"
  }), /remote_e2e_target_requires/);
  assert.equal(validateBrowserE2ETarget("https://staging.example.invalid/path", {
    SOLVEN_E2E_ALLOW_REMOTE: "true",
    SOLVEN_E2E_ALLOWED_REMOTE_ORIGINS: "https://staging.example.invalid"
  }), "https://staging.example.invalid");
});
