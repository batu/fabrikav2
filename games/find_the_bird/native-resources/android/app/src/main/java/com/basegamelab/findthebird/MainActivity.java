package com.basegamelab.findthebird;

import android.os.Bundle;
import com.basegamelab.findthebird.sdk.AppsFlyerAttributionPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppsFlyerAttributionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
