import { describe, expect, test } from 'vitest';
import type { MachineInfo } from './machine';
import { configLabel, rowsLabel, toMarkdown, type BenchmarkResult } from './results';
import type { ScenarioMeasurement } from './runScenario';

const machine: MachineInfo = {
  userAgent: 'TestBrowser/1.0',
  platform: 'macOS',
  cores: 10,
  deviceMemoryGb: 8,
  gpu: 'Test GPU',
  devicePixelRatio: 2,
  viewport: '1440×900',
};

const measurement: ScenarioMeasurement = {
  frames: 300,
  durationMs: 5_000,
  fps: 60,
  p50: 16.7,
  p95: 17.2,
  worst: 20,
  longFrames: 0,
  longestFrame: 0,
  memoryMb: 250,
  prepareP95: 0.4,
  renderP95: 0.6,
  staleFrames: 0,
  skipped: null,
  invalid: null,
};

describe('results', () => {
  test('labels sizes and configurations in plain words', () => {
    expect([rowsLabel(10_000), rowsLabel(1_000_000), rowsLabel(50_000_000)]).toEqual([
      '10k',
      '1M',
      '50M',
    ]);
    expect(configLabel({ renderer: 'webgl', rows: 10_000_000, decimation: 'minmax' })).toBe(
      'WebGL2, 10M readings, downsampling min/max',
    );
  });

  test('renders a Markdown row per result, plus the machine', () => {
    const results: BenchmarkResult[] = [
      {
        config: { renderer: 'webgl', rows: 1_000_000, decimation: 'none' },
        measurement,
        firstChartMs: 119,
        error: null,
      },
      {
        config: { renderer: 'svg', rows: 10_000_000, decimation: 'none' },
        measurement: null,
        firstChartMs: null,
        error: 'out of memory',
      },
    ];
    const md = toMarkdown(results, machine, new Date('2026-09-22T10:00:00Z'));
    const lines = md.split('\n');
    expect(lines[2]).toBe('| WebGL2 | 1M | Off | 60 | 16.7 | 17.2 | 0 | – | 1.0 | 250 | 119 |  |');
    expect(lines[3]).toContain('| out of memory |');
    expect(md).toContain('GPU Test GPU');
    expect(md).toContain('Measured 2026-09-22');
  });

  test('marks invalid runs instead of reporting their numbers as if they were fine', () => {
    const md = toMarkdown(
      [
        {
          config: { renderer: 'canvas', rows: 10_000, decimation: 'none' },
          measurement: { ...measurement, invalid: 'tab hidden' },
          firstChartMs: 10,
          error: null,
        },
      ],
      machine,
      new Date(),
    );
    expect(md.split('\n')[2]).toMatch(/\| tab hidden \|$/);
  });
});
