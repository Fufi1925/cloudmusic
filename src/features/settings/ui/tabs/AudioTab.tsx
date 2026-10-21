import { useState, useEffect } from "react";
import { FolderOpenLine } from "@mingcute/react";
import { useToast } from "@/shared/ui";
import Button from "@/shared/ui/Button";
import { useTranslation } from "@/languages";
import {
  playerEngine,
  usePlayerState,
  usePlayerStore,
  type AudioQuality,
} from "@/features/player";
import { CROSSFADE_MAX_SECONDS } from "@/features/player/store/playerStore";
import { EQ_BAND_COUNT } from "@/features/player/engine/eqMath";
import { Select, Slider, ToggleSwitch } from "@/shared/ui";
import { useConnectivityStore } from "@/features/connectivity";
import { SettingRow, SettingSection, SegmentedControl } from "../controls";
import { getTranslationsForAllLocales } from "@/languages/translator";
import { EqualizerPanel } from "@/features/player/ui/EqualizerPanel";

const QUALITY_HINT_KEYS: Record<Exclude<AudioQuality, "lossless">, string> = {
  low: "settings.audio.quality_hint_low",
  standard: "settings.audio.quality_hint_standard",
  high: "settings.audio.quality_hint_high",
};

export function AudioTab({ searchQuery }: { searchQuery?: string }) {
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(false);
  const { toast } = useToast();
  const [dumpExported, setDumpExported] = useState(false);
  const eqEnabled = usePlayerState().eqEnabled;
  const audioQuality = usePlayerStore((state) => state.audioQuality);
  const setAudioQuality = usePlayerStore((state) => state.setAudioQuality);
  const crossfadeSeconds = usePlayerStore((state) => state.crossfadeSeconds);
  const setCrossfadeSeconds = usePlayerStore((state) => state.setCrossfadeSeconds);
  const gaplessPlayback = usePlayerStore((state) => state.gaplessPlayback);
  const setGaplessPlayback = usePlayerStore((state) => state.setGaplessPlayback);
  const normalizeVolume = usePlayerStore((state) => state.normalizeVolume);
  const setNormalizeVolume = usePlayerStore((state) => state.setNormalizeVolume);
  const normalizationLevel = usePlayerStore((state) => state.normalizationLevel);
  const setNormalizationLevel = usePlayerStore((state) => state.setNormalizationLevel);
  const channelBalance = usePlayerStore((state) => state.channelBalance);
  const setChannelBalance = usePlayerStore((state) => state.setChannelBalance);
  const connRunning = useConnectivityStore((s) => s.running);
  const connChecks = useConnectivityStore((s) => s.checks);
  const connLastRunAt = useConnectivityStore((s) => s.lastRunAt);
  const runAndSaveDump = useConnectivityStore((s) => s.runAndSaveDump);

  useEffect(() => {
    setMounted(true);
  }, []);

  // lossless is listed as unavailable, so the picker only offers live tiers
  const quality: Exclude<AudioQuality, "lossless"> =
    audioQuality === "lossless" ? "high" : audioQuality;

  const balanceLabel = (value: number) => {
    if (value === 0) return t("settings.audio.balance.center");
    return value < 0
      ? t("settings.audio.balance.left", { value: Math.abs(value) })
      : t("settings.audio.balance.right", { value });
  };

  const handleReset = () => {
    const store = usePlayerStore.getState();
    store.setAudioQuality("high");
    store.setCrossfadeSeconds(0);
    store.setGaplessPlayback(true);
    store.setNormalizeVolume(false);
    store.setNormalizationLevel("balanced");
    store.setChannelBalance(0);
    store.setEqBands(new Array(EQ_BAND_COUNT).fill(0));
    store.setEqEnabled(false);
    toast(t("settings.audio.reset_done"), "info");
  };

  return (
    <div className="flex flex-col gap-[16px]">
      <SettingSection>
        <SettingRow
          title={t("settings.audio.title")}
          description={t(QUALITY_HINT_KEYS[quality])}
          titleKey="settings.audio.title"
          descKey="settings.audio.description"
          searchQuery={searchQuery}
          control={
            mounted ? (
              <Select
                aria-label={t("settings.audio.title")}
                className="w-[210px] max-md:w-full"
                value={quality}
                onChange={setAudioQuality}
                options={[
                  { value: "low", label: t("settings.audio.low") },
                  { value: "standard", label: t("settings.audio.standard") },
                  { value: "high", label: t("settings.audio.high") },
                ]}
              />
            ) : (
              <span />
            )
          }
        />
        <SettingRow
          title={t("settings.audio.crossfade.title")}
          description={t("settings.audio.crossfade.description")}
          titleKey="settings.audio.crossfade.title"
          descKey="settings.audio.crossfade.description"
          searchQuery={searchQuery}
          control={
            <div className="w-[190px] max-md:w-full">
              <Slider
                value={crossfadeSeconds}
                onChange={setCrossfadeSeconds}
                min={0}
                max={CROSSFADE_MAX_SECONDS}
                step={1}
                ariaLabel={t("settings.audio.crossfade.title")}
                formatValue={(value) =>
                  value <= 0 ? t("settings.audio.crossfade.off") : `${value} s`
                }
              />
            </div>
          }
        />
        <SettingRow
          title={t("settings.audio.gapless.title")}
          description={t("settings.audio.gapless.description")}
          titleKey="settings.audio.gapless.title"
          descKey="settings.audio.gapless.description"
          searchQuery={searchQuery}
          control={
            <ToggleSwitch
              checked={gaplessPlayback}
              onChange={setGaplessPlayback}
              ariaLabel={t("settings.audio.gapless.title")}
            />
          }
        />
        <SettingRow
          title={t("settings.audio.normalization.title")}
          description={t("settings.audio.normalization.description")}
          titleKey="settings.audio.normalization.title"
          descKey="settings.audio.normalization.description"
          searchQuery={searchQuery}
          control={
            <ToggleSwitch
              checked={normalizeVolume}
              onChange={setNormalizeVolume}
              ariaLabel={t("settings.audio.normalization.title")}
            />
          }
        />
        {normalizeVolume && (
          <SettingRow
            title={t("settings.audio.normalization_level.title")}
            description={t("settings.audio.normalization_level.description")}
            titleKey="settings.audio.normalization_level.title"
            descKey="settings.audio.normalization_level.description"
            searchQuery={searchQuery}
            control={
              <SegmentedControl
                ariaLabel={t("settings.audio.normalization_level.title")}
                value={normalizationLevel}
                onChange={setNormalizationLevel}
                options={[
                  { value: "quiet", label: t("settings.audio.normalization_level.quiet") },
                  { value: "balanced", label: t("settings.audio.normalization_level.balanced") },
                  { value: "loud", label: t("settings.audio.normalization_level.loud") },
                ]}
              />
            }
          />
        )}
        <SettingRow
          title={t("settings.audio.balance.title")}
          description={t("settings.audio.balance.description")}
          titleKey="settings.audio.balance.title"
          descKey="settings.audio.balance.description"
          searchQuery={searchQuery}
          control={
            <div className="w-[190px] max-md:w-full">
              <Slider
                value={Math.round(channelBalance * 100)}
                onChange={(value) => setChannelBalance(value / 100)}
                min={-100}
                max={100}
                step={5}
                ariaLabel={t("settings.audio.balance.title")}
                formatValue={() => balanceLabel(Math.round(channelBalance * 100))}
              />
            </div>
          }
        />
        <SettingRow
          title={t("settings.audio.equalizer_title")}
          description={t("settings.audio.equalizer_description")}
          titleKey="settings.audio.equalizer_title"
          descKey="settings.audio.equalizer_description"
          searchQuery={searchQuery}
          control={
            <ToggleSwitch
              checked={eqEnabled}
              onChange={(checked) => playerEngine.setEqEnabled(checked)}
              ariaLabel={t("player.equalizer")}
            />
          }
        />
        <EqPanelSlot searchQuery={searchQuery} />
        <SettingRow
          title={t("settings.audio.reset.title")}
          description={t("settings.audio.reset.description")}
          titleKey="settings.audio.reset.title"
          descKey="settings.audio.reset.description"
          searchQuery={searchQuery}
          control={
            <Button variant="secondary" size="sm" onClick={handleReset}>
              {t("settings.reset_defaults") || "Reset"}
            </Button>
          }
        />
      </SettingSection>

      <SettingSection label={t("settings.connection.title")}>
        <SettingRow
          title={t("settings.connection.checks_title")}
          titleKey="settings.connection.checks_title"
          searchQuery={searchQuery}
          description={
            connChecks.length > 0 && connLastRunAt
              ? t("settings.connection.last_run", {
                  ok: connChecks.filter((c) => c.status === "ok").length,
                  total: connChecks.length,
                  time: new Date(connLastRunAt).toLocaleTimeString(),
                })
              : t("settings.connection.never_run")
          }
          control={
            <div className="flex items-center gap-[8px]">
              {dumpExported && (
                <Button
                  variant="secondary"
                  type="button"
                  onClick={async () => {
                    const targetPath = useConnectivityStore.getState().lastSavedDumpPath || undefined;
                    if (window.cloudMusicElectron?.openExportFolder) {
                      await window.cloudMusicElectron.openExportFolder(targetPath);
                    } else if (window.cloudMusicElectron?.openDownloads) {
                      await window.cloudMusicElectron.openDownloads(targetPath);
                    } else {
                      toast(t("settings.connection.open_folder"), "info");
                    }
                  }}
                  title={t("settings.connection.open_folder")}
                  aria-label={t("settings.connection.open_folder")}
                  className="!h-[34px] !w-[34px] !px-0"
                >
                  <FolderOpenLine size={18} />
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                type="button"
                disabled={connRunning}
                onClick={async () => {
                  const res = await runAndSaveDump();
                  if (res.success) {
                    setDumpExported(true);
                    toast(t("settings.connection.saved"), "success");
                  } else if (!res.canceled) {
                    toast(t("settings.connection.failed"), "error");
                  }
                }}
              >
                {connRunning
                  ? t("settings.connection.checking")
                  : t("settings.connection.button")}
              </Button>
            </div>
          }
        />
      </SettingSection>
    </div>
  );
}

/** The EQ panel follows the settings search, but has no row title of its own. */
function EqPanelSlot({ searchQuery }: { searchQuery?: string }) {
  const { t } = useTranslation();
  const query = searchQuery?.toLowerCase().trim();
  if (query) {
    const haystack = [
      t("settings.audio.equalizer_title"),
      t("settings.audio.equalizer_description"),
      t("player.equalizer"),
      ...getTranslationsForAllLocales("player.equalizer"),
    ];
    if (!haystack.some((text) => text.toLowerCase().includes(query))) return null;
  }
  return (
    <div className="py-[13px]">
      <div className="rounded-xl border border-border-primary/60 bg-border-alpha-10 p-[14px]">
        <EqualizerPanel showHeader={false} />
      </div>
    </div>
  );
}
