import type { CloudMusicElectronApi } from "../electron/preload";

declare global {
  interface Window {
    cloudMusicElectron?: CloudMusicElectronApi;
  }
}

export {};
