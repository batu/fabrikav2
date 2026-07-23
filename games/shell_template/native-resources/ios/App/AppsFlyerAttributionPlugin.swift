import AppsFlyerLib
import Capacitor
import UIKit

@objc(AppsFlyerAttributionPlugin)
public class AppsFlyerAttributionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppsFlyerAttributionPlugin"
    public let jsName = "AppsFlyerAttribution"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "trackEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
    ]

    private var initialized = false

    @objc func initialize(_ call: CAPPluginCall) {
        onMain { [weak self] in
            self?.initializeOnMain(call)
        }
    }

    @objc func trackEvent(_ call: CAPPluginCall) {
        onMain { [weak self] in
            self?.trackEventOnMain(call)
        }
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        onMain { [weak self] in
            guard let self else {
                call.resolve(["initialized": false, "appsFlyerId": NSNull()])
                return
            }
            var status: JSObject = ["initialized": self.initialized]
            if self.initialized {
                status["appsFlyerId"] = AppsFlyerLib.shared().getAppsFlyerUID()
            } else {
                status["appsFlyerId"] = NSNull()
            }
            call.resolve(status)
        }
    }

    private func initializeOnMain(_ call: CAPPluginCall) {
        guard let devKey = trimmedString(call.getString("devKey")) else {
            log("initialize skipped; missing dev key")
            call.resolve(["initialized": false])
            return
        }
        guard let appleAppId = trimmedString(call.getString("appleAppId")) else {
            log("initialize skipped; missing apple app id")
            call.resolve(["initialized": false])
            return
        }
        if initialized {
            call.resolve(["initialized": true])
            return
        }

        let lib = AppsFlyerLib.shared()
        lib.appsFlyerDevKey = devKey
        lib.appleAppID = appleAppId
        lib.isDebug = call.getBool("debugLogging") ?? false
        let attWaitSeconds = call.getInt("attWaitSeconds") ?? 0
        if attWaitSeconds > 0 {
            // Delay the first launch report until ATT resolves (or the timeout
            // fires) so conversion data carries the user's real consent state.
            lib.waitForATTUserAuthorization(timeoutInterval: Double(attWaitSeconds))
        }
        lib.start()
        initialized = true
        log("AppsFlyer SDK started appleAppId=\(appleAppId) devKey=\(redacted(devKey))")
        call.resolve(["initialized": true])
    }

    private func trackEventOnMain(_ call: CAPPluginCall) {
        guard initialized else {
            log("event skipped; SDK not initialized")
            call.resolve(["tracked": false])
            return
        }
        guard let eventName = trimmedString(call.getString("eventName")) else {
            log("event skipped; missing event name")
            call.resolve(["tracked": false])
            return
        }

        var values: [String: Any] = [:]
        for (key, value) in call.getObject("eventValues") ?? [:] {
            guard let stringValue = value as? String else { continue }
            values[key] = capped(stringValue)
        }
        AppsFlyerLib.shared().logEvent(eventName, withValues: values)
        log("event logged name=\(eventName)")
        call.resolve(["tracked": true])
    }

    private func trimmedString(_ value: String?) -> String? {
        guard let value else {
            return nil
        }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func capped(_ value: String) -> String {
        if value.count <= 96 {
            return value
        }
        return String(value.prefix(96))
    }

    private func onMain(_ work: @escaping () -> Void) {
        if Thread.isMainThread {
            work()
        } else {
            DispatchQueue.main.async(execute: work)
        }
    }

    private func redacted(_ value: String) -> String {
        if value.count <= 6 {
            return "<redacted>"
        }
        return "<redacted:\(value.suffix(4))>"
    }

    private func log(_ message: String) {
        NSLog("[attribution:appsflyer] \(message)")
    }
}
