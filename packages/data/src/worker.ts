/**
 * Spawns the data worker. It lives here, next to the worker source, so bundlers resolve the
 * `new URL(…, import.meta.url)` pattern relative to this package, not to the app.
 */
export function createDataWorker(): Worker {
  return new Worker(new URL('./data.worker.ts', import.meta.url), {
    type: 'module',
    name: 'bicing-data',
  });
}
