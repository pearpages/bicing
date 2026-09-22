import type { Decimation, RendererKind } from '@bicing/charts';
import type { MachineInfo } from './machine';
import type { ScenarioMeasurement } from './runScenario';

export interface BenchmarkConfig {
  readonly renderer: RendererKind;
  readonly rows: number;
  readonly decimation: Decimation;
}

export interface BenchmarkResult {
  readonly config: BenchmarkConfig;
  readonly measurement: ScenarioMeasurement | null;
  readonly firstChartMs: number | null;
  readonly error: string | null;
}

const RENDERER_LABEL: Record<RendererKind, string> = {
  svg: 'SVG',
  canvas: 'Canvas 2D',
  webgl: 'WebGL2',
};
const DECIMATION_LABEL: Record<Decimation, string> = {
  none: 'Off',
  minmax: 'Min/max',
  lttb: 'LTTB',
};

const fixed = (value: number, digits = 1) => value.toFixed(digits);

export function rowsLabel(rows: number): string {
  return rows >= 1_000_000 ? `${String(rows / 1_000_000)}M` : `${String(rows / 1_000)}k`;
}

export function configLabel(config: BenchmarkConfig): string {
  return `${RENDERER_LABEL[config.renderer]}, ${rowsLabel(config.rows)} readings, downsampling ${DECIMATION_LABEL[
    config.decimation
  ].toLowerCase()}`;
}

/** The results as a Markdown table for the README, with the machine they came from. */
export function toMarkdown(
  results: readonly BenchmarkResult[],
  machine: MachineInfo,
  date: Date,
): string {
  const header =
    '| Renderer | Readings | Downsampling | FPS | Frame p50 (ms) | Frame p95 (ms) | Frames > 50 ms | Longest (ms) | Chart CPU p95 (ms) | Memory (MB) | First chart (ms) | Notes |';
  const divider = '|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|';
  const lines = results.map(({ config, measurement: m, firstChartMs, error }) => {
    const cells = [
      RENDERER_LABEL[config.renderer],
      rowsLabel(config.rows),
      DECIMATION_LABEL[config.decimation],
    ];
    if (!m)
      return `| ${[...cells, ...Array<string>(8).fill('–'), error ?? 'not run'].join(' | ')} |`;
    const note =
      m.invalid ?? m.skipped ?? (m.staleFrames > 0 ? `${String(m.staleFrames)} stale frames` : '');
    return `| ${[
      ...cells,
      m.skipped ? '–' : fixed(m.fps, 0),
      fixed(m.p50),
      fixed(m.p95),
      String(m.longFrames),
      m.longFrames > 0 ? fixed(m.longestFrame, 0) : '–',
      fixed(m.prepareP95 + m.renderP95),
      m.memoryMb === null ? '–' : fixed(m.memoryMb, 0),
      firstChartMs === null ? '–' : fixed(firstChartMs, 0),
      note,
    ].join(' | ')} |`;
  });
  const about = [
    `Measured ${date.toISOString().slice(0, 10)} with a scripted 5 s zoom-and-pan (apps/web/src/benchmark/scenario.ts).`,
    `Machine: ${machine.platform}, ${machine.cores === null ? '?' : String(machine.cores)} cores${
      machine.deviceMemoryGb === null ? '' : `, ≥${String(machine.deviceMemoryGb)} GB RAM`
    }, GPU ${machine.gpu}, devicePixelRatio ${String(machine.devicePixelRatio)}, viewport ${machine.viewport}.`,
    `Browser: ${machine.userAgent}.`,
    'Chart CPU = downsampling + upload + draw-call time on the main thread. GPU time is not included (it is asynchronous), but it shows up in frame time.',
  ];
  return [header, divider, ...lines, '', ...about].join('\n');
}
