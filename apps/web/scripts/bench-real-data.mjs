#!/usr/bin/env node
/**
 * Real-data benchmarks (T2.8, P5): time to first chart for a month, a year and the whole history,
 * at each data level, cold (HTTP cache off, a fresh tab and worker per run), on the local server
 * and on a throttled broadband profile. Prints a Markdown table for the README.
 *
 * Needs Node 24 (built-in WebSocket) and a local Chrome; no npm dependency.
 *
 *   pnpm prepare-data --build            # data/parquet
 *   pnpm --filter @bicing/web build
 *   pnpm --filter @bicing/web preview --port 4317 &
 *   node apps/web/scripts/bench-real-data.mjs [--url http://localhost:4317/] [--runs 3]
 *                                             [--chrome "/path/to/chrome"]
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:4317/' },
    runs: { type: 'string', default: '3' },
    chrome: {
      type: 'string',
      default: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    },
  },
});
const RUNS = Number(args.runs);

/** Minutes since 2018-01-01T00:00Z, the app's time unit. */
const minutes = (iso) => (Date.parse(iso) - Date.UTC(2018, 0, 1)) / 60_000;
const YEAR = { t0: minutes('2024-01-01T00:00Z'), t1: minutes('2025-01-01T00:00Z') };

const SCENARIOS = [
  { name: 'One month, original readings (2026-09)', source: { kind: 'real', month: '2026-09' } },
  {
    name: 'One year, original readings (2024)',
    source: { kind: 'history', level: 'raw', ...YEAR },
  },
  { name: 'One year, hourly (2024)', source: { kind: 'history', level: '1h', ...YEAR } },
  {
    name: 'Whole history, daily (2019–2026)',
    source: { kind: 'history', level: '1d', t0: 0, t1: 0xffff_ffff },
  },
];

const NETWORKS = [
  { name: 'local', conditions: null },
  {
    name: '50 Mbps, 20 ms',
    conditions: {
      offline: false,
      latency: 20,
      downloadThroughput: 50e6 / 8,
      uploadThroughput: 10e6 / 8,
    },
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** A Chrome DevTools Protocol connection with flattened sessions. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  let id = 0;
  const pending = new Map();
  const handlers = new Set();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`${message.method ?? ''} ${message.error.message}`));
      else resolve(message.result);
    } else if (message.method) for (const handler of handlers) handler(message);
  });
  return {
    send(method, params = {}, sessionId) {
      const message = { id: ++id, method, params, ...(sessionId ? { sessionId } : {}) };
      return new Promise((resolve, reject) => {
        pending.set(message.id, {
          resolve,
          reject: (error) => reject(new Error(`${method}: ${error.message}`)),
        });
        ws.send(JSON.stringify(message));
      });
    },
    on: (handler) => handlers.add(handler),
    off: (handler) => handlers.delete(handler),
    close: () => ws.close(),
  };
}

async function launchChrome() {
  const profile = await mkdtemp(join(tmpdir(), 'bicing-bench-'));
  const chrome = spawn(
    args.chrome,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  // Chrome writes the port it picked to DevToolsActivePort.
  for (let i = 0; i < 100; i++) {
    try {
      const [port] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n');
      const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      return { chrome, profile, version };
    } catch {
      await sleep(100);
    }
  }
  chrome.kill();
  throw new Error('Chrome did not start');
}

/** One cold run in a fresh tab: returns the app's timing and the bytes the page and worker fetched. */
async function run(cdp, scenario, network) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const sessions = new Set([sessionId]);
  const urls = new Map();
  let bytes = 0;
  let workerThrottled = network.conditions === null;
  const prepare = async (session, isWorker = false) => {
    await cdp.send('Network.enable', {}, session);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }, session);
    if (!network.conditions) return;
    // Worker sessions reject this in Chrome 155; the page's conditions are checked to reach the
    // worker's fetches by the timings themselves (see README > Benchmarks > Real data).
    try {
      await cdp.send('Network.emulateNetworkConditions', network.conditions, session);
      if (isWorker) workerThrottled = true;
    } catch (error) {
      if (!isWorker) throw error;
    }
  };
  const handler = async (message) => {
    if (!sessions.has(message.sessionId) && message.method !== 'Target.attachedToTarget') return;
    if (message.method === 'Target.attachedToTarget') {
      // The data worker fetches the files: throttle and count it like the page.
      const child = message.params.sessionId;
      sessions.add(child);
      await prepare(child, message.params.targetInfo.type === 'worker');
      await cdp.send('Runtime.runIfWaitingForDebugger', {}, child);
    } else if (message.method === 'Network.requestWillBeSent') {
      urls.set(message.params.requestId, message.params.request.url);
    } else if (message.method === 'Network.loadingFinished') {
      const url = urls.get(message.params.requestId) ?? '';
      if (url.includes('/data/') || url.endsWith('.wasm'))
        bytes += message.params.encodedDataLength;
    }
  };
  cdp.on(handler);
  try {
    await prepare(sessionId);
    await cdp.send(
      'Target.setAutoAttach',
      { autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
      sessionId,
    );
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send(
      'Page.navigate',
      { url: new URL('?automation', args.url).toString() },
      sessionId,
    );
    const evaluate = async (expression) =>
      (
        await cdp.send(
          'Runtime.evaluate',
          { expression, awaitPromise: true, returnByValue: true },
          sessionId,
        )
      ).result?.value;
    for (
      let i = 0;
      i < 300 && !(await evaluate('typeof window.bicingBenchmark?.load === "function"'));
      i++
    )
      await sleep(100);
    // The page first draws its default synthetic dataset; let it settle so it isn't measured.
    await sleep(1_500);
    const timing = await evaluate(
      `window.bicingBenchmark.load(${JSON.stringify(scenario.source)})`,
    );
    if (!timing) throw new Error(`${scenario.name}: no timing (the load may have failed)`);
    return { ...timing, bytes, workerThrottled };
  } finally {
    cdp.off(handler);
    await cdp.send('Target.closeTarget', { targetId });
  }
}

const { chrome, profile, version } = await launchChrome();
const cdp = await connect(version.webSocketDebuggerUrl);
try {
  const gpu = await (async () => {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const { result } = await cdp.send(
      'Runtime.evaluate',
      {
        expression: `(() => { const gl = document.createElement('canvas').getContext('webgl2'); const i = gl?.getExtension('WEBGL_debug_renderer_info'); return gl ? (i ? gl.getParameter(i.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no WebGL2'; })()`,
        returnByValue: true,
      },
      sessionId,
    );
    await cdp.send('Target.closeTarget', { targetId });
    return result.value;
  })();
  console.log(
    `Chrome ${version.Browser} (headless), ${gpu}; ${String(RUNS)} cold runs per row, median.\n`,
  );
  console.log('| Data | Network | Downloaded | Points drawn | Worker (ms) | First chart (ms) |');
  console.log('| ---- | ------- | ---------: | -----------: | ----------: | ---------------: |');
  for (const scenario of SCENARIOS) {
    for (const network of NETWORKS) {
      const results = [];
      for (let i = 0; i < RUNS; i++) results.push(await run(cdp, scenario, network));
      const mb = (median(results.map((r) => r.bytes)) / 1e6).toFixed(1);
      const points = median(results.map((r) => r.points)).toLocaleString('en');
      const worker = Math.round(median(results.map((r) => r.workerMs)));
      const first = Math.round(median(results.map((r) => r.firstChartMs)));
      console.log(
        `| ${scenario.name} | ${network.name} | ${mb} MB | ${points} | ${String(worker)} | ${first.toLocaleString('en')} |`,
      );
    }
  }
} finally {
  cdp.close();
  // Wait for Chrome to exit before removing its profile; a failed cleanup mustn't hide a real error.
  const exited = new Promise((resolve) => chrome.once('exit', resolve));
  chrome.kill();
  await exited;
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
}
