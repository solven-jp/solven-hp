import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyticsClient } from "../public/analytics.js";

function browserFixture(protocol = "http:") {
  const scripts = [];
  let cookie = "";
  const documentRef = {
    head: { append(node) { scripts.push(node); } },
    createElement() { return { async: false, src: "", dataset: {} }; },
    get cookie() { return cookie; },
    set cookie(value) { cookie = value.split(";")[0]; }
  };
  const windowRef = { dataLayer: [], location: { protocol } };
  return { documentRef, windowRef, scripts };
}

test("Consent Mode defaults to denied and does not load GA4 before consent", () => {
  const f = browserFixture();
  const analytics = createAnalyticsClient(f);
  analytics.configure({ analytics: { enabled: true, provider: "ga4", measurementId: "G-TEST123" } });
  assert.equal(f.scripts.length, 0);
  assert.equal(analytics.track("generate_lead", { service: "HP" }), false);
  assert.deepEqual(f.windowRef.dataLayer[0].slice(0, 2), ["consent", "default"]);
  assert.equal(f.windowRef.dataLayer[0][2].analytics_storage, "denied");
});

test("grant loads one tag, emits only allowlisted non-PII fields, and revoke stops events", () => {
  const f = browserFixture("https:");
  const analytics = createAnalyticsClient(f);
  analytics.configure({ analytics: { enabled: true, provider: "ga4", measurementId: "G-TEST123" } });
  analytics.setConsent("granted");
  assert.equal(f.windowRef["ga-disable-G-TEST123"], false);
  assert.equal(f.scripts.length, 1);
  assert.match(f.scripts[0].src, /^https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-TEST123$/);
  assert.match(f.documentRef.cookie, /^solven_analytics_consent=granted/);
  assert.equal(analytics.track("generate_lead", { service: "HP", email: "person@example.com", message: "private" }), true);
  const event = f.windowRef.dataLayer.find((entry) => entry[0] === "event" && entry[1] === "generate_lead");
  assert.deepEqual(event[2], { service: "HP" });
  analytics.setConsent("denied");
  assert.equal(f.windowRef["ga-disable-G-TEST123"], true);
  assert.equal(analytics.track("form_submit", { form_id: "contact" }), false);
});

test("disabled or malformed runtime config never loads a remote tag", () => {
  const f = browserFixture();
  f.documentRef.cookie = "solven_analytics_consent=granted";
  const analytics = createAnalyticsClient(f);
  analytics.configure({ analytics: { enabled: true, provider: "ga4", measurementId: "not-an-id" } });
  assert.equal(f.scripts.length, 0);
  assert.equal(analytics.track("form_submit", { form_id: "contact" }), false);
});
