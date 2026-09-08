import type { Calendar, Weekday } from "./types.js";

const WEEKDAYS: readonly Weekday[] = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 地域時刻での "YYYY-MM-DD"。UTC に変換すると日付がずれるので使わない。 */
export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function weekdayOf(date: Date): Weekday {
  return WEEKDAYS[date.getDay()] ?? "sunday";
}

/**
 * 休業日を定義する。
 * 既定は土日。水曜定休や夏季休業は、利用者が指定する。
 */
export function defineCalendar(input: Partial<Calendar>): Calendar {
  const holidays = input.holidays ?? [];
  for (const day of holidays) {
    if (!DATE_PATTERN.test(day)) {
      throw new Error(`日付は YYYY-MM-DD の形式で指定してください: ${day}`);
    }
  }
  return {
    weeklyHolidays: input.weeklyHolidays ?? ["saturday", "sunday"],
    holidays,
  };
}

export function isBusinessDay(calendar: Calendar, date: Date): boolean {
  if (calendar.weeklyHolidays.includes(weekdayOf(date))) return false;
  return !calendar.holidays.includes(localDateKey(date));
}

/**
 * 休業日の一覧が古くなっていないかを見る。
 *
 * 祝日の一覧を更新し忘れると、その年の祝日に誤検知する。
 * 誤検知が起きてから気づくのでは遅いので、先に警告する（ADR-0002）。
 */
export function calendarWarnings(calendar: Calendar, now: Date): string[] {
  if (calendar.holidays.length === 0) return [];

  const today = localDateKey(now);
  const hasFuture = calendar.holidays.some((day) => day > today);
  if (hasFuture) return [];

  return [
    "休業日の一覧に、今日より先の日付が1件もありません。一覧が古くなっている可能性があります",
  ];
}
