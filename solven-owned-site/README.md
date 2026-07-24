# Solven owned-site production-portable candidate

The canonical-linked v2 presentation, same-origin inquiry API and provider-neutral production boundaries are packaged without connecting an external service. Presentation baseline originates from commit `ce2b532991b528a93c35373037768b90e9b1e121`; the current local handoff keeps that design while adding scoped owner-review fixes for mobile navigation, purpose routes, diagnosis transfer, form validation accessibility, pricing-heading wrapping and the U+00A5 yen sign. Canonical source and prices are unchanged.

## Local verification

```sh
npm run build
npm run check
npm run validate:environment
npm test
npm run test:browser # Chromium・WebKit・Firefoxの全engineが必須
npm run bundle:validate # commit前の内容検証（uncommitted-validationと明記）
npm run bundle          # clean commitから最終bundleを生成
```

Default local URL is `http://127.0.0.1:4178`. Local Lead, outbox, notification and event data remain under ignored `runtime/`; no external delivery occurs.

## Components

- `public/`: v2 display with scoped reviewed interaction and accessibility fixes; Owner確定のcanonical／OGP／favicon／robots／sitemap／Organization dataを含む。raw publicはnoindexで、production buildだけがindexを許可する。
- `server.mjs`: same-origin API and validated security contract.
- `src/contracts/`: LeadStore, NotificationOutbox and RateLimiter provider interfaces.
- `src/adapters/`: offline local implementations, including transactional commit and lease tests.
- `src/config/`, `config/`: environment schema and startup unsafe-default validation.
- `deploy/`: provider-neutral manifest, staging defaults and machine-readable release checklists.
- `docs/`: API/data, security, operations, rollback, decision matrix, recommended production stack and migration contracts.
- `scripts/generate-portable-bundle.mjs`: creates a verified artifact outside the repository.

Production and staging adapters are intentionally fail-closed until an approved provider implementation is injected. Canonical originと公開会社情報は確定済みで、専用repository + Firebase Hosting／Cloud Run／Firestoreを推奨するが、production repository、hosting、store、notifier、secret manager、GA4 Measurement IDの外部接続は未実施である。Push、PR and deployment are not part of this package.
