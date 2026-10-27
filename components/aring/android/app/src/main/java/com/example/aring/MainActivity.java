package com.example.aring;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AringNativePlugin.class);
        super.onCreate(savedInstanceState);
        AringJobs.schedule(this);
    }
    @Override public void onResume() {
        super.onResume();
        try { AringAlerts.reconcile(this); } catch (Exception ignored) { }
    }
}
