/**
 * 不動産会社の定時処理を見張る例。
 *
 *   実行:  pnpm example
 *
 * 「ポータル掲載の更新が止まったのに、誰も気づかない」を再現する。
 * 掲載は昨日のまま残っているので、画面を見ても正常に見える。
 * 気づけるのは「動いたという報告が来ていない」ことだけである。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calendarWarnings,
  check,
  dailyAt,
  defineCalendar,
  markAlerted,
  MemoryJournal,
  pendingAlerts,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));

const dim = (s) => `\u001B[90m${s}\u001B[0m`;
const green = (s) => `\u001B[32m${s}\u001B[0m`;
const red = (s) => `\u001B[31m${s}\u001B[0m`;
const yellow = (s) => `\u001B[33m${s}\u001B[0m`;
const bold = (s) => `\u001B[1m${s}\u001B[0m`;

const 時刻 = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const 表示 = (date) =>
  `${date.getMonth() + 1}/${date.getDate()}(${"日月火水木金土"[date.getDay()]}) ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

// ── 見張る対象 ──────────────────────────────────────
const ジョブ = [
  {
    name: "ポータル掲載の更新",
    schedule: dailyAt("06:00"),
    graceMinutes: 30,
    // 土日も掲載は更新する
  },
  {
    name: "契約更新の3ヶ月前通知",
    schedule: dailyAt("09:00"),
    graceMinutes: 60,
    onlyBusinessDays: true, // 営業日だけ動く
  },
  {
    name: "賃料入金の消し込み",
    schedule: dailyAt("07:30"),
    graceMinutes: 45,
    onlyBusinessDays: true,
  },
];

// 不動産会社に多い水曜定休 + 土日 + 祝日
const カレンダー = defineCalendar({
  weeklyHolidays: ["wednesday", "saturday", "sunday"],
  holidays: ["2026-09-21", "2026-09-23"], // 敬老の日・秋分の日
});

const journal = new MemoryJournal();

// ── 過去1週間の「動いた」報告を入れる ──────────────────
// 9/7(月) から 9/11(金) まで。ただしポータル更新は 9/10(木) 以降 止まっている。
const 記録 = [];
for (const [日, 曜日] of [
  [7, "月"],
  [8, "火"],
  [9, "水"],
  [10, "木"],
  [11, "金"],
]) {
  const 営業日 = 曜日 !== "水";

  // ポータル更新は 9/10 から止まった（サーバー再起動でcronが復帰しなかった想定）
  if (日 < 10) {
    記録.push({ job: "ポータル掲載の更新", at: 時刻(2026, 9, 日, 6, 12).toISOString(), ok: true, note: "42件更新" });
  }
  if (営業日) {
    記録.push({ job: "契約更新の3ヶ月前通知", at: 時刻(2026, 9, 日, 9, 8).toISOString(), ok: true, note: "3件通知" });
    記録.push({ job: "賃料入金の消し込み", at: 時刻(2026, 9, 日, 7, 41).toISOString(), ok: true, note: "18件消込" });
  }
}
for (const r of 記録) await journal.record(r);

console.log(bold("\n━━━ 状況 ━━━"));
console.log(`  見張る対象: ${ジョブ.length}件`);
console.log(`  記録された報告: ${記録.length}件（9/7〜9/11）`);
console.log(dim("  ポータル掲載の更新は 9/10 の朝から動いていない（サーバー再起動でcronが復帰しなかった）"));
console.log(dim("  ただし掲載自体は残っているので、画面を見ても異常には見えない\n"));

// ── 見張る ────────────────────────────────────────
async function 点検(now) {
  console.log(bold(`━━━ ${表示(now)} 時点の点検 ━━━`));

  const findings = await check(ジョブ, journal, now, { calendar: カレンダー });

  for (const f of findings) {
    const 記号 = {
      ok: green("✓"),
      late: yellow("…"),
      missing: red("✗"),
      failed: red("✗"),
      never_ran: red("!"),
      not_due: dim("—"),
    }[f.status];

    const 説明 = {
      ok: "動いています",
      late: "まだ来ていませんが猶予の内側です",
      missing: `${f.overdueMinutes}分 遅れています`,
      failed: `失敗の報告: ${f.note ?? ""}`,
      never_ran: "一度も動いた報告がありません（仕掛け忘れの可能性）",
      not_due: "本日は予定がありません",
    }[f.status];

    console.log(`  ${記号} ${f.job.padEnd(22)} ${説明}`);
    if (f.status === "missing") {
      console.log(dim(`      最後に動いたのは ${表示(new Date(f.lastReportedAt))}`));
    }
  }

  const alerts = await pendingAlerts(findings, journal);
  console.log(
    alerts.length === 0
      ? dim("  → 新たに知らせることはありません\n")
      : `  ${red(`→ ${alerts.length}件を担当者に知らせます`)}\n`,
  );
  await markAlerted(alerts, journal);

  return { findings, alerts };
}

// 9/11(金) の朝。ポータル更新は2日前から止まっている
const 金曜 = await 点検(時刻(2026, 9, 11, 10, 0));

// 同じ日の夕方にもう一度点検する。同じ欠測では鳴らない
await 点検(時刻(2026, 9, 11, 18, 0));

// 9/12(土)。営業日だけのジョブは休みなので、休業日に誤検知しない
await 点検(時刻(2026, 9, 12, 10, 0));

// ── 休業日の一覧が古くなっていないか ──────────────────
const 警告 = calendarWarnings(カレンダー, 時刻(2026, 12, 1));
console.log(bold("━━━ 休業日の一覧の点検（12/1 時点）━━━"));
console.log(警告.length === 0 ? dim("  問題なし") : `  ${yellow(警告[0])}`);
console.log();

// ── 担当者に渡す監視レポート ────────────────────────
const outDir = join(here, "out");
await mkdir(outDir, { recursive: true });
const reportPath = join(outDir, "監視レポート.txt");

await writeFile(
  reportPath,
  [
    "【定時処理の監視レポート】2026-09-11 10:00 時点",
    "",
    ...金曜.findings.map((f) => {
      const 状態 = { ok: "正常", late: "遅延中", missing: "停止", failed: "失敗", never_ran: "未実行", not_due: "予定なし" }[f.status];
      const 詳細 = f.lastReportedAt ? `最終実行 ${表示(new Date(f.lastReportedAt))}` : "実行記録なし";
      return `${状態.padEnd(5)} ${f.job}  （${詳細}）`;
    }),
    "",
    金曜.alerts.length > 0
      ? `要対応: ${金曜.alerts.map((a) => a.job).join(" / ")}`
      : "要対応: なし",
    "",
    "※ このレポートは、監視対象とは別の場所から生成しています。",
    "   同じサーバーで動かすと、サーバーごと落ちたときに見張りも止まります。",
  ].join("\n"),
  "utf8",
);

console.log(bold("━━━ 担当者に渡す監視レポート ━━━"));
console.log(`  ${reportPath}\n`);

if (!金曜.findings.some((f) => f.job === "ポータル掲載の更新" && f.status === "missing")) {
  console.log(red("想定と違います: ポータル掲載の更新は missing になるはずです"));
  process.exitCode = 1;
}
