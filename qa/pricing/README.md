# SOL-53 benchmark / Codex

## Scope and acceptance

- Repository: solven-jp/solven-hp; baseline commit `0e2d430b7884f40996928e532c9e5e327b977a39`.
- Local branch: `benchmark-codex`. Stop after local commit. No push, PR, merge or deployment.
- Work completed independently. No other benchmark participant's output was consulted. One separate reviewer inspected only this implementation.
- New page: `public/pricing/index.html`, public URL path `/pricing`. Reuse existing lower-page `public/seo.css`, with page-local navy/cyan and responsive styles. No shared CSS changes.
- Homepage: one link below the existing price note. Existing copy, amounts and styles retained byte-for-byte after removing the single added line.
- Sitemap: add `/pricing` for the existing SEO validation/discovery convention. No change to existing URL records.
- `firebase.json` remains `public: "public"`, `cleanUrls: true`. Root legacy HTML and `production-mirror/` unchanged. The mirror is not the serving target and is not directly edited.
- Visitor flow: homepage → price list → service category/conditions → contact information → existing homepage contact form. There is no new form, persistence, authentication or API. Sending mail/submitting the existing form is outside this test.

## Verification

1. `node scripts/validate-pricing.cjs`: PASS. All 25 price items checked against the current user specification, including range endpoints, monthly/one-off units, app sizes and durations, support limits. Six payment/acceptance/warranty conditions, tax statement, contact information, unique IDs and anchors checked. No additional monetary price outside approved items.
2. `node scripts/validate-seo-pages.cjs`: PASS for all 10 pages, including metadata, single h1, canonical, JSON-LD, sitemap.
3. `node scripts/verify-production-mirror.mjs`: PASS for all 18 pinned artifacts and formal scope hashes.
4. `git diff --check`: PASS. All tracked baseline files were compared directly; only homepage and sitemap were changed. All other existing tracked files match the baseline.
5. Playwright / Chromium local static server: widths 1440, 768, 375, 320px. No document/element horizontal overflow. All 25 price items and six conditions visible. Every card amount fits on one line. Category links, homepage price-list link, and price-list contact-form link all work. Skip link works with keyboard. 200% text-size check at 1280px has no document overflow. No JavaScript runtime errors. Requests outside localhost blocked; no analytics/Google Fonts traffic, form submission or mail action.
6. Author inspected actual desktop/mobile screenshots, including price tables, application ranges, support descriptions and contact section. `pricing-1440.png` and `pricing-375.png` are final full-page screenshots; `browser-results.json` records browser/version/widths.
7. Independent reviewer (not involved in authoring/modification) manually compared all 25 prices, terms, scopes and contact details against the user's instruction, inspected both screenshots and existing-file diff, and independently ran mirror verification: no implementation findings. Browser re-operation by the reviewer, physical devices, contact delivery and production serving remain untested. This is not live approval.

Reproduce browser checks from repository root with Playwright available:

```sh
node qa/pricing/check-browser.cjs
# Or use an already-installed Playwright:
PLAYWRIGHT_MODULE=/path/to/playwright node qa/pricing/check-browser.cjs
```

This creates a temporary localhost server with directory-index routing for the Firebase-style URL paths. It is not a Firebase Hosting emulator or production-hosting test.

## Iterations / turns

- Inspect repository and operating rules; choose the existing lower-page design and correct `public/` target.
- Implement one page, one homepage link and sitemap entry; add the spec comparison check.
- First browser pass: no overflow or broken links. Image inspection found the currency unit wrapping on mobile app range prices.
- One visual fix: responsive application-price font sizing and keeping the whole amount together. Second browser pass adds a one-line amount assertion and passes at all four widths.
- Independent review once; no further implementation fixes required. Record evidence and create local commit.

The main author did research, implementation, fixes and normal testing. The other Codex handled only independent review. No actual API cost/token total was available, so none is estimated.

## Existing constraints to carry into PR review

- The homepage retains its existing tax-exclusive price estimates (e.g. HP/LP ¥148,000〜). These differ from the user-specified tax-inclusive prices on the new page. This is deliberately preserved under the explicit no-existing-price/copy-change requirement; it is a publication decision for the owner, not silently reconciled here.
- The current `Production mirror integrity` workflow passes `--base` on PRs. That mode permits only the original mirror-related scope; `public/`, these tests and these evidence files are outside it. The artifact integrity check itself passes, but the existing PR change-scope check will reject this feature branch. Workflow/policy files remain unchanged. The owner handling the PR must decide the appropriate workflow scope; no bypass is installed.
- No package.json / npm test entry exists in this repository. The repository's actual Node validators and the task-specific browser checks were used.
- Japanese copy: mostly fixed pricing/contract conditions, short labels and lists. Cognitive is N/A for those categories. Yomiyasu/Patina price/condition checking is audit-only; no rhythm rewriting or repricing. The new short introductory copy was checked for meaning and naturalness; no prose expansion or claims added. Existing copy is untouched.
- No security/data boundary is changed, so auth/tenant/data-write tests are N/A.

## Fixed review target

Independent review covered these exact source SHA-256 values; the final commit retains them:

```text
345793bea4d79d371024a86c2420938d51ed332ca6c1d249df845c1c4b11611d  public/pricing/index.html
d6e5df34e78c754ef14cb4b48d3655432a4c0fcdfd076b85ec812f22ad8e3011  public/index.html
cdb92b79f0ba7aa1c97ea25473b5d590590e21d602fd4a9a48f43f56194dd5d4  public/sitemap.xml
```

## Artifacts / temporary files

Keep the source, validators, this record, final screenshots and browser-results in the repository. `/tmp/benchmark-codex-browser.cjs` and `/tmp/benchmark-*.png` are local temporary test/crop files and cleanup candidates. No pre-existing data was deleted.
