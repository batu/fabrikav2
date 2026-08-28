import Capacitor
import Foundation
import AppsFlyerLib

@objc(AppsFlyerAttributionPlugin)
public final class AppsFlyerAttributionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppsFlyerAttributionPlugin"
    public let jsName = "AppsFlyerAttribution"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "trackEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
    ]
    private var initialized = false

    @objc func initialize(_ call: CAPPluginCall) {
        guard !initialized else { call.resolve(["initialized": true]); return }
        guard let devKey = call.getString("devKey"), !devKey.isEmpty,
              let appleAppId = call.getString("appleAppId"), !appleAppId.isEmpty else {
            call.resolve(["initialized": false]); return
        }
        let partners = call.getArray("sharingPartners", String.self) ?? []
        let sdk = AppsFlyerLib.shared()
        sdk.appsFlyerDevKey = devKey
        sdk.appleAppID = appleAppId
        sdk.isDebug = call.getBool("debugLogging") ?? false
        // Privacy policy is applied before start. Empty means deny all partners.
        sdk.setSharingFilterForPartners(partners.isEmpty ? ["all"] : partners)
        sdk.start()
        initialized = true
        call.resolve(["initialized": true])
    }

    @objc func trackEvent(_ call: CAPPluginCall) {
        guard initialized, let name = call.getString("eventName") else {
            call.resolve(["tracked": false]); return
        }
        let values = call.getObject("eventValues") ?? [:]
        AppsFlyerLib.shared().logEvent(name: name, values: values) { _, _ in }
        call.resolve(["tracked": true])
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        call.resolve(["initialized": initialized, "appsFlyerId": initialized ? AppsFlyerLib.shared().getAppsFlyerUID() : NSNull()])
    }
}
