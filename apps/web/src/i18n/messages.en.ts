import type { Decimation } from '@bicing/charts';
import type { Messages } from './messages.ca';

const decimationNames: Record<Decimation, string> = {
  none: 'Off',
  minmax: 'Min/max',
  lttb: 'LTTB',
};

export const en: Messages = {
  meta: {
    title: 'Bicing Pulse',
    description: 'Millions of Bicing readings, rendered smoothly with D3 and WebGL2.',
  },
  language: {
    legend: 'Language',
  },
  app: {
    tagline: 'Bikes available at every Barcelona Bicing station, over time.',
    summary: (readings, stations, span) =>
      `${readings} readings from ${stations} stations over ${span}. Synthetic data with the real schema.`,
    hours: (count) => `${count} hours`,
    days: (count) => `${count} days`,
    chartArea: 'Bikes available per station',
    generating: (readings) => `Generating ${readings} readings in a worker…`,
    loadingMonth: (month) => `Loading ${month} from Open Data BCN in a worker…`,
    loadingLevel: (level) => `Loading ${level}…`,
    historySummary: (points, stations, level) =>
      `Whole history, ${level}: ${points} points from ${stations} stations. Real data from Open Data BCN.`,
    levels: {
      raw: 'original readings',
      '1h': 'hourly data',
      '1d': 'daily data',
    },
    realSummary: (readings, stations, month) =>
      `${readings} readings from ${stations} stations, ${month}. Real data from Open Data BCN.`,
    loadMonthFailed: (month, cause) => `Couldn't load ${month}: ${cause}.`,
    realUnavailable: (url) => `No real data at ${url}. Generate it with pnpm prepare-data --build.`,
    loadFailed: (readings, cause) =>
      `Couldn't generate ${readings} readings: ${cause}. Try a smaller dataset.`,
    hint: 'Scroll to zoom, drag to pan, hover for a station.',
  },
  controls: {
    source: 'Data',
    sourceOptions: { synthetic: 'Synthetic', real: 'Real' },
    month: 'Month',
    wholeHistory: 'Whole history',
    monthsLoading: 'Loading the list of months…',
    renderer: 'Renderer',
    svgTitle: 'One <path> per line, rebuilt every frame. Capped at 1M points.',
    readings: 'Readings',
    stressTitle: 'Stress test: about 800 MB in the tab. It may fail on machines with less memory.',
    decimation: 'Downsampling',
    decimationOptions: { none: 'Off', minmax: 'Min/max per pixel', lttb: 'LTTB' },
    measureThis: 'Measure this setup',
    measureAll: 'Measure all',
    progress: (index, total, config) => `Measuring ${index} of ${total}: ${config}`,
  },
  tooltip: {
    available: (bikes, capacity) => `${String(bikes)} of ${String(capacity)} bikes available`,
    availableNoCapacity: (bikes) =>
      bikes === 1 ? '1 bike available' : `${String(bikes)} bikes available`,
  },
  chart: {
    label: 'Bikes available per station over time',
    station: (number) => `Station ${String(number)}`,
    bikes: (count) => (count === 1 ? '1 bike' : `${String(count)} bikes`),
    capped: (renderer, max, requested) =>
      `${renderer} is capped at ${max} points (${requested} requested)`,
  },
  legend: {
    title: 'Line color: average fill of the station',
    emptier: 'Emptier',
    fuller: 'Fuller',
  },
  perf: {
    label: 'Performance',
    fpsUnit: 'frames per second',
    frameTime: 'Frame time, median and 95th percentile',
    frameTimeValue: (p50, p95) => `${p50} and ${p95}`,
    longFrames: 'Frames over 50 ms',
    longest: (ms) => `(longest ${ms})`,
    memory: 'Memory',
    memoryUnavailable: 'Not available in this browser',
    memoryPage: (mb) => `${mb} MB (page and workers)`,
    memoryHeap: (mb) => `${mb} MB (JS heap)`,
    lastFrame: 'Last chart frame',
    pointsSent: 'Points sent to the renderer',
    pointsSentValue: (sent, total) => `${sent} of ${total}`,
    pointsDrawn: 'Points drawn after culling',
    pointsDrawnValue: (points, calls) =>
      calls === 1 ? `${points} in 1 draw call` : `${points} in ${String(calls)} draw calls`,
    prepare: 'Downsampling and upload',
    renderCpu: 'Draw call CPU time',
    waiting: 'Waiting for the first frame.',
    stale: 'Showing the previous downsampling while you zoom. It refines when you stop.',
    skippedHint: 'Pick a smaller dataset or turn on downsampling.',
    loading: 'Loading',
    generated: 'Worker time (generate or load)',
    firstChart: 'Time to first chart',
    drawing: 'Drawing…',
  },
  trace: {
    label: (over, total) =>
      `Recent frame times; ${over} of the last ${total} frames were over budget`,
    caption: (frames, budget) =>
      `Frame time, last ${frames} frames. The line is the ${budget} budget for 60 fps.`,
  },
  results: {
    title: 'Benchmark results',
    copy: 'Copy as Markdown',
    copied: 'Copied',
    close: 'Close',
    note: 'Each run plays the same 5-second zoom and pan. Keep this tab in the foreground: hidden tabs throttle frames.',
    columns: {
      config: 'Configuration',
      fps: 'FPS',
      p95: 'Frame p95',
      longFrames: 'Frames over 50 ms',
      firstChart: 'First chart',
      notes: 'Notes',
    },
    decimationNames,
    configLabel: (renderer, readings, decimation) =>
      `${renderer}, ${readings} readings, downsampling ${decimationNames[decimation].toLowerCase()}`,
    notRun: 'not run',
    staleFrames: (count) => (count === 1 ? '1 stale frame' : `${String(count)} stale frames`),
    backgroundTab:
      'This tab is in the background, so the browser pauses frames. Bring it to the front and run again.',
    hiddenDuringRun: 'The tab was hidden during the run, so the browser throttled frames.',
    markdown: {
      header: [
        'Renderer',
        'Readings',
        'Downsampling',
        'FPS',
        'Frame p50 (ms)',
        'Frame p95 (ms)',
        'Frames > 50 ms',
        'Longest (ms)',
        'Chart CPU p95 (ms)',
        'Memory (MB)',
        'First chart (ms)',
        'Notes',
      ],
      measured: (date) =>
        `Measured ${date} with a scripted 5 s zoom-and-pan (apps/web/src/benchmark/scenario.ts).`,
      machine: (machine, cores, memory) =>
        `Machine: ${machine.platform}, ${cores} cores${
          memory === null ? '' : `, ≥${memory} GB RAM`
        }, GPU ${machine.gpu}, devicePixelRatio ${String(machine.devicePixelRatio)}, viewport ${machine.viewport}.`,
      browser: (userAgent) => `Browser: ${userAgent}.`,
      cpuNote:
        'Chart CPU = downsampling + upload + draw-call time on the main thread. GPU time is not included (it is asynchronous), but it shows up in frame time.',
    },
  },
};
