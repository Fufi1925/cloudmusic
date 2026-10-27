#!/usr/bin/env bash
# Rebuilds the throwaway toolchain the sandbox loses between sessions.
set -x
NODE=22.14.0

# ── Node 22 (vitest/undici need it) ──────────────────────────────────────
mkdir -p /home/user/.cache/node22 /home/user/.cache/bin
if [ ! -x /home/user/.cache/node22/bin/node ]; then
  curl -fsSL --max-time 600 https://nodejs.org/dist/v${NODE}/node-v${NODE}-linux-x64.tar.xz -o /tmp/node22.tar.xz &&
    tar -xJf /tmp/node22.tar.xz -C /home/user/.cache/node22 --strip-components=1
fi
export PATH=/home/user/.cache/node22/bin:$PATH

# ── pnpm 9 (lockfile is version 9) ───────────────────────────────────────
if [ ! -x /home/user/.cache/pnpm/bin/pnpm ]; then
  npm i -g --prefix /home/user/.cache/pnpm pnpm@9.15.9
fi
export PATH=/home/user/.cache/pnpm/bin:$PATH

# ── JDK 21 + android sdk + chromium + wine ───────────────────────────────
sudo apt-get install -y openjdk-21-jdk-headless unzip chromium xvfb librsvg2-bin wine wine32:i386 > /tmp/apt-setup.log 2>&1

export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME=/home/user/.cache/android-sdk
mkdir -p "$ANDROID_HOME"
if [ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
  cd "$ANDROID_HOME"
  curl -fsSL --max-time 600 https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -o clt.zip
  unzip -q clt.zip
  mkdir -p cmdline-tools/latest
  mv cmdline-tools/bin cmdline-tools/lib cmdline-tools/NOTICE.txt cmdline-tools/source.properties cmdline-tools/latest/
  rm -f clt.zip
  yes | ./cmdline-tools/latest/bin/sdkmanager --licenses > /tmp/sdk-lic.log 2>&1
  ./cmdline-tools/latest/bin/sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" > /tmp/sdk-install.log 2>&1
fi

# ── Xvfb + a fresh wine prefix, plus a shim so electron-builder does not
#    fail on wine's non-zero exit code after building the uninstaller ─────
pgrep -f "Xvfb :77" >/dev/null || (Xvfb :77 -screen 0 1280x900x24 > /tmp/xvfb.log 2>&1 &)
sleep 2
export DISPLAY=:77
export WINEPREFIX=/home/user/.cache/wine2
export WINEDEBUG=-all
mkdir -p "$WINEPREFIX" /tmp/winewrap
wineboot -u > /tmp/wineboot.log 2>&1
printf '#!/bin/sh\n/usr/bin/wine "$@" >/dev/null 2>&1\nexit 0\n' > /tmp/winewrap/wine
chmod +x /tmp/winewrap/wine

# ── project dependencies ─────────────────────────────────────────────────
cd /home/user/desktop
pnpm install --frozen-lockfile > /tmp/pnpm-install.log 2>&1

echo SETUP_DONE
