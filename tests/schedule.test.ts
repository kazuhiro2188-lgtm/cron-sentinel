import { describe, expect, it } from "vitest";
import { dailyAt, everyMinutes, previousOccurrence, weeklyOn } from "../src/schedule.js";
import { defineCalendar } from "../src/calendar.js";

/** テストは地域時刻で日時を組み立てる。実行環境の時間帯に依存させないため。 */
const at = (y: number, m: number, d: number, h = 0, min = 0): Date => new Date(y, m - 1, d, h, min);

const 年中無休 = defineCalendar({ weeklyHolidays: [] });
const 土日休み = defineCalendar({ weeklyHolidays: ["saturday", "sunday"] });

describe("dailyAt — 毎日決まった時刻", () => {
  it("その日の予定時刻を過ぎていれば、当日の時刻を返す", () => {
    // 2026-09-08 は火曜
    const occurrence = previousOccurrence(dailyAt("06:00"), at(2026, 9, 8, 7, 0), 年中無休, false);
    expect(occurrence).toEqual(at(2026, 9, 8, 6, 0));
  });

  it("まだ予定時刻の前なら、前日の時刻を返す", () => {
    const occurrence = previousOccurrence(dailyAt("06:00"), at(2026, 9, 8, 5, 0), 年中無休, false);
    expect(occurrence).toEqual(at(2026, 9, 7, 6, 0));
  });

  it("時刻の指定が不正なら拒否する", () => {
    expect(() => dailyAt("25:00")).toThrow(/時刻/);
    expect(() => dailyAt("6時")).toThrow(/時刻/);
  });
});

describe("everyMinutes — N分ごと", () => {
  it("直近の区切りを返す", () => {
    // 30分ごとなら 07:00, 07:30, 08:00 …
    expect(previousOccurrence(everyMinutes(30), at(2026, 9, 8, 7, 40), 年中無休, false)).toEqual(
      at(2026, 9, 8, 7, 30),
    );
  });

  it("区切りちょうどならその時刻を返す", () => {
    expect(previousOccurrence(everyMinutes(30), at(2026, 9, 8, 8, 0), 年中無休, false)).toEqual(
      at(2026, 9, 8, 8, 0),
    );
  });

  it("0分以下は拒否する", () => {
    expect(() => everyMinutes(0)).toThrow(/分/);
  });
});

describe("weeklyOn — 毎週決まった曜日", () => {
  it("同じ曜日で時刻を過ぎていれば当日を返す", () => {
    // 2026-09-07 は月曜
    expect(previousOccurrence(weeklyOn("monday", "09:00"), at(2026, 9, 7, 10, 0), 年中無休, false)).toEqual(
      at(2026, 9, 7, 9, 0),
    );
  });

  it("別の曜日なら直前のその曜日を返す", () => {
    // 木曜から見た直前の月曜
    expect(previousOccurrence(weeklyOn("monday", "09:00"), at(2026, 9, 10, 12, 0), 年中無休, false)).toEqual(
      at(2026, 9, 7, 9, 0),
    );
  });
});

describe("営業日だけ動くジョブ", () => {
  it("休業日には予定が無いものとして、直前の営業日を返す", () => {
    // 2026-09-13 は日曜。土日が休みなので、直前の営業日は 09-11（金）
    const occurrence = previousOccurrence(dailyAt("09:00"), at(2026, 9, 13, 10, 0), 土日休み, true);
    expect(occurrence).toEqual(at(2026, 9, 11, 9, 0));
  });

  it("営業日を無視する指定なら休業日でも予定がある", () => {
    const occurrence = previousOccurrence(dailyAt("09:00"), at(2026, 9, 13, 10, 0), 土日休み, false);
    expect(occurrence).toEqual(at(2026, 9, 13, 9, 0));
  });

  it("日付指定の休業日も休みとして扱う", () => {
    const 水曜定休 = defineCalendar({
      weeklyHolidays: ["saturday", "sunday", "wednesday"],
      holidays: ["2026-09-08"],
    });
    // 9/8(火)は特別休業、9/9(水)は定休 → 直前の営業日は 9/7(月)
    const occurrence = previousOccurrence(dailyAt("09:00"), at(2026, 9, 9, 10, 0), 水曜定休, true);
    expect(occurrence).toEqual(at(2026, 9, 7, 9, 0));
  });
});
