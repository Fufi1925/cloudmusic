# Liner für Android

Android-Portierung der Liner-Desktop-App (Electron) aus diesem Repository.
Der Renderer-Code unter `src/` wird **unverändert** verwendet; ersetzt wird nur
die Electron-Schicht (`electron/main.ts`, `electron/preload.ts` und Co.) durch
eine native Android-Schicht mit **derselben** `window.linerElectron`-Schnittstelle.

> Lizenz: Das Projekt ist "source-available" und nicht kommerziell. Ein lokaler
> Build ist für den **privaten, persönlichen Gebrauch** erlaubt. APKs dürfen
> nicht weitergegeben oder veröffentlicht werden (siehe `../LICENSE`).

## Aufbau

```
android/
├── web/                    JS-Seite der Brücke (ersetzt electron/preload.ts)
│   ├── index.ts            -> liner-android.js, läuft vor dem Renderer-Bundle
│   ├── api.ts              window.linerElectron (gleicher Vertrag wie preload.ts)
│   ├── ipc.ts              ipcRenderer-Ersatz (invoke/send/on)
│   ├── netPatch.ts         fetch()-Tunnel durch die native Schicht
│   ├── signer.ts           eingebetteter WASM-Request-Signer (Port von electron/crypto.ts)
│   ├── viewport.ts         Skalierung des Desktop-Layouts auf das Display
│   ├── platform.ts         Zurück-Taste, Zwischenablage, window.open
│   └── potokenWorker.ts    -> potoken-worker.js (Port von electron/potoken-preload.ts)
├── app/src/main/java/com/hkamori/liner/
│   ├── MainActivity.java   Fenster (createWindow), Systemleisten, Zurück-Taste, Dialoge
│   ├── LinerBridge.java    alle ipcMain-Handler (gleiche Kanalnamen wie main.ts)
│   ├── net/NetProxy.java   Ersatz für webSecurity:false + session.webRequest
│   ├── net/ElectronHeaders.java  1:1 die Origin/Referer/User-Agent-Regeln aus main.ts
│   ├── PoTokenService.java BotGuard in versteckter youtube.com-WebView (potoken.ts)
│   ├── PlaybackService.java Mediensteuerung/Benachrichtigung/Vordergrunddienst
│   ├── OverlayController.java schwebendes Mini-Player-Overlay (overlay.ts)
│   ├── NetDiag.java        Netzwerk-Diagnose für den Offline-Dump (net:diagnose)
│   └── CacheStats.java     Speicher-Statistik (storage:get-cache-stats)
├── scripts/build-web.mjs   baut Renderer + Brücke nach app/src/main/assets/www
├── test/                   Desktop-Testumgebung (Headless-Chromium + simulierte native Schicht)
└── build.sh                kompletter Build
```

## Electron → Android

| Electron (Desktop) | Android |
| --- | --- |
| `BrowserWindow` + `loadFile(dist/index.html)` | WebView, Renderer aus den APK-Assets über `https://appassets.androidplatform.net` |
| `preload.ts` / `contextBridge` | `liner-android.js` + Java-Interface `LinerAndroid` (gleiche Kanäle) |
| `webSecurity: false` (kein CORS) | jeder Cross-Origin-`fetch()` läuft durch einen same-origin-Tunnel (`/__liner_net__/…`) und wird nativ mit OkHttp ausgeführt; Bilder/Audio/Fonts werden nativ geproxyt und bekommen dieselben `Access-Control-Allow-*`-Header wie bei Electron |
| `onBeforeSendHeaders` (YouTube, googlevideo, Apple Music) | `ElectronHeaders.java`, identische Regeln inkl. `x-liner-user-agent`, pro Redirect-Hop |
| `--disable-http2` | OkHttp nur mit HTTP/1.1 |
| WASM-Signer im Main-Prozess | gleicher WASM-Signer in der WebView (asynchron instanziiert) |
| PO-Token: verstecktes Fenster auf youtube.com/robots.txt | versteckte WebView auf youtube.com/robots.txt, gleicher BotGuard-Code |
| macOS Touch Bar | Android-Mediensteuerung: Benachrichtigung, Sperrbildschirm, Bluetooth-/Kopfhörertasten, "Gefällt mir" |
| `backgroundThrottling: false`, `powerSaveBlocker` | Vordergrunddienst (mediaPlayback), Wake-/WLAN-Lock, Bildschirm bleibt beim Abspielen an (wie am Desktop) |
| Overlay-Fenster (always on top) | schwebendes Fenster über anderen Apps (Berechtigung "Über anderen Apps einblenden"), erscheint wie am Desktop beim Minimieren |
| `liner://`-Deeplinks | Intent-Filter für `liner://` |
| Minimieren / Maximieren / Schließen | App in den Hintergrund / Vollbild (Systemleisten aus) / App beenden |
| Speichern-Dialog für den Dump | Android-"Speichern unter"-Dialog (Storage Access Framework) |
| `net:diagnose` | DNS, TCP, TLS und Kontroll-Endpunkte nativ (Traceroute gibt es auf Android nicht) |
| Fenster-Icon nach Akzentfarbe | Icon in der App-Übersicht (Recents) |

Nicht übertragbar (die UI-Schalter bleiben, haben aber keine Wirkung):
- **Discord Rich Presence** – braucht den lokalen Discord-Desktop-IPC-Socket.
- **Auto-Updater / OTA-Bundles** – liefern Desktop-Installer bzw. Electron-Bundles; meldet "aktuell".
- **Globale Tastenkürzel** – gibt es systemweit nicht (In-App-Kürzel funktionieren mit Tastatur).

## Bedienung

- Handys: Querformat (das Desktop-Layout braucht ein breites Fenster). Tablets: jede Ausrichtung.
- **Mit zwei Fingern zoomen** ändert die Oberflächengröße (wird gespeichert).
- Die Zurück-Taste schließt zuerst Dialoge/Suche/Vollbild-Player (wie Escape), dann zurück, dann Hintergrund.
- Musik läuft im Hintergrund weiter; Steuerung über Benachrichtigung und Sperrbildschirm.
- Overlay: in den Einstellungen → Overlay aktivieren, Berechtigung erteilen, dann erscheint es beim Verlassen der App.

## Selbst bauen

Voraussetzungen: Node 20+, pnpm 10, JDK 17+ (21 empfohlen), Android SDK mit Platform 35.

```bash
android/build.sh               # Release-APK (signiert mit android/keystore.properties, falls vorhanden)
android/build.sh assembleDebug # Debug-APK, WebView über chrome://inspect debugbar
```

Ausgabe: `android/app/build/outputs/apk/{release,debug}/`.
Die Release-Signatur liegt in `android/keystore/` + `android/keystore.properties` –
gut aufheben: Updates lassen sich nur mit demselben Schlüssel über die installierte App installieren.

## Tests

```bash
cd android && ./gradlew testDebugUnitTest          # JVM-Unit-Tests der nativen Regeln
node android/test/build-harness.mjs                 # Testseiten bauen
node android/test/harness.mjs ui|player|playback|fetch|soundcloud
```

Die Harness startet den echten Renderer mit Handy-Emulation in Headless-Chromium,
`native-sim.mjs` spielt die Java-Schicht (Tunnel, Proxy, IPC, BotGuard-WebView) nach.
Geprüft wurden u. a.: Login-Request mit gültiger Signatur gegen api.tryliner.fun,
Wiedergabe über die echte Oberfläche (PO-Token → WEB_REMIX → googlevideo),
Fallback-Profile (VISIONOS/ANDROID_VR), SoundCloud-HLS, Web-Audio auf CORS-sauberem Audio
und die fetch()-Semantik (Redirects, Abbruch, Fehler, FormData).
