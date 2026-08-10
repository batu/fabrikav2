import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildModelerSpec, type ModelerSpec } from './ModelerSpec';

const SPEC: ModelerSpec = {
  parts: [
    { id: 'visible', prim: 'sphere', cell: [0, 0] },
    { id: 'transparent', prim: 'sphere', cell: [1, 0] },
  ],
};

describe('buildModelerSpec', () => {
  it('does not submit fully transparent decorative parts', () => {
    const model = buildModelerSpec(SPEC, {
      materialForPart: (part) => new THREE.MeshBasicMaterial({
        transparent: part.id === 'transparent',
        opacity: part.id === 'transparent' ? 0 : 1,
      }),
    });

    expect(model.getObjectByName('visible')?.visible).toBe(true);
    expect(model.getObjectByName('transparent')?.visible).toBe(false);
  });
});
