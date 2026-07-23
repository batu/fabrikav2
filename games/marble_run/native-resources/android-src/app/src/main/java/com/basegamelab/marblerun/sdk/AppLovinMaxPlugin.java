package com.basegamelab.marblerun.sdk;

import android.app.Activity;
import android.view.Gravity;
import android.widget.FrameLayout;
import com.applovin.mediation.MaxAd;
import com.applovin.mediation.MaxAdListener;
import com.applovin.mediation.MaxAdRevenueListener;
import com.applovin.mediation.MaxAdViewAdListener;
import com.applovin.mediation.MaxError;
import com.applovin.mediation.MaxReward;
import com.applovin.mediation.MaxRewardedAdListener;
import com.applovin.mediation.ads.MaxAdView;
import com.applovin.mediation.ads.MaxInterstitialAd;
import com.applovin.mediation.ads.MaxRewardedAd;
import com.applovin.sdk.AppLovinSdk;
import com.applovin.sdk.AppLovinSdkInitializationConfiguration;
import com.applovin.sdk.AppLovinSdkSettings;
import com.applovin.sdk.AppLovinTermsAndPrivacyPolicyFlowSettings;
import com.applovin.sdk.AppLovinPrivacySettings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.net.Uri;

/**
 * Android mirror of the iOS AppLovinMaxPlugin: same JS contract
 * (initialize / banner / interstitial / rewarded / privacy options +
 * 'adRevenuePaid' events), resolve-not-reject on every path.
 */
@CapacitorPlugin(name = "AppLovinMax")
public class AppLovinMaxPlugin extends Plugin {

    private boolean initialized = false;
    private MaxAdView bannerAdView = null;
    private MaxInterstitialAd interstitialAd = null;
    private boolean interstitialLoaded = false;
    private MaxRewardedAd rewardedAd = null;
    private boolean rewardedLoaded = false;

    @PluginMethod
    public void initialize(PluginCall call) {
        String sdkKey = trimmed(call.getString("sdkKey"));
        if (sdkKey == null) {
            resolve(call, "initialized", false);
            return;
        }
        if (initialized) {
            resolve(call, "initialized", true);
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            resolve(call, "initialized", false);
            return;
        }
        JSObject privacy = call.getObject("privacy", new JSObject());
        JSObject consentFlow = call.getObject("consentFlow", new JSObject());
        activity.runOnUiThread(() -> {
            AppLovinSdkInitializationConfiguration.Builder builder =
                AppLovinSdkInitializationConfiguration.builder(sdkKey, activity.getApplicationContext());
            builder.setMediationProvider(com.applovin.sdk.AppLovinMediationProvider.MAX);
            AppLovinSdk sdk = AppLovinSdk.getInstance(activity.getApplicationContext());
            AppLovinSdkSettings settings = sdk.getSettings();
            settings.setVerboseLogging(Boolean.TRUE.equals(call.getBoolean("verboseLogging", false)));
            AppLovinTermsAndPrivacyPolicyFlowSettings flowSettings = settings.getTermsAndPrivacyPolicyFlowSettings();
            String privacyPolicyUrl = trimmed(consentFlow.optString("privacyPolicyUrl", ""));
            String termsOfServiceUrl = trimmed(consentFlow.optString("termsOfServiceUrl", ""));
            // Fail-safe: the SDK shows a blocking debug error dialog if the
            // consent flow is enabled without a privacy policy URL. A missing
            // URL therefore disables the flow instead of enabling it broken.
            boolean flowEnabled = Boolean.TRUE.equals(consentFlow.optBoolean("enabled", true)) && privacyPolicyUrl != null;
            flowSettings.setEnabled(flowEnabled);
            if (privacyPolicyUrl != null) flowSettings.setPrivacyPolicyUri(Uri.parse(privacyPolicyUrl));
            if (termsOfServiceUrl != null) flowSettings.setTermsOfServiceUri(Uri.parse(termsOfServiceUrl));
            AppLovinPrivacySettings.setHasUserConsent(
                Boolean.TRUE.equals(privacy.optBoolean("hasUserConsent", false)), activity.getApplicationContext());
            AppLovinPrivacySettings.setDoNotSell(
                Boolean.TRUE.equals(privacy.optBoolean("doNotSell", true)), activity.getApplicationContext());
            sdk.initialize(builder.build(), config -> {
                initialized = true;
                resolve(call, "initialized", true);
            });
        });
    }

    @PluginMethod
    public void showBanner(PluginCall call) {
        String adUnitId = trimmed(call.getString("adUnitId"));
        Activity activity = getActivity();
        if (!initialized || adUnitId == null || activity == null) {
            resolve(call, "shown", false);
            return;
        }
        activity.runOnUiThread(() -> {
            if (bannerAdView != null) {
                bannerAdView.setVisibility(android.view.View.VISIBLE);
                bannerAdView.startAutoRefresh();
                resolve(call, "shown", true);
                return;
            }
            MaxAdView adView = new MaxAdView(adUnitId);
            adView.setListener(new MaxAdViewAdListener() {
                private boolean resolved = false;

                @Override public void onAdLoaded(MaxAd ad) {
                    if (!resolved) { resolved = true; resolve(call, "shown", true); }
                }
                @Override public void onAdLoadFailed(String adUnitIdValue, MaxError error) {
                    if (!resolved) { resolved = true; resolve(call, "shown", false); }
                }
                @Override public void onAdDisplayed(MaxAd ad) {}
                @Override public void onAdHidden(MaxAd ad) {}
                @Override public void onAdClicked(MaxAd ad) {}
                @Override public void onAdDisplayFailed(MaxAd ad, MaxError error) {}
                @Override public void onAdExpanded(MaxAd ad) {}
                @Override public void onAdCollapsed(MaxAd ad) {}
            });
            adView.setRevenueListener(revenueListener("banner"));
            int heightPx = activity.getResources().getDimensionPixelSize(
                activity.getResources().getIdentifier("banner_height", "dimen", activity.getPackageName()) != 0
                    ? activity.getResources().getIdentifier("banner_height", "dimen", activity.getPackageName())
                    : android.R.dimen.thumbnail_height);
            FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, heightPx, Gravity.BOTTOM);
            activity.addContentView(adView, params);
            bannerAdView = adView;
            adView.loadAd();
        });
    }

    @PluginMethod
    public void hideBanner(PluginCall call) {
        Activity activity = getActivity();
        if (bannerAdView == null || activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            bannerAdView.stopAutoRefresh();
            bannerAdView.setVisibility(android.view.View.GONE);
            call.resolve();
        });
    }

    @PluginMethod
    public void preloadInterstitial(PluginCall call) {
        String adUnitId = trimmed(call.getString("adUnitId"));
        Activity activity = getActivity();
        if (!initialized || adUnitId == null || activity == null) {
            resolve(call, "loaded", false);
            return;
        }
        activity.runOnUiThread(() -> {
            if (interstitialAd == null) {
                interstitialAd = new MaxInterstitialAd(adUnitId);
                interstitialAd.setRevenueListener(revenueListener("interstitial"));
            }
            interstitialAd.setListener(new MaxAdListener() {
                private boolean resolved = false;

                @Override public void onAdLoaded(MaxAd ad) {
                    interstitialLoaded = true;
                    if (!resolved) { resolved = true; resolve(call, "loaded", true); }
                }
                @Override public void onAdLoadFailed(String adUnitIdValue, MaxError error) {
                    interstitialLoaded = false;
                    if (!resolved) { resolved = true; resolve(call, "loaded", false); }
                }
                @Override public void onAdDisplayed(MaxAd ad) {}
                @Override public void onAdHidden(MaxAd ad) {}
                @Override public void onAdClicked(MaxAd ad) {}
                @Override public void onAdDisplayFailed(MaxAd ad, MaxError error) {}
            });
            interstitialAd.loadAd();
        });
    }

    @PluginMethod
    public void showInterstitial(PluginCall call) {
        Activity activity = getActivity();
        if (!initialized || interstitialAd == null || !interstitialLoaded || activity == null) {
            resolve(call, "shown", false);
            return;
        }
        activity.runOnUiThread(() -> {
            interstitialAd.setListener(new MaxAdListener() {
                private boolean resolved = false;

                @Override public void onAdLoaded(MaxAd ad) {}
                @Override public void onAdLoadFailed(String adUnitIdValue, MaxError error) {}
                @Override public void onAdDisplayed(MaxAd ad) {}
                @Override public void onAdHidden(MaxAd ad) {
                    interstitialLoaded = false;
                    if (!resolved) { resolved = true; resolve(call, "shown", true); }
                }
                @Override public void onAdClicked(MaxAd ad) {}
                @Override public void onAdDisplayFailed(MaxAd ad, MaxError error) {
                    interstitialLoaded = false;
                    if (!resolved) { resolved = true; resolve(call, "shown", false); }
                }
            });
            interstitialAd.showAd(call.getString("placement"));
        });
    }

    @PluginMethod
    public void preloadRewarded(PluginCall call) {
        String adUnitId = trimmed(call.getString("adUnitId"));
        Activity activity = getActivity();
        if (!initialized || adUnitId == null || activity == null) {
            resolve(call, "loaded", false);
            return;
        }
        activity.runOnUiThread(() -> {
            if (rewardedAd == null) {
                rewardedAd = MaxRewardedAd.getInstance(adUnitId, activity);
                rewardedAd.setRevenueListener(revenueListener("rewarded"));
            }
            rewardedAd.setListener(new MaxRewardedAdListener() {
                private boolean resolved = false;

                @Override public void onAdLoaded(MaxAd ad) {
                    rewardedLoaded = true;
                    if (!resolved) { resolved = true; resolve(call, "loaded", true); }
                }
                @Override public void onAdLoadFailed(String adUnitIdValue, MaxError error) {
                    rewardedLoaded = false;
                    if (!resolved) { resolved = true; resolve(call, "loaded", false); }
                }
                @Override public void onAdDisplayed(MaxAd ad) {}
                @Override public void onAdHidden(MaxAd ad) {}
                @Override public void onAdClicked(MaxAd ad) {}
                @Override public void onAdDisplayFailed(MaxAd ad, MaxError error) {}
                @Override public void onUserRewarded(MaxAd ad, MaxReward reward) {}
            });
            rewardedAd.loadAd();
        });
    }

    @PluginMethod
    public void showRewarded(PluginCall call) {
        Activity activity = getActivity();
        if (!initialized || rewardedAd == null || !rewardedLoaded || activity == null) {
            resolve(call, "granted", false);
            return;
        }
        activity.runOnUiThread(() -> {
            rewardedAd.setListener(new MaxRewardedAdListener() {
                private boolean granted = false;
                private boolean resolved = false;

                @Override public void onAdLoaded(MaxAd ad) {}
                @Override public void onAdLoadFailed(String adUnitIdValue, MaxError error) {}
                @Override public void onAdDisplayed(MaxAd ad) {}
                @Override public void onAdHidden(MaxAd ad) {
                    rewardedLoaded = false;
                    if (!resolved) { resolved = true; resolve(call, "granted", granted); }
                }
                @Override public void onAdClicked(MaxAd ad) {}
                @Override public void onAdDisplayFailed(MaxAd ad, MaxError error) {
                    rewardedLoaded = false;
                    if (!resolved) { resolved = true; resolve(call, "granted", false); }
                }
                @Override public void onUserRewarded(MaxAd ad, MaxReward reward) {
                    granted = true;
                }
            });
            rewardedAd.showAd(call.getString("placement"));
        });
    }

    @PluginMethod
    public void showPrivacyOptions(PluginCall call) {
        Activity activity = getActivity();
        if (!initialized || activity == null) {
            resolve(call, "shown", false);
            return;
        }
        activity.runOnUiThread(() ->
            AppLovinSdk.getInstance(activity.getApplicationContext()).getCmpService().showCmpForExistingUser(
                activity,
                error -> resolve(call, "shown", error == null)));
    }

    private MaxAdRevenueListener revenueListener(String adType) {
        return ad -> {
            JSObject event = new JSObject();
            event.put("ad_type", adType);
            event.put("placement", ad.getPlacement() != null ? ad.getPlacement() : "");
            event.put("revenue_usd", ad.getRevenue());
            event.put("currency", "USD");
            event.put("precision", ad.getRevenuePrecision());
            event.put("network_name", ad.getNetworkName());
            event.put("ad_unit_id", ad.getAdUnitId());
            notifyListeners("adRevenuePaid", event);
        };
    }

    private static void resolve(PluginCall call, String key, boolean value) {
        JSObject result = new JSObject();
        result.put(key, value);
        call.resolve(result);
    }

    private static String trimmed(String value) {
        if (value == null) return null;
        String out = value.trim();
        return out.isEmpty() ? null : out;
    }
}
