// Builds the windows-only native snap preview add-on.
//
// The add-on (native/snap-preview) needs MSVC (VS 2022 C++ tools) + the Windows
// SDK, so on any other host it is simply skipped: electron/snap-native.ts then
// falls back to the plain acrylic preview window and the app keeps working.
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

if (process.platform !== "win32") {
  console.log("native-build: not windows, skipped (window snap preview uses the acrylic fallback)");
  process.exit(0);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: true });
  if (result.error) {
    console.error(`native-build: ${command} failed: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("pnpm", ["dlx", "node-gyp@11", "rebuild", "--directory", "native/snap-preview"]);
run("node", ["scripts/verify-native-addon.cjs"]);
