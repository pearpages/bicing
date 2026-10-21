import { describe, expect, test } from 'vitest';
import { fetchGaps, parseGaps } from './gaps';

const GOOD = {
  thresholdMinutes: 15,
  gaps: [{ t0: 10, t1: 40, from: 'x', to: 'y', minutes: 30 }],
  missingMonths: ['2025-11'],
  unusableMonths: [{ month: '2025-10', reason: 'wrong file' }],
};

describe('gaps.json', () => {
  test('keeps the fields the app uses', async () => {
    expect(parseGaps(GOOD)).toEqual({
      gaps: [{ t0: 10, t1: 40 }],
      missingMonths: ['2025-11'],
      unusableMonths: [{ month: '2025-10', reason: 'wrong file' }],
    });
    const fetchImpl: typeof fetch = () => Promise.resolve(new Response(JSON.stringify(GOOD)));
    expect((await fetchGaps('https://data.example/', fetchImpl)).gaps).toHaveLength(1);
  });

  test('accepts a build from before unusable months existed', () => {
    const { unusableMonths, ...older } = GOOD;
    expect(unusableMonths).toHaveLength(1);
    expect(parseGaps(older).unusableMonths).toEqual([]);
  });

  test('rejects anything malformed', () => {
    for (const bad of [
      null,
      { ...GOOD, gaps: [{ t0: 40, t1: 10 }] },
      { ...GOOD, gaps: [{ t0: -1, t1: 10 }] },
      { ...GOOD, gaps: 'none' },
      { ...GOOD, missingMonths: ['2025-13'] },
      { ...GOOD, unusableMonths: [{ month: '2025-10' }] },
    ])
      expect(() => parseGaps(bad), JSON.stringify(bad)).toThrow(/unexpected fields/);
  });
});
