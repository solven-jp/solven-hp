#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOrganizationStructuredData, serializeStructuredData } from "../public/organization-data.js";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicRoot = path.join(appRoot, "public");
const distRoot = path.join(appRoot, "dist");
const environment = process.env.SOLVEN_RUNTIME_ENVIRONMENT || "local";
const noindexValue = process.env.SOLVEN_NOINDEX;
if (noindexValue !== undefined && !["true", "false"].includes(noindexValue)) throw new Error("invalid_noindex_value");
const indexing = noindexValue === "false";
const measurementId = process.env.SOLVEN_GA4_MEASUREMENT_ID || "";
if (process.env.SOLVEN_GA4_ENABLED !== undefined && !["true", "false"].includes(process.env.SOLVEN_GA4_ENABLED)) throw new Error("invalid_ga4_enabled_value");
const analyticsEnabled = process.env.SOLVEN_GA4_ENABLED === "true";
const productionOrigin = "https://solven.jp";
const pageSeo = new Map([
  ["company/index.html", {
    canonical: `${productionOrigin}/company/`,
    description: "Solven合同会社の商号、代表者、所在地、連絡先、事業内容をご案内します。"
  }],
  ["privacy/index.html", {
    canonical: `${productionOrigin}/privacy/`,
    description: "Solven合同会社のプライバシーポリシーです。お問い合わせ情報とアクセス解析データの取扱いをご案内します。"
  }],
  ["cookie/index.html", {
    canonical: `${productionOrigin}/cookie/`,
    description: "Solven合同会社のCookieポリシーです。必須Cookieと同意後のアクセス解析の取扱いをご案内します。"
  }],
  ["disclaimer/index.html", {
    canonical: `${productionOrigin}/disclaimer/`,
    description: "Solven合同会社のWebサイトに掲載する情報、料金、制作例に関する免責事項です。"
  }]
]);

if (!new Set(["local", "staging", "production"]).has(environment)) throw new Error("invalid_public_environment");
if (analyticsEnabled && !/^G-[A-Z0-9]{6,14}$/.test(measurementId)) throw new Error("invalid_ga4_measurement_id");
if (indexing && environment !== "production") throw new Error("indexing_requires_production_environment");

fs.rmSync(distRoot, { recursive: true, force: true });
fs.cpSync(publicRoot, distRoot, { recursive: true });
const canonicalData = JSON.parse(fs.readFileSync(path.join(publicRoot, "data", "owned-site.json"), "utf8"));
const organizationStructuredData = serializeStructuredData(createOrganizationStructuredData(canonicalData.company));

const pending = [distRoot];
while (pending.length) {
  const current = pending.pop();
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) pending.push(target);
    if (entry.isFile() && entry.name.endsWith(".html")) {
      const relative = path.relative(distRoot, target).split(path.sep).join("/");
      let html = fs.readFileSync(target, "utf8").replaceAll(
        '<meta name="robots" content="noindex,nofollow">',
        `<meta name="robots" content="${indexing ? "index,follow" : "noindex,nofollow"}">`
      );
      const seo = pageSeo.get(relative);
      if (seo) {
        const robotsMeta = `<meta name="robots" content="${indexing ? "index,follow" : "noindex,nofollow"}">`;
        html = html.replace(
          robotsMeta,
          `${robotsMeta}\n<meta name="description" content="${seo.description}">\n<link rel="canonical" href="${seo.canonical}">\n<link rel="icon" href="/favicon.svg" type="image/svg+xml">`
        );
      }
      if (relative === "index.html") {
        const structuredDataPlaceholder = '<script id="organization-structured-data" type="application/ld+json">{}</script>';
        if (!html.includes(structuredDataPlaceholder)) throw new Error("organization_structured_data_placeholder_missing");
        html = html.replace(
          structuredDataPlaceholder,
          `<script id="organization-structured-data" type="application/ld+json">${organizationStructuredData}</script>`
        );
        if (environment === "staging") {
          const contactHeading = "<h3>相談内容をお聞かせください</h3>";
          if (!html.includes(contactHeading)) throw new Error("staging_contact_heading_missing");
          const contactGuide = '<p class="section-label">無料相談</p><h2 class="contact-heading"><span>まだ要件が</span><span>決まっていなくても、</span><span>相談できます。</span></h2>';
          if (!html.includes(contactGuide)) throw new Error("staging_contact_guide_missing");
          const replyNote = '<p class="reply-note"><strong>返信目安</strong><span>フォームは24時間受け付けています。原則として1営業日以内にご連絡します。土日祝日・年末年始にいただいたお問い合わせは、翌営業日以降の対応となります。</span></p>';
          if (!html.includes(replyNote)) throw new Error("staging_reply_note_missing");
          const contactSubmit = '<button class="button primary" type="submit" disabled>無料相談を送信する</button>';
          if (!html.includes(contactSubmit)) throw new Error("staging_contact_submit_missing");
          const diagnosisCopy = '<div class="diagnosis-copy"><p class="section-label">簡易診断</p><h2>何を作るか迷ったら、<br>目的から整理します。</h2><p>確定見積ではありません。必要な入口と、次に確認する条件を表示します。</p></div>';
          if (!html.includes(diagnosisCopy)) throw new Error("staging_diagnosis_copy_missing");
          const diagnosisForm = '<form id="diagnosis-form" class="stack" aria-disabled="true">';
          if (!html.includes(diagnosisForm)) throw new Error("staging_diagnosis_form_missing");
          const headerContactLink = '<a class="header-cta" href="#contact">無料の初回相談</a>';
          const mobileContactLink = '<a href="#contact">無料の初回相談</a>';
          const mobileDiagnosisLink = '<a href="#diagnosis">簡易診断</a>';
          const heroContactLink = '<a class="button primary" href="#contact">無料の初回相談へ</a>';
          const maintenanceContactLink = '<a href="#contact">相談する</a>';
          const heroHeading = '<h1 id="brand-catchcopy"><span>作るものが</span><span>決まっていなくても、</span><span>相談から始められます。</span></h1>';
          for (const [name, value] of Object.entries({ headerContactLink, mobileContactLink, mobileDiagnosisLink, heroContactLink, maintenanceContactLink, heroHeading })) {
            if (!html.includes(value)) throw new Error(`staging_${name}_missing`);
          }
          html = html
            .replace(contactGuide, '<p class="section-label">検証環境</p><h2 class="contact-heading"><span>お問い合わせは</span><span>現在受け付けて</span><span>いません。</span></h2>')
            .replace(contactHeading, '<h3>お問い合わせの送信は停止中です</h3><p class="staging-form-notice" role="status">このページは検証環境です。お問い合わせの送信は受け付けていません。実在する個人情報・顧客情報は入力しないでください。</p>')
            .replace(replyNote, '<p class="reply-note"><strong>検証環境</strong><span>お問い合わせは受け付けていません。実在する個人情報・顧客情報は入力しないでください。</span></p>')
            .replace(contactSubmit, '<button class="button primary" type="submit" disabled>お問い合わせの送信は停止中です</button>')
            .replace(diagnosisCopy, '<div class="diagnosis-copy"><p class="section-label">検証環境</p><h2>簡易診断は、<br>現在利用できません。</h2><p>実在する個人情報・顧客情報は入力しないでください。</p></div>')
            .replace(diagnosisForm, '<p class="staging-form-notice" role="status">このページは検証環境です。簡易診断は利用できません。実在する個人情報・顧客情報は入力しないでください。</p><form id="diagnosis-form" class="stack" aria-disabled="true">')
            .replace(headerContactLink, '<span class="header-cta" aria-disabled="true">お問い合わせ停止中</span>')
            .replace(mobileContactLink, '<span aria-disabled="true">お問い合わせ停止中</span>')
            .replace(mobileDiagnosisLink, '<span aria-disabled="true">簡易診断停止中</span>')
            .replace(heroContactLink, '<span class="button primary" aria-disabled="true">お問い合わせ停止中</span>')
            .replace(maintenanceContactLink, '<span aria-disabled="true">お問い合わせ停止中</span>')
            .replace(heroHeading, '<h1 id="brand-catchcopy"><span>サービス内容と</span><span>料金を、</span><span>ご確認いただけます。</span></h1>');
        }
      }
      fs.writeFileSync(target, html, "utf8");
    }
  }
}

fs.writeFileSync(path.join(distRoot, "robots.txt"), indexing
  ? `User-agent: *\nAllow: /\nSitemap: ${productionOrigin}/sitemap.xml\n`
  : "User-agent: *\nDisallow: /\n", "utf8");

const runtimeConfig = {
  analytics: { enabled: analyticsEnabled, provider: "ga4", measurementId: analyticsEnabled ? measurementId : "" },
  environment
};
fs.writeFileSync(path.join(distRoot, "data", "runtime-config.json"), `${JSON.stringify(runtimeConfig, null, 2)}\n`, "utf8");
process.stdout.write(`Built owned-site static candidate: environment=${environment}, indexing=${indexing}, analytics=${analyticsEnabled}\n`);
