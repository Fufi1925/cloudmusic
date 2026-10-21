import { useEffect } from "react";
import logo from "@/assets/app-icon.svg";

// CloudMusic ships one fixed logo (square artwork), so the old branding variants
// no longer redraw the app icon; setAppIcon is still notified once so desktop
// shells can refresh their dock/taskbar entry after an update.
const ICON_SIZE = 512;

async function renderIconDataUrl(logoSrc: string): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to load the CloudMusic logo for the app icon"));
    img.src = logoSrc;
  });
  ctx.drawImage(img, 0, 0, ICON_SIZE, ICON_SIZE);
  return canvas.toDataURL("image/png");
}

export function useAppIconSync() {
  useEffect(() => {
    let active = true;

    void renderIconDataUrl(logo)
      .then((dataUrl) => {
        if (!active || !dataUrl) return;

        window.cloudMusicElectron?.setAppIcon?.(dataUrl, { isDefault: false });

        let favicon = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
        if (!favicon) {
          favicon = document.createElement("link");
          favicon.rel = "icon";
          document.head.appendChild(favicon);
        }
        favicon.href = dataUrl;
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);
}
