# 推奨production構成

## 決定状態

2026-07-20時点の推奨構成を以下とする。これは将来のproduction移植先を選ぶための設計判断であり、provider作成、契約、課金、credential設定、domain変更、deploy、公開を実行した記録ではない。

- canonical origin: `https://solven.jp/`
- `www.solven.jp`: apexへ恒久redirectする。redirect設定はdomain／hosting接続時の外部作業として未実施。
- source: 専用repository候補 `solven-jp/solven-hp` は存在するが、現在は公開repository、未保護の`main`、静的`public/`、GitHub Pages automationという旧構成である。検証済みportable bundleとsame-origin APIを扱うrelease境界への移行は未実施。
- static hosting: Firebase Hosting。
- same-origin API: Firebase Hostingの`/api/**`をCloud Runへrewriteし、staticとserver revisionを同じreleaseでpinする。
- durable store: Firestore Native mode。Lead、idempotency、receipt予約、outboxを同一transaction境界で保存する。
- session／rate limit: 当初の低volumeではFirestoreの分離collectionとtransactionを利用する。PIIをkeyにせずhash化し、contention／latencyが契約値を超えた場合だけadapterの背後をRedis等へ交換する。
- notification worker: APIとは別service accountのCloud Run workerを、認証付きCloud Schedulerから起動してtransactional outboxを処理する。
- notification provider: 安定したdelivery keyをidempotency keyへ渡せるResendを第一候補とする。provider account、送信domain、宛先は未確定であり、実送信は行わない。
- secrets: Secret Manager。環境変数へsecret値を直書きしない。
- backup: Firestore PITRと定期backupを併用し、production release前にrestore手順を別projectで実測する。
- environments: stagingとproductionでFirebase／Google Cloud project、Firestore、service account、secret、通知先を分離する。
- analytics: GA4利用は承認済みだがMeasurement ID未提供のため無効を維持する。ID確定後も同意前は既定拒否とする。

## Staging bootstrap status

2026-07-20のread-only課金先照合で、既存の専用staging候補 `solven-owned-site-stg-d3e6` を確認した。projectはACTIVE、billing account `solven1`へ連携済み、`application=solven-owned-site`／`environment=staging`／`firebase=enabled`のlabelを持つ。Cloud Run service `solven-owned-site-stg`、東京regionのFirestore Native `(default)`／`restore-test`、Secret Manager等の必要APIが存在し、Firestoreはdelete protection有効である。この初期照合ではrelease一致、Hosting／IAM／key／secret／backup／外部到達性を判定せず、後続の詳細監査で確認した。

別途作成したproject shell `solven-jp-staging`はACTIVEだが課金未連携で、Firebase Management／Hosting／Rules APIの有効化以外は未構築である。既存専用stagingとの重複を避けるためrelease targetとして使用せず、課金連携、Firebase登録、resource作成を行わない。物理削除も未承認のため実施しない。

Read-only詳細監査の結果、既存targetのnetwork／IAM分離、staging安全flag、Firestore保護／backupは利用可能な基盤として確認できた。ただしcurrent revisionはsource provenance不明、現行environment schema不一致、secret integration未完了、Hosting release／rewriteなし、restore実測なしのため不採用とする。既存resourceを消さず、現行sourceのclean candidateで段階的に置き換える。

## 選定理由

- Firebase HostingからCloud Runへのrewriteにより、browser側のAPI originを増やさず、既存のsame-origin契約を維持できる。
- Firestore transactionを使えば、Lead作成、idempotency確定、公開受付番号予約、初期outboxを一つのcommit境界に置ける。
- APIとworkerのservice accountを分けることで、公開APIへ全件読取や再送権限を与えずに済む。
- 専用repositoryと環境別projectは、既存repositoryの進行中変更、広いCI trigger、共有secretからproduction release境界を分離しやすい。
- Resendのidempotency keyは現在の最大再送間隔を含む24時間内の重複抑止に利用できる。ただしat-least-onceの限定的重複可能性はoutbox契約どおり残る。

## 実装時の必須条件

1. 正式staging target承認後かつresource変更前に、既存の生成principal、IAM role、browser API keyをread-onlyで棚卸しし、service別の最小権限、API／referrer制限、staging限定性を確認する。Cloud Runのingress、IAM invoker、未認証アクセス可否、Hosting以外のdirect URL到達性も確認し、完了するまでresource変更とdeployへ進まない。この手順を重複project shell `solven-jp-staging`へのFirebase登録として実行しない。
2. `PRODUCTION_ADAPTER_SPEC.md`のcontract testをcandidate providerへ適用する。
3. stagingで同時request、transaction競合、worker lease失効、provider timeout、idempotent replayを実測する。
4. notification payloadはservice、受付時刻、内部状態等のPIIなしsummaryだけとし、氏名、メール、電話、相談本文を送信しない。
5. production originへのdirect Cloud Run accessを遮断または認証し、trusted proxy境界を確定する。
6. backup取得だけでなく、隔離projectへのrestoreとapplication compatibilityを確認する。
7. immutable static release、Cloud Run revision、rewrite、Firestore schema version、backup referenceをrelease単位で記録する。
8. staging noindex、productionだけindex許可とし、raw `public/`をproductionへ直接配信しない。

## 外部入力・承認待ち

- production候補として確認したGoogle Cloud project／Firebase Hosting site `solven-jp`を正式authorityとするOwner判断。projectはACTIVEだが、既存本番をstagingとして使わない。
- production用billing accountの適用範囲と、分離staging用Hosting site ID
- 既存 `solven-owned-site-stg-d3e6` を正式staging targetとするOwner承認と、現行release／Hosting rewrite／IAM／key／secret／backup／Cloud Run ingress・invoker・direct URL到達性のread-only監査
- 重複project shell `solven-jp-staging`を当面保持するか、別承認で物理削除するかのOwner判断
- dedicated repository候補 `solven-jp/solven-hp` の採用判断、非公開化の要否、branch protection、CI実行主体
- Cloud Run regionとdata residencyのOwner判断
- Firestore database ID、retention確定、backup保管期間
- Resend account、送信domain認証、通知先、障害時の運用担当
- Secret Manager secret名とservice account権限
- GA4 Measurement ID
- staging URL、production deploy、DNS／`www` redirect、公開の個別承認

## 参照する一次資料

- Firebase HostingとCloud Run rewrite: <https://firebase.google.com/docs/hosting/cloud-run>
- Firebase Hosting設定: <https://firebase.google.com/docs/hosting/full-config>
- 既存Google Cloud projectへのFirebase追加: <https://firebase.google.com/docs/projects/use-firebase-with-existing-cloud-project>
- Firestore transaction: <https://cloud.google.com/firestore/native/docs/manage-data/transactions>
- Firestore PITR: <https://firebase.google.com/docs/firestore/pitr>
- Firestore backup／restore: <https://cloud.google.com/firestore/native/docs/disaster-recovery>
- Cloud Schedulerから認証付きCloud Run起動: <https://cloud.google.com/run/docs/triggering/using-scheduler>
- Cloud RunのSecret Manager利用: <https://cloud.google.com/run/docs/configuring/services/secrets>
- Resend idempotency key: <https://resend.com/docs/dashboard/emails/idempotency-keys>
