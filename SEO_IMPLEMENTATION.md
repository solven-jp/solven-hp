# Solven SEO Implementation Notes

Date: 2026-06-25

## Implemented Locally

- Added service landing pages:
  - `/homepage-production/`
  - `/lp-production/`
  - `/web-app-development/`
  - `/business-improvement/`
  - `/maintenance/`
- Added anonymous case pages:
  - `/cases/employee-management-app/`
  - `/cases/real-estate-lp/`
  - `/cases/staffing-company-site/`
- Added shared SEO page styling in `/seo.css`.
- Added internal links from the top page service cards, case cards, and footer.
- Added top-page `BreadcrumbList` structured data.
- Added `Service`, `BreadcrumbList`, and FAQ structured data to service pages where FAQ content is present.
- Added `Article` and `BreadcrumbList` structured data to case pages.
- Updated `/sitemap.xml` with all new public URLs.

## Keyword Map

| Keyword | Target page | Intent |
| --- | --- | --- |
| 名古屋 ホームページ制作 | `/homepage-production/` | Local company site production |
| 愛知 ホームページ制作 | `/homepage-production/` | Regional production vendor comparison |
| 名古屋 LP制作 | `/lp-production/` | Landing page for inquiries or ads |
| 愛知 Webアプリ制作 | `/web-app-development/` | Small business web app development |
| 名古屋 業務改善 Web | `/business-improvement/` | Workflow diagnosis before development |
| 中小企業 Web制作 愛知 | `/homepage-production/` | Small business web presence |

## Approval-Gated External Tasks

These require Google account or external profile operation:

- Register or verify `solven.jp` in Google Search Console.
- Submit `https://solven.jp/sitemap.xml` in Search Console.
- Run URL Inspection on the top page and new pages.
- Create or update Google Business Profile.
- Request external links from profiles, SNS, partners, or production records.

## Search Console Submission Checklist

- Property type: Domain property
- Property: `solven.jp`
- Sitemap URL: `https://solven.jp/sitemap.xml`
- URL Inspection targets:
  - `https://solven.jp/`
  - `https://solven.jp/homepage-production`
  - `https://solven.jp/lp-production`
  - `https://solven.jp/web-app-development`
  - `https://solven.jp/business-improvement`
  - `https://solven.jp/maintenance`
- Initial metrics to record:
  - Indexed status
  - Submitted sitemap status
  - Top queries
  - Impressions
  - Clicks
  - Average position

## 90-Day Review Plan

- Week 0: Deploy after approval, submit sitemap, request indexing for top priority pages.
- Weeks 2-4: Record impressions, clicks, indexed pages, and queries in Search Console.
- Month 2: Add one FAQ/case/improvement article based on actual query data.
- Month 3: Compare target queries, identify pages with impressions but low CTR, revise titles/descriptions and add missing content.
