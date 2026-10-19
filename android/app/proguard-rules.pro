# JavaScript bridges (CloudMusicAndroid, CloudMusicNet, CloudMusicPoBridge) are called by name from the WebView
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.hkamori.cloudmusic.CloudMusicBridge { *; }
-keep class com.hkamori.cloudmusic.net.NetProxy$Js { *; }
-keep class com.hkamori.cloudmusic.PoTokenService$PoBridge { *; }
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
