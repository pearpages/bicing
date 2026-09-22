import type { StationTable } from '@bicing/core';
import type { Random } from './prng';

// Rough bounding box of Barcelona's Bicing network.
const LAT_MIN = 41.35;
const LAT_MAX = 41.45;
const LON_MIN = 2.1;
const LON_MAX = 2.22;
const CENTER_LAT = 41.387;
const CENTER_LON = 2.17;

export interface SyntheticStations {
  readonly table: StationTable;
  /**
   * -1 means residential and uphill: it empties in the morning because people ride downhill to work.
   * +1 means central: it fills up during working hours. Derived from position, so the map
   * view in Phase 2 shows a spatially coherent pattern.
   */
  readonly role: Float32Array;
  /** Share of available bikes that are electric, per station. */
  readonly eShare: Float32Array;
}

export function generateStations(count: number, random: Random): SyntheticStations {
  const lat = new Float32Array(count);
  const lon = new Float32Array(count);
  const capacity = new Uint8Array(count);
  const role = new Float32Array(count);
  const eShare = new Float32Array(count);
  const ids: string[] = [];
  const names: string[] = [];

  for (let i = 0; i < count; i++) {
    const la = LAT_MIN + random() * (LAT_MAX - LAT_MIN);
    const lo = LON_MIN + random() * (LON_MAX - LON_MIN);
    lat[i] = la;
    lon[i] = lo;
    capacity[i] = 15 + Math.floor(random() * 26);
    eShare[i] = 0.1 + random() * 0.3;

    // Distance from the centre, normalized to about 0..1. Farther (and, in Barcelona, uphill) means residential.
    const d = Math.hypot((la - CENTER_LAT) / 0.05, (lo - CENTER_LON) / 0.06);
    role[i] = Math.max(-1, Math.min(1, 1 - 2 * d + (random() - 0.5) * 0.4));

    // Non-dense source IDs, so the dense 0..N-1 mapping is exercised like it will be with real data.
    ids.push(String(1 + i * 3));
    names.push(`Synthetic station ${String(i + 1).padStart(3, '0')}`);
  }

  return { table: { length: count, ids, names, lat, lon, capacity }, role, eShare };
}
