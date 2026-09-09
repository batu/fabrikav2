import Capacitor
import Foundation
import UIKit
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
    private var activeObserver: NSObjectProtocol?

    deinit {
        if let activeObserver {
            NotificationCenter.default.removeObserver(activeObserver)
        }
    }

    @objc func initialize(_ call: CAPPluginCall) {
        // Serialize initialization with UIKit lifecycle notifications.
        DispatchQueue.main.async { self.initializeOnMain(call) }
    }

    private func initializeOnMain(_ call: CAPPluginCall) {
        guard !initialized else { call.resolve(["initialized": true]); return }
        guard let devKey = call.getString("devKey"), !devKey.isEmpty,
              let appleAppId = call.getString("appleAppId"), !appleAppId.isEmpty else {
            call.resolve(["initialized": false]); return
        }
        let blockedPartners = call.getArray("blockedPartners", String.self) ?? []
        let sdk = AppsFlyerLib.shared()
        sdk.appsFlyerDevKey = devKey
        sdk.appleAppID = appleAppId
        sdk.isDebug = call.getBool("debugLogging") ?? false
        // General-audience policy: partners activated in the AppsFlyer dashboard
        // receive install and event postbacks. Only explicitly blocked partners
        // are filtered, and the filter is applied before start.
        if !blockedPartners.isEmpty {
            sdk.setSharingFilterForPartners(blockedPartners)
        }
        initialized = true
        activeObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard self?.initialized == true else { return }
            AppsFlyerLib.shared().start()
        }
        // The bridge can initialize after the first active notification. If it
        // initializes while inactive, the observer supplies the first start.
        if UIApplication.shared.applicationState == .active {
            sdk.start()
        }
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
