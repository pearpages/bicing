import { describe, expect, test } from 'vitest';
import { percentile, Ring } from './stats';

describe('percentile', () => {
  test('nearest rank, without reordering the input', () => {
    const values = Float64Array.of(40, 10, 30, 20);
    expect(percentile(values, 50)).toBe(20);
    expect(percentile(values, 95)).toBe(40);
    expect(Array.from(values)).toEqual([40, 10, 30, 20]);
  });

  test('empty input is 0', () => {
    expect(percentile([], 95)).toBe(0);
  });
});

describe('Ring', () => {
  test('keeps the newest samples, oldest first', () => {
    const ring = new Ring(3);
    [1, 2, 3, 4, 5].forEach((v) => {
      ring.push(v);
    });
    expect(Array.from(ring.toArray())).toEqual([3, 4, 5]);
    expect(ring.size).toBe(3);
  });

  test('clear empties it', () => {
    const ring = new Ring(2);
    ring.push(1);
    ring.clear();
    expect(ring.toArray()).toHaveLength(0);
  });
});
