import { describe, expect, test } from 'vitest';
import { numberFormats } from '../i18n/format';
import { ca } from '../i18n/messages.ca';
import { en } from '../i18n/messages.en';
import type { MachineInfo } from './machine';
import { configLabel, resultNote, rowsLabel, toMarkdown, type BenchmarkResult } from './results';
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
  hidden: false,
};

const enFmt = numberFormats('en-GB');
const caFmt = numberFormats('ca-ES');

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
    error: {
      kind: 'load',
      failure: { source: { kind: 'synthetic', rows: 10_000_000 }, cause: 'out of memory' },
    },
  },
];

describe('results', () => {
  test('labels sizes and configurations in plain words, in each language', () => {
    expect([rowsLabel(10_000), rowsLabel(1_000_000), rowsLabel(50_000_000)]).toEqual([
      '10k',
      '1M',
      '50M',
    ]);
    const config = { renderer: 'webgl', rows: 10_000_000, decimation: 'minmax' } as const;
    expect(configLabel(config, en.results)).toBe('WebGL2, 10M readings, downsampling min/max');
    expect(configLabel(config, ca.results)).toBe('WebGL2, 10M lectures, reducció mín./màx.');
    expect(configLabel({ ...config, decimation: 'none' }, ca.results)).toBe(
      'WebGL2, 10M lectures, sense reducció',
    );
  });

  test('renders a Markdown row per result, plus the machine', () => {
    const md = toMarkdown(results, machine, new Date('2026-09-22T10:00:00Z'), en, enFmt);
    const lines = md.split('\n');
    expect(lines[0]).toMatch(/^\| Renderer \| Readings \|/);
    expect(lines[2]).toBe('| WebGL2 | 1M | Off | 60 | 16.7 | 17.2 | 0 | – | 1.0 | 250 | 119 |  |');
    expect(lines[3]).toContain(
      "| Couldn't generate 10,000,000 readings: out of memory. Try a smaller dataset. |",
    );
    expect(md).toContain('GPU Test GPU');
    expect(md).toContain('Measured 2026-09-22');
  });

  test('the Catalan export uses Catalan headers, notes and decimal commas', () => {
    const md = toMarkdown(results, machine, new Date('2026-09-22T10:00:00Z'), ca, caFmt);
    const lines = md.split('\n');
    expect(lines[0]).toMatch(/^\| Motor de dibuix \| Lectures \| Reducció \|/);
    expect(lines[2]).toBe('| WebGL2 | 1M | No | 60 | 16,7 | 17,2 | 0 | – | 1,0 | 250 | 119 |  |');
    expect(lines[3]).toContain("No s'han pogut generar 10.000.000 lectures");
    expect(md).toContain('Mesurat el 2026-09-22');
    expect(md).toContain('Ordinador: macOS, 10 nuclis, ≥8 GB de RAM');
  });

  test('marks invalid runs instead of reporting their numbers as if they were fine', () => {
    const md = toMarkdown(
      [
        {
          config: { renderer: 'canvas', rows: 10_000, decimation: 'none' },
          measurement: { ...measurement, hidden: true },
          firstChartMs: 10,
          error: null,
        },
      ],
      machine,
      new Date(),
      en,
      enFmt,
    );
    expect(md.split('\n')[2]).toMatch(/\| The tab was hidden during the run, .+ \|$/);
  });

  test('notes pick a plural form and pass developer errors through', () => {
    const base = results[0];
    if (!base) throw new Error('fixture missing');
    const stale = (count: number) => ({
      ...base,
      measurement: { ...measurement, staleFrames: count },
    });
    expect(resultNote(stale(1), ca, caFmt)).toBe('1 fotograma amb la reducció anterior');
    expect(resultNote(stale(3), en, enFmt)).toBe('3 stale frames');
    expect(resultNote({ ...base, error: { kind: 'other', message: 'Timed out' } }, ca, caFmt)).toBe(
      'Timed out',
    );
  });
});
