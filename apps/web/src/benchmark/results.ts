import type { Decimation, RendererKind } from '@bicing/charts';
import type { LoadError } from '../data/useDataset';
import type { NumberFormats } from '../i18n/format';
import { loadErrorText } from '../i18n/loadError';
import type { Messages } from '../i18n/messages.ca';
import type { MachineInfo } from './machine';
import type { ScenarioMeasurement } from './runScenario';

export interface BenchmarkConfig {
  readonly renderer: RendererKind;
  readonly rows: number;
  readonly decimation: Decimation;
}

/** Why a configuration has no measurement. Worded when shown, so it follows the language. */
export type BenchmarkError =
  | { readonly kind: 'backgroundTab' }
  | { readonly kind: 'load'; readonly failure: LoadError }
  /** Developer-facing (a timeout, an unmounted chart), so it stays English (ADR 0011). */
  | { readonly kind: 'other'; readonly message: string };

export interface BenchmarkResult {
  readonly config: BenchmarkConfig;
  readonly measurement: ScenarioMeasurement | null;
  readonly firstChartMs: number | null;
  readonly error: BenchmarkError | null;
}

type ResultText = Messages['results'];

/** Product names: the same in every language. */
const RENDERER_LABEL: Record<RendererKind, string> = {
  svg: 'SVG',
  canvas: 'Canvas 2D',
  webgl: 'WebGL2',
};

/** SI-style size tiers (10k, 1M), which read the same in Catalan and English. */
export function rowsLabel(rows: number): string {
  return rows >= 1_000_000 ? `${String(rows / 1_000_000)}M` : `${String(rows / 1_000)}k`;
}

export function configLabel(config: BenchmarkConfig, text: ResultText): string {
  return text.configLabel(
    RENDERER_LABEL[config.renderer],
    rowsLabel(config.rows),
    config.decimation,
  );
}

/** The Notes cell: why there are no numbers, or what to keep in mind about them. */
export function resultNote(result: BenchmarkResult, text: Messages, fmt: NumberFormats): string {
  const { error, measurement: m } = result;
  if (error) {
    if (error.kind === 'backgroundTab') return text.results.backgroundTab;
    if (error.kind === 'load') return loadErrorText(error.failure, text, fmt);
    return error.message;
  }
  if (!m) return text.results.notRun;
  if (m.hidden) return text.results.hiddenDuringRun;
  if (m.skipped) return m.skipped;
  return m.staleFrames > 0 ? text.results.staleFrames(m.staleFrames) : '';
}

/** The results as a Markdown table for the README, with the machine they came from. */
export function toMarkdown(
  results: readonly BenchmarkResult[],
  machine: MachineInfo,
  date: Date,
  text: Messages,
  fmt: NumberFormats,
): string {
  const md = text.results.markdown;
  const header = `| ${md.header.join(' | ')} |`;
  const divider = '|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|';
  const lines = results.map((result) => {
    const { config, measurement: m, firstChartMs } = result;
    const cells = [
      RENDERER_LABEL[config.renderer],
      rowsLabel(config.rows),
      text.results.decimationNames[config.decimation],
    ];
    const note = resultNote(result, text, fmt);
    if (!m) return `| ${[...cells, ...Array<string>(8).fill('–'), note].join(' | ')} |`;
    return `| ${[
      ...cells,
      m.skipped ? '–' : fmt.fixed(m.fps, 0),
      fmt.fixed(m.p50),
      fmt.fixed(m.p95),
      fmt.int(m.longFrames),
      m.longFrames > 0 ? fmt.fixed(m.longestFrame, 0) : '–',
      fmt.fixed(m.prepareP95 + m.renderP95),
      m.memoryMb === null ? '–' : fmt.fixed(m.memoryMb, 0),
      firstChartMs === null ? '–' : fmt.fixed(firstChartMs, 0),
      note,
    ].join(' | ')} |`;
  });
  const about = [
    md.measured(date.toISOString().slice(0, 10)),
    md.machine(
      machine,
      machine.cores === null ? '?' : fmt.int(machine.cores),
      machine.deviceMemoryGb === null ? null : fmt.int(machine.deviceMemoryGb),
    ),
    md.browser(machine.userAgent),
    md.cpuNote,
  ];
  return [header, divider, ...lines, '', ...about].join('\n');
}
