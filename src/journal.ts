import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Journal, RunReport } from "./types.js";

interface Stored {
  reports: RunReport[];
  notified: string[];
}

const empty = (): Stored => ({ reports: [], notified: [] });

const noticeKey = (job: string, occurrenceKey: string): string => `${job} ${occurrenceKey}`;

/** 記録された順ではなく、時刻が最も新しい報告を返す。 */
function latest(reports: readonly RunReport[], job: string): RunReport | undefined {
  return reports
    .filter((r) => r.job === job)
    .reduce<RunReport | undefined>(
      (newest, r) => (newest === undefined || r.at > newest.at ? r : newest),
      undefined,
    );
}

/** プロセスの中だけで持つ置き場所。テストと、単一プロセスでの試用に使う。 */
export class MemoryJournal implements Journal {
  readonly #data: Stored = empty();

  record(report: RunReport): Promise<void> {
    this.#data.reports.push(report);
    return Promise.resolve();
  }

  lastReport(job: string): Promise<RunReport | undefined> {
    return Promise.resolve(latest(this.#data.reports, job));
  }

  markNotified(job: string, occurrenceKey: string): Promise<void> {
    this.#data.notified.push(noticeKey(job, occurrenceKey));
    return Promise.resolve();
  }

  wasNotified(job: string, occurrenceKey: string): Promise<boolean> {
    return Promise.resolve(this.#data.notified.includes(noticeKey(job, occurrenceKey)));
  }
}

/**
 * ファイルに置く。
 *
 * 報告する側と見張る側は別のプロセスなので、両方から読める場所に置く必要がある。
 * 別のサーバーから見張る場合は、共有できる場所（ネットワーク上のディスク、
 * データベース等）に Journal を実装し直す（ADR-0001）。
 */
export class FileJournal implements Journal {
  constructor(private readonly path: string) {}

  async #load(): Promise<Stored> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        return empty();
      }
      throw error;
    }

    try {
      return JSON.parse(text) as Stored;
    } catch {
      // 壊れた記録を「記録が無い」と同じ扱いにすると、止まっているジョブを
      // 「一度も動いていない」と誤って報告することになる。気づける形で止める
      throw new Error(`記録ファイルを読めません（JSONとして壊れています）: ${this.path}`);
    }
  }

  async #save(data: Stored): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  async record(report: RunReport): Promise<void> {
    const data = await this.#load();
    data.reports.push(report);
    await this.#save(data);
  }

  async lastReport(job: string): Promise<RunReport | undefined> {
    return latest((await this.#load()).reports, job);
  }

  async markNotified(job: string, occurrenceKey: string): Promise<void> {
    const data = await this.#load();
    data.notified.push(noticeKey(job, occurrenceKey));
    await this.#save(data);
  }

  async wasNotified(job: string, occurrenceKey: string): Promise<boolean> {
    return (await this.#load()).notified.includes(noticeKey(job, occurrenceKey));
  }
}
