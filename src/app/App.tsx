import type { ReactNode } from "react";
import { HashRouter } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { ThemeProvider } from "next-themes";
import { ToastProvider, AppleEmojiProvider, RootErrorBoundary, GlobalTooltip, WindowAnimationContainer } from "@/shared/ui";
import { useWindowDrag } from "@/shared/hooks";
import { useAppIconSync } from "@/features/player";
import { I18nProvider } from "@/languages";
import { AuthLock } from "@/features/auth";
import { CoverSwRegistrar } from "@/features/covers";
import { usePresenceSync } from "@/shared/presence";
import { useThemeCustomizationSync, useAppearanceSync, useAppearanceStore } from "@/features/settings";
import { useTouchBarSync } from "@/features/touchbar";
import { OverlayPlayer, useOverlaySync } from "@/features/overlay";
import { useDiscordSync } from "@/features/discord";
import { useLobbySync } from "@/features/lobby";
import { AppRoutes } from "./routes";
import DeeplinkHandler from "./DeeplinkHandler";
import EnvironmentWarning from "./EnvironmentWarning";
import { ConnectivityWall } from "@/features/connectivity";
import { getAuthSession } from "@/shared/api";
import "./globals.css";

function AppIconSync() {
  useAppIconSync();
  return null;
}

function PresenceSync() {
  usePresenceSync();
  return null;
}

function ThemeSync() {
  useThemeCustomizationSync();
  useAppearanceSync();
  return null;
}

function MotionPreferences({ children }: { children: ReactNode }) {
  const reduceMotion = useAppearanceStore((s) => s.reduceMotion);
  return <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}>{children}</MotionConfig>;
}

function TouchBarSync() {
  useTouchBarSync();
  return null;
}

function OverlaySync() {
  useOverlaySync();
  return null;
}

function DiscordSync() {
  useDiscordSync();
  return null;
}

function LobbySync() {
  useLobbySync();
  return null;
}

export default function App() {
  const isOverlay = window.location.hash.startsWith("#/overlay");

  if (isOverlay) {
    if (!getAuthSession()) {
      window.cloudMusicElectron?.closeOverlay?.();
      return null;
    }

    return (
      <ThemeProvider
        attribute="data-theme"
        defaultTheme="dark"
        enableSystem={false}
        forcedTheme="dark"
      >
        <GlobalTooltip />
        <OverlayPlayer />
      </ThemeProvider>
    );
  }

  useWindowDrag();

  return (
    <HashRouter>
      <CoverSwRegistrar />
      <ThemeProvider
        attribute="data-theme"
        defaultTheme="system"
        enableSystem={true}
        disableTransitionOnChange
      >
        <GlobalTooltip />
        <ThemeSync />
        <AppIconSync />
        <PresenceSync />
        <TouchBarSync />
        <OverlaySync />
        <DiscordSync />
        <LobbySync />
        <AppleEmojiProvider>
          <I18nProvider>
            <ToastProvider>
              <RootErrorBoundary>
                <WindowAnimationContainer>
                  <MotionPreferences>
                    <DeeplinkHandler />
                    <EnvironmentWarning />
                    <ConnectivityWall />
                    <AuthLock>
                      <AppRoutes />
                    </AuthLock>
                  </MotionPreferences>
                </WindowAnimationContainer>
              </RootErrorBoundary>
            </ToastProvider>
          </I18nProvider>
        </AppleEmojiProvider>
      </ThemeProvider>
    </HashRouter>
  );
}
