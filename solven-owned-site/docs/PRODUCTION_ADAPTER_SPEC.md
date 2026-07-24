# Production adapter contract

この文書と`src/contracts/`、`tests/contracts/provider-contract.mjs`を本番provider実装の規範とする。provider固有SDKはadapter内部だけへ閉じ込め、正本、`public/`、HTTP成功responseの形を変更しない。本番adapterはまだ接続していない。

## 識別子と公開response

- `lead_id`: server内部の連番識別子。永続record、内部event、承認済み管理画面だけで使用する。
- `receipt_id`: 64 bit以上の乱数から生成する一意な非連番の公開受付番号。同じidempotency keyには保存済みの同じ値を返す。
- 成功responseは`receipt_id`、`status`、`notification_status`の3 fieldだけとする。
- `lead_id`を公開HTML、HTTP response、browser log、analytics eventへ出さない。
- `receipt_id`から状態やLead本文を引ける公開照会APIを作らない。

## LeadStore

`src/contracts/lead-store.mjs`の全操作を実装する。

| operation | contract |
|---|---|
| `create(input)` | Lead、idempotency確定、初期outboxを1 transactionでcommitし、`{record, created}`を返す |
| `findByIdempotencyKey(key)` | 内部recordを返す。HTTP層は必ず公開projectionへ変換する |
| `findByLeadId(leadId)` | 内部operator／retry worker専用 |
| `reserveReceiptId()` | 一意制約下で予約し、衝突時は新しい乱数で再試行する |
| `updateNotificationState(leadId, state)` | 通知成功状態をLeadへ反映する |
| `markRetry(leadId, detail)` | 正規化code、試行数、次回時刻を保存する |
| `moveToDeadLetter(leadId, detail)` | 永続失敗を記録し、自動再送を止める |
| `listRetentionCandidates(query)` | PII本文を返さず、dry-run対象だけを列挙する |
| `deleteOrAnonymize(leadId, option)` | 承認済みretention jobからだけ実行する |

必須保証:

- Lead作成、idempotency keyの一意確定、初期outbox enqueueは同じtransaction境界に置く。
- idempotency digestと`receipt_id`に一意制約を設ける。同時requestでも同じkeyから複数Leadを作らない。
- 保存commit完了前に成功responseを返さない。provider timeout、接続断、一意制約競合は安全側で失敗する。
- `lead_id`と`receipt_id`を別columnとして保持する。公開番号を内部主keyにしない。
- 通知失敗、worker停止、provider停止でLead本体を失わない。
- PIIは保存時暗号化し、backupにも同等の暗号化とaccess controlを適用する。

local-file adapterは単一のtransaction commit recordを権威とし、process間lock内でidempotencyとreceipt予約を確定する。Lead／outbox projectionの生成中に停止した場合はcommit recordから修復する。これはlocal E2E用であり、本番永続storeの代替ではない。

## NotificationOutbox

`src/contracts/notification-outbox.mjs`の`enqueue`、`claim`、`recordSendResult`、`scheduleRetry`、`moveToDeadLetter`、`manualRetry`、`getStatus`、due itemをPIIなしで列挙する`listPending`を実装する。全adapter操作は同期値またはPromiseを返せるが、HTTP／worker層はPromiseとして待機する。

- Leadと初期outboxの整合はLeadStoreのtransactional outboxで保証する。
- `claim`は共有storeのleaseまたは同等の排他で、同じ通知の同時送信を抑える。
- providerへ内部`lead_id`由来の安定した`delivery_key`を渡し、providerが対応する場合はidempotency keyとして使用する。公開`receipt_id`は使用しない。
- 配信はat-least-onceであり、network切断直前にproviderが受理した場合の限定的な重複可能性を残す。lease、安定delivery key、最大試行数により無制限な重複を防ぐ。
- 通知payloadは内部`lead_id`、受付時刻、希望service、状態だけとする。氏名、メール、電話、相談本文を含めない。
- provider response本文、宛先実値、credential、secretをoutboxやlogへ保存しない。正規化したcodeだけを記録する。

初回失敗後は1分、5分、30分、2時間、12時間のexponential backoff相当で最大5回再送する。初回と5回の再送がすべて失敗したら`DEAD_LETTER`へ移す。manual retryはoperator認証、理由、監査eventをproduction adapter側で必須にする。

## RateLimiter

`src/contracts/rate-limiter.mjs`の`consume`を実装し、拒否時は`allowed=false`と1秒以上の`retryAfterSeconds`を返す。HTTP層はstatus 429と`Retry-After`を返す。

- 本番は分散storeまたは承認済みedge rate limitを使う。instance memoryを禁止する。
- session由来hashと正規化したnetwork prefix由来hashを独立dimensionとして評価し、session再発行による迂回とIP単独判定の双方を避ける。network側はNATを考慮してsession側より広い短時間budgetにする。
- immediate peerが明示したtrusted proxyでない限り`X-Forwarded-For`を無視する。`edge` modeはoriginへのdirect access遮断をdeploymentで保証する。
- IPv4、IPv6、NATの共有を考慮し、短いwindowで回復する。正常な問い合わせを長期間blockしない。
- `consume`はcomposite keyに加えてPIIを含まない`session`／`network` hash dimensionを受け取れる。production adapterは両dimensionを共有storeまたはedge policyへ写像する。
- limiter障害時は問い合わせを無制限に通さず、HTTP 500/503へ安全側で失敗させる。

## Provider contract test

`tests/contracts/provider-contract.mjs`へcandidate adapter factoryを渡し、local adapterと同じcontractを実行する。加えてprovider環境でtransaction isolation、multi-instance同時実行、lease失効、backup復元、retention dry-runを実測する。testがPASSしてもprovider接続や本番操作のOwner承認を代替しない。

## 権限・保存・監視

- API runtime: Lead作成、idempotency参照、初期outbox作成だけ。全件export、schema変更、Auth管理を許可しない。
- retry worker: claim、必要最小限の内部record参照、通知、状態更新だけ。
- retention worker: dry-run列挙と別承認済み削除／匿名化だけ。operatorとcredentialを分離する。
- stagingとproductionのstore、queue、secret namespace、通知先を分離する。
- Leadは原則最終接触から2年、失注・無回答は1年、解決outbox/eventとidempotency記録は90日を基準とし、法令、契約、legal holdを優先する。
- metricsは件数、pending age、dead-letter件数だけ。server logはtimestamp、event、correlation ID、内部`lead_id`、adapter名、正規化codeまでとし、browser logには内部IDを出さない。
