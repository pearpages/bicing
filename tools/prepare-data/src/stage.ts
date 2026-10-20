import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CacheEntry } from './download';
import { sqlString, withDuckDB } from './duckdb';
import { extractSingleCsv } from './extract';
import { csvKind, stageTables, type CsvKind, type MonthInput, type MonthReport } from './month';

/**
 * Step 1 of `--build` (architecture.md > Ingest): one month's archives → `data/stage/<YYYY-MM>/`,
 * keeping original station ids so months can be staged one at a time, in any order.
 */

/** The archive versions a staged month came from. A change in either means "stage it again". */
export interface StageSources {
  readonly status: CacheEntry;
  readonly info: CacheEntry;
}

/** A month whose status archive holds the wrong file: not staged, listed in gaps.json (ADR 0012). */
export interface UnusableMonth {
  readonly month: string;
  readonly sources: StageSources;
  readonly unusable: string;
}

export interface StagedMonth extends MonthReport {
  readonly sources: StageSources;
  readonly unusable?: undefined;
  /** Why the information archive was dropped, if it was; station details then come from other months. */
  readonly informationProblem: string | null;
}

export type StagedReport = StagedMonth | UnusableMonth;

const PROBLEM: Record<CsvKind, string> = {
  status: "holds the status CSV, not this dataset's",
  information: "holds the information CSV, not this dataset's",
  unreadable: 'has a CSV whose header is unreadable',
};

const sameSource = (a: CacheEntry, b: CacheEntry) =>
  a.resourceId === b.resourceId && a.lastModified === b.lastModified && a.bytes === b.bytes;

async function readStagedReport(dir: string): Promise<StagedReport | null> {
  try {
    return JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')) as StagedReport;
  } catch {
    return null;
  }
}

/** Stages `month` unless it's already staged from the same archives. Returns its report. */
export async function stageMonth(options: {
  readonly rawDir: string;
  readonly stageDir: string;
  readonly scratchDir: string;
  readonly month: string;
  readonly sources: StageSources;
  readonly tolerance?: Pick<MonthInput, 'maxInvalidShare' | 'maxRepairedShare'>;
}): Promise<{ readonly report: StagedReport; readonly cached: boolean }> {
  const { month, sources } = options;
  const target = join(options.stageDir, month);
  const existing = await readStagedReport(target);
  if (
    existing &&
    sameSource(existing.sources.status, sources.status) &&
    sameSource(existing.sources.info, sources.info)
  )
    return { report: existing, cached: true };

  // Written beside the target and renamed at the end, so a crash never leaves a half-staged month
  // that looks complete (report.json is written last).
  const building = `${target}.building`;
  const scratch = join(options.scratchDir, month);
  await rm(building, { recursive: true, force: true });
  await mkdir(building, { recursive: true });
  try {
    const statusCsv = await extractSingleCsv(
      join(options.rawDir, 'estat-estacions-bicing', `${month}.7z`),
      scratch,
    );
    const infoCsv = await extractSingleCsv(
      join(options.rawDir, 'informacio-estacions-bicing', `${month}.7z`),
      scratch,
    );
    const report = await withDuckDB(async (connection): Promise<StagedReport> => {
      const statusKind = await csvKind(connection, statusCsv);
      if (statusKind !== 'status')
        return { month, sources, unusable: `the status archive ${PROBLEM[statusKind]}` };
      const infoKind = await csvKind(connection, infoCsv);
      const informationProblem =
        infoKind === 'information' ? null : `the information archive ${PROBLEM[infoKind]}`;
      const staged = await stageTables(connection, {
        month,
        statusCsv,
        infoCsv: informationProblem === null ? infoCsv : null,
        ...options.tolerance,
      });
      const parquet = (file: string) =>
        `${sqlString(join(building, file))} (FORMAT parquet, COMPRESSION snappy)`;
      await connection.run(`COPY obs TO ${parquet('obs.parquet')}`);
      await connection.run(
        `COPY (SELECT station_id, name, lat, lon, capacity FROM stations) TO ${parquet('stations.parquet')}`,
      );
      await connection.run(`COPY snapshots TO ${parquet('snapshots.parquet')}`);
      return { ...staged, sources, informationProblem };
    });
    // An unusable month is recorded too, so a re-run doesn't extract it again.
    await writeFile(join(building, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    await rm(target, { recursive: true, force: true });
    await rename(building, target);
    return { report, cached: false };
  } catch (error) {
    await rm(building, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
