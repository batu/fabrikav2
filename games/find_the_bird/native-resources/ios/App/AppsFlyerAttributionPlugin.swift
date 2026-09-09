import Capacitor
import Foundation
import UIKit
import AppTrackingTransparency
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
    private var requestTracking = false
    private var trackingRequested = false
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
        requestTracking = call.getBool("requestTrackingAuthorization") ?? true
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
        // The install postback waits for the ATT answer (or the timeout) so an
        // authorized IDFA reaches the attribution partners on the first launch.
        if requestTracking {
            sdk.waitForATTUserAuthorization(timeoutInterval: 60)
        }
        initialized = true
        activeObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self, self.initialized else { return }
            self.requestTrackingAuthorizationIfNeeded()
            AppsFlyerLib.shared().start()
        }
        // The bridge can initialize after the first active notification. If it
        // initializes while inactive, the observer supplies the first start.
        if UIApplication.shared.applicationState == .active {
            requestTrackingAuthorizationIfNeeded()
            sdk.start()
        }
        call.resolve(["initialized": true])
    }

    // The ATT prompt is shown once, while the app is active, immediately before
    // the SDK session that carries the answer.
    private func requestTrackingAuthorizationIfNeeded() {
        guard requestTracking, !trackingRequested else { return }
        trackingRequested = true
        if #available(iOS 14, *) {
            ATTrackingManager.requestTrackingAuthorization { _ in }
        }
    }

    private func attStatus() -> String {
        if #available(iOS 14, *) {
            switch ATTrackingManager.trackingAuthorizationStatus {
            case .authorized: return "authorized"
            case .denied: return "denied"
            case .notDetermined: return "notDetermined"
            case .restricted: return "restricted"
            @unknown default: return "unavailable"
            }
        }
        return "unavailable"
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
        call.resolve([
            "initialized": initialized,
            "appsFlyerId": initialized ? AppsFlyerLib.shared().getAppsFlyerUID() : NSNull(),
            "attStatus": attStatus(),
        ])
    }
}
