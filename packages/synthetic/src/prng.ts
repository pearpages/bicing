/**
 * mulberry32: a 32-bit-state PRNG. It's tiny, fast and good enough for synthetic data. Math.random
 * can't be seeded, and reproducibility is the point (P19).
 */
export type Random = () => number;

export function mulberry32(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box–Muller (one value per call; simplicity over speed). */
export function gaussian(random: Random): number {
  const u = 1 - random();
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
