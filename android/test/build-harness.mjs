// builds the test-only bundle next to a copy of the android www assets
import { build } from "vite";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const www = path.join(root, "android/app/src/main/assets/www");
const out = "/home/user/.cache/harness-www";
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(www, out, { recursive: true });
await build({
  configFile: false, root, logLevel: "warn", mode: "production",
  define: { __APP_VERSION__: JSON.stringify("0.0.0-harness") },
  resolve: { alias: { "@": path.join(root, "src") } },
  build: { outDir: out, emptyOutDir: false, minify: false, target: "es2022",
    lib: { entry: path.join(root, "android/test/harness-entry.ts"), formats: ["iife"], name: "CloudMusicHarness", fileName: () => "harness-test.js" } },
});
fs.writeFileSync(path.join(out, "test.html"), `<!DOCTYPE html><html><head><meta charset="utf-8"><script src="./cloudmusic-android.js"></script><script src="./harness-test.js"></script></head><body><audio id="cloudmusic-audio" crossorigin="anonymous"></audio></body></html>`);
console.log("harness assets in", out);
