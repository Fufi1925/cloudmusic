import PopularTracksSection from "./PopularTracksSection";
import type { PopularItem } from "../hooks/usePopularTracks";
import { useTranslation } from "@/languages";
import { MoonFill } from "@mingcute/react";

interface ChillSectionProps {
  items: PopularItem[];
  loading?: boolean;
}

/**
 * Quiet pop / slow evening row. Reuses the popular tracks card layout so the
 * home page stays visually consistent, but sits at the very top.
 */
export default function ChillSection({ items, loading = false }: ChillSectionProps) {
  const { t } = useTranslation();

  if (items.length === 0) {
    if (!loading) return null;
    return (
      <div className="flex flex-col">
        <div className="mt-[18px] px-8 max-md:px-4 flex items-center gap-2.5">
          <MoonFill className="w-5 h-5 text-indigo-400" />
          <h2
            className="m-0 min-w-0 text-balance text-[21px] font-semibold leading-tight tracking-tight text-text-primary max-md:text-[18px]"
            style={{ fontFamily: "var(--font-inter), sans-serif" }}
          >
            {t("home.chill.title") || "Chill"}
          </h2>
        </div>
        <div className="mt-[12px] flex gap-[28px] max-md:gap-[14px] overflow-hidden pl-8 pr-8 max-md:pl-4 max-md:pr-4">
          {[0, 1, 2, 3, 4].map((index) => (
            <div
              key={index}
              className="w-[175px] max-md:w-[136px] shrink-0 animate-pulse"
            >
              <div className="aspect-square w-full rounded-md bg-border-alpha-14" />
              <div className="mt-[10px] h-[12px] w-[70%] rounded bg-border-alpha-14" />
              <div className="mt-[6px] h-[10px] w-[45%] rounded bg-border-alpha-14" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <PopularTracksSection
      title={t("home.chill.title") || "Chill"}
      subtitle={t("home.chill.subtitle")}
      icon={<MoonFill className="w-5 h-5 text-indigo-400" />}
      items={items}
      headingMarginTop="mt-[18px]"
    />
  );
}
