// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { linesOf, VIEW } from '../testing';
import { DIM_ALPHA } from '../types';
import { SvgRenderer } from './SvgRenderer';

describe('SvgRenderer', () => {
  test('creates one path per line, colored through the scale', () => {
    const r = new SvgRenderer();
    r.setColorScale((t) => (t < 0.5 ? 'blue' : 'red'));
    r.setData(
      linesOf(
        [
          [
            [0, 0],
            [100, 10],
          ],
          [
            [0, 5],
            [100, 5],
          ],
        ],
        [0, 1],
      ),
    );
    const paths = r.element.querySelectorAll('path');
    expect(paths).toHaveLength(2);
    expect([paths[0]?.getAttribute('stroke'), paths[1]?.getAttribute('stroke')]).toEqual([
      'blue',
      'red',
    ]);
  });

  test('rebuilds every d attribute on render, in CSS pixels', () => {
    const r = new SvgRenderer();
    r.setData(
      linesOf([
        [
          [0, 0],
          [100, 10],
        ],
      ]),
    );
    const stats = r.render(VIEW);
    expect(r.element.querySelector('path')?.getAttribute('d')).toBe('M0.0,100.0L200.0,0.0');
    expect(stats).toEqual({ points: 2, drawCalls: 1 });
  });

  test('replacing data replaces paths instead of accumulating them', () => {
    const r = new SvgRenderer();
    r.setData(linesOf([[[0, 0]], [[1, 1]], [[2, 2]]]));
    r.setData(linesOf([[[0, 0]]]));
    expect(r.element.querySelectorAll('path')).toHaveLength(1);
  });

  test('refuses more than 1M points: the baseline is capped, not left to freeze the tab', () => {
    const r = new SvgRenderer();
    const huge = { ...linesOf([]), x: { length: 1_000_001 } as Uint32Array };
    expect(() => {
      r.setData(huge);
    }).toThrow(/at most 1000000/);
  });

  test('dimmed paths keep their color at a fraction of the opacity, also after new data', () => {
    const r = new SvgRenderer({ alpha: 0.5 });
    const line: [number, number][] = [
      [0, 0],
      [100, 10],
    ];
    r.setDimmed(Uint8Array.of(0, 1));
    r.setData(linesOf([line, line]));
    const opacity = () =>
      [...r.element.querySelectorAll('path')].map((p) => Number(p.getAttribute('stroke-opacity')));
    expect(opacity()).toEqual([0.5, 0.5 * DIM_ALPHA]);
    r.setDimmed(null);
    expect(opacity()).toEqual([0.5, 0.5]);
  });
});
