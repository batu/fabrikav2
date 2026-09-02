package com.basegamelab.findthedog;

import android.os.Bundle;
import com.basegamelab.findthedog.sdk.AppsFlyerAttributionPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppsFlyerAttributionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
