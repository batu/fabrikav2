import { describe, expect, test } from 'vitest';

import { pointAtBoxFraction } from './canvas.ts';

describe('pointAtBoxFraction', (): void => {
  test('maps a relative canvas point into absolute page coordinates', (): void => {
    expect(pointAtBoxFraction(
      {
        x: 100,
        y: 200,
        width: 500,
        height: 400,
      },
      {
        x: 0.5,
        y: 0.25,
      },
    )).toEqual({
      x: 350,
      y: 300,
    });
  });
});
