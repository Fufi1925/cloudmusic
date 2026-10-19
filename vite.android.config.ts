// Vite config for the Android build of the renderer.
// Identical to vite.config.ts minus the electron main/preload plugin; instead
// the android bridge (android/web -> liner-android.js) is loaded before the
// renderer bundle, exactly where electron's preload script would run.
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import pkg from "./package.json" with { type: "json" };

export const ANDROID_WWW = path.resolve(import.meta.dirname, "android/app/src/main/assets/www");

function androidHtml(): Plugin {
  return {
    name: "liner-android-html",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        // the viewport meta is owned by liner-android.js (it scales the desktop layout)
        const withoutViewport = html.replace(/<meta\s+name="viewport"[^>]*>\s*/i, "");
        return {
          html: withoutViewport,
          tags: [
            {
              tag: "script",
              attrs: { src: "./liner-android.js" },
              injectTo: "head-prepend",
            },
          ],
        };
      },
    },
  };
}

export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), tailwindcss(), androidHtml()],
  clearScreen: false,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "next/navigation": path.resolve(import.meta.dirname, "./src/lib/navigation.tsx"),
      "next/link": path.resolve(import.meta.dirname, "./src/lib/navigation.tsx"),
      "next/image": path.resolve(import.meta.dirname, "./src/components/ui/AppImage.tsx"),
    },
  },
  build: {
    outDir: ANDROID_WWW,
    emptyOutDir: true,
  },
});
