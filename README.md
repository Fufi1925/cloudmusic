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

## Discord Rich Presence

Desktop builds talk to the local Discord client through its IPC socket (no login needed). Android has no
such socket, so the phone app uses a built-in gateway client instead: it signs in to
`wss://gateway.discord.gg` with a user token and publishes the same "Listening to …" activity
(cover, artist badge, live progress).

Tap **Connect with Discord** in *Settings → Discord*: an in-app browser opens `discord.com/login`, you sign
in, and CloudMusic takes the token over automatically – the window closes itself. Everything else works
exactly like the desktop (`DiscordRpc.java`, `DiscordLoginActivity.java`).

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

