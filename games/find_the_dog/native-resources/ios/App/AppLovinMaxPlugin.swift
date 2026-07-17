import AppLovinSDK
import Capacitor
import UIKit

@objc(AppLovinMaxPlugin)
public class AppLovinMaxPlugin: CAPPlugin, CAPBridgedPlugin, MAAdDelegate, MAAdViewAdDelegate, MARewardedAdDelegate, MAAdRevenueDelegate {
    public let identifier = "AppLovinMaxPlugin"
    public let jsName = "AppLovinMax"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showBanner", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hideBanner", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "preloadInterstitial", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showInterstitial", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "preloadRewarded", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showRewarded", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showPrivacyOptions", returnType: CAPPluginReturnPromise),
    ]

    private var initialized = false
    private var initializationInFlight = false
    private var pendingInitializeCalls: [CAPPluginCall] = []

    private var bannerAdView: MAAdView?
    private var bannerAdUnitId: String?
    private var bannerDisplayable = false
    private var bannerRequestedVisible = false
    private var pendingBannerShowCall: CAPPluginCall?

    private var interstitialAd: MAInterstitialAd?
    private var interstitialAdUnitId: String?
    private var interstitialLoaded = false
    private var interstitialLoading = false
    private var pendingInterstitialLoadCalls: [CAPPluginCall] = []
    private var pendingInterstitialShowCall: CAPPluginCall?

    private var rewardedAd: MARewardedAd?
    private var rewardedAdUnitId: String?
    private var rewardedLoaded = false
    private var rewardedLoading = false
    private var rewardedGranted = false
    private var pendingRewardedLoadCalls: [CAPPluginCall] = []
    private var pendingRewardedShowCall: CAPPluginCall?

    @objc func initialize(_ call: CAPPluginCall) {
        onMain { [weak self] in
            self?.initializeOnMain(call)
        }
    }

    @objc func showBanner(_ call: CAPPluginCall) {
        onMain { [weak self] in
            self?.showBannerOnMain(call)
        }
    }

    @objc func hideBanner(_ call: CAPPluginCall) {
        onMain { [weak self] in
            self?.hideBannerOnMain(call)
        }
    }

    @objc func preloadInterstitial(_ call: CAPPluginCall) {
        onMain { [weak self] in
            self?.preloadInterstitialOnMain(call)
        }
    }

    @objc func showInterstitial(_ call: CAPPluginCall) {
        onMain { [weak self] in
            self?.showInterstitialOnMain(call)
        }
    }

    @objc func preloadRewarded(_ call: CAPPluginCall) {
        onMain { [weak self] in
            self?.preloadRewardedOnMain(call)
        }
    }

    @objc func showRewarded(_ call: CAPPluginCall) {
        onMain { [weak self] in
            self?.showRewardedOnMain(call)
        }
    }

    @objc func showPrivacyOptions(_ call: CAPPluginCall) {
        onMain { [weak self] in
            self?.showPrivacyOptionsOnMain(call)
        }
    }

    private func initializeOnMain(_ call: CAPPluginCall) {
        guard let sdkKey = call.getString("sdkKey"), !sdkKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            log("initialize skipped; missing SDK key")
            call.resolve(["initialized": false])
            return
        }

        if initialized {
            call.resolve(["initialized": true])
            return
        }

        pendingInitializeCalls.append(call)
        if initializationInFlight {
            return
        }

        initializationInFlight = true
        let verboseLogging = call.getBool("verboseLogging") ?? false
        let adUnitIdentifiers = compactAdUnitIdentifiers(call.getObject("adUnitIds") ?? [:])

        let privacy = call.getObject("privacy") ?? [:]
        guard privacy["generalAudienceOnly"] as? Bool == true else {
            log("initialize skipped; AppLovin general-audience gate is not enabled")
            resolveInitializeCalls(initialized: false)
            initializationInFlight = false
            return
        }

        let consentFlow = call.getObject("consentFlow") ?? [:]
        let consentFlowEnabled = consentFlow["enabled"] as? Bool ?? false
        let hasUserConsent = privacy["hasUserConsent"] as? Bool ?? false
        let doNotSell = privacy["doNotSell"] as? Bool ?? true
        if !consentFlowEnabled {
            ALPrivacySettings.setHasUserConsent(hasUserConsent)
        }
        ALPrivacySettings.setDoNotSell(doNotSell)
        if !configureConsentFlow(consentFlow) {
            resolveInitializeCalls(initialized: false)
            initializationInFlight = false
            return
        }
        ALSdk.shared().settings.isVerboseLoggingEnabled = verboseLogging
        let initConfig = ALSdkInitializationConfiguration(sdkKey: sdkKey) { builder in
            builder.mediationProvider = ALMediationProviderMAX
            if !adUnitIdentifiers.isEmpty {
                builder.adUnitIdentifiers = adUnitIdentifiers
            }
        }

        log("initializing MAX SDK units=\(adUnitIdentifiers.count) verbose=\(verboseLogging) consentFlow=\(consentFlowEnabled) hasUserConsent=\(hasUserConsent) doNotSell=\(doNotSell)")
        ALSdk.shared().initialize(with: initConfig) { [weak self] _ in
            guard let self else { return }
            self.initialized = true
            self.initializationInFlight = false
            self.log("MAX SDK initialized")
            self.resolveInitializeCalls(initialized: true)
        }
    }

    private func showBannerOnMain(_ call: CAPPluginCall) {
        guard initialized else {
            log("banner skipped; SDK not initialized")
            call.resolve(["shown": false])
            return
        }
        guard let adUnitId = requiredAdUnitId(call) else {
            call.resolve(["shown": false])
            return
        }
        if let bannerAdView {
            guard bannerAdUnitId == adUnitId else {
                log("banner skipped; persistent view already owns another ad unit")
                call.resolve(["shown": false])
                return
            }

            bannerRequestedVisible = true
            bannerAdView.isHidden = !bannerDisplayable
            call.resolve(["shown": bannerDisplayable])
            return
        }

        guard let container = bridge?.viewController?.view else {
            log("banner skipped; bridge view unavailable")
            call.resolve(["shown": false])
            return
        }

        let adView = MAAdView(adUnitIdentifier: adUnitId)
        adView.delegate = self
        adView.revenueDelegate = self
        adView.backgroundColor = UIColor.clear
        adView.isHidden = true

        let bannerHeight: CGFloat = UIDevice.current.userInterfaceIdiom == .pad ? 90 : 50
        let width = container.bounds.width
        let y = container.bounds.height - bannerHeight - container.safeAreaInsets.bottom
        adView.frame = CGRect(x: 0, y: y, width: width, height: bannerHeight)
        adView.autoresizingMask = [.flexibleWidth, .flexibleTopMargin]

        container.addSubview(adView)
        bannerAdView = adView
        bannerAdUnitId = adUnitId
        bannerDisplayable = false
        bannerRequestedVisible = true
        pendingBannerShowCall = call
        log("persistent banner created unit=\(redacted(adUnitId))")
        adView.loadAd()
    }

    private func hideBannerOnMain(_ call: CAPPluginCall) {
        bannerRequestedVisible = false
        bannerAdView?.isHidden = true
        pendingBannerShowCall?.resolve(["shown": false])
        pendingBannerShowCall = nil
        log("banner hidden")
        call.resolve()
    }

    private func showPrivacyOptionsOnMain(_ call: CAPPluginCall) {
        guard initialized else {
            log("privacy options skipped; SDK not initialized")
            call.resolve(["shown": false])
            return
        }
        ALSdk.shared().cmpService.showCMPForExistingUser { [weak self] error in
            if let error {
                self?.log("privacy options failed: code=\(error.code.rawValue) message=\(error.message)")
                call.resolve(["shown": false])
                return
            }
            self?.log("privacy options shown")
            call.resolve(["shown": true])
        }
    }

    private func preloadInterstitialOnMain(_ call: CAPPluginCall) {
        guard initialized else {
            call.resolve(["loaded": false])
            return
        }
        guard let adUnitId = requiredAdUnitId(call) else {
            call.resolve(["loaded": false])
            return
        }

        ensureInterstitial(adUnitId: adUnitId)
        if interstitialAd?.isReady == true || interstitialLoaded {
            call.resolve(["loaded": true])
            return
        }

        pendingInterstitialLoadCalls.append(call)
        if interstitialLoading {
            return
        }

        interstitialLoading = true
        log("interstitial load requested unit=\(redacted(adUnitId))")
        interstitialAd?.load()
    }

    private func showInterstitialOnMain(_ call: CAPPluginCall) {
        guard initialized else {
            call.resolve(["shown": false])
            return
        }
        guard let adUnitId = requiredAdUnitId(call) else {
            call.resolve(["shown": false])
            return
        }

        ensureInterstitial(adUnitId: adUnitId)
        guard pendingInterstitialShowCall == nil else {
            call.resolve(["shown": false])
            return
        }
        guard let interstitialAd, interstitialAd.isReady else {
            log("interstitial not ready; starting preload")
            interstitialAd?.load()
            call.resolve(["shown": false])
            return
        }

        pendingInterstitialShowCall = call
        let placement = call.getString("placement")?.trimmingCharacters(in: .whitespacesAndNewlines)
        log("interstitial showing unit=\(redacted(adUnitId)) placement=\(placement ?? "none")")
        if let placement, !placement.isEmpty {
            interstitialAd.show(forPlacement: placement)
        } else {
            interstitialAd.show()
        }
    }

    private func preloadRewardedOnMain(_ call: CAPPluginCall) {
        guard initialized else {
            call.resolve(["loaded": false])
            return
        }
        guard let adUnitId = requiredAdUnitId(call) else {
            call.resolve(["loaded": false])
            return
        }

        ensureRewarded(adUnitId: adUnitId)
        if rewardedAd?.isReady == true || rewardedLoaded {
            call.resolve(["loaded": true])
            return
        }

        pendingRewardedLoadCalls.append(call)
        if rewardedLoading {
            return
        }

        rewardedLoading = true
        log("rewarded load requested unit=\(redacted(adUnitId))")
        rewardedAd?.load()
    }

    private func showRewardedOnMain(_ call: CAPPluginCall) {
        guard initialized else {
            call.resolve(["granted": false])
            return
        }
        guard let adUnitId = requiredAdUnitId(call) else {
            call.resolve(["granted": false])
            return
        }

        ensureRewarded(adUnitId: adUnitId)
        guard pendingRewardedShowCall == nil else {
            call.resolve(["granted": false])
            return
        }
        guard let rewardedAd, rewardedAd.isReady else {
            log("rewarded not ready; starting preload")
            rewardedAd?.load()
            call.resolve(["granted": false])
            return
        }

        pendingRewardedShowCall = call
        rewardedGranted = false
        let placement = call.getString("placement")?.trimmingCharacters(in: .whitespacesAndNewlines)
        log("rewarded showing unit=\(redacted(adUnitId)) placement=\(placement ?? "none")")
        if let placement, !placement.isEmpty {
            rewardedAd.show(forPlacement: placement)
        } else {
            rewardedAd.show()
        }
    }

    public func didLoad(_ ad: MAAd) {
        if ad.adUnitIdentifier == interstitialAdUnitId {
            interstitialLoaded = true
            interstitialLoading = false
            log("interstitial loaded unit=\(redacted(ad.adUnitIdentifier))")
            resolveInterstitialLoadCalls(loaded: true)
            return
        }

        if ad.adUnitIdentifier == rewardedAdUnitId {
            rewardedLoaded = true
            rewardedLoading = false
            log("rewarded loaded unit=\(redacted(ad.adUnitIdentifier))")
            resolveRewardedLoadCalls(loaded: true)
            return
        }

        if ad.adUnitIdentifier == bannerAdUnitId {
            bannerDisplayable = true
            bannerAdView?.isHidden = !bannerRequestedVisible
            log("banner loaded unit=\(redacted(ad.adUnitIdentifier))")
            pendingBannerShowCall?.resolve(["shown": bannerRequestedVisible])
            pendingBannerShowCall = nil
        }
    }

    public func didFailToLoadAd(forAdUnitIdentifier adUnitIdentifier: String, withError error: MAError) {
        if adUnitIdentifier == interstitialAdUnitId {
            interstitialLoaded = false
            interstitialLoading = false
            log("interstitial load failed unit=\(redacted(adUnitIdentifier)) error=\(error)")
            resolveInterstitialLoadCalls(loaded: false)
        }

        if adUnitIdentifier == rewardedAdUnitId {
            rewardedLoaded = false
            rewardedLoading = false
            log("rewarded load failed unit=\(redacted(adUnitIdentifier)) error=\(error)")
            resolveRewardedLoadCalls(loaded: false)
        }

        if adUnitIdentifier == bannerAdUnitId {
            bannerDisplayable = false
            bannerAdView?.isHidden = true
            log("banner load failed unit=\(redacted(adUnitIdentifier)) error=\(error)")
            pendingBannerShowCall?.resolve(["shown": false])
            pendingBannerShowCall = nil
        }
    }

    public func didDisplay(_ ad: MAAd) {
        log("ad displayed unit=\(redacted(ad.adUnitIdentifier))")
    }

    public func didClick(_ ad: MAAd) {
        log("ad clicked unit=\(redacted(ad.adUnitIdentifier))")
    }

    public func didHide(_ ad: MAAd) {
        if ad.adUnitIdentifier == interstitialAdUnitId {
            pendingInterstitialShowCall?.resolve(["shown": true])
            pendingInterstitialShowCall = nil
            interstitialLoaded = false
            interstitialAd?.load()
            log("interstitial hidden unit=\(redacted(ad.adUnitIdentifier))")
            return
        }

        if ad.adUnitIdentifier == rewardedAdUnitId {
            pendingRewardedShowCall?.resolve(["granted": rewardedGranted])
            pendingRewardedShowCall = nil
            rewardedLoaded = false
            rewardedAd?.load()
            log("rewarded hidden unit=\(redacted(ad.adUnitIdentifier)) granted=\(rewardedGranted)")
        }
    }

    public func didFail(toDisplay ad: MAAd, withError error: MAError) {
        if ad.adUnitIdentifier == interstitialAdUnitId {
            pendingInterstitialShowCall?.resolve(["shown": false])
            pendingInterstitialShowCall = nil
            interstitialLoaded = false
            interstitialAd?.load()
            log("interstitial display failed unit=\(redacted(ad.adUnitIdentifier)) error=\(error)")
            return
        }

        if ad.adUnitIdentifier == rewardedAdUnitId {
            pendingRewardedShowCall?.resolve(["granted": false])
            pendingRewardedShowCall = nil
            rewardedLoaded = false
            rewardedAd?.load()
            log("rewarded display failed unit=\(redacted(ad.adUnitIdentifier)) error=\(error)")
        }
    }

    public func didRewardUser(for ad: MAAd, with reward: MAReward) {
        if ad.adUnitIdentifier == rewardedAdUnitId {
            rewardedGranted = true
            log("rewarded callback unit=\(redacted(ad.adUnitIdentifier)) amount=\(reward.amount) label=\(reward.label)")
        }
    }

    public func didPayRevenue(for ad: MAAd) {
        notifyListeners("adRevenuePaid", data: [
            "ad_type": adType(for: ad),
            "placement": nonEmpty(ad.placement) ?? defaultPlacement(for: ad),
            "revenue_usd": ad.revenue,
            "currency": "USD",
            "precision": nonEmpty(ad.revenuePrecision) ?? "unknown",
            "network_name": nonEmpty(ad.networkName) ?? "unknown",
            "ad_unit_id": ad.adUnitIdentifier,
        ])
    }

    public func didExpand(_ ad: MAAd) {
        log("banner expanded unit=\(redacted(ad.adUnitIdentifier))")
    }

    public func didCollapse(_ ad: MAAd) {
        log("banner collapsed unit=\(redacted(ad.adUnitIdentifier))")
    }

    private func ensureInterstitial(adUnitId: String) {
        if interstitialAd != nil, interstitialAdUnitId == adUnitId {
            return
        }

        interstitialAd = MAInterstitialAd(adUnitIdentifier: adUnitId)
        interstitialAd?.delegate = self
        interstitialAd?.revenueDelegate = self
        interstitialAdUnitId = adUnitId
        interstitialLoaded = false
        interstitialLoading = false
    }

    private func ensureRewarded(adUnitId: String) {
        if rewardedAd != nil, rewardedAdUnitId == adUnitId {
            return
        }

        rewardedAd = MARewardedAd.shared(withAdUnitIdentifier: adUnitId)
        rewardedAd?.delegate = self
        rewardedAd?.revenueDelegate = self
        rewardedAdUnitId = adUnitId
        rewardedLoaded = false
        rewardedLoading = false
    }

    private func resolveInitializeCalls(initialized: Bool) {
        let calls = pendingInitializeCalls
        pendingInitializeCalls = []
        calls.forEach { $0.resolve(["initialized": initialized]) }
    }

    private func resolveInterstitialLoadCalls(loaded: Bool) {
        let calls = pendingInterstitialLoadCalls
        pendingInterstitialLoadCalls = []
        calls.forEach { $0.resolve(["loaded": loaded]) }
    }

    private func resolveRewardedLoadCalls(loaded: Bool) {
        let calls = pendingRewardedLoadCalls
        pendingRewardedLoadCalls = []
        calls.forEach { $0.resolve(["loaded": loaded]) }
    }

    private func requiredAdUnitId(_ call: CAPPluginCall) -> String? {
        guard let rawValue = call.getString("adUnitId") else {
            log("ad call skipped; missing adUnitId")
            return nil
        }

        guard let adUnitId = nonEmpty(rawValue) else {
            log("ad call skipped; blank adUnitId")
            return nil
        }
        return adUnitId
    }

    private func configureConsentFlow(_ consentFlow: JSObject) -> Bool {
        let enabled = consentFlow["enabled"] as? Bool ?? false
        let settings = ALSdk.shared().settings.termsAndPrivacyPolicyFlowSettings
        settings.isEnabled = enabled
        guard enabled else {
            return true
        }

        guard let privacyPolicyURL = urlValue(consentFlow["privacyPolicyUrl"] as? String) else {
            log("initialize skipped; consent flow requires privacyPolicyUrl")
            return false
        }
        settings.privacyPolicyURL = privacyPolicyURL
        if let termsOfServiceURL = urlValue(consentFlow["termsOfServiceUrl"] as? String) {
            settings.termsOfServiceURL = termsOfServiceURL
        }
        settings.shouldShowTermsAndPrivacyPolicyAlertInGDPR = consentFlow["showTermsAndPrivacyPolicyAlertInGdpr"] as? Bool ?? true
        return true
    }

    private func urlValue(_ value: String?) -> URL? {
        guard let value = nonEmpty(value) else { return nil }
        return URL(string: value)
    }

    private func compactAdUnitIdentifiers(_ adUnitIds: JSObject) -> [String] {
        return ["banner", "interstitial", "rewarded"].compactMap { key in
            guard let value = adUnitIds[key] as? String else {
                return nil
            }
            return nonEmpty(value)
        }
    }

    private func adType(for ad: MAAd) -> String {
        if ad.adUnitIdentifier == bannerAdUnitId {
            return "banner"
        }
        if ad.adUnitIdentifier == interstitialAdUnitId {
            return "interstitial"
        }
        if ad.adUnitIdentifier == rewardedAdUnitId {
            return "rewarded"
        }
        return "unknown"
    }

    private func defaultPlacement(for ad: MAAd) -> String {
        switch adType(for: ad) {
        case "banner":
            return "gameplay"
        case "interstitial":
            return "level_break"
        case "rewarded":
            return "economy_reward"
        default:
            return "unknown"
        }
    }

    private func nonEmpty(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
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
        NSLog("[ads:applovin] \(message)")
    }
}
