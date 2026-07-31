import AdjustSdk
import Capacitor
import UIKit

@objc(AdjustAttributionPlugin)
public class AdjustAttributionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AdjustAttributionPlugin"
    public let jsName = "AdjustAttribution"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "trackEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
    ]

    private var initialized = false
    private var activeEnvironment: String?
    private var eventTokens: [String: String] = [:]
    private let allowedCallbackParametersByEvent: [String: Set<String>] = [
        "appOpen": ["cohort_bucket"],
        "levelStart": ["level_id", "level_name"],
        "levelComplete": ["level_id", "time_seconds", "hints_used", "wrong_taps"],
        "levelFailed": ["level_id", "dogs_found"],
        "rewardedWatched": ["placement"],
    ]

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
                call.resolve(["initialized": false, "environment": NSNull()])
                return
            }
            var status: JSObject = ["initialized": self.initialized]
            if let activeEnvironment = self.activeEnvironment {
                status["environment"] = activeEnvironment
            } else {
                status["environment"] = NSNull()
            }
            call.resolve(status)
        }
    }

    private func initializeOnMain(_ call: CAPPluginCall) {
        guard let appToken = trimmedString(call.getString("appToken")) else {
            log("initialize skipped; missing app token")
            call.resolve(["initialized": false])
            return
        }
        guard let environmentName = trimmedString(call.getString("environment")) else {
            log("initialize skipped; missing environment")
            call.resolve(["initialized": false])
            return
        }
        guard let adjustEnvironment = adjustEnvironment(from: environmentName) else {
            log("initialize skipped; invalid environment=\(environmentName)")
            call.resolve(["initialized": false])
            return
        }

        if initialized {
            call.resolve(["initialized": true])
            return
        }

        let config = ADJConfig(
            appToken: appToken,
            environment: adjustEnvironment,
            suppressLogLevel: true)
        guard let config else {
            log("initialize skipped; ADJConfig rejected app token")
            call.resolve(["initialized": false])
            return
        }
        guard config.isValid() else {
            log("initialize skipped; invalid Adjust config")
            call.resolve(["initialized": false])
            return
        }

        config.disableIdfaReading()
        config.disableAppTrackingTransparencyUsage()
        let verboseLogging = (call.getBool("verboseLogging") ?? false) && environmentName.lowercased() == "sandbox"
        config.logLevel = verboseLogging ? ADJLogLevel.verbose : ADJLogLevel.suppress

        eventTokens = compactEventTokens(call.getObject("eventTokens") ?? [:])
        Adjust.initSdk(config)
        initialized = true
        activeEnvironment = environmentName
        log("Adjust SDK initialized environment=\(environmentName) appToken=\(redacted(appToken))")
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
        guard let eventToken = eventTokens[eventName] else {
            log("event skipped; missing configured token for \(eventName)")
            call.resolve(["tracked": false])
            return
        }
        guard let event = ADJEvent(eventToken: eventToken) else {
            log("event skipped; ADJEvent rejected token=\(redacted(eventToken))")
            call.resolve(["tracked": false])
            return
        }

        let allowedCallbackParameters = allowedCallbackParametersByEvent[eventName] ?? []
        for (key, value) in call.getObject("callbackParameters") ?? [:] {
            guard allowedCallbackParameters.contains(key) else {
                continue
            }
            guard let stringValue = value as? String else {
                continue
            }
            event.addCallbackParameter(key, value: capped(stringValue))
        }

        Adjust.trackEvent(event)
        log("event tracked token=\(redacted(eventToken))")
        call.resolve(["tracked": true])
    }

    private func adjustEnvironment(from value: String) -> String? {
        switch value.lowercased() {
        case "sandbox":
            return ADJEnvironmentSandbox
        case "production":
            return ADJEnvironmentProduction
        default:
            return nil
        }
    }

    private func compactEventTokens(_ rawEventTokens: JSObject) -> [String: String] {
        var tokens: [String: String] = [:]
        for eventName in allowedCallbackParametersByEvent.keys {
            guard let rawToken = rawEventTokens[eventName] as? String else {
                continue
            }
            let trimmedToken = rawToken.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmedToken.isEmpty {
                tokens[eventName] = trimmedToken
            }
        }
        return tokens
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
        NSLog("[attribution:adjust] \(message)")
    }
}
