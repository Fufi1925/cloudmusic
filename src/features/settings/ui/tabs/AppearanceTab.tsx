import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { useTranslation, LOCALE_OPTIONS } from "@/languages";
import { Select, ToggleSwitch } from "@/shared/ui";
import {
  useCustomizationStore,
  selectIsGlassThemeActive,
} from "../../store/customizationStore";
import {
  ACCENT_IDS,
  accentSwatch,
  useAppearanceStore,
  type AccentId,
  type CornerStyle,
  type SurfaceStyle,
} from "../../store/appearanceStore";
import { SettingBlock, SettingRow, SettingSection, SegmentedControl } from "../controls";

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;

// tiny dashboard mock so theme choice reads visually instead of as text
function ThemeMock({ mode }: { mode: "light" | "dark" }) {
  const dark = mode === "dark";
  return (
    <div className={`flex h-full w-full ${dark ? "bg-[#101012]" : "bg-[#ececee]"}`}>
      <div className={`flex w-[36%] flex-col gap-[4px] p-[8px] ${dark ? "bg-[#1c1c1e]" : "bg-white"}`}>
        <div className="flex gap-[3px] px-[1px] pb-[3px]">
          <span className="h-[4px] w-[4px] rounded-full bg-[#ff5f57]" />
          <span className="h-[4px] w-[4px] rounded-full bg-[#febc2e]" />
          <span className="h-[4px] w-[4px] rounded-full bg-[#28c840]" />
        </div>
        {[22, 16, 20].map((w, i) => (
          <span
            key={i}
            className={`h-[5px] rounded-full ${dark ? "bg-white/15" : "bg-black/10"}`}
            style={{ width: w }}
          />
        ))}
        <span className={`mt-auto h-[12px] rounded-[3px] ${dark ? "bg-white/20" : "bg-black/15"}`} />
      </div>
      <div className="flex flex-1 flex-col gap-[4px] p-[8px]">
        <span className={`h-[6px] w-[46px] rounded-full ${dark ? "bg-white/25" : "bg-black/20"}`} />
        <div className="grid grid-cols-2 gap-[4px]">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`h-[14px] rounded-[3px] ${dark ? "bg-white/10" : "bg-black/[0.07]"}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ThemeCard({
  mode,
  label,
  active,
  disabled = false,
  disabledReason,
  onSelect,
}: {
  mode: "light" | "dark" | "system";
  label: string;
  active: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onSelect}
      aria-pressed={active}
      aria-disabled={disabled}
      title={disabled ? disabledReason : undefined}
      className={`group flex flex-col gap-[6px] border-0 bg-transparent p-0 text-left ${
        disabled ? "cursor-not-allowed opacity-40 select-none" : "cursor-pointer"
      }`}
    >
      <span
        className={`relative block h-[76px] w-full overflow-hidden rounded-lg border transition-colors ${
          disabled
            ? "border-border-primary"
            : active
              ? "border-text-primary ring-1 ring-text-primary"
              : "border-border-primary group-hover:border-text-tertiary"
        }`}
      >
        {mode === "system" ? (
          <span className="flex h-full w-full">
            <span className="h-full w-1/2 overflow-hidden">
              <ThemeMock mode="light" />
            </span>
            <span className="h-full w-1/2 overflow-hidden">
              <ThemeMock mode="dark" />
            </span>
          </span>
        ) : (
          <ThemeMock mode={mode} />
        )}
        {active ? (
          <span className="absolute right-[6px] top-[6px] flex h-[18px] w-[18px] items-center justify-center rounded-full bg-text-primary">
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M2 6.5L4.5 9L10 3"
                stroke="var(--color-bg-primary)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        ) : null}
      </span>
      <span
        className={`text-[12.5px] leading-none ${
          disabled
            ? "text-text-tertiary"
            : active
              ? "text-text-primary"
              : "text-text-secondary"
        }`}
        style={{ ...font, fontWeight: active ? 500 : 400 }}
      >
        {label}
      </span>
    </button>
  );
}

/** Accent swatches; the last chip opens the native colour picker for a custom tone. */
function AccentPicker() {
  const { t } = useTranslation();
  const accent = useAppearanceStore((s) => s.accent);
  const customAccent = useAppearanceStore((s) => s.customAccent);
  const setAccent = useAppearanceStore((s) => s.setAccent);
  const setCustomAccent = useAppearanceStore((s) => s.setCustomAccent);

  const chips: AccentId[] = ACCENT_IDS;

  return (
    <div className="flex flex-wrap items-center gap-[8px]">
      {chips.map((id) => {
        const isActive = !customAccent && accent === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setAccent(id)}
            aria-pressed={isActive}
            aria-label={id === "default" ? t("settings.appearance.accent_default") : id}
            title={id === "default" ? t("settings.appearance.accent_default") : id}
            className={`relative flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-full border-0 p-0 transition-transform active:scale-[0.92] ${
              isActive ? "ring-2 ring-text-primary ring-offset-2 ring-offset-bg-primary" : ""
            }`}
            style={{ backgroundColor: accentSwatch(id) }}
          >
            {isActive ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path
                  d="M2 6.5L4.5 9L10 3"
                  stroke="#ffffff"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : null}
          </button>
        );
      })}

      <label
        className={`relative flex h-[28px] w-[28px] cursor-pointer items-center justify-center overflow-hidden rounded-full border border-border-secondary bg-bg-elevated ${
          customAccent ? "ring-2 ring-text-primary ring-offset-2 ring-offset-bg-primary" : ""
        }`}
        title={t("settings.appearance.accent_custom")}
      >
        <span
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "conic-gradient(from 0deg, #ff3b3b, #f59e0b, #10b981, #3b82f6, #8b5cf6, #f43f5e, #ff3b3b)",
            opacity: customAccent ? 0 : 1,
          }}
        />
        <span
          className="pointer-events-none absolute inset-0"
          style={{ backgroundColor: customAccent ?? "transparent" }}
        />
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          className="relative z-10 drop-shadow-[0_0_2px_rgba(0,0,0,0.5)]"
        >
          <path d="M6 1v10M1 6h10" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          type="color"
          aria-label={t("settings.appearance.accent_custom")}
          value={customAccent ?? "#8b5cf6"}
          onChange={(event) => setCustomAccent(event.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}

export function AppearanceTab({ searchQuery }: { searchQuery?: string }) {
  const { t, locale, setLocale } = useTranslation();
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();
  const isGlassActive = useCustomizationStore(selectIsGlassThemeActive);

  const accent = useAppearanceStore((s) => s.accent);
  const customAccent = useAppearanceStore((s) => s.customAccent);
  const corners = useAppearanceStore((s) => s.corners);
  const surface = useAppearanceStore((s) => s.surface);
  const reduceMotion = useAppearanceStore((s) => s.reduceMotion);
  const compactLists = useAppearanceStore((s) => s.compactLists);
  const setCorners = useAppearanceStore((s) => s.setCorners);
  const setSurface = useAppearanceStore((s) => s.setSurface);
  const setReduceMotion = useAppearanceStore((s) => s.setReduceMotion);
  const setCompactLists = useAppearanceStore((s) => s.setCompactLists);
  const resetAppearance = useAppearanceStore((s) => s.resetAppearance);

  useEffect(() => {
    setMounted(true);
  }, []);

  const systemIsLight =
    mounted &&
    typeof window !== "undefined" &&
    !window.matchMedia("(prefers-color-scheme: dark)").matches;

  const accentLabel = customAccent
    ? t("settings.appearance.accent_custom_value", { color: customAccent.toUpperCase() })
    : (() => {
        const key = `settings.appearance.accent_${accent === "default" ? "default" : accent}`;
        const label = t(key);
        return label === key ? accent : label;
      })();

  return (
    <>
      <SettingSection>
        <SettingRow
          title={t("settings.language.label")}
          description={t("settings.language.description")}
          titleKey="settings.language.label"
          descKey="settings.language.description"
          searchQuery={searchQuery}
          control={
            mounted ? (
              <Select
                options={LOCALE_OPTIONS}
                value={locale}
                onChange={setLocale}
                align="bottom-right"
                className="min-w-[130px]"
                aria-label={t("settings.language.label")}
              />
            ) : (
              <span />
            )
          }
        />

        <SettingBlock
          title={t("settings.theme.title")}
          description={
            isGlassActive
              ? t("settings.theme.disabled_for_glass") ||
                "Light theme is disabled when using custom wallpaper glassmorphism."
              : t("settings.theme.description")
          }
          titleKey="settings.theme.title"
          descKey={isGlassActive ? undefined : "settings.theme.description"}
          searchQuery={searchQuery}
        >
          {mounted ? (
            <div className="grid grid-cols-3 gap-[10px]">
              {(
                [
                  { value: "system", label: t("settings.theme.system") },
                  { value: "light", label: t("settings.theme.light") },
                  { value: "dark", label: t("settings.theme.dark") },
                ] as const
              ).map((item) => {
                const isLightOpt = item.value === "light";
                const isSystemLightOpt = item.value === "system" && systemIsLight;
                const disabled = isGlassActive && (isLightOpt || isSystemLightOpt);

                return (
                  <ThemeCard
                    key={item.value}
                    mode={item.value}
                    label={item.label}
                    active={theme === item.value}
                    disabled={disabled}
                    disabledReason={
                      disabled
                        ? t("settings.theme.disabled_for_glass") ||
                          "Light theme is disabled when using custom wallpaper glassmorphism."
                        : undefined
                    }
                    onSelect={() => setTheme(item.value)}
                  />
                );
              })}
            </div>
          ) : null}
        </SettingBlock>

        <SettingRow
          title={t("settings.appearance.accent")}
          description={t("settings.appearance.accent_desc")}
          titleKey="settings.appearance.accent"
          descKey="settings.appearance.accent_desc"
          searchQuery={searchQuery}
          control={mounted ? <AccentPicker /> : <span />}
        />

        <SettingRow
          title={t("settings.appearance.corners")}
          description={t("settings.appearance.corners_desc")}
          titleKey="settings.appearance.corners"
          descKey="settings.appearance.corners_desc"
          searchQuery={searchQuery}
          control={
            mounted ? (
              <SegmentedControl<CornerStyle>
                ariaLabel={t("settings.appearance.corners")}
                value={corners}
                onChange={setCorners}
                options={[
                  { value: "soft", label: t("settings.appearance.corners_soft") },
                  { value: "default", label: t("settings.appearance.corners_default") },
                  { value: "round", label: t("settings.appearance.corners_round") },
                ]}
              />
            ) : (
              <span />
            )
          }
        />

        <SettingRow
          title={t("settings.appearance.surface")}
          description={t("settings.appearance.surface_desc")}
          titleKey="settings.appearance.surface"
          descKey="settings.appearance.surface_desc"
          searchQuery={searchQuery}
          control={
            mounted ? (
              <SegmentedControl<SurfaceStyle>
                ariaLabel={t("settings.appearance.surface")}
                value={surface}
                onChange={setSurface}
                options={[
                  { value: "default", label: t("settings.appearance.surface_default") },
                  { value: "contrast", label: t("settings.appearance.surface_contrast") },
                  { value: "oled", label: t("settings.appearance.surface_oled") },
                ]}
              />
            ) : (
              <span />
            )
          }
        />

        <SettingRow
          title={t("settings.appearance.compact")}
          description={t("settings.appearance.compact_desc")}
          titleKey="settings.appearance.compact"
          descKey="settings.appearance.compact_desc"
          searchQuery={searchQuery}
          control={
            <ToggleSwitch
              checked={compactLists}
              onChange={setCompactLists}
              ariaLabel={t("settings.appearance.compact")}
            />
          }
        />

        <SettingRow
          title={t("settings.appearance.reduce_motion")}
          description={t("settings.appearance.reduce_motion_desc")}
          titleKey="settings.appearance.reduce_motion"
          descKey="settings.appearance.reduce_motion_desc"
          searchQuery={searchQuery}
          control={
            <ToggleSwitch
              checked={reduceMotion}
              onChange={setReduceMotion}
              ariaLabel={t("settings.appearance.reduce_motion")}
            />
          }
        />

        <SettingRow
          title={t("settings.appearance.reset")}
          description={t("settings.appearance.reset_desc", { accent: accentLabel })}
          titleKey="settings.appearance.reset"
          descKey="settings.appearance.reset_desc"
          searchQuery={searchQuery}
          control={
            <button
              type="button"
              onClick={resetAppearance}
              className="inline-flex h-[28px] shrink-0 cursor-pointer items-center rounded-md border-0 bg-border-alpha-14 px-[11px] text-[12.5px] font-[500] text-text-secondary transition-colors hover:bg-border-alpha-33 hover:text-text-primary active:scale-[0.97]"
              style={font}
            >
              {t("settings.appearance.reset_action")}
            </button>
          }
        />
      </SettingSection>
    </>
  );
}
