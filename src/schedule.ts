import { isBusinessDay, weekdayOf } from "./calendar.js";
import type { Calendar, Schedule, Weekday } from "./types.js";

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 何日前まで遡って予定を探すか。これを超えたら「予定なし」とする。 */
const MAX_LOOKBACK_DAYS = 60;
const MINUTE_MS = 60000;
const MINUTES_PER_DAY = 24 * 60;

function parseTime(time: string): { hour: number; minute: number } {
  const matched = TIME_PATTERN.exec(time);
  if (matched === null) {
    throw new Error(`時刻は HH:MM の形式（00:00〜23:59）で指定してください: ${time}`);
  }
  return { hour: Number(matched[1]), minute: Number(matched[2]) };
}

/** 毎日、決まった時刻に動く。 */
export function dailyAt(time: string): Schedule {
  const { hour, minute } = parseTime(time);
  return { kind: "dailyAt", hour, minute };
}

/** N分ごとに動く。 */
export function everyMinutes(minutes: number): Schedule {
  if (!Number.isInteger(minutes) || minutes < 1) {
    throw new Error(`分は1以上の整数で指定してください: ${String(minutes)}`);
  }
  return { kind: "everyMinutes", minutes };
}

/** 毎週、決まった曜日の決まった時刻に動く。 */
export function weeklyOn(weekday: Weekday, time: string): Schedule {
  const { hour, minute } = parseTime(time);
  return { kind: "weeklyOn", weekday, hour, minute };
}

function atTime(date: Date, hour: number, minute: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * 「直近で動くはずだった時刻」を求める。
 *
 * 現在時刻を引数で受け取り、内部で読まない。別の場所・別の時刻から実行しても、
 * 同じ条件なら同じ答えになる（ADR-0001）。
 */
export function previousOccurrence(
  schedule: Schedule,
  now: Date,
  calendar: Calendar,
  onlyBusinessDays: boolean,
): Date | undefined {
  switch (schedule.kind) {
    case "dailyAt": {
      let candidate = atTime(now, schedule.hour, schedule.minute);
      if (candidate > now) candidate = addDays(candidate, -1);
      for (let i = 0; i <= MAX_LOOKBACK_DAYS; i += 1) {
        if (!onlyBusinessDays || isBusinessDay(calendar, candidate)) return candidate;
        candidate = addDays(candidate, -1);
      }
      return undefined;
    }

    case "weeklyOn": {
      let candidate = atTime(now, schedule.hour, schedule.minute);
      for (let i = 0; i <= MAX_LOOKBACK_DAYS; i += 1) {
        const 曜日が合う = weekdayOf(candidate) === schedule.weekday;
        const 過去である = candidate <= now;
        const 営業日である = !onlyBusinessDays || isBusinessDay(calendar, candidate);
        if (曜日が合う && 過去である && 営業日である) return candidate;
        candidate = addDays(candidate, -1);
      }
      return undefined;
    }

    case "everyMinutes": {
      let day = now;
      for (let i = 0; i <= MAX_LOOKBACK_DAYS; i += 1) {
        if (!onlyBusinessDays || isBusinessDay(calendar, day)) {
          const startOfDay = atTime(day, 0, 0);
          // 当日ならこれまでに過ぎた区切り、前日以前ならその日の最後の区切り
          const elapsed =
            i === 0 ? Math.floor((now.getTime() - startOfDay.getTime()) / MINUTE_MS) : MINUTES_PER_DAY - 1;
          const slot = Math.floor(elapsed / schedule.minutes) * schedule.minutes;
          return new Date(startOfDay.getTime() + slot * MINUTE_MS);
        }
        day = addDays(day, -1);
      }
      return undefined;
    }
  }
}
