# JavaScript bridges (LinerAndroid, LinerNet, LinerPoBridge) are called by name from the WebView
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.hkamori.liner.LinerBridge { *; }
-keep class com.hkamori.liner.net.NetProxy$Js { *; }
-keep class com.hkamori.liner.PoTokenService$PoBridge { *; }
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
