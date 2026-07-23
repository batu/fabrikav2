package com.basegamelab.marblerun.sdk;

import android.os.Bundle;
import com.facebook.FacebookSdk;
import com.facebook.appevents.AppEventsLogger;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Iterator;
import org.json.JSONObject;

@CapacitorPlugin(name = "MetaEvents")
public class MetaEventsPlugin extends Plugin {

    private boolean initialized = false;
    private String activeAppId = null;
    private AppEventsLogger logger = null;

    @PluginMethod
    public void initialize(PluginCall call) {
        String appId = trimmed(call.getString("appId"));
        String clientToken = trimmed(call.getString("clientToken"));
        if (appId == null || clientToken == null) {
            resolveInitialized(call, false);
            return;
        }
        if (initialized) {
            resolveInitialized(call, true);
            return;
        }
        // Programmatic configuration keeps the FB identity in env config rather
        // than the manifest, so a config-less build ships zero Facebook identity.
        FacebookSdk.setApplicationId(appId);
        FacebookSdk.setClientToken(clientToken);
        FacebookSdk.setAutoLogAppEventsEnabled(Boolean.TRUE.equals(call.getBoolean("autoLogAppEvents", false)));
        FacebookSdk.setAdvertiserIDCollectionEnabled(Boolean.TRUE.equals(call.getBoolean("advertiserIdCollection", false)));
        FacebookSdk.sdkInitialize(getContext().getApplicationContext());
        logger = AppEventsLogger.newLogger(getContext().getApplicationContext());
        initialized = true;
        activeAppId = appId;
        resolveInitialized(call, true);
    }

    @PluginMethod
    public void logEvent(PluginCall call) {
        String eventName = trimmed(call.getString("eventName"));
        if (!initialized || logger == null || eventName == null) {
            JSObject result = new JSObject();
            result.put("logged", false);
            call.resolve(result);
            return;
        }
        Bundle parameters = new Bundle();
        JSONObject raw = call.getObject("parameters", new JSObject());
        Iterator<String> keys = raw.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            Object value = raw.opt(key);
            if (value instanceof String) {
                parameters.putString(key, capped((String) value));
            }
        }
        logger.logEvent(eventName, parameters);
        JSObject result = new JSObject();
        result.put("logged", true);
        call.resolve(result);
    }

    @PluginMethod
    public void setAdvertiserTrackingEnabled(PluginCall call) {
        // iOS-only concept (ATT); Android resolves initialized state as a no-op.
        resolveInitialized(call, initialized);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject status = new JSObject();
        status.put("initialized", initialized);
        if (activeAppId != null) {
            status.put("appId", activeAppId);
        } else {
            status.put("appId", JSObject.NULL);
        }
        call.resolve(status);
    }

    private static void resolveInitialized(PluginCall call, boolean value) {
        JSObject result = new JSObject();
        result.put("initialized", value);
        call.resolve(result);
    }

    private static String trimmed(String value) {
        if (value == null) return null;
        String out = value.trim();
        return out.isEmpty() ? null : out;
    }

    private static String capped(String value) {
        return value.length() <= 96 ? value : value.substring(0, 96);
    }
}
