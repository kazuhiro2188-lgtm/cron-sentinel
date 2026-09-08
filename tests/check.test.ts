import { beforeEach, describe, expect, it } from "vitest";
import { defineCalendar } from "../src/calendar.js";
import { check, markAlerted, pendingAlerts } from "../src/check.js";
import { MemoryJournal } from "../src/journal.js";
import { dailyAt } from "../src/schedule.js";
import type { JobDefinition } from "../src/types.js";

const at = (y: number, m: number, d: number, h = 0, min = 0): Date => new Date(y, m - 1, d, h, min);

const ポータル更新: JobDefinition = {
  name: "ポータル掲載の更新",
  schedule: dailyAt("06:00"),
  graceMinutes: 30,
};

const 更新通知: JobDefinition = {
  name: "契約更新の通知",
  schedule: dailyAt("09:00"),
  graceMinutes: 60,
  onlyBusinessDays: true,
};

const 土日休み = defineCalendar({ weeklyHolidays: ["saturday", "sunday"] });

let journal: MemoryJournal;
beforeEach(() => {
  journal = new MemoryJournal();
});

describe("check — 動いたことの確認", () => {
  it("予定時刻の後に報告があれば ok", async () => {
    await journal.record({ job: ポータル更新.name, at: at(2026, 9, 8, 6, 12).toISOString(), ok: true });
    const [finding] = await check([ポータル更新], journal, at(2026, 9, 8, 8, 0));
    expect(finding?.status).toBe("ok");
  });

  it("報告が失敗だったら failed", async () => {
    await journal.record({
      job: ポータル更新.name,
      at: at(2026, 9, 8, 6, 12).toISOString(),
      ok: false,
      note: "APIが403を返しました",
    });
    const [finding] = await check([ポータル更新], journal, at(2026, 9, 8, 8, 0));
    expect(finding?.status).toBe("failed");
    expect(finding?.note).toContain("403");
  });
});

describe("check — 動かなかったことの検知（本題）", () => {
  it("猶予の内側なら late", async () => {
    // 前日は動いた。今日の 06:00 分はまだ来ていないが、06:20 なので猶予（30分）の内側
    await journal.record({ job: ポータル更新.name, at: at(2026, 9, 7, 6, 5).toISOString(), ok: true });
    const [finding] = await check([ポータル更新], journal, at(2026, 9, 8, 6, 20));
    expect(finding?.status).toBe("late");
  });

  it("猶予を過ぎても報告が無ければ missing", async () => {
    await journal.record({ job: ポータル更新.name, at: at(2026, 9, 7, 6, 5).toISOString(), ok: true });
    const [finding] = await check([ポータル更新], journal, at(2026, 9, 8, 7, 0));
    expect(finding?.status).toBe("missing");
  });

  it("どれくらい遅れているかを分で示す", async () => {
    await journal.record({ job: ポータル更新.name, at: at(2026, 9, 7, 6, 5).toISOString(), ok: true });
    const [finding] = await check([ポータル更新], journal, at(2026, 9, 8, 7, 0));
    expect(finding?.overdueMinutes).toBe(60);
  });

  it("最後に動いた時刻を示す", async () => {
    await journal.record({ job: ポータル更新.name, at: at(2026, 9, 7, 6, 5).toISOString(), ok: true });
    const [finding] = await check([ポータル更新], journal, at(2026, 9, 8, 7, 0));
    expect(finding?.lastReportedAt).toBe(at(2026, 9, 7, 6, 5).toISOString());
  });

  it("何日も止まっていても検知し続ける", async () => {
    await journal.record({ job: ポータル更新.name, at: at(2026, 9, 1, 6, 5).toISOString(), ok: true });
    const [finding] = await check([ポータル更新], journal, at(2026, 9, 8, 7, 0));
    expect(finding?.status).toBe("missing");
  });
});

describe("check — 一度も動いていないジョブ", () => {
  it("報告が1件も無ければ never_ran", async () => {
    const [finding] = await check([ポータル更新], journal, at(2026, 9, 8, 7, 0));
    expect(finding?.status).toBe("never_ran");
  });

  it("missing とは区別する（原因が違うため）", async () => {
    // never_ran = 仕掛け忘れ / missing = 動いていたものが止まった
    const [finding] = await check([ポータル更新], journal, at(2026, 9, 8, 7, 0));
    expect(finding?.status).not.toBe("missing");
  });
});

describe("check — 営業日を扱う", () => {
  it("休業日に誤検知しない", async () => {
    // 金曜(9/11)に動いた。日曜(9/13)に見ても、直前の予定は金曜なので ok
    await journal.record({ job: 更新通知.name, at: at(2026, 9, 11, 9, 5).toISOString(), ok: true });
    const [finding] = await check([更新通知], journal, at(2026, 9, 13, 12, 0), { calendar: 土日休み });
    expect(finding?.status).toBe("ok");
  });

  it("営業日に止まっていれば検知する", async () => {
    // 金曜に動いたきり、翌週の火曜まで動いていない
    await journal.record({ job: 更新通知.name, at: at(2026, 9, 11, 9, 5).toISOString(), ok: true });
    const [finding] = await check([更新通知], journal, at(2026, 9, 15, 12, 0), { calendar: 土日休み });
    expect(finding?.status).toBe("missing");
  });

  it("営業日を無視するジョブは休業日でも検知する", async () => {
    await journal.record({ job: ポータル更新.name, at: at(2026, 9, 11, 6, 5).toISOString(), ok: true });
    const [finding] = await check([ポータル更新], journal, at(2026, 9, 13, 12, 0), { calendar: 土日休み });
    expect(finding?.status).toBe("missing");
  });
});

describe("check — 決定論的であること", () => {
  it("同じ記録と同じ時刻なら、何度呼んでも同じ結果になる", async () => {
    await journal.record({ job: ポータル更新.name, at: at(2026, 9, 7, 6, 5).toISOString(), ok: true });
    const 一回目 = await check([ポータル更新], journal, at(2026, 9, 8, 7, 0));
    const 二回目 = await check([ポータル更新], journal, at(2026, 9, 8, 7, 0));
    expect(一回目).toEqual(二回目);
  });

  it("時刻を引数で受け取る（内部で現在時刻を読まない）", async () => {
    // 別の場所・別の時刻から実行しても、同じ記録なら同じ判定になる（ADR-0001）
    await journal.record({ job: ポータル更新.name, at: at(2026, 9, 7, 6, 5).toISOString(), ok: true });
    const 朝 = await check([ポータル更新], journal, at(2026, 9, 8, 7, 0));
    const 夜 = await check([ポータル更新], journal, at(2026, 9, 8, 22, 0));
    expect(朝[0]?.status).toBe("missing");
    expect(夜[0]?.status).toBe("missing");
    expect(朝[0]?.overdueMinutes).not.toBe(夜[0]?.overdueMinutes);
  });
});

describe("通知の重複を抑える", () => {
  it("同じ欠測については1回しか知らせない", async () => {
    await journal.record({ job: ポータル更新.name, at: at(2026, 9, 7, 6, 5).toISOString(), ok: true });

    const findings = await check([ポータル更新], journal, at(2026, 9, 8, 7, 0));
    const 一回目 = await pendingAlerts(findings, journal);
    expect(一回目).toHaveLength(1);

    await markAlerted(一回目, journal);

    const 二回目 = await pendingAlerts(await check([ポータル更新], journal, at(2026, 9, 8, 8, 0)), journal);
    expect(二回目).toHaveLength(0);
  });

  it("翌日また止まれば、別の欠測として知らせる", async () => {
    await journal.record({ job: ポータル更新.name, at: at(2026, 9, 7, 6, 5).toISOString(), ok: true });

    const 初日 = await pendingAlerts(await check([ポータル更新], journal, at(2026, 9, 8, 7, 0)), journal);
    await markAlerted(初日, journal);

    const 翌日 = await pendingAlerts(await check([ポータル更新], journal, at(2026, 9, 9, 7, 0)), journal);
    expect(翌日).toHaveLength(1);
  });

  it("正常なジョブは知らせない", async () => {
    await journal.record({ job: ポータル更新.name, at: at(2026, 9, 8, 6, 5).toISOString(), ok: true });
    const findings = await check([ポータル更新], journal, at(2026, 9, 8, 8, 0));
    expect(await pendingAlerts(findings, journal)).toHaveLength(0);
  });
});
