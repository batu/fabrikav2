package com.basegamelab.findthedog.sdk;

import com.appsflyer.AppsFlyerLib;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import org.json.JSONObject;

@CapacitorPlugin(name = "AppsFlyerAttribution")
public class AppsFlyerAttributionPlugin extends Plugin {
    private boolean initialized = false;

    @PluginMethod
    public void initialize(PluginCall call) {
        String devKey = trimmed(call.getString("devKey"));
        if (devKey == null) { resolve(call, "initialized", false); return; }
        if (!initialized) {
            AppsFlyerLib lib = AppsFlyerLib.getInstance();
            lib.setDebugLog(Boolean.TRUE.equals(call.getBoolean("debugLogging", false)));
            lib.init(devKey, null, getContext().getApplicationContext());
            lib.start(getContext().getApplicationContext());
            initialized = true;
        }
        resolve(call, "initialized", true);
    }

    @PluginMethod
    public void trackEvent(PluginCall call) {
        String eventName = trimmed(call.getString("eventName"));
        if (!initialized || eventName == null) { resolve(call, "tracked", false); return; }
        Map<String, Object> values = new HashMap<>();
        JSONObject raw = call.getObject("eventValues", new JSObject());
        Iterator<String> keys = raw.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            Object value = raw.opt(key);
            if (value instanceof String) values.put(key, capped((String) value));
        }
        AppsFlyerLib.getInstance().logEvent(getContext().getApplicationContext(), eventName, values);
        resolve(call, "tracked", true);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject status = new JSObject();
        status.put("initialized", initialized);
        status.put("appsFlyerId", initialized ? AppsFlyerLib.getInstance().getAppsFlyerUID(getContext()) : JSObject.NULL);
        call.resolve(status);
    }

    private static void resolve(PluginCall call, String key, boolean value) { JSObject result = new JSObject(); result.put(key, value); call.resolve(result); }
    private static String trimmed(String value) { if (value == null) return null; String out = value.trim(); return out.isEmpty() ? null : out; }
    private static String capped(String value) { return value.length() <= 96 ? value : value.substring(0, 96); }
}
