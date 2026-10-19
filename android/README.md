# CloudMusic für Android

Android-Portierung der CloudMusic-Desktop-App (Electron) aus diesem Repository
(CloudMusic = privater, umbenannter Fork von *Liner*, siehe `../NOTICE.md`).
Der Renderer-Code unter `src/` wird **unverändert** verwendet; ersetzt wird nur
die Electron-Schicht (`electron/main.ts`, `electron/preload.ts` und Co.) durch
eine native Android-Schicht mit **derselben** `window.cloudMusicElectron`-Schnittstelle.

> Lizenz: Das Projekt ist "source-available" und nicht kommerziell. Ein lokaler
> Build ist für den **privaten, persönlichen Gebrauch** erlaubt. APKs dürfen
> nicht weitergegeben oder veröffentlicht werden (siehe `../LICENSE`).

## Aufbau

```
android/
├── web/                    JS-Seite der Brücke (ersetzt electron/preload.ts)
│   ├── index.ts            -> cloudmusic-android.js, läuft vor dem Renderer-Bundle
│   ├── api.ts              window.cloudMusicElectron (gleicher Vertrag wie preload.ts)
│   ├── ipc.ts              ipcRenderer-Ersatz (invoke/send/on)
│   ├── netPatch.ts         fetch()-Tunnel durch die native Schicht
│   ├── signer.ts           eingebetteter WASM-Request-Signer (Port von electron/crypto.ts)
│   ├── viewport.ts         Skalierung des Desktop-Layouts auf das Display
│   ├── platform.ts         Zurück-Taste, Zwischenablage, window.open
│   └── potokenWorker.ts    -> potoken-worker.js (Port von electron/potoken-preload.ts)
├── app/src/main/java/com/hkamori/cloudmusic/
│   ├── MainActivity.java   Fenster (createWindow), Systemleisten, Zurück-Taste, Dialoge
│   ├── CloudMusicBridge.java    alle ipcMain-Handler (gleiche Kanalnamen wie main.ts)
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
| `preload.ts` / `contextBridge` | `cloudmusic-android.js` + Java-Interface `CloudMusicAndroid` (gleiche Kanäle) |
| `webSecurity: false` (kein CORS) | jeder Cross-Origin-`fetch()` läuft durch einen same-origin-Tunnel (`/__cloudmusic_net__/…`) und wird nativ mit OkHttp ausgeführt; Bilder/Audio/Fonts werden nativ geproxyt und bekommen dieselben `Access-Control-Allow-*`-Header wie bei Electron |
| `onBeforeSendHeaders` (YouTube, googlevideo, Apple Music) | `ElectronHeaders.java`, identische Regeln inkl. `x-cloudmusic-user-agent`, pro Redirect-Hop |
| `--disable-http2` | OkHttp nur mit HTTP/1.1 |
| WASM-Signer im Main-Prozess | gleicher WASM-Signer in der WebView (asynchron instanziiert) |
| PO-Token: verstecktes Fenster auf youtube.com/robots.txt | versteckte WebView auf youtube.com/robots.txt, gleicher BotGuard-Code |
| macOS Touch Bar | Android-Mediensteuerung: Benachrichtigung, Sperrbildschirm, Bluetooth-/Kopfhörertasten, "Gefällt mir" |
| `backgroundThrottling: false`, `powerSaveBlocker` | Vordergrunddienst (mediaPlayback), Wake-/WLAN-Lock, Bildschirm bleibt beim Abspielen an (wie am Desktop) |
| Overlay-Fenster (always on top) | schwebendes Fenster über anderen Apps (Berechtigung "Über anderen Apps einblenden"), erscheint wie am Desktop beim Minimieren |
| `cloudmusic://`-Deeplinks | Intent-Filter für `cloudmusic://` |
| Minimieren / Maximieren / Schließen | App in den Hintergrund / Vollbild (Systemleisten aus) / App beenden |
| Speichern-Dialog für den Dump | Android-"Speichern unter"-Dialog (Storage Access Framework) |
| `net:diagnose` | DNS, TCP, TLS und Kontroll-Endpunkte nativ (Traceroute gibt es auf Android nicht) |
| Fenster-Icon nach Akzentfarbe | Icon in der App-Übersicht (Recents) |
| Discord Rich Presence über den lokalen Discord-IPC-Socket | **eigener Gateway-Client** (`wss://gateway.discord.gg`): Token wird in der App eingefügt, AES-256/GCM-verschlüsselt im Android-Keystore gespeichert und nur an Discord gesendet (`DiscordRpc.java`, `DiscordTokenStore.java`) |

Nicht übertragbar (die UI-Schalter bleiben, haben aber keine Wirkung):
- **Auto-Updater / OTA-Bundles** – liefern Desktop-Installer bzw. Electron-Bundles; in diesem Build komplett
  abgeschaltet (`UPDATES_ENABLED = false`), damit kein Original-Update die umbenannte App überschreibt.
  Der Knopf meldet "aktuell".
- **Globale Tastenkürzel** – gibt es systemweit nicht (In-App-Kürzel funktionieren mit Tastatur).

## Discord Rich Presence

Die Einstellungen → **Discord** funktionieren auf dem Handy anders als am Desktop: Android hat keinen
Discord-IPC-Socket, also meldet sich CloudMusic direkt an Discords Gateway an und setzt dort eine
Activity vom Typ *Hört gerade …* mit Cover, Künstler-Badge und Fortschrittsbalken.

1. In *Einstellungen → Discord* auf **Discord im Browser öffnen** tippen, dort anmelden.
2. Token holen: im Browser `F12` → *Application* → *Local Storage* → `https://discord.com` → Feld `token`.
3. Token in der App einfügen → **Speichern & verbinden**.

Das Token wird **ausschließlich lokal** gespeichert: AES-256/GCM-verschlüsselt, der Schlüssel liegt im
Android-Keystore (`cloudmusic_discord_token_v1`) und verlässt das Gerät nie. Das Klartext-Token existiert
nur im Arbeitsspeicher und wird nur an `gateway.discord.gg` gesendet. **Token löschen** entfernt Schlüsselblob
und Verbindung; die Einstellungen zeigen jederzeit den Status (verbunden als …).

> Hinweis: Das ist der inoffizielle Weg (Selfbot). Discord kann so etwas als Regelverstoß werten –
> Nutzung auf eigenes Risiko.

## Bedienung

- Handys: Hochformat (gesperrt), Layout automatisch kompakt (< 768 px). Tablets: jede Ausrichtung.
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

App-ID/Namespace: `com.hkamori.cloudmusic`, App-Name **CloudMusic**, Deeplink-Schema `cloudmusic://`.
Die Icons (adaptiv, monochrom für Themed Icons ab Android 13, Benachrichtigung) entstehen aus
`branding/cloudmusic-logo.svg` über `python3 branding/generate-icons.py`.
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
