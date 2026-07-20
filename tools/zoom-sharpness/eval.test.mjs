import assert from 'node:assert/strict';
import test from 'node:test';
import { median, msSsim, psnrBand, resampleLanczos, scorePair, worstDecile } from './lib.mjs';

function image(width, height, pixel) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(pixel, i);
  return { width, height, data };
}

test('identity reaches every score ceiling', () => {
  const value = image(16, 16, [80, 120, 160, 255]);
  assert.equal(msSsim(value, value), 1);
  assert.equal(scorePair(value, value).composite, 100);
});

test('PSNR band and aggregates use fixed boundaries', () => {
  assert.deepEqual([psnrBand(10), psnrBand(20), psnrBand(30), psnrBand(40), psnrBand(50)], [0, 0, 0.5, 1, 1]);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(worstDecile(Array.from({ length: 15 }, (_, index) => index + 1)), 1.5);
});

test('Lanczos resampling is deterministic and dimension exact', () => {
  const source = image(4, 4, [10, 20, 30, 255]);
  assert.deepEqual(resampleLanczos(source, { x: 0, y: 0, width: 4, height: 4 }, 3, 5), resampleLanczos(source, { x: 0, y: 0, width: 4, height: 4 }, 3, 5));
  assert.equal(resampleLanczos(source, { x: 0, y: 0, width: 4, height: 4 }, 3, 5).data.length, 60);
});

