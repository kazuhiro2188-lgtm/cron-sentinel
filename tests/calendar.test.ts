import { describe, expect, it } from "vitest";
import { calendarWarnings, defineCalendar, isBusinessDay } from "../src/calendar.js";

const at = (y: number, m: number, d: number): Date => new Date(y, m - 1, d);

describe("defineCalendar — 休業日の定義", () => {
  it("既定では土日が休み", () => {
    const calendar = defineCalendar({});
    expect(isBusinessDay(calendar, at(2026, 9, 12))).toBe(false); // 土
    expect(isBusinessDay(calendar, at(2026, 9, 13))).toBe(false); // 日
    expect(isBusinessDay(calendar, at(2026, 9, 14))).toBe(true); // 月
  });

  it("週の休みを変えられる（不動産に多い水曜定休）", () => {
    const calendar = defineCalendar({ weeklyHolidays: ["wednesday"] });
    expect(isBusinessDay(calendar, at(2026, 9, 9))).toBe(false); // 水
    expect(isBusinessDay(calendar, at(2026, 9, 12))).toBe(true); // 土は営業
  });

  it("日付を指定して休みにできる（祝日・夏季休業・創立記念日）", () => {
    const calendar = defineCalendar({ holidays: ["2026-09-08"] });
    expect(isBusinessDay(calendar, at(2026, 9, 8))).toBe(false);
    expect(isBusinessDay(calendar, at(2026, 9, 7))).toBe(true);
  });

  it("休業日を持たない指定もできる（年中無休）", () => {
    const calendar = defineCalendar({ weeklyHolidays: [] });
    expect(isBusinessDay(calendar, at(2026, 9, 13))).toBe(true);
  });

  it("日付の形式が不正なら拒否する", () => {
    expect(() => defineCalendar({ holidays: ["2026/09/08"] })).toThrow(/日付/);
  });
});

describe("calendarWarnings — 一覧が古くなっていることに気づく", () => {
  it("未来の休業日が1件も無ければ警告する", () => {
    // 祝日の一覧を更新し忘れると、その年の祝日に誤検知する。
    // 誤検知が起きる前に気づけるようにする（ADR-0002）
    const calendar = defineCalendar({ holidays: ["2026-01-01"] });
    expect(calendarWarnings(calendar, at(2026, 9, 8))).toHaveLength(1);
  });

  it("未来の休業日があれば警告しない", () => {
    const calendar = defineCalendar({ holidays: ["2026-01-01", "2026-12-31"] });
    expect(calendarWarnings(calendar, at(2026, 9, 8))).toEqual([]);
  });

  it("日付指定の休業日を使っていなければ警告しない", () => {
    expect(calendarWarnings(defineCalendar({}), at(2026, 9, 8))).toEqual([]);
  });
});
