# cron-sentinel

**動かなかったことを検知する。失敗はログに残るが、実行されなかったことはログに残らない。**

[![CI](https://github.com/kazuhiro2188-lgtm/cron-sentinel/actions/workflows/ci.yml/badge.svg)](https://github.com/kazuhiro2188-lgtm/cron-sentinel/actions/workflows/ci.yml)
![実行時依存](https://img.shields.io/badge/runtime%20dependencies-0-1f5f52)
![License](https://img.shields.io/badge/license-MIT-1f5f52)

---

## 実際の業務ではこう使う — 不動産会社の定時処理を見張る

賃貸管理の現場では、毎日いくつもの処理が定時に動いています。

| 処理 | 止まると何が起きるか |
|---|---|
| ポータルサイト（SUUMO等）への物件情報の更新 | 成約済み物件が載り続ける（**おとり広告のリスク**）／新規物件の反響が来ない |
| 契約更新の3ヶ月前通知 | 更新手続きが漏れ、法定更新になって**更新料が取れない** |
| 賃料入金の消し込み | 督促の遅れ、オーナー報告の遅れ |

**問題は、止まっても気づけないことです。**

ポータルの掲載は昨日のまま残っているので、画面を見ても正常に見えます。気づくのは数日後の「なんか今月、反響少なくない？」という会話です。

```bash
git clone https://github.com/kazuhiro2188-lgtm/cron-sentinel.git
cd cron-sentinel && pnpm install && pnpm example
```

```
━━━ 状況 ━━━
  見張る対象: 3件
  記録された報告: 11件（9/7〜9/11）
  ポータル掲載の更新は 9/10 の朝から動いていない（サーバー再起動でcronが復帰しなかった）
  ただし掲載自体は残っているので、画面を見ても異常には見えない

━━━ 9/11(金) 10:00 時点の点検 ━━━
  ✗ ポータル掲載の更新              240分 遅れています
      最後に動いたのは 9/9(水) 06:12
  ✓ 契約更新の3ヶ月前通知            動いています
  ✓ 賃料入金の消し込み              動いています
  → 1件を担当者に知らせます

━━━ 9/11(金) 18:00 時点の点検 ━━━
  ✗ ポータル掲載の更新              720分 遅れています
  → 新たに知らせることはありません        ← 同じ欠測では鳴らない

━━━ 9/12(土) 10:00 時点の点検 ━━━
  ✓ 契約更新の3ヶ月前通知            動いています     ← 休業日に誤検知しない
  ✓ 賃料入金の消し込み              動いています
```

---

## 仕組みは1行で言えます

```
動いたときに報告させ、報告が来ないことを検知する。
```

動かなかったものは、自分では何も言えません。だから「動いた」という報告の**不在**を見ます。

```ts
// ① 処理する側: 終わったら報告する
await journal.record({ job: "ポータル掲載の更新", at: new Date().toISOString(), ok: true, note: "42件更新" });

// ② 見張る側（別の場所で動く）: 報告が来ていないジョブを見つける
const findings = await check(jobs, journal, new Date(), { calendar });
const alerts = await pendingAlerts(findings, journal);   // まだ知らせていないものだけ
await markAlerted(alerts, journal);                       // 同じ欠測で二度鳴らさない
```

### 判定は6種類

| 判定 | 意味 |
|---|---|
| `ok` | 直近の予定時刻ぶんの報告が来ている |
| `late` | 予定時刻を過ぎたが、まだ猶予の内側 |
| `missing` | **猶予を過ぎても報告が無い。これが本題** |
| `failed` | 報告は来たが、失敗したと報告された |
| `never_ran` | 一度も報告が無い。**仕掛け忘れの可能性** |
| `not_due` | 今日は予定が無い |

`never_ran` を `missing` と分けているのは、**原因がまったく違う**からです。前者は「仕掛けを入れ忘れた」、後者は「動いていたものが止まった」。打つ手が違います。

---

## 実務で効く3つの配慮

### ① 見張り番は、監視対象と同じ場所で動かさない

同じサーバーに置くと、サーバーごと落ちたときに見張りも一緒に死にます。**最も検知したい状況こそ、見張り番が動かない状況です。**

そのため、この道具は次のように作ってあります。

- 見張り番は監視対象を呼ばない。**記録だけを読む**
- 判定は**現在時刻を引数で受け取る**。内部で `new Date()` を呼ばない
- 記録の置き場所を差し替えられる（別サーバーやデータベースに置ける）

GitHub Actions から見張る例:

```yaml
name: 定時処理の見張り
on:
  schedule:
    - cron: "0 * * * *"   # 毎時、自社の障害とは独立した場所で動く
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/check-jobs.mjs   # missing があれば Slack へ
```

→ 詳細: [ADR-0001](docs/adr/0001-the-watcher-must-not-live-with-the-watched.md)

### ② 土日祝に鳴らさない（日本の営業日）

「営業日だけ動くジョブ」を休業日に「止まった」と通知すると、担当者は数週間で通知を無視します。**無視される通知は、無いのと同じです。**

```ts
const calendar = defineCalendar({
  weeklyHolidays: ["wednesday", "saturday", "sunday"],  // 不動産に多い水曜定休
  holidays: ["2026-09-21", "2026-09-23"],               // 祝日・夏季休業・創立記念日
});
```

**祝日の一覧は内蔵しません。** 法律で変わるうえ、企業ごとに休業日が違うためです。内蔵すると、更新しない限り来年から静かに間違い始めます。

代わりに、**一覧が古くなっていることに先に気づけるようにしています。**

```ts
calendarWarnings(calendar, new Date());
// → ["休業日の一覧に、今日より先の日付が1件もありません。一覧が古くなっている可能性があります"]
```

→ 詳細: [ADR-0002](docs/adr/0002-holidays-come-from-the-user.md)

### ③ 同じ欠測で鳴り続けない

止まっている間ずっと通知すると、担当者は通知を切ります。**1つの予定時刻につき、通知は1回だけ**です。翌日また欠測すれば、それは別の予定時刻なので改めて知らせます。

---

## 使い方

```ts
import {
  check, dailyAt, defineCalendar, FileJournal, markAlerted, pendingAlerts, weeklyOn,
} from "cron-sentinel";

const jobs = [
  { name: "ポータル掲載の更新", schedule: dailyAt("06:00"), graceMinutes: 30 },
  { name: "契約更新の3ヶ月前通知", schedule: dailyAt("09:00"), graceMinutes: 60, onlyBusinessDays: true },
  { name: "週次レポート", schedule: weeklyOn("monday", "08:00"), graceMinutes: 120, onlyBusinessDays: true },
];

const journal = new FileJournal("/shared/cron-journal.json");
const calendar = defineCalendar({ weeklyHolidays: ["saturday", "sunday"] });

const findings = await check(jobs, journal, new Date(), { calendar });
const alerts = await pendingAlerts(findings, journal);

if (alerts.length > 0) {
  await notifySlack(alerts);   // 通知の手段は利用者が持つ
  await markAlerted(alerts, journal);
}
```

スケジュールは cron 式ではなく、読んで分かる形で書きます。`0 6 * * *` は読み間違えても気づけません。

| 書き方 | 意味 |
|---|---|
| `dailyAt("06:00")` | 毎日 6時 |
| `everyMinutes(30)` | 30分ごと |
| `weeklyOn("monday", "08:00")` | 毎週月曜 8時 |

---

## やらないこと

| やらないこと | 理由 |
|---|---|
| 通知の送信（メール・Slack等） | 判定を返すだけにする。送信手段を抱えると、送信先の都合で本体を変えることになる |
| ジョブの実行 | これは見張り番であって、実行基盤ではない（実行は [agent-kit](https://github.com/kazuhiro2188-lgtm/agent-kit) の担当） |
| 祝日カレンダーの内蔵 | 法律で変わる。内蔵すると必ず陳腐化する |
| cron 式の完全対応 | 読みにくく、誤りに気づきにくい |

### 既知の限界（隠しません）

**見張り番自身が止まったら、検知できません。**

この問題は原理的に解決しません。見張り番を見張る仕組みを作れば、今度はそれを見張る必要が出ます。無限に続きます。

できるのは**止まりにくい場所に置く**ことだけです。

| 置き場所 | 評価 |
|---|---|
| 監視対象と同じサーバー | ✗ 同時に落ちる。最も検知したい場面で機能しない |
| 別のサーバー | △ そのサーバーも落ちうる |
| GitHub Actions などの外部サービス | ○ 自社の障害と独立している |

「完全に監視できます」と言うほうが、利用者を危険にさらします。

その他:

- 記録の書き込みが失敗すると、動いたジョブが `missing` に見えます（記録の置き場所の可用性に依存します）
- 判定は分単位です。秒単位の精度は扱いません

## 開発

```bash
pnpm install
pnpm test        # 45 tests
pnpm typecheck
pnpm build
pnpm example     # 不動産会社の定時処理を見張る例
```

## 設計文書

| 文書 | 内容 |
|---|---|
| [仕様書](docs/spec.md) | 何を作るか・なぜ・判定の種類 |
| [ADR-0001](docs/adr/0001-the-watcher-must-not-live-with-the-watched.md) | 見張り番は監視対象と同じ場所で動かさない |
| [ADR-0002](docs/adr/0002-holidays-come-from-the-user.md) | 祝日カレンダーを内蔵しない |
| [仕組みの解説](docs/explain.md) | コードの流れと設計判断の理由 |

## ライセンス

MIT
