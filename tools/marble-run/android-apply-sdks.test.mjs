import assert from 'node:assert/strict';
import test from 'node:test';

import { patchBuildGradle, patchRootBuildGradle } from './android-apply-sdks.mjs';

test('wires the Crashlytics Gradle plugin when Firebase config is present', () => {
  const root = `buildscript {
  dependencies {
    classpath 'com.google.gms:google-services:4.4.4'
  }
}`;
  const app = `dependencies {
}
try {
    if (servicesJSON.text) {
        apply plugin: 'com.google.gms.google-services'
    }
}`;

  const patchedRoot = patchRootBuildGradle(root);
  const patchedApp = patchBuildGradle(app);

  assert.match(patchedRoot, /firebase-crashlytics-gradle:3\.0\.7/);
  assert.match(patchedApp, /apply plugin: 'com\.google\.firebase\.crashlytics'/);
  assert.equal(patchRootBuildGradle(patchedRoot), patchedRoot);
  assert.equal(patchBuildGradle(patchedApp), patchedApp);
});
