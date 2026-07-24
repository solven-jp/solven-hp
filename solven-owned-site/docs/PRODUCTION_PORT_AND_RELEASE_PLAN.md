# Production port, staging and rollback plan

## Evidence status

Ownerは2026-07-20にcanonical originを`https://solven.jp/`、公開会社情報を現在の画面表示どおりと確定した。`www.solven.jp`はapexへ恒久redirectする方針とするが、DNS／redirectは未設定である。

2026-07-20のread-only再確認で、Google Cloud project `solven-jp`がACTIVEであること、`solven-jp/solven-hp`のdefault branchが`main`であること、`.firebaserc`と`firebase.json`がproject／Hosting site `solven-jp`およびdeploy directory `public/`を指定していることを確認した。repositoryは公開状態、`main`は未保護、構成は静的HTML中心で、GitHub Pagesの自動処理も有効である。これらは既存targetの識別証跡であり、現行HPのproduction sourceまたは新release authorityとしてのOwner承認ではない。

現行HPが必要とするCloud Run Admin APIとCloud Firestore APIは`solven-jp`で未有効で、`/api/**` rewrite、persistent adapter、rollback releaseは存在を確認できていない。Domain ownership、現行production commit、Cloudflare管理元も未解決である。既存projectをstagingへ流用せず、productionとは別project／originで検証する。No remote, hosting or provider was changed.

2026-07-20のread-only課金先照合で、既存の専用staging候補 `solven-owned-site-stg-d3e6` を確認した。projectはACTIVEでbilling account `solven1`へ連携済み、Firebase有効、Cloud Run service `solven-owned-site-stg`、東京regionのFirestore Native `(default)`／`restore-test`、Secret Manager等の関連APIを持ち、Firestoreはdelete protection有効である。現行release、Hosting site／rewrite、生成principal／IAM role／browser API key、secret参照、backup内容、Cloud Run ingress／IAM invoker／未認証アクセス可否／direct URL到達性は未監査で、この確認ではresource変更やdeployを行っていない。既存`solven-jp`も変更していない。

先に作成したproject shell `solven-jp-staging`はACTIVE、課金未連携、Firebase Management／Hosting／Rules API有効の状態で保持する。既存専用stagingと重複するためrelease targetにせず、追加設定・deploy・物理削除はいずれも行わない。

同日のread-only詳細監査では、Cloud Runの未認証direct access 403、service／job accountの分離と最小role、Scheduler PAUSED、安全flag、Firestore PITR／delete protection／backupを確認した。一方、Hosting release／rewriteは0件、配備source SHAは現行workspace／GitHubで追跡不能、live adapter名は現行schema不一致、必須secret参照は欠落、secret versionは0、restore-testはbackup restore由来でない。詳細は`records/solven-owned-site-staging-readonly-audit-20260720.md`とし、現revisionの再利用・Hosting接続・promotionを禁止する。

Local presentation and form behavior are `LOCAL_READY_FOR_OWNER_REVIEW`: Playwright 1.60.0のChromium、WebKit 26.4、Firefox 150.0.2で正式E2EがPASSし、外部request 0、page error 0、横overflowなしを確認した。本番公開は以下の外部境界が未完了のため`PRODUCTION_BLOCKED`とする。

2026-07-20の追加表示差分では、派遣会社向け従業員管理アプリと不動産会社向け案件管理アプリを匿名の開発実績として追加し、実績cardの「稼働中」ラベルを削除した。desktop／390×844のBrowser表示、console、local build、41/41 unit、environment、公開build contract、portable bundleはPASSした。追加差分を含む正式3 browser E2EもChromium 148.0.7778.96、WebKit 26.4、Firefox 150.0.2ですべてPASSし、HTTP 201、外部request 0、page error 0、横overflowなしを確認した。

Brandは`LOCAL_READY`: Owner指定SVGをbyte無改変で保持し、公式色`#0B1F35 / #3884D2 / #FFFFFF`、favicon、1200×630 OG画像、desktop／mobile表示へ反映した。ローカルのbrand差し替えは公開blockerではない。

- 永続LeadStore／outbox／session／rate limit provider
- 実通知provider、通知先、secret manager
- production source、Hosting、domain、same-origin API rewrite
- backup、release snapshot、rollbackの実環境検証
- staging環境での実Safariブランド表示、screen reader実機と運用者確認。実Safari 26.5.2の既存UX操作検証は完了済みであり、ブランド差し替え後の可視SafariとVoiceOver操作だけを人間の確認項目として残す。
- Ownerによる公開承認

## Public SEO inputs

Owner確定情報に基づき、canonical、OGP、1200×630のOG画像、favicon、sitemap.xml、robots.txt、Organization構造化dataをlocal実装した。Organizationは画面上の会社名、所在地、メールと一致し、架空の代表者経歴、顧客名、実績値を含めない。

raw `public/`とlocal／staging buildは`noindex,nofollow`かつrobots `Disallow: /`を維持する。production buildで`SOLVEN_RUNTIME_ENVIRONMENT=production`と`SOLVEN_NOINDEX=false`を明示した場合だけ`index,follow`とproduction sitemapを出力する。domain／Hosting接続と実公開確認は未実施である。

## Portable handoff

Use `scripts/generate-portable-bundle.mjs` only after a clean build. The generated artifact contains immutable presentation output, server source, adapter contracts, environment/deploy schemas, checksums and migration/rollback material. It excludes local runtime, review material, screenshots, logs, secrets and absolute paths. Verify it in a separate extraction directory before handoff.

The three integration methods and evidence-based selection conditions are in `PRODUCTION_HANDOFF_DECISION.md`. 専用repository候補は既に存在するが、現行HPの移植、CI、branch protection、same-origin APIは未構築である。実装基盤は`RECOMMENDED_PRODUCTION_STACK.md`のFirebase Hosting + Cloud Run + Firestore構成を推奨する。現行HP用runtime resourceは未作成である。

## Staging

Apply `deploy/staging.defaults.json` and complete `deploy/staging.checklist.json`. Staging uses a distinct origin, noindex/nofollow, GA4 disabled, staging-only persistent Lead/outbox scope, no real customer data, notification disabled/sandbox, separate session/cookie/secrets and no production data connection. `solven-owned-site-stg-d3e6`をtarget候補とするが、current revisionは監査不合格である。Ownerのtarget承認と、現行sourceから生成したclean candidateのlocal検証が完了するまで設定変更・preview deployへ進まない。

## Production

Complete every required gate in `deploy/production.checklist.json`. GA4の利用方針は承認済みだがMeasurement IDが未提供なので、現時点ではdisabledとする。Production deployment requires current source/hosting evidence, persistent providers, real notification destination confirmation, backup/snapshot, staging browser/security/E2E evidence and Owner approval.

Rollback and incident steps are normative in `OPERATIONS_INCIDENT_ROLLBACK.md`. Static/server revisions roll back together; LeadStore and outbox data are never deleted or rolled back with application code.
