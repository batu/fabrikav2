#!/bin/zsh
# Final standalone install: bundled dist (no dev server), harness on, portrait, icon.
set -e
G=/Users/base/dev/appletolye/fabrikav2/.worktrees/mage-master/games/mage_master
cd $G
VITE_ENABLE_TEST_HARNESS=true npx vite build 2>&1 | tail -1
npx cap sync ios 2>&1 | tail -1
cp -R native-resources/ios/App/ ios/App/App/
mkdir -p .work
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination 'id=00008101-000410EC3EF9001E' -allowProvisioningUpdates DEVELOPMENT_TEAM=42L77JAX72 -derivedDataPath .work/DerivedData build > .work/xcodebuild-final.log 2>&1 && echo "xcodebuild ok" || { tail -20 .work/xcodebuild-final.log; exit 1; }
APP=$(find .work/DerivedData/Build/Products -name 'App.app' -maxdepth 2 | head -1)
xcrun devicectl device install app --device 00008101-000410EC3EF9001E "$APP" 2>&1 | tail -1
xcrun devicectl device process launch --device 00008101-000410EC3EF9001E com.basegamelab.mage_master 2>&1 | tail -1
grep -c 'server' ios/App/App/capacitor.config.json || echo "no server.url (standalone)"
