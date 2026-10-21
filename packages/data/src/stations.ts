import type { StationTable } from '@bicing/core';

/** Values `tools/prepare-data` writes, but they arrive over the network, so they're checked (security.md). */
function isArrayOf<T>(value: unknown, item: (v: unknown) => v is T): value is T[] {
  return Array.isArray(value) && value.every(item);
}
const isString = (v: unknown): v is string => typeof v === 'string';
const isCoordinate = (v: unknown): v is number | null =>
  v === null || (typeof v === 'number' && Number.isFinite(v));
const isCapacity = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255;

/** `stations.json` (T2.3) → a StationTable. A station without coordinates gets NaN. */
export function parseStations(body: unknown): StationTable {
  if (typeof body !== 'object' || body === null) throw new Error('stations.json is not an object');
  const { ids, names, lat, lon, capacity } = body as Record<string, unknown>;
  if (
    !isArrayOf(ids, isString) ||
    !isArrayOf(names, isString) ||
    !isArrayOf(lat, isCoordinate) ||
    !isArrayOf(lon, isCoordinate) ||
    !isArrayOf(capacity, isCapacity)
  )
    throw new Error('stations.json has unexpected fields');
  const length = ids.length;
  if ([names, lat, lon, capacity].some((column) => column.length !== length))
    throw new Error('stations.json columns have different lengths');
  // Station indices are Uint16 (P4).
  if (length > 65_535) throw new Error('stations.json has too many stations');
  return {
    length,
    ids,
    names,
    lat: Float32Array.from(lat, (v) => v ?? Number.NaN),
    lon: Float32Array.from(lon, (v) => v ?? Number.NaN),
    capacity: Uint8Array.from(capacity),
  };
}
