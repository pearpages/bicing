/** Resolves after `count` animation frames. */
export function waitFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (remaining: number) => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => {
        step(remaining - 1);
      });
    };
    step(count);
  });
}

/** Polls once per frame until `condition` holds, or rejects after `timeoutMs`. */
export async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<void> {
  const started = performance.now();
  while (!condition()) {
    if (performance.now() - started > timeoutMs) throw new Error('Timed out waiting for the chart');
    await waitFrames(1);
  }
}
