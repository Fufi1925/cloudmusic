import { useEffect, useState } from "react";
import { usePlayerStore } from "../store/playerStore";

/** `m:ss` below an hour, `h:mm:ss` above — used by the settings and the player */
export function formatSleepTimerRemaining(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.round(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `${hours}:${String(rest).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** live countdown, re-renders once per second while a timer is running */
export function useSleepTimerRemaining(): number | null {
  const endsAt = usePlayerStore((state) => state.sleepTimerEndsAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (endsAt === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  if (endsAt === null) return null;
  return Math.max(0, endsAt - now);
}
