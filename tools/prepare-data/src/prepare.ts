import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { extractSingleCsv } from './extract';
import { readMonth, type MonthData, type MonthInput } from './month';

/**
 * One cached month (T2.1's `data/raw/<dataset>/<YYYY-MM>.7z`) → columns. The extracted CSVs, about
 * 1.3 GB for a 2026 month, live in `scratchDir` only while DuckDB reads them.
 */
export async function prepareMonth(
  rawDir: string,
  month: string,
  scratchDir: string,
  options: Pick<MonthInput, 'maxInvalidShare' | 'maxRepairedShare'> = {},
): Promise<MonthData> {
  const scratch = join(scratchDir, month);
  try {
    const statusCsv = await extractSingleCsv(
      join(rawDir, 'estat-estacions-bicing', `${month}.7z`),
      scratch,
    );
    const infoCsv = await extractSingleCsv(
      join(rawDir, 'informacio-estacions-bicing', `${month}.7z`),
      scratch,
    );
    return await readMonth({ month, statusCsv, infoCsv, ...options });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
