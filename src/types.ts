/** この道具で使う言葉の定義。処理は書かない。 */

export type Weekday =
  | "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";

/** いつ動くはずか。cron式ではなく、読んで分かる形で持つ。 */
export type Schedule =
  | { readonly kind: "dailyAt"; readonly hour: number; readonly minute: number }
  | { readonly kind: "everyMinutes"; readonly minutes: number }
  | { readonly kind: "weeklyOn"; readonly weekday: Weekday; readonly hour: number; readonly minute: number };

/**
 * 休業日の定義。祝日の一覧は利用者が渡す。
 * ライブラリに内蔵すると、法改正で静かに間違い始めるため（ADR-0002）。
 */
export interface Calendar {
  readonly weeklyHolidays: readonly Weekday[];
  /** "YYYY-MM-DD"。祝日・年末年始・創立記念日など */
  readonly holidays: readonly string[];
}

export interface JobDefinition {
  readonly name: string;
  readonly schedule: Schedule;
  /** 予定時刻から何分までの遅れを許すか。処理の所要時間＋少しの余裕が目安 */
  readonly graceMinutes: number;
  /** 営業日だけ動くジョブか。休業日に誤検知しないために使う */
  readonly onlyBusinessDays?: boolean;
}

/** 「動いた」という報告。処理する側が残す。 */
export interface RunReport {
  readonly job: string;
  /** ISO 8601 形式 */
  readonly at: string;
  readonly ok: boolean;
  readonly note?: string | undefined;
}

export type JobStatus =
  /** 直近の予定時刻ぶんの報告が来ている */
  | "ok"
  /** 予定時刻を過ぎたが、まだ猶予の内側 */
  | "late"
  /** 猶予を過ぎても報告が無い。これが本題 */
  | "missing"
  /** 報告は来たが、失敗したと報告された */
  | "failed"
  /** 一度も報告が無い。仕掛け忘れの可能性がある */
  | "never_ran"
  /** 今日は予定が無い */
  | "not_due";

export interface Finding {
  readonly job: string;
  readonly status: JobStatus;
  /** 直近の予定時刻 */
  readonly expectedAt?: string | undefined;
  /** その予定時刻を一意に表す鍵。同じ欠測で繰り返し通知しないために使う */
  readonly occurrenceKey?: string | undefined;
  readonly lastReportedAt?: string | undefined;
  readonly overdueMinutes?: number | undefined;
  readonly note?: string | undefined;
}

/**
 * 報告の置き場所。
 * 報告する側と見張る側は別のプロセスなので、両方から読み書きできる場所に置く（ADR-0001）。
 */
export interface Journal {
  record(report: RunReport): Promise<void>;
  lastReport(job: string): Promise<RunReport | undefined>;
  markNotified(job: string, occurrenceKey: string): Promise<void>;
  wasNotified(job: string, occurrenceKey: string): Promise<boolean>;
}

export interface CheckOptions {
  readonly calendar?: Calendar;
}
