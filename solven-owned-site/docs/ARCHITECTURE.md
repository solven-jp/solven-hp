# owned-site architecture

## Boundary

| layer | location | responsibility | production boundary |
|---|---|---|---|
| 正本adapter公開projection | `public/data/owned-site.json` | ブランド、公開会社情報、商品・価格 | canonical生成物を手編集せず、`project-owned-site-data.mjs`で公開最小項目だけへ投影する |
| 表示／Consent／SEO | `public/` | v2表示、mobile navigation、目的別導線、診断、form、GA4同意、canonical／OGP／favicon／robots／sitemap／Organization data | baseline designと正本契約を維持し、review済みの局所変更だけを許可する |
| HTTP application | `server.mjs` | same-origin API、security contract、公開response projection | provider SDKやsecretを置かない |
| domain validation | `src/domain/` | formのserver validation | public form contractを維持する |
| LeadStore contract | `src/contracts/lead-store.mjs` | internal `lead_id`、public `receipt_id`、atomic idempotency、retention | persistent provider adapterへ差し替える |
| NotificationOutbox contract | `src/contracts/notification-outbox.mjs` | transactional enqueue、claim、retry、dead letter | shared persistent queueへ差し替える |
| RateLimiter contract | `src/contracts/rate-limiter.mjs` | session／network-prefixの独立hash dimension、429、Retry-After | distributed storeまたはedgeへ差し替える |
| local adapters | `src/adapters/local-*` | 外部接続なしのE2E | staging／productionでは起動拒否する |
| notification coordinator | `src/services/` | PII-free payload、backoff、最大試行 | provider-neutral |
| environment validation | `src/config/`, `config/` | 起動時unsafe-default拒否 | secretは参照名だけを受ける |

Organization構造化dataは`public/organization-data.js`で公開projectionの会社情報から生成する。`public/index.html`のplaceholderはbrowser runtimeで同期され、production／staging artifactでは`build-site.mjs`が静的JSON-LDへ置換する。会社情報をHTMLとJSON-LDへ別々にハードコードしない。

## Lead受付sequence

1. browserは同一originの`/api/session`でHttpOnly sessionとCSRF tokenを取得する。
2. `/api/leads`はHost、HTTPS、Origin、Content-Type、32 KiB、session、CSRF、rate limitを検証する。
   RateLimiterはsession hashとtrusted client network-prefix hashを独立評価し、session再発行とIP単独判定の双方を避ける。
3. server validationとhoneypot判定を行う。
4. LeadStoreが内部`lead_id`と非連番`receipt_id`を生成し、idempotency keyと初期outboxを同じtransactionでcommitする。
5. commit後だけNotificationOutboxをclaimし、PIIを含まないsummaryをproviderへ渡す。
6. 通知失敗時もLeadとoutboxを保持し、有限backoff後にdead letterへ移す。
7. HTTP成功responseは`receipt_id`、受付状態、通知状態だけを返す。`lead_id`は公開HTML、response、browser logへ出さない。
8. 同じidempotency keyの再送は保存済みrecordを公開projectionへ変換し、同じ`receipt_id`を返す。再通知は作らない。

公開`receipt_id`を使った照会routeは存在しない。内部運用画面を将来作る場合も別認証境界とし、このpublic applicationへ混在させない。

## Static/server boundary

`dist/`は静的asset、`server.mjs`と`src/`はserver artifactである。`/api/*`は静的hostingへ配置せず、同一origin rewriteでserver runtimeへ接続する。CORSを広げない。runtime data、test data、release review画像はartifactへ含めない。

推奨production境界は`RECOMMENDED_PRODUCTION_STACK.md`のFirebase Hosting + Cloud Run + Firestore構成とする。これは未接続のtarget architectureであり、現在のprovider authorityではない。raw `public/`はnoindexを維持し、production設定で検証した`dist/`だけindexを許可する。

## Failure model

- environmentがproduction/staging安全条件を満たさない: process起動失敗。
- LeadStore／rate limiter／outbox provider error: 成功responseを返さず安全側で失敗。
- Lead commit後のnotification error: 受付成功を維持し、outboxをretry対象にする。
- providerが受理した直後のnetwork断: at-least-onceの限定的重複を認め、delivery keyとleaseで抑制する。
- public health: `{ "status": "ok" }`だけ。release ID、source SHA、adapter、path、secret参照は公開しない。
