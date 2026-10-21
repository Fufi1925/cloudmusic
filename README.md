<div align="center">

# CloudMusic

**Desktop music streaming player with syllable-synced lyrics and reactive dynamic visuals — plus a native Android build.**

> [!IMPORTANT]
> **Private build.** CloudMusic is a personal, renamed fork of *Liner* (upstream: [tryliner/desktop](https://github.com/tryliner/desktop)).
> It runs against the official Liner backend, which this fork talks to unchanged. The repository is private on purpose:
> the [license](./LICENSE) only allows private, non-commercial use and forbids distributing copies or binaries.
> See [NOTICE.md](./NOTICE.md).

[![Electron](https://img.shields.io/badge/Electron-44.0-47848F?style=flat-square&logo=electron&logoColor=black&labelColor=white)](https://electronjs.org)
[![React 19](https://img.shields.io/badge/React_19-19.2-61DAFB?style=flat-square&logo=react&logoColor=black&labelColor=white)](https://react.dev)
[![TypeScript 5](https://img.shields.io/badge/TypeScript_5-5.0-3178C6?style=flat-square&logo=typescript&logoColor=black&labelColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS v4](https://img.shields.io/badge/Tailwind_CSS_v4-v4.0-06B6D4?style=flat-square&logo=tailwindcss&logoColor=black&labelColor=white)](https://tailwindcss.com)
[![WebAssembly](https://img.shields.io/badge/Rust-WebAssembly-654FF0?style=flat-square&logo=webassembly&logoColor=black&labelColor=white)](https://webassembly.org)
[![License: Source-Available](https://img.shields.io/badge/License-Source--Available-blueviolet?style=flat-square&labelColor=white)](./LICENSE)

[Preview](#preview) •
[Architecture](#architecture) •
[Getting Started](#getting-started) •
[Building](#building) •
[Contributing](#contributing) •
[License](#license)

<br/>

<img src="./.github/assets/lyrics_preview.png" alt="CloudMusic Fullscreen Lyrics" width="100%" />

</div>

---

## Preview

<div align="center">
  <table>
    <tr>
      <td align="center" width="50%">
        <img src="./.github/assets/home.png" alt="CloudMusic Home Page" />
        <br/>
        <sub><b>Home</b></sub>
      </td>
      <td align="center" width="50%">
        <img src="./.github/assets/demo.gif" alt="CloudMusic Fullscreen Mode Demo" />
        <br/>
        <sub><b>Fullscreen mode</b></sub>
      </td>
    </tr>
  </table>
</div>

---

> [!NOTE]
> CloudMusic talks to the same official Liner API backend (`api.tryliner.fun`, `covers.tryliner.fun`, `link.tryliner.fun`)
> for music catalog, streaming playback, and synchronized lyrics. The upstream update channels are switched off in this
> build (`UPDATES_ENABLED = false` in `electron/main.ts`), so the original installer/OTA bundles can never overwrite it.

---

## Layouts

CloudMusic ships two layouts from one renderer:

- **Desktop (≥ 768 px)** – the original electron shell: 58 px icon rail, floating search island,
  440 px queue/lyrics drawer, bottom player bar.
- **Portrait (< 768 px, Android phones)** – bottom navigation (Home, Search, Library, Settings),
  compact player bar above it, stacked page headers, full-screen search and settings, and the
  queue/lyrics panel as a bottom sheet. Phones are locked to portrait, tablets may rotate freely.

The home page starts with a curated **Chill** row (quiet pop: Lana Del Rey, Billie Eilish,
Taylor Swift, Gracie Abrams, Olivia Rodrigo, Adele, Phoebe Bridgers, girl in red), assembled
client-side from search results because the backend has no editorial endpoint.

The **Website** entry in *Settings → Info* is intentionally disabled and greyed out
(“coming soon”).

---

## What's new in 0.1.49 (sleep timer, audio depth, more customisation)

- **Phone settings trimmed** – *Shortcuts* and *Overlay* disappear from the settings on a phone
  (no hardware keyboard, no desktop overlay window); the desktop build keeps both. The storage
  tab hides its *open folder* button there too, and a selected tab always falls back to
  *Playback* when the window gets narrow.
- **Sleep timer** – *Settings → Wiedergabe* offers 5/15/30/45/60/90/120 minutes. The player
  shows a moon pill with the live countdown; tapping it cancels. When the deadline hits, playback
  fades out over four seconds and pauses. The timer never survives a restart.
- **Audio tab, more depth** – the streaming quality now really caps the stream (low ≈ 96 kbit/s,
  standard ≈ 160 kbit/s, high = best available format) instead of only being stored. New:
  crossfade 0–12 s (fade out at the end, fade in on start), gapless preloading, loudness
  normalisation with three levels (RMS auto-gain in the WebAudio chain), L/R channel balance,
  and a reset row that restores quality, crossfade, normalisation, balance and EQ at once.
- **Customisation, more options** – wallpapers can be applied from a URL, fitted (fill / fit /
  tile), desaturated or amplified (0–200 %), and set in slow Ken-Burns motion. Four one-click
  glass presets (none / soft / glass / strong) restyle all three interface blocks together.

---

## What's new in 0.1.48 (phone polish, live lyrics)

- **Full screen live lyrics** – a new `/lyrics` screen (also reachable from the queue sheet's
  expand button, the player's *Songtext* pill and a dedicated entry in the bottom navigation).
  The back button sits top right, the artwork is used as a blurred backdrop, and the line size
  drops to a phone-friendly value so lines stop wrapping.
- **Settings → Anpassung (customization) on phones** – the glass-effect sliders no longer squeeze
  the label and the 190 px track into one row: label, value and track stack vertically, the block
  selector and *Auf alle / Zurücksetzen* buttons get their own row.
- **Accent colours removed** from *Settings → Darstellung*; that tab keeps language, theme,
  corners, surfaces, compact lists and reduced motion. The reset row no longer mentions an accent.
- **Library / playlist scrolling** – the library header gets a frosted backdrop once the list is
  scrolled, and the playlist page no longer clips rows under the header: the cover block has its
  own background, the track list fades in at the top edge instead of being cut mid-row.
- **Player** – with lyrics on screen the artwork shrinks to a compact 150 px tile instead of
  pushing the controls off the page; the provider/timestamp island is desktop-only now.

---

## What's new in 0.1.47 (new mark, appearance, phone UI)

- **New CloudMusic mark** – the cloud with the two notes replaces the old cloud/headphone logo
  everywhere: desktop window + installer icons, all Windows/Linux builds, the Android launcher
  (adaptive, monochrome and notification icon), the web favicon and the in-app wordmark.
  `branding/generate-icons.py` now derives every asset from `branding/cloudmusic-logo.svg`;
  the VectorDrawables need the potrace grid (`8430×3100`, y-up) while the SVGs scale it down.
- **Settings → Appearance** is a real tab now: nine accent colours plus a custom hex field,
  three corner styles, three surface levels (default / contrast / OLED black), and switches for
  reduced motion and compact lists. Everything writes CSS variables on `<html>` and survives a restart.
- **Phones** – nothing spills off screen any more: the library grid is a fixed two-column grid,
  home rows snap card by card, headings scale down and wrap instead of pushing the row wide,
  dialogs use the full phone width, and the tab strip in settings fades at the edges.
- **Player on phones** – the now-playing screen gained the queue button it was missing, swiping the
  compact bar skips tracks, and the sheet respects the system bars.
- **Language picker** – flags are inline SVG instead of CDN emoji, so the selector no longer shows
  a broken image when the app is offline or freshly installed on Android.

---

## What's new in 0.1.46 (equalizer + queue)

- **10-band equalizer** (32 Hz – 16 kHz, ±12 dB, 10 presets) that sits after pitch and reverb in the
  audio chain and auto-damps the preamp so boosted curves cannot clip. It is now available in
  *Settings → Audio* with an on/off switch, and still opens from the player bar.
- **Queue upgrades** – reorder by dragging, *Play next* / *Add to queue* from every track menu, and
  **Save queue as playlist**, which snapshots the current queue into a new account playlist
  (name + optional description, duplicates skipped).
- Settings search finds the equalizer in all ten languages.

---

## What's new in 0.1.45 (upstream sync)

The fork now tracks the upstream Liner `main` again (18 commits, `v0.1.40` + unreleased work):

- **Windows 11 window motion** – drag to the top edge to maximize with Windows' own snap preview look;
  maximize/restore and minimize↔overlay morph through the DWM compositor (native add-on
  `native/snap-preview`), with an acrylic fallback when the add-on is not built.
- **Edge-to-edge layout** when the window is maximized or fullscreen (no rounded corners / padding).
- **Player** – the system media session survives track changes (Windows media controls keep working),
  seeking no longer flashes the loading state, no endless reload loop on a broken spot.
- **Library & home** – saved artists/albums/playlists keep name and artwork, daily mixes and recently
  played are cached per account.
- **Imports** – SoundCloud tracks without artwork inherit the set's or uploader's image; Spotify TOTP
  is also read from the mobile web player.
- **Small UI fixes** – styled login errors instead of the native email bubble, square login frame when
  maximized, no stale hover on the window controls after returning.

> The native window add-on needs MSVC (VS 2022 + Windows SDK): `pnpm native:build`. On non-Windows hosts
> it is skipped and the app uses the acrylic fallback (`scripts/native-build.cjs`).

---

## Discord Rich Presence

Desktop builds talk to the local Discord client through its IPC socket (no login needed). Android has no
such socket, so the phone app uses a built-in gateway client instead: it signs in to
`wss://gateway.discord.gg` with a user token and publishes the same "Listening to …" activity
(cover, artist badge, live progress).

Tap **Connect with Discord** in *Settings → Discord*: an in-app browser opens `discord.com/login`, you sign
in, and CloudMusic takes the token over automatically – the window closes itself. Everything else works
exactly like the desktop (`DiscordRpc.java`, `DiscordLoginActivity.java`).

The *Listen on CloudMusic* profile button (desktop and Android) points at
`https://cloudtix.up.railway.app` (`electron/discord.ts`, `LISTEN_ON_CLOUDMUSIC_URL`).

The token is encrypted with AES-256/GCM behind a key that lives in the Android keystore
(`cloudmusic_discord_token_v1`). It never leaves the device, is never logged and is only sent to Discord's
own gateway. "Delete token" removes it again.

> Unofficial method (selfbot) – Discord may treat it as a rule violation. Use at your own risk.

---

## Architecture

```
Music./
├── electron/
│   ├── main.ts              # Electron main process & IPC handlers
│   ├── preload.ts           # Context bridge & secure renderer bindings
│   ├── crypto.ts            # High-performance in-memory WebAssembly signer
│   └── signer.ts            # Embedded WebAssembly binary
├── src/
│   ├── assets/              # Static assets and media
│   ├── components/          # Shared reusable UI components
│   ├── features/            # Feature modules (player, lyrics, queue, library, search, auth)
│   ├── pages/               # Route views (Home, Search, Album, Artist, Playlist)
│   ├── shared/              # API client, state stores (Zustand), and data contracts
│   ├── App.tsx              # Application root
│   └── main.tsx             # Vite entry point
├── android/                 # native Android port (WebView + Java bridge), see android/README.md
├── branding/                # CloudMusic logo (vector master + icon generator)
├── build/                   # desktop icon assets used by electron-builder
├── package.json
└── vite.config.ts
```

---

## Getting Started

### Prerequisites

- **Node.js** `v20+` and **pnpm** or **Bun**
- Modern OS (Windows 10/11, macOS, or Linux)

---

### Setup

```bash
# 1. Clone repository (private)
git clone https://github.com/Fufi1925/Music..git
cd Music.

# 2. Install dependencies (pnpm or Bun)
pnpm install
# or
bun install
```

---

### Running in Development

```bash
# Start CloudMusic in development mode (Electron app with Vite hot-reload)
pnpm run dev
# or
bun run dev
```

---

## Testing

```bash
# Run test suite with Vitest
bun run test
# or
pnpm test
```

---

## Building

```bash
# Build desktop packages for your current OS:

# Linux (AppImage & .deb)
bun run electron:build:linux

# Windows (.exe installer)
bun run electron:build:win
```

Compiled distributions will be placed in the `release/` directory (AppImage/deb, NSIS setup, dmg/zip).

### Android APK

```bash
cd android
./build.sh            # renderer -> webView assets, then assembleRelease + assembleDebug
```

The signed APKs land in `android/app/build/outputs/apk/`. Signing uses
`android/keystore/keystore.properties` (not committed — back it up, updates need the same key).
Details, the Electron-to-Android mapping and the device test steps are in [android/README.md](./android/README.md).

### Icons and logo

All icons come from one master: `branding/cloudmusic-logo.svg` (vectorised from
`branding/cloudmusic-original.webp`). Rebuild every icon (desktop, Windows `.ico`, Android adaptive icon,
monochrome icon, notification icon, renderer logo) with:

```bash
python3 branding/generate-icons.py   # needs rsvg-convert, imagemagick, potrace, numpy, pillow
```

---

## Contributing

This is a private personal fork; there is no contribution process. See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## Special Thanks

- [`@braccato/core`](https://github.com/better-lyrics/braccato) & `@braccato/parsers` — Synced lyrics components and format parsers.
- [`@kawarp/react`](https://github.com/better-lyrics/kawarp) & `@kawarp/core` — WebGL background shader components.
- [Solar Icons](https://solar-icons.com) & [MingCute Icons](https://www.mingcute.com) — Icon collections.

---

## License

The code stays under the **Liner Source-Available & Non-Commercial Contribution License** (`LICENSE`, unchanged).

- **Allowed**: personal, private, non-commercial builds and modifications (§2) — the owner of this repository has the upstream author's permission.
- **Prohibited**: any public distribution, hosting or binary release of the fork (§4b), and extracting the signer or core algorithms (§4c).
- The license grants no rights to the Liner name or branding (§4d); this fork is therefore called **CloudMusic** and uses its own logo.

Keep this repository private. See [LICENSE](./LICENSE) and [NOTICE.md](./NOTICE.md).

