import { describe, expect, test } from 'vitest';
import { linesOf } from '../testing';
import { perVertexColor } from './WebGLRenderer';

describe('perVertexColor', () => {
  test('repeats each line value for its vertices, as clamped bytes', () => {
    const data = linesOf(
      [
        [
          [0, 0],
          [1, 1],
        ],
        [[2, 2]],
        [
          [3, 3],
          [4, 4],
          [5, 5],
        ],
      ],
      [0, 0.5, 2],
    );
    expect(Array.from(perVertexColor(data))).toEqual([0, 0, 128, 255, 255, 255]);
  });
});
