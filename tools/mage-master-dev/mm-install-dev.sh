#!/bin/zsh
# Dev install: bundle points at the Mac's Vite server for live reload + dev drive.
ROOT=$(cd "$(dirname "$0")/../.." && pwd)  # repo root, whichever checkout this lives in
set -e
G=$ROOT/games/mage_master
cd $G
VITE_ENABLE_TEST_HARNESS=true npx vite build 2>&1 | tail -1
npx cap sync ios 2>&1 | tail -1
cp -R native-resources/ios/App/ ios/App/App/
node -e "const fs=require('fs');const p='ios/App/App/capacitor.config.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));c.server={url:'http://192.168.1.74:5199',cleartext:true};fs.writeFileSync(p,JSON.stringify(c,null,2));"
/usr/libexec/PlistBuddy -c 'Add :NSAppTransportSecurity dict' -c 'Add :NSAppTransportSecurity:NSAllowsArbitraryLoads bool true' ios/App/App/Info.plist
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination 'id=00008101-000410EC3EF9001E' -allowProvisioningUpdates DEVELOPMENT_TEAM=42L77JAX72 -derivedDataPath .work/DerivedData build > .work/xcodebuild-dev.log 2>&1 && echo "xcodebuild ok" || { tail -20 .work/xcodebuild-dev.log; exit 1; }
APP=$(find .work/DerivedData/Build/Products -name 'App.app' -maxdepth 2 | head -1)
xcrun devicectl device install app --device 00008101-000410EC3EF9001E "$APP" 2>&1 | tail -1
BID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")  # the generated project may still say mage_master
xcrun devicectl device process launch --device 00008101-000410EC3EF9001E "$BID" 2>&1 | tail -1
