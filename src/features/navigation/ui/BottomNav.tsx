import { memo } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Home7Fill,
  Search3Fill,
  BookmarksFill,
  Settings4Fill,
} from "@mingcute/react";
import { useTranslation } from "@/languages";
import { useModalStore } from "@/features/library";

interface BottomNavProps {
  searchOpen: boolean;
  onSearchToggle: () => void;
}

/**
 * Portrait shell navigation: replaces the 58px icon rail with a four item
 * bottom bar (home, search, library, settings).
 */
function BottomNav({ searchOpen, onSearchToggle }: BottomNavProps) {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const settingsOpen = useModalStore((state) => state.settingsOpen);
  const toggleSettings = useModalStore((state) => state.toggleSettings);

  const itemClass = (active: boolean) =>
    [
      "relative flex flex-1 flex-col items-center justify-center gap-[3px] h-full min-w-0 pt-[6px] pb-[2px] border-none bg-transparent cursor-pointer select-none transition-colors duration-150",
      active ? "text-text-primary" : "text-text-tertiary active:text-text-secondary",
    ].join(" ");

  const iconWrapClass = (active: boolean) =>
    [
      "relative flex h-[26px] w-[46px] items-center justify-center rounded-full transition-colors duration-150",
      active ? "bg-border-alpha-14" : "",
    ].join(" ");

  const isHome = pathname === "/" || pathname === "/home";
  const isLibrary = pathname === "/library" || pathname?.startsWith("/library");

  return (
    <nav
      aria-label={t("common.sidebar.home") || "Navigation"}
      className="relative z-[56] w-full shrink-0 border-t border-border-primary/70 bg-bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl"
    >
      <div className="flex h-[54px] w-full items-stretch px-[4px]">
        <Link to="/" className={itemClass(isHome)} aria-current={isHome ? "page" : undefined}>
          <span className={iconWrapClass(isHome)}>
            <Home7Fill size={20} />
          </span>
          <span className="max-w-full truncate px-[2px] text-[10px] font-[550] leading-none">
            {t("common.sidebar.home") || "Home"}
          </span>
        </Link>

        <button
          type="button"
          onClick={onSearchToggle}
          aria-pressed={searchOpen}
          className={itemClass(searchOpen)}
        >
          <span className={iconWrapClass(searchOpen)}>
            <Search3Fill size={20} />
          </span>
          <span className="max-w-full truncate px-[2px] text-[10px] font-[550] leading-none">
            {t("common.sidebar.search") || "Search"}
          </span>
        </button>

        <Link
          to="/library"
          className={itemClass(isLibrary)}
          aria-current={isLibrary ? "page" : undefined}
        >
          <span className={iconWrapClass(isLibrary)}>
            <BookmarksFill size={20} />
          </span>
          <span className="max-w-full truncate px-[2px] text-[10px] font-[550] leading-none">
            {t("common.sidebar.library") || "Library"}
          </span>
        </Link>

        <button
          type="button"
          onClick={toggleSettings}
          aria-pressed={settingsOpen}
          className={itemClass(settingsOpen)}
        >
          <span className={iconWrapClass(settingsOpen)}>
            <Settings4Fill size={20} />
          </span>
          <span className="max-w-full truncate px-[2px] text-[10px] font-[550] leading-none">
            {t("common.sidebar.settings") || "Settings"}
          </span>
        </button>
      </div>
    </nav>
  );
}

export default memo(BottomNav);
