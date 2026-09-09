import { test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Execute the actual bridge implementation with SDK/UIKit boundary doubles.
// This tests native notification behavior, not iOS or backend delivery.
test.skipIf(process.platform !== 'darwin')('Bird AppsFlyer starts on initialization and subsequent active transitions', () => {
  const source = fs.readFileSync(new URL('../../../games/find_the_bird/native-resources/ios/App/AppsFlyerAttributionPlugin.swift', import.meta.url), 'utf8')
    .replace(/^import (Capacitor|UIKit|AppsFlyerLib)\n/gm, '');
  const fixture = `
import Foundation
public class CAPPlugin: NSObject {}
public protocol CAPBridgedPlugin {}
public struct CAPPluginMethod { public init(name: String, returnType: String) {} }
public let CAPPluginReturnPromise = "promise"
public class CAPPluginCall: NSObject {
    var values: [String: Any] = ["devKey": "test-key", "appleAppId": "6796698146"]
    var result: [String: Any]?
    func getString(_ key: String) -> String? { values[key] as? String }
    func getBool(_ key: String) -> Bool? { values[key] as? Bool }
    func getArray<T>(_ key: String, _ type: T.Type) -> [T]? { values[key] as? [T] }
    func getObject(_ key: String) -> [String: Any]? { values[key] as? [String: Any] }
    func resolve(_ value: [String: Any]) { result = value }
}
enum State { case active, inactive, background }
class UIApplication {
    static let shared = UIApplication()
    static let didBecomeActiveNotification = Notification.Name("didBecomeActive")
    var applicationState = State.inactive
}
class AppsFlyerLib {
    static let instance = AppsFlyerLib()
    static func shared() -> AppsFlyerLib { instance }
    var appsFlyerDevKey = ""
    var appleAppID = ""
    var isDebug = false
    var starts = 0
    var filters: [[String]] = []
    var startsWhenFiltered: [Int] = []
    func setSharingFilterForPartners(_ partners: [String]) {
        filters.append(partners)
        startsWhenFiltered.append(starts)
    }
    func start() {
        precondition(Thread.isMainThread)
        precondition(!appsFlyerDevKey.isEmpty && appleAppID == "6796698146")
        starts += 1
    }
    func logEvent(name: String, values: [String: Any], completion: (Any?, Any?) -> Void) {}
    func getAppsFlyerUID() -> String { "test-uid" }
}
${source}
func drain() { RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.02)) }
func activate() {
    UIApplication.shared.applicationState = .active
    NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
}
let sdk = AppsFlyerLib.shared()
var plugin: AppsFlyerAttributionPlugin? = AppsFlyerAttributionPlugin()
activate()
precondition(sdk.starts == 0, "No start before initialization")
UIApplication.shared.applicationState = .inactive
let first = CAPPluginCall()
plugin!.initialize(first)
drain()
precondition(first.result?["initialized"] as? Bool == true && sdk.starts == 0)
activate()
precondition(sdk.starts == 1, "Inactive initialization waits for activation")
plugin!.initialize(CAPPluginCall())
plugin!.initialize(CAPPluginCall())
drain()
precondition(sdk.starts == 1 && sdk.filters.isEmpty, "Repeated initialization is idempotent and no partner is blocked by default")
UIApplication.shared.applicationState = .background
activate()
precondition(sdk.starts == 2, "Resume records another session")
plugin = nil
activate()
precondition(sdk.starts == 2, "Released plugin does not receive notifications")
var activePlugin: AppsFlyerAttributionPlugin? = AppsFlyerAttributionPlugin()
activePlugin!.initialize(CAPPluginCall())
drain()
precondition(sdk.starts == 3, "Already active initialization starts exactly once")
activePlugin = nil
let blockingSdk = AppsFlyerLib.shared()
let blocking = AppsFlyerAttributionPlugin()
let blockingCall = CAPPluginCall()
blockingCall.values["blockedPartners"] = ["facebook_int"]
blocking.initialize(blockingCall)
drain()
precondition(blockingCall.result?["initialized"] as? Bool == true && blockingSdk.starts == 4, "Blocklisted initialization still starts")
precondition(blockingSdk.filters == [["facebook_int"]] && blockingSdk.startsWhenFiltered == [3], "Only the explicit blocklist is applied, and before that plugin's start")
print("PASS: lifecycle, idempotence, cleanup, and partner blocklist")
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bird-appsflyer-foreground-'));
  try {
    const file = path.join(dir, 'main.swift');
    fs.writeFileSync(file, fixture);
    const output = execFileSync('xcrun', ['swift', '-swift-version', '5', file], { encoding: 'utf8' });
    expect(output).toMatch(/PASS: lifecycle, idempotence, cleanup, and partner blocklist/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
