// Desktop-only lobby overlay: a small always-on-top card that lives in a corner
// of the screen and can be dragged anywhere. It shows the room, who is listening
// and what plays next, and lets the host kick somebody from the right-click menu.
//
// The media overlay (electron/overlay.ts) is a sibling of this: same look, same
// window flags, but this one remembers where the user dragged it.

import { BrowserWindow, ipcMain, screen, app } from "electron";
import path from "node:path";
import fs from "node:fs";

export interface LobbyOverlayState {
  active: boolean;
  role: "host" | "listener" | null;
  code: string | null;
  hostName: string | null;
  meId: string | null;
  members: Array<{ userId: string; name: string; online?: boolean }>;
  current: { title: string; artists?: string; coverUrl?: string | null } | null;
  next: Array<{ id: string; title: string; artists?: string }>;
  requests: Array<{ id: string; title: string; name: string; votes: number }>;
  votes: { skip: number; skipNeeded: number };
}

export interface LobbyOverlaySettings {
  enabled: boolean;
  x: number | null;
  y: number | null;
}

const WIDTH = 296;
const HEIGHT = 360;
const PADDING = 20;

export class LobbyOverlayManager {
  private mainWindow: BrowserWindow | null = null;
  private overlayWindow: BrowserWindow | null = null;
  private latestState: LobbyOverlayState | null = null;
  private readonly preloadPath: string;
  private readonly rendererDist: string;

  private enabled = true;
  private x: number | null = null;
  private y: number | null = null;
  private disposed = false;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(preloadPath: string, rendererDist: string) {
    this.preloadPath = preloadPath;
    this.rendererDist = rendererDist;
    this.loadPersistedSettings();
    this.registerIpcHandlers();
  }

  // ── settings ────────────────────────────────────────────────────────────

  private getSettingsFilePath(): string {
    try {
      return path.join(app.getPath("userData"), "lobby-overlay-settings.json");
    } catch {
      return "";
    }
  }

  private loadPersistedSettings() {
    try {
      const filePath = this.getSettingsFilePath();
      if (!filePath || !fs.existsSync(filePath)) return;
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (typeof data.enabled === "boolean") this.enabled = data.enabled;
      if (Number.isFinite(data.x)) this.x = Math.round(data.x);
      if (Number.isFinite(data.y)) this.y = Math.round(data.y);
    } catch (e) {
      console.warn("[lobby-overlay] could not read settings:", e);
    }
  }

  private savePersistedSettings() {
    try {
      const filePath = this.getSettingsFilePath();
      if (!filePath) return;
      const data: LobbyOverlaySettings = { enabled: this.enabled, x: this.x, y: this.y };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
      console.warn("[lobby-overlay] could not write settings:", e);
    }
  }

  /** remember the spot the user dragged the card to */
  private rememberBounds() {
    const win = this.overlayWindow;
    if (!win || win.isDestroyed()) return;
    const bounds = win.getBounds();
    this.x = bounds.x;
    this.y = bounds.y;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.savePersistedSettings();
    }, 400);
  }

  // ── window ──────────────────────────────────────────────────────────────

  public setMainWindow(win: BrowserWindow | null) {
    this.mainWindow = win;
  }

  private getDefaultBounds() {
    let display = screen.getPrimaryDisplay();
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        display = screen.getDisplayMatching(this.mainWindow.getBounds());
      }
    } catch {
      display = screen.getPrimaryDisplay();
    }
    const { workArea } = display;
    const defaultX = Math.round(workArea.x + workArea.width - WIDTH - PADDING);
    const defaultY = Math.round(workArea.y + PADDING);
    // keep a remembered spot usable even if the monitor layout changed
    const x = this.x === null ? defaultX : Math.round(Math.min(Math.max(this.x, workArea.x - 40), workArea.x + workArea.width - 80));
    const y = this.y === null ? defaultY : Math.round(Math.min(Math.max(this.y, workArea.y - 20), workArea.y + workArea.height - 80));
    return { x, y, width: WIDTH, height: HEIGHT };
  }

  public resetPosition() {
    this.x = null;
    this.y = null;
    this.savePersistedSettings();
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.setBounds(this.getDefaultBounds());
    }
  }

  private createWindow(show: boolean) {
    if (this.disposed) return;
    const bounds = this.getDefaultBounds();
    this.overlayWindow = new BrowserWindow({
      title: "CloudMusic Lobby",
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      show: false,
      alwaysOnTop: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      skipTaskbar: true,
      hasShadow: false,
      roundedCorners: true,
      webPreferences: {
        preload: this.preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        devTools: true,
        backgroundThrottling: false,
      },
    });

    this.overlayWindow.on("moved", () => this.rememberBounds());
    this.overlayWindow.on("closed", () => {
      this.overlayWindow = null;
    });

    this.overlayWindow.once("ready-to-show", () => {
      const win = this.overlayWindow;
      if (!win || win.isDestroyed()) return;
      if (this.latestState) win.webContents.send("lobby-overlay:state", this.latestState);
      if (show) this.show();
    });

    const targetUrl = process.env.VITE_DEV_SERVER_URL
      ? `${process.env.VITE_DEV_SERVER_URL}#/lobby-overlay`
      : `file://${path.join(this.rendererDist, "index.html")}#/lobby-overlay`;
    void this.overlayWindow.loadURL(targetUrl);

    this.overlayWindow.webContents.on("did-finish-load", () => {
      const win = this.overlayWindow;
      if (!win || win.isDestroyed()) return;
      if (this.latestState) win.webContents.send("lobby-overlay:state", this.latestState);
    });
  }

  private applyWindowFlags() {
    const win = this.overlayWindow;
    if (!win || win.isDestroyed()) return;
    try {
      win.setAlwaysOnTop(true, "floating");
    } catch {
      try {
        win.setAlwaysOnTop(true);
      } catch {}
    }
    try {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch {}
  }

  public show() {
    if (this.disposed || !this.enabled) return;
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) {
      this.createWindow(true);
      return;
    }
    const win = this.overlayWindow;
    win.setBounds(this.getDefaultBounds());
    this.applyWindowFlags();
    if (!win.isVisible()) win.showInactive();
    if (this.latestState) win.webContents.send("lobby-overlay:state", this.latestState);
    win.webContents.send("lobby-overlay:visibility", true);
  }

  public hide() {
    const win = this.overlayWindow;
    if (!win || win.isDestroyed()) return;
    win.webContents.send("lobby-overlay:visibility", false);
    win.hide();
  }

  public toggle(): boolean {
    if (this.disposed) return false;
    const win = this.overlayWindow;
    if (win && !win.isDestroyed() && win.isVisible()) {
      this.hide();
      return false;
    }
    this.show();
    return true;
  }

  public isOpen(): boolean {
    return Boolean(this.overlayWindow && !this.overlayWindow.isDestroyed() && this.overlayWindow.isVisible());
  }

  public setEnabled(enabled: boolean) {
    this.enabled = Boolean(enabled);
    this.savePersistedSettings();
    if (!this.enabled) this.hide();
    else if (this.latestState?.active) this.show();
  }

  public dispose() {
    this.disposed = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      try {
        this.overlayWindow.destroy();
      } catch {}
    }
    this.overlayWindow = null;
    this.mainWindow = null;
  }

  // ── ipc ─────────────────────────────────────────────────────────────────

  private forward(action: any) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("lobby-overlay:action", action);
    }
  }

  private registerIpcHandlers() {
    ipcMain.on("lobby-overlay:update-state", (_event, state: LobbyOverlayState) => {
      if (!state || typeof state !== "object") return;
      this.latestState = state;

      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.webContents.send("lobby-overlay:state", state);
      }

      // the overlay follows the room: open when a lobby is joined, close when it ends.
      // Only on the transition – otherwise every store update would snap a card the
      // user dragged elsewhere back to its stored position.
      if (!state.active) {
        if (this.isOpen()) this.hide();
      } else if (this.enabled && !this.isOpen()) {
        this.show();
      }
    });

    ipcMain.handle("lobby-overlay:get-initial-state", () => this.latestState);
    ipcMain.handle("lobby-overlay:is-open", () => this.isOpen());
    ipcMain.handle("lobby-overlay:toggle", () => this.toggle());

    ipcMain.on("lobby-overlay:close", () => this.hide());

    ipcMain.on("lobby-overlay:set-enabled", (_event, enabled: boolean) => {
      this.setEnabled(Boolean(enabled));
    });

    ipcMain.on("lobby-overlay:reset-position", () => this.resetPosition());

    // the overlay window asks the main window to do something (kick, open lobby, …)
    ipcMain.on("lobby-overlay:send-action", (_event, action: any) => {
      if (!action || typeof action !== "object") return;
      if (action.type === "closeOverlay") {
        this.hide();
        return;
      }
      if (action.type === "focusMainWindow") {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          const win = this.mainWindow;
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        }
        return;
      }
      if (action.type === "resetPosition") {
        this.resetPosition();
        return;
      }
      this.forward(action);
    });

    ipcMain.on("lobby-overlay:send-main-action", (_event, action: any) => {
      this.forward(action);
    });
  }
}
