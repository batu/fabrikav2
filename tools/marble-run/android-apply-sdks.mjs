// Idempotently patch the generated Android project with the SDK component
// wiring `npx cap add android` cannot produce: Gradle deps for AppLovin MAX /
// AppsFlyer / Facebook Core, the AD_ID permission, and MainActivity plugin
// registration for the committed bridges in native-resources/android-src (which
// sync-native-resources.mjs overlays in). Firebase Android stays out until the
// publisher supplies google-services.json — the Capacitor Firebase plugin is
// already excluded by capacitor.config.ts includePlugins when env is absent.
//
// Mirrors ios-inject-team.mjs: safe to re-run, no-ops when already applied.

/* global process */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = '// marble-run-sdk-deps';

export const SDK_DEPENDENCIES = [
  `    implementation "com.applovin:applovin-sdk:13.5.1" ${MARKER}`,
  `    implementation "com.appsflyer:af-android-sdk:6.17.0" ${MARKER}`,
  `    implementation "com.facebook.android:facebook-core:18.1.3" ${MARKER}`,
];

const PLUGIN_IMPORTS = [
  'import com.basegamelab.marblerun.sdk.AppLovinMaxPlugin;',
  'import com.basegamelab.marblerun.sdk.AppsFlyerAttributionPlugin;',
  'import com.basegamelab.marblerun.sdk.MetaEventsPlugin;',
];

const AD_ID_PERMISSION = '    <uses-permission android:name="com.google.android.gms.permission.AD_ID"/>';

export function patchBuildGradle(content) {
  if (content.includes(MARKER)) return content;
  const anchor = /dependencies \{\n/;
  if (!anchor.test(content)) throw new Error('android/app/build.gradle has no dependencies block');
  return content.replace(anchor, `dependencies {\n${SDK_DEPENDENCIES.join('\n')}\n`);
}

export function patchManifest(content) {
  if (content.includes('com.google.android.gms.permission.AD_ID')) return content;
  const anchor = '</manifest>';
  if (!content.includes(anchor)) throw new Error('AndroidManifest.xml has no closing tag');
  return content.replace(anchor, `${AD_ID_PERMISSION}\n${anchor}`);
}

export function patchMainActivity(content) {
  let next = content;
  if (!next.includes('import com.getcapacitor.BridgeActivity;')) {
    throw new Error('MainActivity.java is not a Capacitor BridgeActivity');
  }
  for (const line of PLUGIN_IMPORTS) {
    if (!next.includes(line)) {
      next = next.replace('import com.getcapacitor.BridgeActivity;', `import com.getcapacitor.BridgeActivity;\n${line}`);
    }
  }
  if (!next.includes('registerPlugin(AppLovinMaxPlugin.class);')) {
    const registrations = [
      '        registerPlugin(AppLovinMaxPlugin.class);',
      '        registerPlugin(AppsFlyerAttributionPlugin.class);',
      '        registerPlugin(MetaEventsPlugin.class);',
    ].join('\n');
    if (next.includes('super.onCreate(savedInstanceState);')) {
      next = next.replace('super.onCreate(savedInstanceState);', `${registrations}\n        super.onCreate(savedInstanceState);`);
    } else {
      // Stock Capacitor MainActivity has an empty class body; add onCreate.
      next = next.replace(/public class MainActivity extends BridgeActivity \{\s*\}/,
        `public class MainActivity extends BridgeActivity {\n    @Override\n    protected void onCreate(android.os.Bundle savedInstanceState) {\n${registrations}\n        super.onCreate(savedInstanceState);\n    }\n}`);
      if (!next.includes('registerPlugin(AppLovinMaxPlugin.class);')) {
        throw new Error('MainActivity.java shape not recognized; cannot inject plugin registration');
      }
    }
  }
  return next;
}

function apply(root) {
  const targets = [
    ['android/app/build.gradle', patchBuildGradle],
    ['android/app/src/main/AndroidManifest.xml', patchManifest],
    ['android/app/src/main/java/com/basegamelab/marblerun/MainActivity.java', patchMainActivity],
  ];
  const changed = [];
  for (const [relative, patch] of targets) {
    const file = path.join(root, relative);
    if (!existsSync(file)) throw new Error(`[android-apply-sdks] missing ${relative}; run npx cap add android first`);
    const current = readFileSync(file, 'utf8');
    const next = patch(current);
    if (next !== current) {
      writeFileSync(file, next);
      changed.push(relative);
    }
  }
  console.info(changed.length
    ? `[android-apply-sdks] patched: ${changed.join(', ')}`
    : '[android-apply-sdks] already applied; no change.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  apply(process.cwd());
}
