#!/usr/bin/env node
// Builds everything the Android WebView loads into android/app/src/main/assets/www:
//   index.html + assets/*      the unchanged liner renderer (vite.android.config.ts)
//   liner-android.js           the android bridge (replaces electron/preload.ts)
//   potoken-worker.js          BotGuard worker for the hidden youtube.com WebView
import { build } from "vite";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(root, "android/app/src/main/assets/www");

// same production endpoints the official release workflow builds with
process.env.VITE_API_URL ??= "https://api.tryliner.fun";
process.env.VITE_COVERS_PROXY_URL ??= "https://covers.tryliner.fun";

process.chdir(root);

console.log("\n[android] building renderer...");
await build({ configFile: path.join(root, "vite.android.config.ts"), mode: "production", logLevel: "warn" });

const libBuild = (entry, fileName, name) =>
  build({
    configFile: false,
    root,
    logLevel: "warn",
    mode: "production",
    build: {
      outDir,
      emptyOutDir: false,
      target: "es2020",
      minify: true,
      sourcemap: false,
      lib: {
        entry: path.join(root, entry),
        formats: ["iife"],
        name,
        fileName: () => fileName,
      },
    },
  });

console.log("[android] building bridge (liner-android.js)...");
await libBuild("android/web/index.ts", "liner-android.js", "LinerAndroidBridge");

console.log("[android] building BotGuard worker (potoken-worker.js)...");
await libBuild("android/web/potokenWorker.ts", "potoken-worker.js", "LinerPoTokenWorker");

// electron unregisters the covers service worker; it is never used on android either
for (const unused of ["cover-sw.js"]) {
  fs.rmSync(path.join(outDir, unused), { force: true });
}

const html = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
if (!html.includes("liner-android.js")) throw new Error("bridge script was not injected into index.html");
for (const file of ["liner-android.js", "potoken-worker.js"]) {
  const size = fs.statSync(path.join(outDir, file)).size;
  console.log(`[android] ${file}: ${(size / 1024).toFixed(1)} KB`);
}
console.log(`[android] web assets ready in ${path.relative(root, outDir)}\n`);
