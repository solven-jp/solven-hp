# Known limitations

- Canonical origin `https://solven.jp/`と公開会社情報はOwner確定済み。既存候補はrepository `solven-jp/solven-hp`、Google Cloud project／Firebase Hosting site `solven-jp`、deploy directory `public/`までread-only確認済み。ただしproduction commit、domain ownership、Cloudflare管理元、same-origin rewrite、新release authorityは未確認。
- 候補repositoryは公開状態で`main`が未保護、旧静的構成とGitHub Pagesの自動処理を持つ。現行HPのserver runtimeをそのまま配備できない。
- 候補projectではCloud Run Admin APIとCloud Firestore APIが未有効で、現行HP用のCloud Run／Firestore resourceは確認できない。Productionとは別project／originのstagingが必要。
- Persistent LeadStore/outbox, distributed rate limiter, shared session store and notification provider are interfaces only; no production provider is connected.
- Secret manager, backup target and notification destination reference names are unresolved.
- GA4利用方針は承認済みだがMeasurement IDは未提供。GA4 remains disabled and is not a release blocker.
- Local file and memory adapters are test/development implementations, not production durability or scaling guarantees.
- At-least-once notification can produce a limited duplicate when a provider accepts a request immediately before network failure; stable delivery keys and provider idempotency should be used.
- Playwright 1.60.0のChromium、WebKit 26.4、Firefox 150.0.2によるブランド差し替え後のlocal正式E2EはPASSしている。実Safari 26.5.2の既存UX操作確認は完了済みだが、差し替え後のロゴ・色とVoiceOverの読み進めは可視操作を避けるため、人間によるstaging確認として残る。
- Platform-authenticated administration health for release ID/source SHA must be provided by the chosen hosting platform; the public endpoint intentionally omits them.
- Canonical archive trailing-newline differences remain the recorded byte-preservation exception. Canonical files are not changed by this handoff.
- canonical、OGP、公式ロゴ／色で再生成した1200×630のOG画像、公式SVGとbyte一致するfavicon、robots.txt、sitemap.xml、Organization構造化dataはOwner確定情報でlocal実装済み。Hosting／domainへの反映と検索engineからの実取得は未検証。
- Backup、release snapshot、rollbackは文書とlocal契約のみであり、実hosting環境では未検証。
