#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distRoot = path.join(appRoot, "dist");
const prohibitedText = [
  "Owner",
  "Lead ID",
  "公開前",
  "ここへ明記",
  "合成データ",
  "合成問い合わせデータ",
  "個別見積（パイロット）",
  "E2Eテスト",
  "合成テスト",
  "e2e@example.com",
  "test@example.com",
  "LEAD-"
];
const prohibitedPaths = ["desktop-home", "design-concepts", "playwright", "owner_review", "design_review"];
const knownBinaryExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".pdf", ".zip"]);
const markupExtensions = new Set([".html", ".htm", ".xhtml", ".xml", ".svg"]);
const internalPaymentPatterns = [
  ["underwriting", /与信(?:条件|審査|判断)?/u],
  ["direct_cost_recovery", /(?:直接)?原価(?:等)?を?回収/u],
  ["concurrent_installment_limit", /同時適用\s*(?:は|を)?\s*\d+\s*件(?:以内|まで)/u],
  ["cashflow_condition", /資金繰り/u],
  ["cash_balance_threshold", /(?:自由に使える|利用可能な).{0,12}(?:現預金|現金預金|現金・預金).{0,24}(?:円|万円)|(?:現預金|現金預金|現金・預金).{0,24}\d[\d,]*\s*(?:円|万円)|\d[\d,]*\s*(?:円|万円).{0,24}(?:現預金|現金預金|現金・預金)/u],
  ["installment_delinquency_condition", /(?:既存|分割|12回).{0,24}延滞|延滞.{0,24}(?:既存|分割|12回)/u],
  ["source_or_admin_rights_reservation", /(?:最終ソース|管理権限|権利留保)/u],
  ["intellectual_property_reservation", /知的財産権.{0,32}(?:移転を)?留保/u]
];
const files = [];
const pending = [distRoot];

function decodeNumericEntity(match, value) {
  const codePoint = Number.parseInt(value.startsWith("x") || value.startsWith("X") ? value.slice(1) : value, value.startsWith("x") || value.startsWith("X") ? 16 : 10);
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
}

function decodeUtf16BigEndian(buffer, offset) {
  const body = Buffer.from(buffer.subarray(offset));
  if (body.length % 2 !== 0) throw new Error("public_text_utf16_length_invalid");
  return body.swap16().toString("utf16le");
}

function decodeUtf32(buffer, offset, littleEndian) {
  const body = buffer.subarray(offset);
  if (body.length % 4 !== 0) throw new Error("public_text_utf32_length_invalid");
  let decoded = "";
  for (let index = 0; index < body.length; index += 4) {
    const codePoint = littleEndian ? body.readUInt32LE(index) : body.readUInt32BE(index);
    if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) throw new Error("public_text_utf32_codepoint_invalid");
    decoded += String.fromCodePoint(codePoint);
  }
  return decoded;
}

function decodeUtf8(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("public_text_utf8_invalid");
  }
}

function decodedPublicText(buffer, relative) {
  if (buffer.subarray(0, 4).equals(Buffer.from([0xff, 0xfe, 0x00, 0x00]))) return decodeUtf32(buffer, 4, true);
  if (buffer.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0xfe, 0xff]))) return decodeUtf32(buffer, 4, false);
  if (buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) return buffer.subarray(2).toString("utf16le");
  if (buffer.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) return decodeUtf16BigEndian(buffer, 2);
  if (buffer.includes(0)) {
    if (knownBinaryExtensions.has(path.extname(relative))) return null;
    throw new Error(`public_build_unknown_nul_binary:${relative}`);
  }
  return decodeUtf8(buffer);
}

function normalizedPublicText(buffer, relative) {
  let content = decodedPublicText(buffer, relative);
  if (content === null) return null;
  for (let depth = 0; depth < 4; depth += 1) {
    const decoded = content
      .replace(/&#(x[0-9a-f]+|\d+);?/gi, decodeNumericEntity)
      .replace(/\\u\{([0-9a-f]+)\}/gi, (match, value) => decodeNumericEntity(match, `x${value}`))
      .replace(/\\u([0-9a-f]{4})/gi, (match, value) => decodeNumericEntity(match, `x${value}`));
    if (decoded === content) break;
    content = decoded;
  }
  return content.normalize("NFKC");
}

function publicTextCandidates(content, relative) {
  const candidates = [content];
  if (!markupExtensions.has(path.extname(relative))) return candidates;
  const visibleText = content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/gu, " ")
    .trim();
  candidates.push(visibleText, visibleText.replace(/\s+/gu, ""));
  return candidates;
}

while (pending.length) {
  const current = pending.pop();
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const target = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`public_build_symlink:${path.relative(distRoot, target)}`);
    if (entry.isDirectory()) pending.push(target);
    if (entry.isFile()) files.push(target);
  }
}

for (const file of files) {
  const relative = path.relative(distRoot, file).toLowerCase();
  for (const fragment of prohibitedPaths) {
    if (relative.includes(fragment)) throw new Error(`prohibited_public_path:${relative}`);
  }
  const content = normalizedPublicText(fs.readFileSync(file), relative);
  if (content === null) continue;
  const candidates = publicTextCandidates(content, relative);
  for (const value of prohibitedText) {
    if (candidates.some((candidate) => candidate.includes(value))) throw new Error(`prohibited_public_text:${value}:${relative}`);
  }
  for (const [label, expression] of internalPaymentPatterns) {
    if (candidates.some((candidate) => expression.test(candidate))) throw new Error(`internal_payment_copy_exposed:${label}:${relative}`);
  }
}

const index = fs.readFileSync(path.join(distRoot, "index.html"), "utf8");
if (!index.includes('data-presentation-version="v2"')) throw new Error("presentation_version_not_v2");
if (!index.includes('<link rel="canonical" href="https://solven.jp/">')) throw new Error("canonical_missing");
if (!index.includes('<meta property="og:url" content="https://solven.jp/">')) throw new Error("og_url_missing");
if (!index.includes('<meta property="og:image" content="https://solven.jp/og-image.png">')) throw new Error("og_image_missing");
if (!index.includes('<link rel="icon" href="/favicon.svg" type="image/svg+xml">')) throw new Error("favicon_link_missing");
if (!index.includes('<meta name="theme-color" content="#0B1F35">')) throw new Error("official_theme_color_missing");
if (!index.includes('src="/assets/solven-logo-symbol.svg"')) throw new Error("official_logo_usage_missing");

const pageCanonicals = new Map([
  ["index.html", "https://solven.jp/"],
  ["company/index.html", "https://solven.jp/company/"],
  ["privacy/index.html", "https://solven.jp/privacy/"],
  ["cookie/index.html", "https://solven.jp/cookie/"],
  ["disclaimer/index.html", "https://solven.jp/disclaimer/"]
]);
for (const [relative, canonical] of pageCanonicals) {
  const html = fs.readFileSync(path.join(distRoot, relative), "utf8");
  if (!html.includes(`<link rel="canonical" href="${canonical}">`)) throw new Error(`page_canonical_missing:${relative}`);
  if (!html.includes('<link rel="icon" href="/favicon.svg" type="image/svg+xml">')) throw new Error(`page_favicon_missing:${relative}`);
  if (!html.includes('src="/assets/solven-logo-symbol.svg"')) throw new Error(`page_official_logo_missing:${relative}`);
  if (/https?:\/\/(?:localhost|127\.0\.0\.1|example\.com)/i.test(html)) throw new Error(`nonproduction_seo_origin:${relative}`);
}

const jsonLdMatch = index.match(/<script id="organization-structured-data" type="application\/ld\+json">([^<]+)<\/script>/);
if (!jsonLdMatch) throw new Error("structured_data_missing");
const organization = JSON.parse(jsonLdMatch[1]);
const canonicalData = JSON.parse(fs.readFileSync(path.join(distRoot, "data", "owned-site.json"), "utf8"));
const canonicalCompany = canonicalData.company;
if (organization["@context"] !== "https://schema.org" || organization["@id"] !== "https://solven.jp/#organization") throw new Error("structured_data_identity_invalid");
if (organization["@type"] !== "Organization") throw new Error("structured_data_type_invalid");
if (organization.name !== canonicalCompany.legal_name || organization.url !== "https://solven.jp/" || organization.email !== canonicalCompany.business_email) throw new Error("structured_data_company_mismatch");
if (organization.address?.postalCode !== canonicalCompany.registered_postal_code || organization.address?.streetAddress !== canonicalCompany.registered_address || organization.address?.addressCountry !== "JP") throw new Error("structured_data_address_mismatch");

const fixedHplp = canonicalData.pricing?.hplp?.filter((plan) => plan.public_fixed_price);
if (canonicalData.canonical?.as_of !== "2026-07-20" || fixedHplp?.length !== 3) throw new Error("payment_canonical_version_invalid");
const requirementsServices = canonicalData.pricing?.requirements_services;
if (
  requirementsServices?.mini !== 55000 ||
  requirementsServices?.standard !== 110000 ||
  requirementsServices?.advanced !== 220000 ||
  requirementsServices?.legacy_investigation !== "custom"
) throw new Error("requirements_services_projection_invalid");
const additionalWork = canonicalData.pricing?.additional_work;
if (
  additionalWork?.billing_unit_minutes !== 30 ||
  additionalWork?.fee_ex_tax_per_unit !== 5500 ||
  additionalWork?.effective_hourly_rate_ex_tax !== 11000 ||
  additionalWork?.advance_quote_and_approval_required !== true ||
  additionalWork?.automatic_overage_billing_prohibited !== true
) throw new Error("additional_work_projection_invalid");
for (const plan of fixedHplp) {
  if (!Number.isInteger(plan.production_consideration_ex_tax) || !Number.isInteger(plan.minimum_contract_total_ex_tax)) throw new Error(`payment_amount_missing:${plan.plan_id}`);
  if (plan.production_payment_schedule?.map((item) => item.percentage).join(",") !== "0.4,0.3,0.3") throw new Error(`payment_schedule_invalid:${plan.plan_id}`);
  if (!Number.isInteger(plan.maintenance?.monthly_fee_ex_tax) || plan.maintenance?.minimum_months !== 6) throw new Error(`maintenance_boundary_invalid:${plan.plan_id}`);
  for (const legacyField of ["initial_fee_ex_tax", "monthly_fee_ex_tax", "installments", "contract_total_ex_tax"]) {
    if (legacyField in plan) throw new Error(`legacy_payment_field_present:${plan.plan_id}:${legacyField}`);
  }
}

for (const legacyCopy of ["初期費用と月額24回", "月額 × 24回", "HP・LPの24回構造"]) {
  if (index.includes(legacyCopy)) throw new Error(`legacy_payment_copy_present:${legacyCopy}`);
}
for (const requiredPaymentCopy of [
  "契約・着手時40% ＋ 要件・設計承認時30% ＋ 公開・納品前30%",
  "24回払いは標準提供していません",
  "要件整理費、保守料、追加作業、第三者費用・実費・立替金は対象外",
  "見積・注文書で確定"
]) {
  if (!index.includes(requiredPaymentCopy)) throw new Error(`payment_copy_missing:${requiredPaymentCopy}`);
}
for (const relative of ["assets/solven-logo-symbol.svg", "favicon.svg", "og-image.png", "robots.txt", "sitemap.xml"]) {
  if (!fs.existsSync(path.join(distRoot, relative))) throw new Error(`seo_asset_missing:${relative}`);
}

const officialLogo = fs.readFileSync(path.join(distRoot, "assets", "solven-logo-symbol.svg"));
const favicon = fs.readFileSync(path.join(distRoot, "favicon.svg"));
const officialLogoSha256 = crypto.createHash("sha256").update(officialLogo).digest("hex");
if (officialLogoSha256 !== "42338a332439a628ca01d52b7c1573593d184dd204274fd556b9b630df486eb5") throw new Error("official_logo_hash_mismatch");
if (!favicon.equals(officialLogo)) throw new Error("favicon_not_official_logo");
const publicPaletteText = [index, fs.readFileSync(path.join(distRoot, "styles.css"), "utf8"), fs.readFileSync(path.join(distRoot, "consent.css"), "utf8")].join("\n").toLowerCase();
for (const legacyColor of ["#071b2b", "#087f89", "#09a9b4", "#0b8e95"]) {
  if (publicPaletteText.includes(legacyColor)) throw new Error(`legacy_brand_color_present:${legacyColor}`);
}

const ogImage = fs.readFileSync(path.join(distRoot, "og-image.png"));
if (ogImage.toString("hex", 0, 8) !== "89504e470d0a1a0a") throw new Error("og_image_not_png");
if (ogImage.readUInt32BE(16) !== 1200 || ogImage.readUInt32BE(20) !== 630) throw new Error("og_image_dimensions_invalid");

const runtimeConfig = JSON.parse(fs.readFileSync(path.join(distRoot, "data", "runtime-config.json"), "utf8"));
const robots = fs.readFileSync(path.join(distRoot, "robots.txt"), "utf8");
if (runtimeConfig.environment === "production") {
  for (const relative of pageCanonicals.keys()) {
    const html = fs.readFileSync(path.join(distRoot, relative), "utf8");
    if (!html.includes('<meta name="robots" content="index,follow">')) throw new Error(`production_indexing_meta_missing:${relative}`);
  }
  if (robots !== "User-agent: *\nAllow: /\nSitemap: https://solven.jp/sitemap.xml\n") throw new Error("production_robots_invalid");
} else {
  for (const relative of pageCanonicals.keys()) {
    const html = fs.readFileSync(path.join(distRoot, relative), "utf8");
    if (!html.includes('<meta name="robots" content="noindex,nofollow">')) throw new Error(`nonproduction_noindex_missing:${relative}`);
  }
  if (robots !== "User-agent: *\nDisallow: /\n") throw new Error("nonproduction_robots_invalid");
}
if (runtimeConfig.environment === "staging") {
  if (!index.includes("このページは検証環境です。お問い合わせの送信は受け付けていません。")) throw new Error("staging_contact_notice_missing");
  if (!index.includes("このページは検証環境です。簡易診断は利用できません。")) throw new Error("staging_diagnosis_notice_missing");
  if (index.includes("フォームは24時間受け付けています。")) throw new Error("staging_reply_note_not_removed");
  if (index.includes("無料相談を送信する")) throw new Error("staging_contact_submit_not_replaced");
  for (const disabledStagingRoute of ['href="#contact"', 'href="#diagnosis"', "無料の初回相談", "無料の初回相談へ", "相談から始められます"]) {
    if (index.includes(disabledStagingRoute)) throw new Error(`staging_disabled_route_present:${disabledStagingRoute}`);
  }
  for (const id of ["contact-company", "contact-name", "contact-email", "contact-phone", "contact-service", "contact-timing", "contact-message", "contact-privacy-consent"]) {
    if (!new RegExp(`id="${id}"[^>]*\\bdisabled`).test(index)) throw new Error(`staging_contact_control_enabled:${id}`);
  }
  const diagnosisForm = index.match(/<form id="diagnosis-form"[\s\S]*?<\/form>/)?.[0] || "";
  const disabledControls = diagnosisForm.match(/<(?:input|textarea|button)\b[^>]*\bdisabled(?:\s|>|=)/g) || [];
  if (disabledControls.length !== 8) throw new Error(`staging_diagnosis_control_enabled:${disabledControls.length}`);
}

const sitemap = fs.readFileSync(path.join(distRoot, "sitemap.xml"), "utf8");
for (const url of ["https://solven.jp/", "https://solven.jp/company/", "https://solven.jp/privacy/", "https://solven.jp/cookie/", "https://solven.jp/disclaimer/"]) {
  if (!sitemap.includes(`<loc>${url}</loc>`)) throw new Error(`sitemap_url_missing:${url}`);
}

process.stdout.write(`PUBLIC_BUILD_CONTENT_PASS files=${files.length} presentation=v2\n`);
