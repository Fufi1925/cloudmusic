import { useEffect } from "react";
import { useTheme } from "next-themes";
import {
  applyAccent,
  applyCompact,
  applyMotion,
  applyRadii,
  applySurface,
  useAppearanceStore,
} from "../store/appearanceStore";

/**
 * Mirrors the appearance settings onto <html>:
 * accent variables, radius scale, surface tone, motion + density flags.
 */
export function useAppearanceSync() {
  const accent = useAppearanceStore((s) => s.accent);
  const customAccent = useAppearanceStore((s) => s.customAccent);
  const corners = useAppearanceStore((s) => s.corners);
  const surface = useAppearanceStore((s) => s.surface);
  const reduceMotion = useAppearanceStore((s) => s.reduceMotion);
  const compactLists = useAppearanceStore((s) => s.compactLists);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    applyAccent(accent, customAccent, resolvedTheme === "dark");
  }, [accent, customAccent, resolvedTheme]);

  useEffect(() => {
    applyRadii(corners);
  }, [corners]);

  useEffect(() => {
    applySurface(surface);
  }, [surface]);

  useEffect(() => {
    applyMotion(reduceMotion);
  }, [reduceMotion]);

  useEffect(() => {
    applyCompact(compactLists);
  }, [compactLists]);
}
