import { useTranslation } from "@/languages";
import { playerEngine, usePlayerStore } from "@/features/player";
import {
  formatSleepTimerRemaining,
  useSleepTimerRemaining,
} from "@/features/player/hooks/useSleepTimer";
import { Select } from "@/shared/ui";
import { SettingRow } from "../controls";

/** presets in minutes; 0 switches the timer off */
const SLEEP_TIMER_PRESETS = [0, 5, 15, 30, 45, 60, 90, 120];

export function SleepTimerRow({ searchQuery }: { searchQuery?: string }) {
  const { t } = useTranslation();
  const endsAt = usePlayerStore((state) => state.sleepTimerEndsAt);
  const durationMs = usePlayerStore((state) => state.sleepTimerDurationMs);
  const remainingMs = useSleepTimerRemaining();

  const activeMinutes =
    endsAt !== null && durationMs ? Math.max(1, Math.round(durationMs / 60000)) : 0;
  // keep a non-preset duration selectable instead of snapping the menu to 30
  const options = activeMinutes > 0 && !SLEEP_TIMER_PRESETS.includes(activeMinutes)
    ? [...SLEEP_TIMER_PRESETS, activeMinutes].sort((a, b) => a - b)
    : SLEEP_TIMER_PRESETS;

  return (
    <SettingRow
      title={t("settings.sleep_timer.title")}
      description={
        endsAt !== null && remainingMs !== null
          ? t("settings.sleep_timer.remaining", {
              time: formatSleepTimerRemaining(remainingMs),
            })
          : t("settings.sleep_timer.description")
      }
      titleKey="settings.sleep_timer.title"
      descKey="settings.sleep_timer.description"
      searchQuery={searchQuery}
      control={
        <Select
          aria-label={t("settings.sleep_timer.title")}
          className="w-[190px]"
          value={String(activeMinutes)}
          onChange={(value) => {
            const minutes = Number(value);
            if (!minutes) {
              playerEngine.cancelSleepTimer();
            } else {
              playerEngine.startSleepTimer(minutes * 60_000);
            }
          }}
          options={options.map((minutes) => ({
            value: String(minutes),
            label:
              minutes === 0
                ? t("settings.sleep_timer.off")
                : t("settings.sleep_timer.minutes", { count: minutes }),
          }))}
        />
      }
    />
  );
}
