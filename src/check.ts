import { defineCalendar } from "./calendar.js";
import { previousOccurrence } from "./schedule.js";
import type { CheckOptions, Finding, JobDefinition, Journal } from "./types.js";

const MINUTE_MS = 60000;

/** 通知の重複を抑えるための鍵。予定時刻ごとに1つ。 */
function occurrenceKeyOf(occurrence: Date): string {
  return occurrence.toISOString();
}

/**
 * 動くはずだったのに動いていないジョブを見つける。
 *
 * 現在時刻を引数で受け取り、内部で読まない。監視対象とは別の場所から呼ぶ前提で、
 * 同じ記録と同じ時刻なら必ず同じ判定になる（ADR-0001）。
 * ジョブそのものは呼ばない。記録を読むだけ。
 */
export async function check(
  jobs: readonly JobDefinition[],
  journal: Journal,
  now: Date,
  options: CheckOptions = {},
): Promise<Finding[]> {
  const calendar = options.calendar ?? defineCalendar({});
  const findings: Finding[] = [];

  for (const job of jobs) {
    const occurrence = previousOccurrence(
      job.schedule,
      now,
      calendar,
      job.onlyBusinessDays ?? false,
    );

    if (occurrence === undefined) {
      findings.push({ job: job.name, status: "not_due" });
      continue;
    }

    const expectedAt = occurrence.toISOString();
    const occurrenceKey = occurrenceKeyOf(occurrence);
    const last = await journal.lastReport(job.name);

    // 一度も動いていない。「動いていたものが止まった」とは原因が違うので分ける
    if (last === undefined) {
      findings.push({ job: job.name, status: "never_ran", expectedAt, occurrenceKey });
      continue;
    }

    // 直近の予定時刻より後に報告がある = その回は動いた
    if (new Date(last.at) >= occurrence) {
      findings.push({
        job: job.name,
        status: last.ok ? "ok" : "failed",
        expectedAt,
        occurrenceKey,
        lastReportedAt: last.at,
        note: last.note,
      });
      continue;
    }

    const overdueMinutes = Math.floor((now.getTime() - occurrence.getTime()) / MINUTE_MS);

    findings.push({
      job: job.name,
      status: overdueMinutes <= job.graceMinutes ? "late" : "missing",
      expectedAt,
      occurrenceKey,
      lastReportedAt: last.at,
      overdueMinutes,
    });
  }

  return findings;
}

/** 知らせるべき状態。late は猶予の内側なので含めない。 */
const ALERTING: ReadonlySet<Finding["status"]> = new Set(["missing", "failed", "never_ran"]);

/**
 * まだ知らせていない異常だけを取り出す。
 *
 * 止まっている間ずっと鳴らすと、担当者は通知を切る。
 * 1つの予定時刻につき1回だけにする。
 */
export async function pendingAlerts(
  findings: readonly Finding[],
  journal: Journal,
): Promise<Finding[]> {
  const pending: Finding[] = [];

  for (const finding of findings) {
    if (!ALERTING.has(finding.status)) continue;
    if (finding.occurrenceKey === undefined) continue;
    if (await journal.wasNotified(finding.job, finding.occurrenceKey)) continue;
    pending.push(finding);
  }

  return pending;
}

/** 知らせたことを記録する。次回から同じ欠測では鳴らない。 */
export async function markAlerted(findings: readonly Finding[], journal: Journal): Promise<void> {
  for (const finding of findings) {
    if (finding.occurrenceKey === undefined) continue;
    await journal.markNotified(finding.job, finding.occurrenceKey);
  }
}
