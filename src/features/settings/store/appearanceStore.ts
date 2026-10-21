import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { debouncedStorage } from "@/shared/utils/storage";

export type AccentId = "default" | "blue" | "violet" | "green" | "amber" | "rose" | "teal";
export type CornerStyle = "default" | "soft" | "round";
export type SurfaceStyle = "default" | "contrast" | "oled";

export interface AccentPalette {
  primary: string;
  secondary: string;
  tertiary: string;
  /** readable text on top of `primary` */
  onPrimary: string;
}

// light + dark variants: dark theme needs slightly brighter tints to stay legible
const ACCENTS: Record<AccentId, { light: AccentPalette; dark: AccentPalette; swatch: string }> = {
  default: {
    light: { primary: "#ff3b3b", secondary: "#ff5c5c", tertiary: "#ff7d7d", onPrimary: "#ffffff" },
    dark: { primary: "#ff4d4d", secondary: "#ff8a8a", tertiary: "#ff9b9b", onPrimary: "#ffffff" },
    swatch: "#ff3b3b",
  },
  blue: {
    light: { primary: "#2563eb", secondary: "#3b82f6", tertiary: "#60a5fa", onPrimary: "#ffffff" },
    dark: { primary: "#3b82f6", secondary: "#60a5fa", tertiary: "#93c5fd", onPrimary: "#ffffff" },
    swatch: "#3b82f6",
  },
  violet: {
    light: { primary: "#7c3aed", secondary: "#8b5cf6", tertiary: "#a78bfa", onPrimary: "#ffffff" },
    dark: { primary: "#8b5cf6", secondary: "#a78bfa", tertiary: "#c4b5fd", onPrimary: "#ffffff" },
    swatch: "#8b5cf6",
  },
  green: {
    light: { primary: "#059669", secondary: "#10b981", tertiary: "#34d399", onPrimary: "#ffffff" },
    dark: { primary: "#10b981", secondary: "#34d399", tertiary: "#6ee7b7", onPrimary: "#04140f" },
    swatch: "#10b981",
  },
  amber: {
    light: { primary: "#d97706", secondary: "#f59e0b", tertiary: "#fbbf24", onPrimary: "#1c1200" },
    dark: { primary: "#f59e0b", secondary: "#fbbf24", tertiary: "#fcd34d", onPrimary: "#1c1200" },
    swatch: "#f59e0b",
  },
  rose: {
    light: { primary: "#e11d48", secondary: "#f43f5e", tertiary: "#fb7185", onPrimary: "#ffffff" },
    dark: { primary: "#f43f5e", secondary: "#fb7185", tertiary: "#fda4af", onPrimary: "#ffffff" },
    swatch: "#f43f5e",
  },
  teal: {
    light: { primary: "#0d9488", secondary: "#14b8a6", tertiary: "#5eead4", onPrimary: "#ffffff" },
    dark: { primary: "#14b8a6", secondary: "#2dd4bf", tertiary: "#99f6e4", onPrimary: "#04140f" },
    swatch: "#14b8a6",
  },
};

export const ACCENT_IDS = Object.keys(ACCENTS) as AccentId[];

export function accentSwatch(id: AccentId): string {
  return ACCENTS[id]?.swatch ?? ACCENTS.default.swatch;
}

// radius scales: the whole UI reads these custom properties
const RADII: Record<CornerStyle, Record<string, string>> = {
  default: {
    "--radius-xs": "4px",
    "--radius-sm": "6px",
    "--radius-md": "8px",
    "--radius-lg": "10px",
    "--radius-xl": "12px",
    "--radius-2xl": "14px",
    "--radius-3xl": "16px",
    "--radius-4xl": "10px",
    "--radius-5xl": "12px",
  },
  soft: {
    "--radius-xs": "2px",
    "--radius-sm": "3px",
    "--radius-md": "4px",
    "--radius-lg": "5px",
    "--radius-xl": "6px",
    "--radius-2xl": "7px",
    "--radius-3xl": "8px",
    "--radius-4xl": "5px",
    "--radius-5xl": "6px",
  },
  round: {
    "--radius-xs": "8px",
    "--radius-sm": "11px",
    "--radius-md": "14px",
    "--radius-lg": "17px",
    "--radius-xl": "20px",
    "--radius-2xl": "24px",
    "--radius-3xl": "28px",
    "--radius-4xl": "17px",
    "--radius-5xl": "20px",
  },
};

export const CORNER_IDS: CornerStyle[] = ["soft", "default", "round"];

export interface AppearanceState {
  accent: AccentId;
  corners: CornerStyle;
  surface: SurfaceStyle;
  isCustomAccent: boolean;
  customAccent: string | null;
  reduceMotion: boolean;
  compactLists: boolean;

  setAccent: (accent: AccentId) => void;
  setCustomAccent: (hex: string | null) => void;
  setCorners: (corners: CornerStyle) => void;
  setSurface: (surface: SurfaceStyle) => void;
  setReduceMotion: (reduceMotion: boolean) => void;
  setCompactLists: (compactLists: boolean) => void;
  resetAppearance: () => void;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const value = hex.trim().replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("");
}

function mix(hex: string, target: string, amount: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  if (!a || !b) return hex;
  return rgbToHex([a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount] as [number, number, number]);
}

/** Relative luminance, used to pick a readable foreground for a custom accent. */
function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function paletteFor(accent: AccentId, customHex: string | null, dark: boolean): AccentPalette {
  if (customHex) {
    const base = hexToRgb(customHex) ? customHex : ACCENTS[accent].swatch;
    const towards = dark ? "#ffffff" : "#000000";
    return {
      primary: base,
      secondary: mix(base, towards, 0.16),
      tertiary: mix(base, towards, 0.34),
      onPrimary: luminance(base) > 0.55 ? "#101010" : "#ffffff",
    };
  }
  const entry = ACCENTS[accent] ?? ACCENTS.default;
  return dark ? entry.dark : entry.light;
}

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      accent: "default",
      corners: "default",
      surface: "default",
      isCustomAccent: false,
      customAccent: null,
      reduceMotion: false,
      compactLists: false,

      setAccent: (accent) => set({ accent, isCustomAccent: false, customAccent: null }),
      setCustomAccent: (customAccent) => set({ customAccent, isCustomAccent: Boolean(customAccent) }),
      setCorners: (corners) => set({ corners }),
      setSurface: (surface) => set({ surface }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      setCompactLists: (compactLists) => set({ compactLists }),
      resetAppearance: () =>
        set({
          accent: "default",
          corners: "default",
          surface: "default",
          isCustomAccent: false,
          customAccent: null,
          reduceMotion: false,
          compactLists: false,
        }),
    }),
    {
      name: "cloudmusic-appearance",
      storage: createJSONStorage(() => debouncedStorage),
      partialize: (state) => ({
        accent: state.accent,
        corners: state.corners,
        surface: state.surface,
        isCustomAccent: state.isCustomAccent,
        customAccent: state.customAccent,
        reduceMotion: state.reduceMotion,
        compactLists: state.compactLists,
      }),
    },
  ),
);

export function applyRadii(style: CornerStyle) {
  const root = document.documentElement;
  const radii = RADII[style] ?? RADII.default;
  for (const [key, value] of Object.entries(radii)) root.style.setProperty(key, value);
}

export function applyAccent(accent: AccentId, customHex: string | null, dark: boolean) {
  const palette = paletteFor(accent, customHex, dark);
  const root = document.documentElement;
  root.style.setProperty("--accent-primary", palette.primary);
  root.style.setProperty("--accent-secondary", palette.secondary);
  root.style.setProperty("--accent-tertiary", palette.tertiary);
  root.style.setProperty("--accent-on-primary", palette.onPrimary);
  root.dataset.accent = accent;
}

export function applySurface(style: SurfaceStyle) {
  document.documentElement.dataset.surface = style;
}

export function applyMotion(reduceMotion: boolean) {
  document.documentElement.dataset.reduceMotion = reduceMotion ? "true" : "false";
}

export function applyCompact(compactLists: boolean) {
  document.documentElement.dataset.density = compactLists ? "compact" : "default";
}
