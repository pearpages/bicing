#!/usr/bin/env node
/**
 * Brush latency benchmarks (T3.7, P5): for each dataset, drag each brush back and forth one step per
 * frame and record
 * - the worker's time per filter update and the page's round trip, from the `bicing:filter` User
 *   Timing measures (apps/web/src/data/useFilters.ts);
 * - the main thread's frame times and long tasks while brushing.
 * Prints a Markdown table for the README and writes the raw numbers to bench-results/brush.json.
 *
 * Runs the installed Google Chrome (real GPU) through Playwright, headless, so rAF never stalls on
 * a hidden window.
 *
 *   pnpm prepare-data --build               # data/parquet, for the real month
 *   pnpm --filter @bicing/web build
 *   pnpm --filter @bicing/web preview --port 4317 &
 *   node apps/web/scripts/bench-brush.mjs [--url http://127.0.0.1:4317/] [--reps 3]
 */
/* global document, window, MouseEvent, requestAnimationFrame, devicePixelRatio -- brushInPage and the page.evaluate callbacks run in the browser */
import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:4317/' },
    reps: { type: 'string', default: '3' },
  },
});
const REPS = Number(args.reps);
/** Frames per drag: there and back over the brush's whole width. */
const STEPS = 120;

const DATASETS = [
  { name: '1M synthetic', source: { kind: 'synthetic', rows: 1_000_000 } },
  { name: '10M synthetic', source: { kind: 'synthetic', rows: 10_000_000 } },
  { name: 'Real month (2026-09)', source: { kind: 'real', month: '2026-09' } },
];

const BRUSHES = [
  { name: 'Occupancy', selector: '.bp-histogram__brush .overlay', index: 1, shift: false },
  { name: 'Hour of day', selector: '.bp-histogram__brush .overlay', index: 0, shift: false },
  { name: 'Time', selector: '.bp-chart__brush .overlay', index: 0, shift: true },
];

const quantile = (xs, q) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted.length === 0
    ? NaN
    : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const ms = (x) => (Number.isFinite(x) ? x.toFixed(1) : '–');

/**
 * Runs in the page: drags one brush back and forth, a step per frame, with real DOM mouse events on
 * the brush's own overlay. Returns frame times and the filter measures recorded meanwhile.
 */
async function brushInPage({ selector, index, shift, steps, reps }) {
  const target = document.querySelectorAll(selector)[index];
  if (!target) throw new Error(`no brush at ${selector} #${String(index)}`);
  const box = target.getBoundingClientRect();
  const y = box.top + box.height / 2;
  const x0 = box.left + box.width * 0.02;
  const x1 = box.left + box.width * 0.98;
  const event = (type, x) =>
    new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, shiftKey: shift, view: window });
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const longTasks = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) longTasks.push(entry.duration);
  });
  observer.observe({ type: 'longtask' });
  performance.clearMeasures('bicing:filter');
  const frames = [];
  for (let rep = 0; rep < reps; rep++) {
    // Start from the left edge each time: the first move creates the selection.
    target.dispatchEvent(event('mousedown', x0));
    let last = performance.now();
    for (let i = 1; i <= steps; i++) {
      const f = i <= steps / 2 ? (2 * i) / steps : 2 - (2 * i) / steps;
      window.dispatchEvent(event('mousemove', x0 + (x1 - x0) * Math.max(0.1, f)));
      await frame();
      const now = performance.now();
      frames.push(now - last);
      last = now;
    }
    window.dispatchEvent(event('mouseup', x0 + (x1 - x0) * 0.1));
    await frame();
  }
  // Let the last answer arrive.
  await new Promise((resolve) => setTimeout(resolve, 500));
  observer.disconnect();
  const measures = performance
    .getEntriesByName('bicing:filter', 'measure')
    .map((m) => ({ roundTrip: m.duration, worker: m.detail.workerMs }));
  // Clear filters between brushes, so each brush is measured alone.
  [...document.querySelectorAll('button')]
    .find((b) => /Clear filters/.test(b.textContent))
    ?.click();
  await new Promise((resolve) => setTimeout(resolve, 300));
  return { frames, measures, longTasks };
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const url = new URL('?automation&lang=en', args.url).toString();
  const results = [];
  const environment = {};
  for (const dataset of DATASETS) {
    await page.goto(url);
    await page.waitForFunction(() => typeof window.bicingBenchmark?.load === 'function');
    // Unfiltered counts arrive after the load; their worker time includes building the indexes.
    await page.evaluate(() => performance.clearMeasures('bicing:filter'));
    await page.evaluate((source) => window.bicingBenchmark.load(source), dataset.source);
    await page.waitForFunction(
      () => performance.getEntriesByName('bicing:filter', 'measure').length > 0,
      undefined,
      { timeout: 60_000 },
    );
    const first = await page.evaluate(() => {
      const [m] = performance.getEntriesByName('bicing:filter', 'measure');
      const status = [...document.querySelectorAll('[role=status]')].find((p) =>
        /readings pass/.test(p.textContent ?? ''),
      );
      return { workerMs: m?.detail.workerMs ?? NaN, status: status?.textContent ?? '' };
    });
    Object.assign(
      environment,
      await page.evaluate(() => ({
        userAgent: navigator.userAgent,
        dpr: devicePixelRatio,
        gpu: (() => {
          const gl = document.createElement('canvas').getContext('webgl2');
          const info = gl?.getExtension('WEBGL_debug_renderer_info');
          return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
        })(),
      })),
    );
    const rows = Number(first.status.match(/of ([\d,]+)/)?.[1]?.replace(/,/g, '') ?? NaN);
    for (const brush of BRUSHES) {
      const run = await page.evaluate(brushInPage, { ...brush, steps: STEPS, reps: REPS });
      results.push({
        dataset: dataset.name,
        rows,
        indexBuildMs: first.workerMs,
        brush: brush.name,
        updates: run.measures.length,
        workerP50: quantile(
          run.measures.map((m) => m.worker),
          0.5,
        ),
        workerP95: quantile(
          run.measures.map((m) => m.worker),
          0.95,
        ),
        roundTripP50: quantile(
          run.measures.map((m) => m.roundTrip),
          0.5,
        ),
        roundTripP95: quantile(
          run.measures.map((m) => m.roundTrip),
          0.95,
        ),
        frameP50: quantile(run.frames, 0.5),
        frameP95: quantile(run.frames, 0.95),
        frameMax: Math.max(...run.frames),
        longTasks: run.longTasks.length,
      });
      console.error(`${dataset.name} · ${brush.name}: ${String(run.measures.length)} updates`);
    }
  }
  await browser.close();

  await mkdir('bench-results', { recursive: true });
  await writeFile(
    'bench-results/brush.json',
    JSON.stringify({ measured: new Date().toISOString(), environment, results }, null, 2),
  );

  const lines = [
    '| Data | Rows filtered | Brush | Updates | Worker p50 / p95 (ms) | Round trip p50 / p95 (ms) | Frame p95 / max (ms) | Long tasks |',
    '| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |',
    ...results.map(
      (r) =>
        `| ${r.dataset} | ${r.rows.toLocaleString('en')} | ${r.brush} | ${String(r.updates)} | ${ms(r.workerP50)} / ${ms(r.workerP95)} | ${ms(r.roundTripP50)} / ${ms(r.roundTripP95)} | ${ms(r.frameP95)} / ${ms(r.frameMax)} | ${String(r.longTasks)} |`,
    ),
    '',
    'First update after a load (builds the indexes, in the worker): ' +
      [...new Map(results.map((r) => [r.dataset, r.indexBuildMs])).entries()]
        .map(([name, t]) => `${name} ${ms(t)} ms`)
        .join(', ') +
      '.',
    `Browser: ${environment.userAgent}. GPU: ${environment.gpu}. devicePixelRatio ${String(environment.dpr)}.`,
  ];
  console.log(lines.join('\n'));
}

await main();
