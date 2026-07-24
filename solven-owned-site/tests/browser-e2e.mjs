#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium, firefox, webkit } = require("playwright");
const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const screenshotRoot = path.resolve(process.env.SOLVEN_OWNER_SCREENSHOT_DIR || path.join(appRoot, "release", "screenshots"));
const baseUrl = process.env.SOLVEN_E2E_BASE_URL || "http://127.0.0.1:4178";
fs.mkdirSync(screenshotRoot, { recursive: true });

const results = [];
const screenshotNames = [
  "desktop-redesign.png",
  "mobile-redesign.png",
  "hero-detail.png",
  "demo-section.png",
  "pricing-section.png",
  "contact-section.png",
  "form-success.png",
  "form-success-chromium.png",
  "form-success-webkit.png",
  "form-success-firefox.png",
  "consent-states.png",
  "mobile-navigation.png",
  "purpose-route-lp.png",
  "diagnosis-result.png",
  "diagnosis-form-transfer.png",
  "form-validation-errors.png",
  "pricing-heading-1280.png"
];

function relativeLuminance([red, green, blue]) {
  const values = [red, green, blue].map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * values[0]) + (0.7152 * values[1]) + (0.0722 * values[2]);
}

function contrastRatio(foreground, background) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function rgb(value, background = [255, 255, 255]) {
  const channels = value.match(/[\d.]+/g)?.map(Number);
  assert.equal(channels?.length === 3 || channels?.length === 4, true, `unsupported color: ${value}`);
  const [red, green, blue, alpha = 1] = channels;
  return [red, green, blue].map((channel, index) => (channel * alpha) + (background[index] * (1 - alpha)));
}

async function assertNoHorizontalOverflow(page, label) {
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    true,
    `${label}: horizontal overflow`
  );
}

async function assertBelowStickyHeader(page, locator, label) {
  const positions = await locator.evaluate((element) => ({
    top: element.getBoundingClientRect().top,
    headerBottom: document.querySelector(".site-header").getBoundingClientRect().bottom
  }));
  assert.equal(positions.top >= positions.headerBottom, true, `${label}: hidden below sticky header`);
}

async function assertActiveBelowStickyHeader(page, label) {
  const positions = await page.evaluate(() => ({
    id: document.activeElement?.id || "",
    tag: document.activeElement?.tagName || "",
    top: document.activeElement?.getBoundingClientRect().top ?? -1,
    headerBottom: document.querySelector(".site-header").getBoundingClientRect().bottom
  }));
  assert.notEqual(positions.tag, "BODY", `${label}: focus was not moved to the destination`);
  assert.equal(positions.top >= positions.headerBottom, true, `${label}: hidden below sticky header`);
}

async function getVisualLines(locator) {
  return locator.evaluate((element) => {
    const lines = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      for (let index = 0; index < node.textContent.length; index += 1) {
        const character = node.textContent[index];
        if (/\s/.test(character)) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect = range.getClientRects()[0];
        if (!rect) continue;
        const top = Math.round(rect.top);
        const line = lines.find((entry) => Math.abs(entry.top - top) <= 1);
        if (line) line.text += character;
        else lines.push({ top, text: character });
      }
    }
    return lines.sort((left, right) => left.top - right.top).map((line) => line.text).filter(Boolean);
  });
}

for (const browserType of [chromium, webkit, firefox]) {
  const name = browserType.name();
  if (!fs.existsSync(browserType.executablePath())) {
    results.push({ browser: name, status: "NOT_RUN", reason: "playwright_browser_runtime_not_installed" });
    continue;
  }
  const browser = await browserType.launch({ headless: true });
  const browserVersion = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const externalRequests = [];
  const pageErrors = [];
  const observedPages = new WeakSet();
  const observePage = (observedPage) => {
    if (observedPages.has(observedPage)) return;
    observedPages.add(observedPage);
    observedPage.on("request", (request) => {
      const url = new URL(request.url());
      if (["http:", "https:"].includes(url.protocol) && url.origin !== new URL(baseUrl).origin) externalRequests.push(url.origin);
    });
    observedPage.on("pageerror", (error) => pageErrors.push(error.message));
  };
  context.on("page", observePage);
  const page = await context.newPage();
  observePage(page);
  await page.goto(`${baseUrl}/?utm_source=local-browser&utm_medium=qa&utm_campaign=2026q3-owned-site`, { waitUntil: "networkidle" });

  assert.equal(await page.title(), "Solven合同会社｜集客の入口から、現場の仕組みまで。");
  assert.equal(await page.locator('link[rel="canonical"]').getAttribute("href"), "https://solven.jp/");
  assert.equal(await page.locator('meta[property="og:url"]').getAttribute("content"), "https://solven.jp/");
  assert.equal(await page.locator('meta[property="og:image"]').getAttribute("content"), "https://solven.jp/og-image.png");
  assert.equal(await page.locator('meta[property="og:image:width"]').getAttribute("content"), "1200");
  assert.equal(await page.locator('meta[property="og:image:height"]').getAttribute("content"), "630");
  assert.equal(await page.locator('meta[name="twitter:card"]').getAttribute("content"), "summary_large_image");
  assert.equal(await page.locator('link[rel="icon"]').getAttribute("href"), "/favicon.svg");
  assert.equal(await page.locator('meta[name="theme-color"]').getAttribute("content"), "#0B1F35");
  const [ownedSiteResponse, robotsResponse, sitemapResponse, ogImageResponse, faviconResponse, officialLogoResponse] = await Promise.all([
    page.request.get(`${baseUrl}/data/owned-site.json`),
    page.request.get(`${baseUrl}/robots.txt`),
    page.request.get(`${baseUrl}/sitemap.xml`),
    page.request.get(`${baseUrl}/og-image.png`),
    page.request.get(`${baseUrl}/favicon.svg`),
    page.request.get(`${baseUrl}/assets/solven-logo-symbol.svg`)
  ]);
  assert.equal(ownedSiteResponse.status(), 200);
  const ownedSite = await ownedSiteResponse.json();
  const company = ownedSite.company;
  const organization = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
  assert.equal(organization["@context"], "https://schema.org");
  assert.equal(organization["@type"], "Organization");
  assert.equal(organization["@id"], "https://solven.jp/#organization");
  assert.equal(organization.name, company.legal_name);
  assert.equal(organization.url, "https://solven.jp/");
  assert.equal(organization.email, company.business_email);
  assert.deepEqual(organization.address, {
    "@type": "PostalAddress",
    postalCode: company.registered_postal_code,
    streetAddress: company.registered_address,
    addressCountry: "JP"
  });
  assert.equal(ownedSite.canonical.as_of, "2026-07-20");
  assert.deepEqual(ownedSite.pricing.hplp.filter((plan) => plan.public_fixed_price).map((plan) => ({
    production: plan.production_consideration_ex_tax,
    schedule: plan.production_payment_schedule.map((item) => item.percentage),
    maintenance: plan.maintenance.monthly_fee_ex_tax,
    minimumMonths: plan.maintenance.minimum_months
  })), [
    { production: 355000, schedule: [0.4, 0.3, 0.3], maintenance: 5500, minimumMonths: 6 },
    { production: 590000, schedule: [0.4, 0.3, 0.3], maintenance: 11000, minimumMonths: 6 },
    { production: 590000, schedule: [0.4, 0.3, 0.3], maintenance: 16500, minimumMonths: 6 }
  ]);
  assert.equal(robotsResponse.status(), 200);
  assert.equal(robotsResponse.headers()["content-type"], "text/plain; charset=utf-8");
  assert.equal((await robotsResponse.text()).trim(), "User-agent: *\nDisallow: /");
  assert.equal(sitemapResponse.status(), 200);
  assert.equal(sitemapResponse.headers()["content-type"], "application/xml; charset=utf-8");
  assert.match(await sitemapResponse.text(), /<loc>https:\/\/solven\.jp\/<\/loc>/);
  assert.equal(ogImageResponse.status(), 200);
  const ogImage = await ogImageResponse.body();
  assert.equal(ogImage.toString("hex", 0, 8), "89504e470d0a1a0a");
  assert.equal(ogImage.readUInt32BE(16), 1200);
  assert.equal(ogImage.readUInt32BE(20), 630);
  assert.equal(faviconResponse.status(), 200);
  assert.match(await faviconResponse.text(), /<svg[\s>]/);
  assert.equal(officialLogoResponse.status(), 200);
  assert.deepEqual(await faviconResponse.body(), await officialLogoResponse.body());
  assert.equal(await page.locator('img.brand-mark[src="/assets/solven-logo-symbol.svg"]').count(), 2);
  assert.equal(await page.locator('img.identity-mark[src="/assets/solven-logo-symbol.svg"]').count(), 1);
  assert.equal(await page.locator('.live-hero-photo image[href="/assets/solven-home-atlas.png"]').count(), 1);
  assert.deepEqual(await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return [style.getPropertyValue("--navy").trim(), style.getPropertyValue("--cyan").trim(), style.getPropertyValue("--white").trim()];
  }), ["#0b1f35", "#3884d2", "#fff"]);
  assert.equal(await page.locator("h1").count(), 1);
  assert.equal(await page.locator("main").count(), 1);
  assert.equal(await page.locator("#hplp-pricing article").count(), 4);
  assert.equal(await page.locator("#webapp-pricing article").count(), 4);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  assert.equal(await page.locator("label input, label textarea, label select").count() >= 10, true);
  assert.equal(await page.locator('[role="img"][aria-label]').count() >= 5, true);
  assert.equal(await page.locator(".work-story").count(), 3);
  assert.equal(await page.locator(".work-story").filter({ hasText: "DEMO" }).count(), 3);
  assert.equal(await page.locator(".identity-placeholder").count(), 1);
  const identityText = await page.locator(".identity-placeholder").textContent();
  assert.equal(identityText.includes(company.legal_name), true);
  assert.equal(identityText.includes(`${company.representative_role} ${company.representative_name}`), true);
  const companyDetailsText = await page.locator("#company-details").textContent();
  assert.equal(companyDetailsText.includes(company.registered_address), true);
  assert.equal(companyDetailsText.includes(company.business_email), true);
  assert.equal(await page.locator(".portrait-shape").count(), 0);
  assert.equal(await page.locator(".reply-note span").textContent(), "フォームは24時間受け付けています。原則として1営業日以内にご連絡します。土日祝日・年末年始にいただいたお問い合わせは、翌営業日以降の対応となります。");
  assert.equal(await page.locator('#contact-form button[type="submit"]').textContent(), "無料相談を送信する");
  assert.equal(await page.getByRole("link", { name: /無料の初回相談/ }).count() >= 2, true);
  assert.equal(await page.getByRole("link", { name: "料金プランを見る", exact: true }).count(), 1);
  const pricingText = await page.locator("#pricing").textContent();
  assert.match(pricingText, /契約・着手時40% ＋ 要件・設計承認時30% ＋ 公開・納品前30%/);
  assert.match(await page.locator("#hplp-pricing").textContent(), /LP Start[\s\S]*制作費（税別）\u00A5355,000/);
  assert.match(await page.locator("#hplp-pricing").textContent(), /契約・制作枠確定時 40%\u00A5142,000/);
  assert.match(await page.locator("#hplp-pricing").textContent(), /公開後保守 \u00A55,500／月（税別）・最低6か月/);
  assert.match(await page.locator("#hplp-pricing").textContent(), /最低契約総額（税別）\u00A5388,000/);
  assert.match(await page.locator("#hplp-pricing").textContent(), /税込参考（10%）\u00A5426,800/);
  assert.doesNotMatch(pricingText, /初期費用と月額24回|月額 × 24回|HP・LPの24回構造/);
  assert.doesNotMatch(await page.locator("#pricing").textContent(), /\uFFE5/);
  assert.match(await page.locator("#hplp-pricing").textContent(), /HP Growth[\s\S]*個別見積/);
  assert.doesNotMatch(await page.locator("#hplp-pricing").textContent(), /個別見積（パイロット）/);
  assert.match(await page.locator("#maintenance-pricing").textContent(), /保守契約なし \u00A50/);
  assert.match(await page.locator("#maintenance-pricing").textContent(), /作業枠・障害対応・SLAは含みません/);
  assert.doesNotMatch(await page.locator("#maintenance-pricing").textContent(), /セルフ \u00A50|個別作業 0分を含む/);
  assert.doesNotMatch(await page.locator("body").textContent(), /導入社数|売上\d+%|問い合わせ\d+倍|お客様の声/);
  assert.doesNotMatch(await page.locator("body").textContent(), /Owner|公開前|ここへ明記|Lead ID/);
  assert.equal(await page.locator(".pricing-section h2").textContent(), "サービスごとの料金体系を、分かりやすくご案内します。");
  const paymentFaq = page.locator(".payment-faq details");
  assert.equal(await paymentFaq.count(), 3);
  assert.match(await paymentFaq.nth(2).textContent(), /要件整理費、保守料、追加作業、第三者費用・実費・立替金は対象外/);
  assert.deepEqual(await page.locator(".contact-heading span").allTextContents(), ["まだ要件が", "決まっていなくても、", "相談できます。"]);
  assert.equal(await page.locator(".contact-guide li").nth(2).locator("small").textContent(), "予算感は未定でも構いません。決まっている場合は相談内容欄へご記入ください。");
  assert.equal(await page.locator('footer a[href="/privacy/"]').textContent(), "プライバシー");
  assert.equal(await page.locator('footer a[href="/disclaimer/"]').textContent(), "免責事項");

  const requiredState = await page.locator("#contact-form").evaluate((form) => Object.fromEntries(
    ["company", "name", "email", "phone", "service", "timing", "message", "privacy_consent"]
      .map((name) => [name, form.elements.namedItem(name).required])
  ));
  assert.deepEqual(requiredState, {
    company: false,
    name: true,
    email: true,
    phone: false,
    service: true,
    timing: false,
    message: true,
    privacy_consent: true
  });

  const skipInitial = await page.locator(".skip").evaluate((skip) => {
    const style = getComputedStyle(skip);
    return { opacity: style.opacity, pointerEvents: style.pointerEvents, bottom: skip.getBoundingClientRect().bottom };
  });
  assert.equal(skipInitial.opacity, "0");
  assert.equal(skipInitial.pointerEvents, "none");
  assert.equal(skipInitial.bottom <= 0, true);
  await page.locator(".skip").focus();
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".skip").evaluate((skip) => {
    const style = getComputedStyle(skip);
    const rect = skip.getBoundingClientRect();
    return style.opacity === "1" && style.pointerEvents === "auto" && rect.top >= 0;
  }), true);
  await page.locator(".skip").evaluate((skip) => skip.blur());

  await paymentFaq.nth(1).locator("summary").click();
  assert.equal(await paymentFaq.nth(1).getAttribute("open"), "");
  const installmentTerms = await paymentFaq.nth(1).textContent();
  assert.match(installmentTerms, /案件内容と契約条件を確認のうえ、個別にご案内/);
  assert.doesNotMatch(installmentTerms, /直接原価|同時適用|現預金|延滞|知的財産権の移転/);

  const unlabeledControls = await page.locator("input, select, textarea, button").evaluateAll((controls) => controls.filter((control) => {
    if (control.closest('[aria-hidden="true"]')) return false;
    if (control.tagName === "BUTTON" && control.textContent.trim()) return false;
    const id = control.getAttribute("id");
    const labelledBy = control.getAttribute("aria-labelledby");
    const ariaLabel = control.getAttribute("aria-label");
    return !ariaLabel && !labelledBy && !control.closest("label") && !(id && document.querySelector(`label[for="${CSS.escape(id)}"]`));
  }).map((control) => control.outerHTML));
  assert.deepEqual(unlabeledControls, []);

  const contrastPairs = await page.evaluate(() => [
    ["body", "body"],
    [".header-cta", ".header-cta"],
    [".button.primary", ".button.primary"],
    [".works-section", ".works-section"],
    [".webapp-pricing-wrap", ".webapp-pricing-wrap"],
    [".contact-section .section-label", ".contact-section"],
    [".contact-guide > p:not(.section-label):not(.reply-note)", ".contact-section"],
    [".contact-guide li small", ".contact-section"],
    [".reply-note span", ".reply-note"]
  ].map(([foregroundSelector, backgroundSelector]) => {
    const foregroundStyle = getComputedStyle(document.querySelector(foregroundSelector));
    const background = getComputedStyle(document.querySelector(backgroundSelector)).backgroundColor;
    return { foregroundSelector, foreground: foregroundStyle.color, opacity: Number(foregroundStyle.opacity), background };
  }));
  for (const pair of contrastPairs) {
    const background = rgb(pair.background);
    const foreground = rgb(pair.foreground, background).map((channel, index) => (channel * pair.opacity) + (background[index] * (1 - pair.opacity)));
    assert.equal(contrastRatio(foreground, background) >= 4.5, true, `contrast ${pair.foregroundSelector}`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/?mobile-navigation=${name}`, { waitUntil: "networkidle" });
  const menuToggle = page.locator("#mobile-menu-toggle");
  assert.equal(await menuToggle.getAttribute("aria-expanded"), "false");
  assert.equal(await menuToggle.getAttribute("aria-controls"), "mobile-navigation");
  await menuToggle.click();
  assert.equal(await menuToggle.getAttribute("aria-expanded"), "true");
  assert.equal(await menuToggle.getAttribute("aria-label"), "ページ内メニューを閉じる");
  assert.equal(await page.locator("#mobile-navigation").isVisible(), true);
  assert.deepEqual(await page.locator("#mobile-navigation a").allTextContents(), ["相談できること", "制作の軸・対応例", "簡易診断", "料金プラン", "会社情報", "無料の初回相談"]);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("href")), "#services");
  if (name === "chromium") {
    await page.screenshot({ path: path.join(screenshotRoot, "mobile-navigation.png") });
  }
  await page.keyboard.press("Escape");
  assert.equal(await menuToggle.getAttribute("aria-expanded"), "false");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "mobile-menu-toggle");

  for (const hash of ["#services", "#works", "#diagnosis", "#pricing", "#company", "#contact"]) {
    await menuToggle.click();
    await page.locator(`#mobile-navigation a[href="${hash}"]`).click();
    assert.equal(await page.evaluate(() => window.location.hash), hash);
    assert.equal(await menuToggle.getAttribute("aria-expanded"), "false");
    await assertActiveBelowStickyHeader(page, `${name} ${hash}`);
  }
  await assertNoHorizontalOverflow(page, `${name} 390x844 mobile navigation`);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseUrl}/?purpose-routes=${name}`, { waitUntil: "networkidle" });
  const purposeRoutes = [
    { route: "HP", hash: "#work-hp", label: "HP" },
    { route: "LP", hash: "#work-lp", label: "LP" },
    { route: "WEBAPP", hash: "#work-webapp", label: "Webアプリ" }
  ];
  for (const { route, hash, label } of purposeRoutes) {
    await page.locator(`#services a[data-diagnosis-route="${route}"]`).click();
    assert.equal(await page.evaluate(() => window.location.hash), hash);
    assert.equal(await page.locator(hash).getAttribute("data-diagnosis-route"), route);
    assert.equal(await page.locator(hash).getAttribute("class").then((value) => value.includes("is-selected")), true);
    assert.equal(await page.locator(`${hash} .selected-route-marker`).textContent(), "選択した制作例");
    assert.equal(await page.locator(`#diagnosis-form input[value="${route}"]`).isChecked(), true);
    assert.match(await page.locator("#route-selection-status").textContent(), new RegExp(`「${label}」を選択しました`));
    if (name === "chromium" && route === "LP") {
      await page.locator(hash).screenshot({ path: path.join(screenshotRoot, "purpose-route-lp.png") });
    }
  }

  await page.evaluate(() => {
    window.__routeStatusMutationCount = 0;
    window.__routeStatusObserver = new MutationObserver((records) => { window.__routeStatusMutationCount += records.length; });
    window.__routeStatusObserver.observe(document.querySelector("#route-selection-status"), { childList: true, subtree: true, characterData: true });
  });
  await page.goBack();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.location.hash), "#work-lp");
  assert.equal(await page.locator("#work-lp").getAttribute("class").then((value) => value.includes("is-selected")), true);
  assert.equal(await page.locator('#diagnosis-form input[value="LP"]').isChecked(), true);
  assert.equal(await page.evaluate(() => window.__routeStatusMutationCount), 1);
  await page.evaluate(() => { window.__routeStatusMutationCount = 0; });
  await page.goForward();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.location.hash), "#work-webapp");
  assert.equal(await page.locator("#work-webapp").getAttribute("class").then((value) => value.includes("is-selected")), true);
  assert.equal(await page.locator('#diagnosis-form input[value="WEBAPP"]').isChecked(), true);
  assert.equal(await page.evaluate(() => window.__routeStatusMutationCount), 1);
  await page.evaluate(() => { window.__routeStatusObserver.disconnect(); });

  for (const [route, label] of Object.entries({ HP: "HP", LP: "LP", WEBAPP: "Webアプリ", MAINTENANCE: "保守" })) {
    await page.locator(`#diagnosis-form input[value="${route}"]`).check();
    await page.locator('#diagnosis-form [name="timing"]').fill("");
    await page.locator('#diagnosis-form [name="budget"]').fill("");
    await page.locator('#diagnosis-form [name="note"]').fill("");
    await page.locator('#diagnosis-form button[type="submit"]').click();
    await page.locator("#diagnosis-result").waitFor({ state: "visible" });
    const resultText = await page.locator("#diagnosis-result").textContent();
    assert.match(resultText, new RegExp(`希望サービス\\s*${label}`));
    assert.match(resultText, /確定見積や適合保証ではありません/);
  }

  const safeNote = "Excel転記を減らしたい <img src=x onerror=alert(1)>";
  await page.locator('#diagnosis-form input[value="WEBAPP"]').check();
  await page.locator('#diagnosis-form [name="timing"]').fill("2か月以内");
  await page.locator('#diagnosis-form [name="budget"]').fill("100万円前後");
  await page.locator('#diagnosis-form [name="note"]').fill(safeNote);
  await page.locator('#diagnosis-form button[type="submit"]').click();
  await page.locator("#diagnosis-result").waitFor({ state: "visible" });
  const diagnosisText = await page.locator("#diagnosis-result").textContent();
  assert.match(diagnosisText, /相談時の整理結果（目安）/);
  assert.match(diagnosisText, /希望サービス\s*Webアプリ/);
  assert.match(diagnosisText, /希望時期\s*2か月以内/);
  assert.match(diagnosisText, /予算感\s*100万円前後/);
  assert.match(diagnosisText, /補足条件\s*Excel転記を減らしたい/);
  assert.match(diagnosisText, /確定見積や適合保証ではありません/);
  assert.equal(await page.locator("#diagnosis-result img").count(), 0);
  if (name === "chromium") {
    await page.locator("#diagnosis-result").screenshot({ path: path.join(screenshotRoot, "diagnosis-result.png") });
  }

  await page.getByRole("button", { name: "この内容で相談する" }).click();
  assert.equal(await page.locator('#contact-form [name="service"]').inputValue(), "Webアプリ");
  assert.equal(await page.locator('#contact-form [name="timing"]').inputValue(), "2か月以内");
  assert.match(await page.locator('#contact-form [name="message"]').inputValue(), /簡易診断の相談概要（目安）/);
  assert.match(await page.locator('#contact-form [name="message"]').inputValue(), /予算感：100万円前後/);
  assert.match(await page.locator('#contact-form [name="message"]').inputValue(), /補足条件：Excel転記を減らしたい/);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "contact-name");
  await assertBelowStickyHeader(page, page.locator("#contact-name"), `${name} diagnosis transfer focus`);
  if (name === "chromium") {
    await page.locator(".contact-form-wrap").screenshot({ path: path.join(screenshotRoot, "diagnosis-form-transfer.png") });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/?validation=${name}`, { waitUntil: "networkidle" });
  await page.locator('#contact-form button[type="submit"]').click();
  assert.equal(await page.locator("#form-error-summary").isVisible(), true);
  assert.equal(await page.locator("#form-error-summary a").count(), 5);
  assert.equal(await page.locator(".field-error:not([hidden])").count(), 5);
  assert.equal(await page.locator("#contact-name").getAttribute("aria-invalid"), "true");
  assert.match(await page.locator("#contact-name").getAttribute("aria-describedby"), /contact-name-error/);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "contact-name");
  await assertBelowStickyHeader(page, page.locator("#contact-name"), `${name} first validation error`);
  if (name === "chromium") {
    await page.locator("#form-error-summary").evaluate((summary) => {
      const root = document.documentElement;
      const previousScrollBehavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      summary.scrollIntoView({ block: "start", behavior: "auto" });
      root.style.scrollBehavior = previousScrollBehavior;
    });
    await page.screenshot({ path: path.join(screenshotRoot, "form-validation-errors.png") });
  }
  await page.locator("#contact-name").fill("E2Eテスト担当");
  assert.equal(await page.locator("#contact-name").getAttribute("aria-invalid"), null);
  assert.equal(await page.locator("#contact-name-error").isHidden(), true);
  assert.equal(await page.locator("#contact-name-error").textContent(), "");
  assert.equal(await page.locator('#form-error-summary a[href="#contact-name"]').count(), 0);
  await page.locator("#contact-email").fill("invalid-email");
  assert.equal(await page.locator("#contact-email").getAttribute("aria-invalid"), "true");
  assert.equal(await page.locator("#contact-email-error").textContent(), "メールアドレスを正しい形式で入力してください。");
  await page.locator("#contact-email").fill("e2e@example.com");
  assert.equal(await page.locator("#contact-email").getAttribute("aria-invalid"), null);
  await page.locator("#contact-message").fill("短い");
  assert.equal(await page.locator("#contact-message-error").textContent(), "相談内容は10文字以上で入力してください。");
  await page.locator("#contact-message").fill("10文字以上の相談内容です。");
  assert.equal(await page.locator("#contact-message").getAttribute("aria-invalid"), null);

  await page.goto(`${baseUrl}/?responsive-pricing=${name}`, { waitUntil: "networkidle" });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1024, height: 900 },
    { width: 1280, height: 900 },
    { width: 1440, height: 1000 }
  ]) {
    await page.setViewportSize(viewport);
    await assertNoHorizontalOverflow(page, `${name} ${viewport.width}px`);
    if (viewport.width === 1280) {
      const lines = await getVisualLines(page.locator(".pricing-heading-title"));
      assert.deepEqual(lines, ["サービスごとの料金体系を、", "分かりやすくご案内します。"]);
      if (name === "chromium") {
        await page.locator("#pricing .section-heading").screenshot({ path: path.join(screenshotRoot, "pricing-heading-1280.png") });
      }
    }
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseUrl}/?form-success=${name}`, { waitUntil: "networkidle" });

  assert.equal(await page.locator("#analytics-status").textContent(), "現在：アクセス解析は停止中");
  assert.equal(await page.locator("#analytics-consent").textContent(), "アクセス解析を許可する");
  assert.equal(await page.context().cookies().then((cookies) => cookies.some((cookie) => cookie.name.startsWith("_ga"))), false);
  await page.locator("#analytics-consent").click();
  assert.equal(await page.locator("#analytics-consent").getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("#analytics-status").textContent(), "現在：アクセス解析を許可中");
  assert.equal(await page.locator("#analytics-consent").textContent(), "アクセス解析を停止する");
  assert.equal(await page.context().cookies().then((cookies) => cookies.some((cookie) => cookie.name.startsWith("_ga"))), false);
  await page.locator("#analytics-consent").click();
  assert.equal(await page.locator("#analytics-consent").getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator("#analytics-status").textContent(), "現在：アクセス解析は停止中");
  assert.equal(await page.locator("#analytics-consent").textContent(), "アクセス解析を許可する");
  assert.equal(await page.locator('script[data-solven-analytics="ga4"]').count(), 0);

  await page.locator('[name="name"]').fill("E2Eテスト担当");
  await page.locator('[name="email"]').fill("e2e@example.com");
  await page.locator('[name="service"]').selectOption("HP");
  await page.locator('[name="message"]').fill("主要ブラウザで問い合わせ受付を確認する合成テストです。");
  await page.locator('[name="privacy_consent"]').check();
  const leadResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/leads") && response.request().method() === "POST");
  await page.locator('#contact-form button[type="submit"]').click();
  const leadResponse = await leadResponsePromise;
  const leadResponseText = await leadResponse.text();
  assert.equal(leadResponse.status(), 201);
  assert.doesNotMatch(leadResponseText, /lead_id|LEAD-/);
  await page.locator("#form-status[data-state=success]").waitFor({ timeout: 10_000 });
  assert.equal(await page.locator("#form-status > span").textContent(), "お問い合わせを受け付けました。原則として1営業日以内にご連絡します。");
  assert.match(await page.locator("#form-status > strong").textContent(), /^受付番号：SV-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{5}$/);
  assert.doesNotMatch(await page.locator("body").textContent(), /LEAD-/);
  assert.equal(await page.locator("#form-status").getAttribute("role"), "status");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "form-status");
  const formScreenshot = `form-success-${name}.png`;
  await page.locator("#form-status").screenshot({ path: path.join(screenshotRoot, formScreenshot) });

  if (name === "chromium") {
    await page.locator("#form-status").screenshot({ path: path.join(screenshotRoot, "form-success.png") });
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(screenshotRoot, "desktop-redesign.png"), fullPage: true });
    await page.locator(".site-header").evaluate((header) => { header.style.visibility = "hidden"; });
    await page.locator(".skip").evaluate((skip) => { skip.style.visibility = "hidden"; });
    await page.locator("#top").screenshot({ path: path.join(screenshotRoot, "hero-detail.png") });
    await page.locator("#works").screenshot({ path: path.join(screenshotRoot, "demo-section.png") });
    await page.locator("#pricing").screenshot({ path: path.join(screenshotRoot, "pricing-section.png") });
    await page.locator("#contact").screenshot({ path: path.join(screenshotRoot, "contact-section.png") });
    await page.locator(".site-header").evaluate((header) => { header.style.visibility = "visible"; });
    await page.locator(".skip").evaluate((skip) => { skip.style.visibility = "visible"; });
    const deniedFooter = await page.locator("footer").screenshot();
    await page.locator("#analytics-consent").click();
    const grantedFooter = await page.locator("footer").screenshot();
    await page.locator("#analytics-consent").click();
    const consentComparison = await context.newPage();
    await consentComparison.setViewportSize({ width: 1100, height: 760 });
    await consentComparison.setContent(`<!doctype html><html lang="ja"><style>
      *{box-sizing:border-box}body{margin:0;padding:32px;background:#edf5f7;font-family:"Hiragino Sans","Yu Gothic",sans-serif;color:#10212c}
      main{display:grid;gap:24px}article{padding:18px;background:#fff;border:1px solid #cbd8df;border-radius:12px;box-shadow:0 12px 30px rgba(7,27,43,.1)}
      h2{margin:0 0 12px;font-size:18px}img{display:block;width:100%;height:auto;border-radius:7px}
    </style><main><article><h2>未許可</h2><img alt="アクセス解析の未許可表示" src="data:image/png;base64,${deniedFooter.toString("base64")}"></article><article><h2>許可後</h2><img alt="アクセス解析の許可後表示" src="data:image/png;base64,${grantedFooter.toString("base64")}"></article></main></html>`);
    await consentComparison.locator("main").screenshot({ path: path.join(screenshotRoot, "consent-states.png") });
    await consentComparison.close();
    const mobile = await context.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
    await mobile.screenshot({ path: path.join(screenshotRoot, "mobile-redesign.png"), fullPage: true });
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    assert.equal(await mobile.locator("#top .button").evaluateAll((buttons) => buttons.every((button) => button.getBoundingClientRect().height >= 44)), true);
    assert.equal(await mobile.locator(".phrase").evaluateAll((phrases) => phrases.every((phrase) => phrase.getBoundingClientRect().right <= document.documentElement.clientWidth)), true);
    assert.equal(await mobile.locator(".contact-heading span").evaluateAll((lines) => lines.every((line) => line.getBoundingClientRect().right <= document.documentElement.clientWidth)), true);
    await mobile.close();
  }

  assert.deepEqual([...new Set(externalRequests)], []);
  assert.deepEqual(pageErrors, []);
  results.push({
    browser: name,
    version: browserVersion,
    status: "PASS",
    http_status: 201,
    external_requests: 0,
    page_errors: 0,
    horizontal_overflow: false,
    form_screenshot: formScreenshot
  });
  await browser.close();
}

assert.deepEqual(
  results.map(({ browser, status }) => ({ browser, status })),
  [
    { browser: "chromium", status: "PASS" },
    { browser: "webkit", status: "PASS" },
    { browser: "firefox", status: "PASS" }
  ],
  "Chromium・WebKit・Firefoxの全ランタイムで正式E2Eが必要です。"
);
process.stdout.write(`${JSON.stringify({ browsers: results, screenshots: screenshotNames }, null, 2)}\n`);
