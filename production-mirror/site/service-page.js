import { createAnalyticsClient } from "/analytics.js";

const analytics = createAnalyticsClient();
const service = document.body.dataset.service || "";

fetch("/data/runtime-config.json", { cache: "no-store" })
  .then((response) => response.ok ? response.json() : {})
  .then((config) => {
    analytics.configure(config);
    analytics.track("service_view", { service });
  })
  .catch(() => {});

for (const link of document.querySelectorAll("[data-service-cta]")) {
  link.addEventListener("click", () => analytics.track("cta_click", { method: "onsite", service }));
}
