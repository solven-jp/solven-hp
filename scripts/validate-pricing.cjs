// User-approved benchmark specification, 2026-10-26. Keep amounts bound to their plan.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../public/pricing/index.html'), 'utf8');
const normalize = text => text.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
const expected = {
  lp: 'LP 132,000円',
  hp5: 'HP 5ページ 165,000円',
  hp10: 'HP 10ページ 220,000円',
  'page-new': '追加ページ（新規）33,000円〜',
  'page-common': '追加ページ（共通）22,000円',
  'lp-section': 'LPセクション追加 11,000円',
  form: '追加フォーム 22,000円〜',
  cms: '簡易CMS 55,000円〜',
  extra: '追加作業 30分 5,500円',
  'renew-part': '部分リニューアル 150,000円〜',
  'renew-standard': '標準リニューアル 300,000円〜',
  'renew-wp': 'WordPressリニューアル 450,000円〜',
  'renew-function': '機能付きリニューアル 550,000円〜',
  'app-small': '小規模 121,000円〜 規模 画面1〜2 期間 1〜2週間',
  'app-mini': 'ミニ 242,000〜363,000円 規模 画面4前後 期間 2〜5週間',
  'app-standard': 'スタンダード 484,000〜726,000円 規模 画面8前後 期間 1〜2か月',
  'app-plus': 'プラス 968,000円〜 規模 画面10超 期間 2〜4か月',
  'hp-basic': 'HP基本 月額 5,500円 月1回点検・報告 バックアップ 障害対応は月30分まで',
  'hp-update': 'HP保守＋更新 月額 9,900円 基本保守 軽微な更新 月2回まで・1回30分',
  'hp-improve': 'HP更新＋月次改善提案つき 月額 16,500円',
  'app-watch': '見守り 月額 12,100円 障害の一次対応 月30分まで 月次報告',
  'app-maint-standard': '標準 月額 24,200円 障害の一次対応 月30分まで 月次報告 軽微な改修 月30分まで',
  'app-maint-plus': 'プラス 月額 36,300円 障害の一次対応 月30分まで 月次報告 軽微な改修 月60分まで',
  advisory: 'IT顧問 月額 33,000円 最低3か月',
  organize: '業務整理のみ 55,000円',
};
const actual = Object.fromEntries([...html.matchAll(/<(article|tr)\b[^>]*data-price-item="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)].map(m => [m[2], normalize(m[3])]));
assert.equal(Object.keys(actual).length, 25, 'all 25 price items must be present');
assert.equal([...html.matchAll(/data-price-item=/g)].length, 25, 'no duplicate price items');
assert.deepEqual(actual, Object.fromEntries(Object.entries(expected).map(([id,text]) => [id,normalize(text)])));
const terms = { hp:'HPのお支払い 着手前50%・検収後50%', lp:'LPのお支払い 前払い100%', app:'アプリのお支払い 着手前50%・納品時50%', advisory:'顧問のお支払い 当月分前払い', acceptance:'検収 納品後5営業日が目安', warranty:'保証 検収完了の翌日から90日' };
const actualTerms = Object.fromEntries([...html.matchAll(/<div data-term="([^"]+)">([\s\S]*?)<\/div>/g)].map(m=>[m[1],normalize(m[2])]));
assert.deepEqual(actualTerms,Object.fromEntries(Object.entries(terms).map(([id,text])=>[id,normalize(text)])));
for (const text of ['掲載価格はすべて税込です。','大規模は個別見積です。','初回相談は60分無料','愛知県安城市を主な活動拠点']) assert.ok(normalize(html).includes(normalize(text)),text);
assert.ok(html.includes('href="mailto:info@solven.jp"'));
assert.ok(html.includes('href="https://www.solven.jp/"'));
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(ids).size,ids.length,'no duplicate IDs');
for (const m of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(m[1]),`anchor ${m[1]} exists`);
// No additional monetary amounts outside the 25 approved items.
const outside = html.replace(/<(article|tr)\b[^>]*data-price-item="[^"]+"[^>]*>[\s\S]*?<\/\1>/g,'');
assert.equal(/\d[\d,〜]*円/.test(normalize(outside)),false,'no unapproved price outside plan items');
console.log('PASS: 25 price items (amounts, ranges, units, scope, durations), 6 terms, tax, contact and anchors.');
