import { createAnalyticsClient } from "/analytics.js";
import { createOrganizationStructuredData, serializeStructuredData } from "/organization-data.js";

const YEN_SIGN = "\u00A5";
const wholeYen = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });
const status = document.querySelector("#form-status");
const contactForm = document.querySelector("#contact-form");
const formErrorSummary = document.querySelector("#form-error-summary");
const diagnosisForm = document.querySelector("#diagnosis-form");
const diagnosisResult = document.querySelector("#diagnosis-result");
const routeSelectionStatus = document.querySelector("#route-selection-status");
const organizationStructuredData = document.querySelector("#organization-structured-data");
const mobileMenuToggle = document.querySelector("#mobile-menu-toggle");
const mobileNavigation = document.querySelector("#mobile-navigation");
const consentButton = document.querySelector("#analytics-consent");
const consentStatus = document.querySelector("#analytics-status");
const analytics = createAnalyticsClient();
const serviceLabels = { HP: "HP", LP: "LP", WEBAPP: "Webアプリ", MAINTENANCE: "保守" };
let csrfToken = "";
let sessionId = "";
let pendingIdempotencyKey = "";
let formStarted = false;
let validationAttempted = false;
let routeHighlightTimer = 0;
let lastSyncedHash = null;
let runtimeEnvironment = "local";

function formatYen(value) {
  return `${YEN_SIGN}${wholeYen.format(value)}`;
}

function text(tag, value) {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}

function reducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function focusWithHeaderOffset(target, block = "center") {
  target.focus({ preventScroll: true });
  const root = document.documentElement;
  const previousScrollBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = "auto";

  try {
    if (block === "start") {
      const headerHeight = document.querySelector(".site-header")?.getBoundingClientRect().height || 0;
      const top = window.scrollY + target.getBoundingClientRect().top - headerHeight - 16;
      window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
      return;
    }

    target.scrollIntoView({ behavior: "auto", block });
  } finally {
    root.style.scrollBehavior = previousScrollBehavior;
  }
}

function setMobileNavigation(open, returnFocus = false) {
  mobileNavigation.hidden = !open;
  mobileMenuToggle.setAttribute("aria-expanded", String(open));
  mobileMenuToggle.setAttribute("aria-label", open ? "ページ内メニューを閉じる" : "ページ内メニューを開く");
  document.body.classList.toggle("mobile-navigation-open", open);
  if (open) mobileNavigation.querySelector("a")?.focus();
  else if (returnFocus) mobileMenuToggle.focus();
}

function focusSection(hash) {
  const target = document.querySelector(hash);
  if (!target) return;
  const heading = target.querySelector("h2, h3") || target;
  heading.setAttribute("tabindex", "-1");
  focusWithHeaderOffset(heading, "start");
}

function applyRouteSelection(route, announce = true) {
  const target = document.querySelector(`.work-story[data-diagnosis-route="${route}"]`);
  const radio = diagnosisForm.querySelector(`input[name="purpose"][value="${route}"]`);
  if (!target || !radio) return;
  radio.checked = true;
  for (const story of document.querySelectorAll(".work-story")) {
    story.classList.remove("is-selected");
    story.querySelector(".selected-route-marker")?.remove();
  }
  target.classList.add("is-selected");
  const marker = text("span", "選択した制作例");
  marker.className = "selected-route-marker";
  target.querySelector(".work-copy")?.prepend(marker);
  if (announce) routeSelectionStatus.textContent = `「${serviceLabels[route]}」を選択しました。対応する制作例を表示し、簡易診断にも反映しました。`;
  clearTimeout(routeHighlightTimer);
  routeHighlightTimer = window.setTimeout(() => {
    target.classList.remove("is-selected");
    marker.remove();
  }, 5000);
}

function syncRouteSelectionFromLocation() {
  if (location.hash === lastSyncedHash) return;
  lastSyncedHash = location.hash;
  const target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
  if (target?.dataset.diagnosisRoute) applyRouteSelection(target.dataset.diagnosisRoute);
}

function diagnosisSummary({ label, timing, budget, note }) {
  return [
    "簡易診断の相談概要（目安）",
    `希望サービス：${label}`,
    `希望時期：${timing || "未定"}`,
    `予算感：${budget || "未定"}`,
    `補足条件：${note || "未入力"}`,
    "範囲、データ、権限、運用条件は相談時に確認します。"
  ].join("\n");
}

function transferDiagnosisToContact({ route, timing, summary }) {
  const service = contactForm.elements.namedItem("service");
  const contactTiming = contactForm.elements.namedItem("timing");
  const message = contactForm.elements.namedItem("message");
  service.value = serviceLabels[route];
  if (timing) contactTiming.value = timing;
  if (!message.value.trim()) message.value = summary;
  else if (!message.value.includes(summary)) message.value = `${message.value.trim()}\n\n${summary}`;
  for (const control of [service, contactTiming, message]) {
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const firstRequired = [...contactForm.elements].find((control) => control.required && !control.validity.valid);
  focusWithHeaderOffset(firstRequired || service);
}

function renderDiagnosisResult({ route, timing, budget, note }) {
  const label = serviceLabels[route];
  const summary = diagnosisSummary({ label, timing, budget, note });
  const heading = text("h3", "相談時の整理結果（目安）");
  const lead = text("p", "確定見積や適合保証ではありません。相談時に確認する内容を整理した結果です。");
  const details = document.createElement("dl");
  for (const [term, value] of [
    ["希望サービス", label],
    ["希望時期", timing || "未定"],
    ["予算感", budget || "未定"],
    ["補足条件", note || "未入力"]
  ]) details.append(text("dt", term), text("dd", value));
  const guidance = text("p", "範囲、データ、権限、運用条件は相談時に確認します。");
  const action = text("button", "この内容で相談する");
  action.type = "button";
  action.className = "button primary diagnosis-contact-action";
  action.addEventListener("click", () => transferDiagnosisToContact({ route, timing, summary }));
  diagnosisResult.replaceChildren(heading, lead, details, guidance, action);
  diagnosisResult.dataset.state = "diagnosis";
  focusWithHeaderOffset(diagnosisResult);
}

const validationControls = [...contactForm.elements].filter((control) => control.name && control.name !== "website");
const fieldNames = {
  company: "会社・事業名",
  name: "氏名",
  email: "メール",
  phone: "電話",
  service: "希望サービス",
  timing: "希望時期",
  message: "相談内容",
  privacy_consent: "プライバシーポリシーへの同意"
};

function fieldErrorElement(control) {
  const id = `${control.id}-error`;
  let error = document.getElementById(id);
  if (!error) {
    error = text("span", "");
    error.id = id;
    error.className = "field-error";
    error.hidden = true;
    control.closest("label")?.append(error);
  }
  return error;
}

function fieldErrorMessage(control) {
  const validity = control.validity;
  if (validity.valid) return "";
  if (validity.valueMissing) {
    if (control.name === "privacy_consent") return "プライバシーポリシーへの同意が必要です。";
    if (control.name === "service") return "希望サービスを選択してください。";
    return `${fieldNames[control.name]}を入力してください。`;
  }
  if (validity.typeMismatch && control.name === "email") return "メールアドレスを正しい形式で入力してください。";
  if (validity.tooShort) return `${fieldNames[control.name]}は${control.minLength}文字以上で入力してください。`;
  if (validity.tooLong) return `${fieldNames[control.name]}は${control.maxLength}文字以内で入力してください。`;
  return `${fieldNames[control.name] || "入力内容"}を確認してください。`;
}

function setFieldError(control, message) {
  const error = fieldErrorElement(control);
  const describedBy = new Set((control.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
  if (message) {
    error.textContent = message;
    error.hidden = false;
    control.setAttribute("aria-invalid", "true");
    describedBy.add(error.id);
  } else {
    error.textContent = "";
    error.hidden = true;
    control.removeAttribute("aria-invalid");
    describedBy.delete(error.id);
  }
  if (describedBy.size) control.setAttribute("aria-describedby", [...describedBy].join(" "));
  else control.removeAttribute("aria-describedby");
}

function validateContactForm() {
  return validationControls.flatMap((control) => {
    const message = fieldErrorMessage(control);
    setFieldError(control, message);
    return message ? [{ control, message }] : [];
  });
}

function renderErrorSummary(errors) {
  formErrorSummary.replaceChildren();
  if (!errors.length) {
    formErrorSummary.hidden = true;
    return;
  }
  formErrorSummary.hidden = false;
  formErrorSummary.append(text("h4", "入力内容を確認してください"), text("p", `${errors.length}件の項目に修正が必要です。`));
  const list = document.createElement("ul");
  for (const { control, message } of errors) {
    const item = document.createElement("li");
    const link = text("a", `${fieldNames[control.name]}：${message}`);
    link.href = `#${control.id}`;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      focusWithHeaderOffset(control);
    });
    item.append(link);
    list.append(item);
  }
  formErrorSummary.append(list);
}

function clearContactValidation() {
  validationAttempted = false;
  for (const control of validationControls) setFieldError(control, "");
  renderErrorSummary([]);
}

function scopeItems(plan) {
  const items = [`${plan.standard_scope.primary_pages}ページ`];
  if (plan.standard_scope.max_sections) items.push(`最大${plan.standard_scope.max_sections}セクション`);
  items.push(`フォーム ${plan.standard_scope.forms}`);
  if (plan.standard_scope.cms_types) items.push(`CMS ${plan.standard_scope.cms_types}種`);
  if (plan.standard_scope.initial_posts) items.push(`初期投稿 ${plan.standard_scope.initial_posts}件`);
  if (plan.standard_delivery_business_days) items.push(`標準 ${plan.standard_delivery_business_days}営業日`);
  return items;
}

function planTarget(plan) {
  const targets = {
    "lp-start": "1ページで、一つの目的へ案内したい場合",
    "hp-start-html": "更新頻度が低い、基本的な会社サイト",
    "hp-start-wordpress": "自社でお知らせ等を更新したい会社サイト",
    "hp-growth": "複数の情報をCMSで継続運用する個別設計"
  };
  return targets[plan.plan_id] || "個別の要件に合わせて確認";
}

function addScopeList(card, plan) {
  const list = document.createElement("ul");
  list.className = "scope-list";
  for (const item of scopeItems(plan)) list.append(text("li", item));
  card.append(list);
}

function addHplpPlan(container, plan) {
  const card = document.createElement("article");
  card.className = `price-plan${plan.public_fixed_price ? "" : " quote-plan"}`;

  const top = document.createElement("div");
  top.className = "plan-top";
  const title = document.createElement("div");
  title.append(text("small", plan.technology === "wordpress" ? "WORDPRESS" : "STATIC HTML"), text("h3", plan.name));
  const target = text("p", planTarget(plan));
  target.className = "plan-target";
  top.append(title, target);
  card.append(top);

  const equation = document.createElement("div");
  equation.className = "price-equation";
  if (plan.public_fixed_price) {
    const production = document.createElement("span");
    production.append(text("small", "制作費（税別）"), text("b", formatYen(plan.production_consideration_ex_tax)));
    const payment = document.createElement("span");
    payment.append(text("small", "通常支払"), text("b", "40%・30%・30%"));
    equation.append(production, payment);
  } else {
    equation.append(text("strong", "個別見積"), text("p", "固定価格としては公開しません。"));
  }
  card.append(equation);

  if (plan.public_fixed_price) {
    const schedule = document.createElement("dl");
    schedule.className = "payment-schedule";
    for (const installment of plan.production_payment_schedule) {
      schedule.append(
        text("dt", `${installment.label} ${Math.round(installment.percentage * 100)}%`),
        text("dd", formatYen(installment.amount_ex_tax))
      );
    }
    card.append(schedule);

    const maintenance = text(
      "p",
      `公開後保守 ${formatYen(plan.maintenance.monthly_fee_ex_tax)}／月（税別）・最低${plan.maintenance.minimum_months}か月`
    );
    maintenance.className = "plan-maintenance";
    card.append(maintenance);

    const totals = document.createElement("div");
    totals.className = "price-total";
    const exTax = document.createElement("span");
    exTax.append(text("small", "最低契約総額（税別）"), text("strong", formatYen(plan.minimum_contract_total_ex_tax)));
    const inTax = document.createElement("span");
    inTax.append(text("small", "税込参考（10%）"), text("strong", formatYen(plan.minimum_contract_total_in_tax_at_10pct)));
    totals.append(exTax, inTax);
    card.append(totals);
  }
  addScopeList(card, plan);
  container.append(card);
}

function addWebappPlan(container, plan) {
  const card = document.createElement("article");
  card.className = "webapp-plan";
  card.append(text("small", "STARTING PRICE"), text("h4", plan.name));
  const price = text("strong", `${formatYen(plan.starting_price)}〜`);
  price.className = "starting-price";
  card.append(price);
  card.append(
    text("p", plan.screens_guide ? `画面目安 ${plan.screens_guide}` : "画面数は個別要件により決定"),
    text("p", plan.roles_guide ? `権限目安 ${plan.roles_guide}` : "権限は個別要件により決定"),
    text("p", "有償の要件整理を原則先行します。")
  );
  container.append(card);
}

function addMaintenanceOptions(container, maintenance) {
  container.append(text("strong", "Webアプリ保守（月額・税別）"));
  const labels = { self: "セルフ", light: "ライト", standard: "スタンダード", priority: "優先対応" };
  for (const [key, option] of Object.entries(maintenance)) {
    const item = document.createElement("div");
    item.className = "maintenance-option";
    const amount = option.monthly_from ?? option.monthly;
    if (key === "self") {
      item.append(
        text("b", `保守契約なし ${formatYen(amount)}`),
        text("small", "作業枠・障害対応・SLAは含みません")
      );
    } else {
      item.append(
        text("b", `${labels[key]} ${formatYen(amount)}${option.monthly_from !== undefined ? "〜" : ""}`),
        text("small", `個別作業 ${option.included_custom_work_minutes}分を含む`)
      );
    }
    container.append(item);
  }
}

function updateConsentControl() {
  const granted = analytics.getConsent() === "granted";
  consentButton.textContent = granted ? "アクセス解析を停止する" : "アクセス解析を許可する";
  consentButton.setAttribute("aria-pressed", String(granted));
  consentStatus.textContent = granted ? "現在：アクセス解析を許可中" : "現在：アクセス解析は停止中";
}

function disableContactFormForStaging() {
  for (const control of contactForm.elements) control.disabled = true;
  contactForm.setAttribute("aria-disabled", "true");
  for (const control of diagnosisForm.elements) control.disabled = true;
  diagnosisForm.setAttribute("aria-disabled", "true");
  status.replaceChildren(text("span", "このページは検証環境です。お問い合わせの送信は受け付けていません。実在する個人情報・顧客情報は入力しないでください。"));
  status.dataset.state = "staging";
  diagnosisResult.replaceChildren(text("span", "このページは検証環境です。簡易診断は利用できません。実在する個人情報・顧客情報は入力しないでください。"));
  diagnosisResult.dataset.state = "staging";
}

function enableContactFormForInteractiveRuntime() {
  for (const control of contactForm.elements) control.disabled = false;
  contactForm.removeAttribute("aria-disabled");
  for (const control of diagnosisForm.elements) control.disabled = false;
  diagnosisForm.removeAttribute("aria-disabled");
}

async function loadRuntimeConfig() {
  const response = await fetch("/data/runtime-config.json", { cache: "no-store" });
  const runtimeConfig = response.ok ? await response.json() : {};
  runtimeEnvironment = ["local", "production"].includes(runtimeConfig.environment) ? runtimeConfig.environment : "staging";
  analytics.configure(runtimeConfig);
  if (runtimeEnvironment === "staging") disableContactFormForStaging();
  else enableContactFormForInteractiveRuntime();
  updateConsentControl();
}

async function loadCanonical() {
  const response = await fetch("/data/owned-site.json", { cache: "no-store" });
  if (!response.ok) throw new Error("正本データを読み込めませんでした。");
  const data = await response.json();
  if (!document.body.classList.contains("live-design")) {
    const catchcopy = document.querySelector("#brand-catchcopy");
    const [catchcopyLead, ...catchcopyRest] = data.brand.catchcopy.split("、");
    catchcopy.replaceChildren(text("span", `${catchcopyLead}、`), text("span", catchcopyRest.join("、")));
    document.querySelector("#top").setAttribute("aria-label", data.brand.message);
  }
  const hplp = document.querySelector("#hplp-pricing");
  for (const plan of data.pricing.hplp) addHplpPlan(hplp, plan);
  const webapp = document.querySelector("#webapp-pricing");
  for (const plan of data.pricing.webapp) addWebappPlan(webapp, plan);
  addMaintenanceOptions(document.querySelector("#maintenance-pricing"), data.pricing.webapp_maintenance);
  const company = document.querySelector("#company-details");
  for (const [label, value] of [
    ["商号", data.company.legal_name],
    ["代表者", `${data.company.representative_role} ${data.company.representative_name}`],
    ["所在地", `〒${data.company.registered_postal_code} ${data.company.registered_address}`],
    ["メール", data.company.business_email]
  ]) company.append(text("dt", label), text("dd", value));
  organizationStructuredData.textContent = serializeStructuredData(createOrganizationStructuredData(data.company));
}

async function prepareSession() {
  const response = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("session_unavailable");
  const session = await response.json();
  csrfToken = session.csrf_token;
  sessionId = session.session_transport === "header" && typeof session.session_id === "string" ? session.session_id : "";
  if (!csrfToken || (session.session_transport === "header" && !sessionId)) throw new Error("session_unavailable");
}

function safeReferrer() {
  if (!document.referrer) return "";
  try { return new URL(document.referrer).origin; } catch { return ""; }
}

diagnosisForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (runtimeEnvironment === "staging") return;
  const form = new FormData(event.currentTarget);
  const route = form.get("purpose");
  renderDiagnosisResult({
    route,
    timing: String(form.get("timing") || "").trim(),
    budget: String(form.get("budget") || "").trim(),
    note: String(form.get("note") || "").trim()
  });
  analytics.track("diagnosis_complete", { route: String(route || "") });
});

for (const routeLink of document.querySelectorAll(".purpose-route[data-diagnosis-route]")) {
  routeLink.addEventListener("click", (event) => {
    event.preventDefault();
    const route = routeLink.dataset.diagnosisRoute;
    applyRouteSelection(route);
    history.pushState(null, "", routeLink.hash);
    lastSyncedHash = routeLink.hash;
    focusSection(routeLink.hash);
  });
}

syncRouteSelectionFromLocation();
window.addEventListener("popstate", syncRouteSelectionFromLocation);
window.addEventListener("hashchange", syncRouteSelectionFromLocation);

mobileMenuToggle.addEventListener("click", () => {
  setMobileNavigation(mobileMenuToggle.getAttribute("aria-expanded") !== "true");
});

for (const link of mobileNavigation.querySelectorAll('a[href^="#"]')) {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    setMobileNavigation(false);
    history.pushState(null, "", link.hash);
    lastSyncedHash = link.hash;
    focusSection(link.hash);
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && mobileMenuToggle.getAttribute("aria-expanded") === "true") setMobileNavigation(false, true);
});

document.addEventListener("pointerdown", (event) => {
  if (mobileMenuToggle.getAttribute("aria-expanded") === "true" && !event.target.closest(".site-header")) setMobileNavigation(false);
});

matchMedia("(min-width: 901px)").addEventListener("change", (event) => {
  if (event.matches) setMobileNavigation(false);
});

contactForm.addEventListener("focusin", () => {
  if (formStarted) return;
  formStarted = true;
  analytics.track("form_start", { form_id: "contact" });
});

contactForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (runtimeEnvironment === "staging") {
    disableContactFormForStaging();
    return;
  }
  validationAttempted = true;
  const errors = validateContactForm();
  renderErrorSummary(errors);
  if (errors.length) {
    focusWithHeaderOffset(errors[0].control);
    return;
  }
  const submitButton = contactForm.querySelector("button[type=submit]");
  status.textContent = "記録しています…";
  status.dataset.state = "pending";
  contactForm.setAttribute("aria-busy", "true");
  submitButton.disabled = true;
  const form = new FormData(contactForm);
  const payload = Object.fromEntries(form.entries());
  payload.privacy_consent = form.get("privacy_consent") === "on";
  const params = new URLSearchParams(location.search);
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) payload[key] = params.get(key) || "";
  payload.landing_page = location.pathname;
  payload.referrer = safeReferrer();
  pendingIdempotencyKey ||= crypto.randomUUID();
  try {
    if (!csrfToken) await prepareSession();
    const headers = { "content-type": "application/json", "x-solven-csrf": csrfToken, "idempotency-key": pendingIdempotencyKey };
    if (sessionId) headers["x-solven-session"] = sessionId;
    const response = await fetch("/api/leads", {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "記録できませんでした。");
    const message = text("span", "お問い合わせを受け付けました。原則として1営業日以内にご連絡します。");
    const receipt = text("strong", `受付番号：${body.receipt_id}`);
    status.replaceChildren(message, receipt);
    status.dataset.state = "success";
    analytics.track("form_submit", { form_id: "contact", service: String(payload.service || "") });
    analytics.track("generate_lead", { form_id: "contact", service: String(payload.service || "") });
    analytics.track("thank_you_view", { form_id: "contact" });
    contactForm.reset();
    clearContactValidation();
    pendingIdempotencyKey = "";
    formStarted = false;
    status.focus({ preventScroll: true });
    status.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
  } catch (error) {
    status.textContent = `${error.message} 入力内容を保持したまま、時間をおいて再度お試しください。`;
    status.dataset.state = "error";
    analytics.track("form_error", { form_id: "contact" });
  } finally {
    contactForm.removeAttribute("aria-busy");
    submitButton.disabled = false;
  }
});

for (const control of validationControls) {
  for (const eventName of ["input", "change"]) {
    control.addEventListener(eventName, () => {
      if (!validationAttempted && control.getAttribute("aria-invalid") !== "true") return;
      renderErrorSummary(validateContactForm());
    });
  }
}

for (const link of document.querySelectorAll('a[href="#contact"]')) {
  link.addEventListener("click", () => analytics.track("contact_cta", { method: "onsite" }));
}

consentButton.addEventListener("click", () => {
  analytics.setConsent(analytics.getConsent() === "granted" ? "denied" : "granted");
  updateConsentControl();
});

updateConsentControl();
loadRuntimeConfig()
  .then(() => runtimeEnvironment === "staging" ? undefined : prepareSession())
  .catch(() => { csrfToken = ""; updateConsentControl(); });
loadCanonical().catch((error) => { status.textContent = error.message; status.dataset.state = "error"; });
