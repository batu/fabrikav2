import Capacitor
import FBSDKCoreKit
import UIKit

@objc(MetaEventsPlugin)
public class MetaEventsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MetaEventsPlugin"
    public let jsName = "MetaEvents"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "logEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAdvertiserTrackingEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
    ]

    private var initialized = false
    private var activeAppId: String?

    @objc func initialize(_ call: CAPPluginCall) {
        onMain { [weak self] in
            self?.initializeOnMain(call)
        }
    }

    @objc func logEvent(_ call: CAPPluginCall) {
        onMain { [weak self] in
            self?.logEventOnMain(call)
        }
    }

    @objc func setAdvertiserTrackingEnabled(_ call: CAPPluginCall) {
        onMain { [weak self] in
            guard let self, self.initialized else {
                call.resolve(["initialized": false])
                return
            }
            Settings.shared.isAdvertiserTrackingEnabled = call.getBool("enabled") ?? false
            call.resolve(["initialized": true])
        }
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        onMain { [weak self] in
            guard let self else {
                call.resolve(["initialized": false, "appId": NSNull()])
                return
            }
            var status: JSObject = ["initialized": self.initialized]
            if let activeAppId = self.activeAppId {
                status["appId"] = activeAppId
            } else {
                status["appId"] = NSNull()
            }
            call.resolve(status)
        }
    }

    private func initializeOnMain(_ call: CAPPluginCall) {
        guard let appId = trimmedString(call.getString("appId")) else {
            log("initialize skipped; missing app id")
            call.resolve(["initialized": false])
            return
        }
        guard let clientToken = trimmedString(call.getString("clientToken")) else {
            log("initialize skipped; missing client token")
            call.resolve(["initialized": false])
            return
        }
        if initialized {
            call.resolve(["initialized": true])
            return
        }

        // Programmatic configuration keeps the FB identity in env config rather
        // than Info.plist, so a config-less build (shell_template) ships zero
        // Facebook identity and the JS layer never calls initialize.
        Settings.shared.appID = appId
        Settings.shared.clientToken = clientToken
        Settings.shared.isAutoLogAppEventsEnabled = call.getBool("autoLogAppEvents") ?? false
        Settings.shared.isAdvertiserIDCollectionEnabled = call.getBool("advertiserIdCollection") ?? false
        ApplicationDelegate.shared.initializeSDK()
        initialized = true
        activeAppId = appId
        log("Facebook SDK initialized appId=\(appId) clientToken=\(redacted(clientToken))")
        call.resolve(["initialized": true])
    }

    private func logEventOnMain(_ call: CAPPluginCall) {
        guard initialized else {
            log("event skipped; SDK not initialized")
            call.resolve(["logged": false])
            return
        }
        guard let eventName = trimmedString(call.getString("eventName")) else {
            log("event skipped; missing event name")
            call.resolve(["logged": false])
            return
        }

        var parameters: [AppEvents.ParameterName: Any] = [:]
        for (key, value) in call.getObject("parameters") ?? [:] {
            guard let stringValue = value as? String else { continue }
            parameters[AppEvents.ParameterName(key)] = capped(stringValue)
        }
        AppEvents.shared.logEvent(AppEvents.Name(eventName), parameters: parameters)
        log("event logged name=\(eventName)")
        call.resolve(["logged": true])
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
        NSLog("[meta] \(message)")
    }
}
