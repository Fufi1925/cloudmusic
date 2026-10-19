#!/usr/bin/env bash
# Baut die CloudMusic-Android-APK aus diesem Repository.
# Voraussetzungen: Node 20+, pnpm 10, JDK 17+ (21 empfohlen), Android SDK (platform 35, build-tools 35)
#   ANDROID_HOME muss gesetzt sein (oder android/local.properties mit sdk.dir=...).
# Aufruf:  android/build.sh                 -> signierte Release-APK (mit android/keystore.properties)
#          android/build.sh assembleDebug   -> Debug-APK (WebView per chrome://inspect debugbar)
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --frozen-lockfile
fi

node android/scripts/build-web.mjs

cd android
if [ -z "${ANDROID_HOME:-}" ] && [ ! -f local.properties ]; then
  echo "ANDROID_HOME ist nicht gesetzt und android/local.properties fehlt" >&2
  exit 1
fi
./gradlew "${1:-assembleRelease}"

echo
find app/build/outputs/apk -name "*.apk" -newer ../package.json -print
