# NOTICE

**CloudMusic** is a private, renamed fork of **Liner** by the Liner Project Contributors & feralbureau
(upstream: <https://github.com/tryliner/desktop>). All original code, design and the request/cover signer remain
the work of the upstream authors and stay under the license shipped in [LICENSE](./LICENSE)
(*Liner Source-Available & Non-Commercial Contribution License*, version 1.0).

What this fork changes:

- the application name and all identifiers: **CloudMusic** (package `com.hkamori.cloudmusic`, protocol `cloudmusic://`,
  renderer bridge `window.cloudMusicElectron`, storage names, UI texts),
- a new application icon and logo, vectorised from the owner's own artwork (`branding/`),
- the Android port of the Electron shell (`android/`), originally added in this repository,
- the upstream update channels are disabled (`UPDATES_ENABLED = false` in `electron/main.ts`).

What this fork does **not** change:

- the network protocol: it talks to the same endpoints (`api.tryliner.fun`, `covers.tryliner.fun`, `link.tryliner.fun`,
  `monitor.tryliner.fun`), sends the same signature headers (`x-liner-signature`, `x-liner-timestamp`, `x-liner-nonce`)
  and the same renderer header override (`x-liner-user-agent`). Those names are part of the server contract and were
  intentionally left untouched,
- the signer, the license, and the upstream copyright notices.

Use of this fork is limited to the private, non-commercial, personal use described in §2 of the license. Public
distribution, hosting, or binary releases of this fork are not permitted (§4b), and the license grants no rights to the
Liner name or branding (§4d) — hence the rename. If you are not the owner of this repository, do not use or redistribute it.
