package com.multiplustv.premium;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Rational;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

public class MainActivity extends Activity {
    private FrameLayout root;
    private WebView webView;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WindowManager.LayoutParams startupLp = getWindow().getAttributes();
        startupLp.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
        getWindow().setAttributes(startupLp);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        enterImmersiveMode();

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setDatabaseEnabled(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);

        webView.setBackgroundColor(Color.BLACK);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                view.loadUrl(request.getUrl().toString());
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                root.addView(customView, new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT));
                webView.setVisibility(View.GONE);
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                enterImmersiveMode();
            }

            @Override
            public void onHideCustomView() {
                hideCustomView();
            }
        });

        webView.loadUrl("file:///android_asset/index.html");
    }

    private void hideCustomView() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        webView.setVisibility(View.VISIBLE);
        if (customViewCallback != null) customViewCallback.onCustomViewHidden();
        customViewCallback = null;
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        enterImmersiveMode();
    }

    private void enterImmersiveMode() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        );
    }

    private void enterPipMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                PictureInPictureParams params = new PictureInPictureParams.Builder()
                        .setAspectRatio(new Rational(16, 9))
                        .build();
                enterPictureInPictureMode(params);
            } catch (Exception ignored) {
            }
        }
    }

    public class AndroidBridge {

        @JavascriptInterface
        public String getDeviceId() {
            try {
                String id = Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);
                return id == null ? "unknown" : id;
            } catch (Exception e) {
                return "unknown";
            }
        }

        @JavascriptInterface
        public void enterFullscreen() {
            runOnUiThread(() -> {
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                enterImmersiveMode();
            });
        }

        @JavascriptInterface
        public void exitFullscreen() {
            runOnUiThread(() -> {
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                enterImmersiveMode();
            });
        }

        @JavascriptInterface
        public void enterMiniPlayer() {
            runOnUiThread(() -> enterPipMode());
        }

        @JavascriptInterface
        public void setBrightness(double value) {
            final float brightness = (float) Math.max(0.01f, Math.min(1.0f, value));
            runOnUiThread(() -> {
                WindowManager.LayoutParams lp = getWindow().getAttributes();
                lp.screenBrightness = brightness;
                getWindow().setAttributes(lp);
            });
        }
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        enterPipMode();
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        if (!isInPictureInPictureMode) {
            enterImmersiveMode();
        }
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {
            hideCustomView();
            return;
        }
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        if (customView == null) {
            lp.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
            getWindow().setAttributes(lp);
        }
        enterImmersiveMode();
    }
}
