import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileJournal, MemoryJournal } from "../src/journal.js";

const report = (job: string, iso: string, ok = true) => ({ job, at: iso, ok });

describe("MemoryJournal — 記録の置き場所（メモリ）", () => {
  it("記録した報告を読み出せる", async () => {
    const journal = new MemoryJournal();
    await journal.record(report("A", "2026-09-08T06:05:00.000Z"));
    expect((await journal.lastReport("A"))?.at).toBe("2026-09-08T06:05:00.000Z");
  });

  it("最新の報告を返す", async () => {
    const journal = new MemoryJournal();
    await journal.record(report("A", "2026-09-07T06:05:00.000Z"));
    await journal.record(report("A", "2026-09-08T06:05:00.000Z"));
    expect((await journal.lastReport("A"))?.at).toBe("2026-09-08T06:05:00.000Z");
  });

  it("順序が前後しても最新を返す", async () => {
    const journal = new MemoryJournal();
    await journal.record(report("A", "2026-09-08T06:05:00.000Z"));
    await journal.record(report("A", "2026-09-07T06:05:00.000Z"));
    expect((await journal.lastReport("A"))?.at).toBe("2026-09-08T06:05:00.000Z");
  });

  it("報告の無いジョブは undefined を返す", async () => {
    expect(await new MemoryJournal().lastReport("無い")).toBeUndefined();
  });

  it("通知済みの印を残せる", async () => {
    const journal = new MemoryJournal();
    expect(await journal.wasNotified("A", "key1")).toBe(false);
    await journal.markNotified("A", "key1");
    expect(await journal.wasNotified("A", "key1")).toBe(true);
    expect(await journal.wasNotified("A", "key2")).toBe(false);
  });
});

describe("FileJournal — 記録の置き場所（ファイル）", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cron-sentinel-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("別のインスタンスからでも読める（プロセスをまたいで共有する）", async () => {
    // 報告する側と見張る側は別のプロセス。記録を共有できることが要件（ADR-0001）
    const path = join(dir, "journal.json");
    await new FileJournal(path).record(report("A", "2026-09-08T06:05:00.000Z"));
    expect((await new FileJournal(path).lastReport("A"))?.at).toBe("2026-09-08T06:05:00.000Z");
  });

  it("ファイルが無ければ undefined を返す", async () => {
    expect(await new FileJournal(join(dir, "無い.json")).lastReport("A")).toBeUndefined();
  });

  it("通知済みの印もファイルに残る", async () => {
    const path = join(dir, "journal.json");
    await new FileJournal(path).markNotified("A", "key1");
    expect(await new FileJournal(path).wasNotified("A", "key1")).toBe(true);
  });

  it("壊れたJSONは黙って無視せず、エラーにする", async () => {
    const path = join(dir, "journal.json");
    const journal = new FileJournal(path);
    await journal.record(report("A", "2026-09-08T06:05:00.000Z"));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, "{ 壊れている", "utf8");
    await expect(journal.lastReport("A")).rejects.toThrow(/読めません/);
  });
});
