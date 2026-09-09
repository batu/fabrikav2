import { test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Execute the actual bridge implementation with SDK/UIKit boundary doubles.
// This tests native notification behavior, not iOS or backend delivery.
for (const game of ['find_the_bird', 'find_the_dog']) test.skipIf(process.platform !== 'darwin')(`${game} AppsFlyer bridge starts, prompts ATT once, and stays idempotent`, () => {
  const source = fs.readFileSync(new URL(`../../../games/${game}/native-resources/ios/App/AppsFlyerAttributionPlugin.swift`, import.meta.url), 'utf8')
    .replace(/^import (Capacitor|UIKit|AppsFlyerLib|AppTrackingTransparency)\n/gm, '');
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
enum ATTrackingManager {
    enum AuthorizationStatus { case notDetermined, restricted, denied, authorized }
    static var requests = 0
    static var trackingAuthorizationStatus = AuthorizationStatus.notDetermined
    static func requestTrackingAuthorization(completionHandler: @escaping (AuthorizationStatus) -> Void) {
        requests += 1
        trackingAuthorizationStatus = .authorized
        completionHandler(.authorized)
    }
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
    var attWaits: [TimeInterval] = []
    func waitForATTUserAuthorization(timeoutInterval: TimeInterval) {
        attWaits.append(timeoutInterval)
    }
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
precondition(ATTrackingManager.requests == 0, "ATT is not requested while inactive")
precondition(sdk.attWaits == [60], "SDK waits for ATT before the first start")
activate()
precondition(sdk.starts == 1, "Inactive initialization waits for activation")
precondition(ATTrackingManager.requests == 1, "ATT prompt requested on the first activation")
plugin!.initialize(CAPPluginCall())
plugin!.initialize(CAPPluginCall())
drain()
precondition(sdk.starts == 1 && sdk.filters.isEmpty, "Repeated initialization is idempotent and no partner is blocked by default")
UIApplication.shared.applicationState = .background
activate()
precondition(sdk.starts == 2 && ATTrackingManager.requests == 1, "Resume records another session without a second ATT prompt")
plugin = nil
activate()
precondition(sdk.starts == 2, "Released plugin does not receive notifications")
var activePlugin: AppsFlyerAttributionPlugin? = AppsFlyerAttributionPlugin()
activePlugin!.initialize(CAPPluginCall())
drain()
precondition(sdk.starts == 3 && ATTrackingManager.requests == 2, "Already active initialization starts once and prompts once")
let status = CAPPluginCall()
activePlugin!.getStatus(status)
precondition(status.result?["attStatus"] as? String == "authorized", "getStatus reports the ATT status")
activePlugin = nil
let blockingSdk = AppsFlyerLib.shared()
let blocking = AppsFlyerAttributionPlugin()
let blockingCall = CAPPluginCall()
blockingCall.values["blockedPartners"] = ["facebook_int"]
blockingCall.values["requestTrackingAuthorization"] = false
blocking.initialize(blockingCall)
drain()
precondition(blockingCall.result?["initialized"] as? Bool == true && blockingSdk.starts == 4, "Blocklisted initialization still starts")
precondition(blockingSdk.filters == [["facebook_int"]] && blockingSdk.startsWhenFiltered == [3], "Only the explicit blocklist is applied, and before that plugin's start")
precondition(ATTrackingManager.requests == 2 && blockingSdk.attWaits.count == 2, "Opting out of ATT skips both the prompt and the SDK wait")
print("PASS: lifecycle, idempotence, cleanup, ATT, and partner blocklist")
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bird-appsflyer-foreground-'));
  try {
    const file = path.join(dir, 'main.swift');
    fs.writeFileSync(file, fixture);
    const output = execFileSync('xcrun', ['swift', '-swift-version', '5', file], { encoding: 'utf8' });
    expect(output).toMatch(/PASS: lifecycle, idempotence, cleanup, ATT, and partner blocklist/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
