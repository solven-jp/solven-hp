const consentCookie = "solven_analytics_consent";
const permittedEvents = new Set([
  "service_view", "pricing_view", "plan_detail_view", "case_view", "contact_cta",
  "form_start", "form_error", "form_submit", "thank_you_view", "diagnosis_complete",
  "generate_lead"
]);
const permittedParameters = new Set(["service", "form_id", "method", "route"]);

function cookieValue(documentRef) {
  for (const part of String(documentRef.cookie || "").split(";")) {
    const [key, value] = part.trim().split("=");
    if (key === consentCookie) return value === "granted" ? "granted" : "denied";
  }
  return "denied";
}

function validMeasurementId(value) {
  return /^G-[A-Z0-9]{6,14}$/.test(String(value || ""));
}

export function createAnalyticsClient({ windowRef = window, documentRef = document } = {}) {
  windowRef.dataLayer = windowRef.dataLayer || [];
  const gtag = (...args) => windowRef.dataLayer.push(args);
  let config = { enabled: false, measurementId: "" };
  let tagLoaded = false;

  gtag("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    wait_for_update: 500
  });

  function getConsent() {
    return cookieValue(documentRef);
  }

  function loadTag() {
    if (tagLoaded || !config.enabled || !validMeasurementId(config.measurementId) || getConsent() !== "granted") return false;
    const script = documentRef.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.measurementId)}`;
    script.dataset.solvenAnalytics = "ga4";
    documentRef.head.append(script);
    gtag("js", new Date());
    gtag("config", config.measurementId, { allow_google_signals: false, allow_ad_personalization_signals: false, send_page_view: true });
    tagLoaded = true;
    return true;
  }

  function setConsent(value) {
    const normalized = value === "granted" ? "granted" : "denied";
    const secure = windowRef.location?.protocol === "https:" ? "; Secure" : "";
    documentRef.cookie = `${consentCookie}=${normalized}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    if (config.measurementId) windowRef[`ga-disable-${config.measurementId}`] = normalized !== "granted";
    if (normalized === "denied") {
      for (const part of String(documentRef.cookie || "").split(";")) {
        const name = part.trim().split("=")[0];
        if (name.startsWith("_ga")) documentRef.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
      }
    }
    gtag("consent", "update", {
      analytics_storage: normalized,
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied"
    });
    if (normalized === "granted") loadTag();
    return normalized;
  }

  function configure(runtimeConfig = {}) {
    const analytics = runtimeConfig.analytics || {};
    config = {
      enabled: analytics.enabled === true && analytics.provider === "ga4",
      measurementId: validMeasurementId(analytics.measurementId) ? analytics.measurementId : ""
    };
    if (config.measurementId) windowRef[`ga-disable-${config.measurementId}`] = getConsent() !== "granted";
    if (getConsent() === "granted") {
      gtag("consent", "update", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
      loadTag();
    }
    return { enabled: config.enabled && Boolean(config.measurementId), consent: getConsent() };
  }

  function track(eventName, parameters = {}) {
    if (getConsent() !== "granted" || !config.enabled || !config.measurementId || !permittedEvents.has(eventName)) return false;
    const safe = {};
    for (const [key, value] of Object.entries(parameters)) {
      if (permittedParameters.has(key) && typeof value === "string") safe[key] = value.slice(0, 80);
    }
    gtag("event", eventName, safe);
    return true;
  }

  return { configure, getConsent, setConsent, track };
}
