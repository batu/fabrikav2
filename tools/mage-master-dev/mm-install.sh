#!/bin/zsh
# Final standalone install: bundled dist (no dev server), harness on, portrait, icon.
ROOT=$(cd "$(dirname "$0")/../.." && pwd)  # repo root, whichever checkout this lives in
set -e
G=$ROOT/games/mage_master
cd $G
VITE_ENABLE_TEST_HARNESS=true npx vite build 2>&1 | tail -1
npx cap sync ios 2>&1 | tail -1
cp -R native-resources/ios/App/ ios/App/App/
mkdir -p .work
APP=$(node "$ROOT/tools/native-shell/build-ios.mjs" --game mage_master --configuration Debug -- -project "$G/ios/App/App.xcodeproj" -scheme App -configuration Debug -destination 'id=00008101-000410EC3EF9001E' -allowProvisioningUpdates DEVELOPMENT_TEAM=42L77JAX72 build)
xcrun devicectl device install app --device 00008101-000410EC3EF9001E "$APP" 2>&1 | tail -1
BID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")  # the generated project may still say mage_master
xcrun devicectl device process launch --device 00008101-000410EC3EF9001E "$BID" 2>&1 | tail -1
grep -c 'server' ios/App/App/capacitor.config.json || echo "no server.url (standalone)"
