import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "@/languages";
import { Button, Dialog, TextInput, showToast } from "@/shared/ui";
import { finalizeImportedPlaylist } from "@/features/library/services/import/manager/finalizeImport";
import type { Track as ApiTrack } from "@/shared/contracts";
import type { Track as PlayerTrack } from "@/shared/types/track";
import { usePlayerStore } from "../store/playerStore";

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;

/** The queue stores UI tracks (artists as a string); playlist snapshots need the API shape. */
export function toApiTrack(track: PlayerTrack): ApiTrack {
  const names = track.artistList?.map((artist) => artist.name).filter(Boolean);
  const artistNames =
    names && names.length > 0
      ? names
      : track.artists.split(",").map((name) => name.trim()).filter(Boolean);
  return {
    id: track.id,
    title: track.title,
    artists: (artistNames.length > 0 ? artistNames : [track.artists]).map((name, index) => ({
      id: track.artistList?.[index]?.id ?? track.artistId ?? `queue_${track.id}_${index}`,
      name,
    })),
    ...(track.album ? { album: { id: track.album.id, title: track.album.title } } : {}),
    durationMs: track.durationMs ?? 0,
    ...(track.coverUrl ? { cover: { url: track.coverUrl, width: 480, height: 480 } } : {}),
    ...(track.explicit ? { explicit: true } : {}),
  };
}

function defaultName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `Queue ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "Queue als Playlist speichern": snapshots the whole queue into a new account playlist. */
export function SaveQueueDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queue = usePlayerStore((state) => state.queue);
  const [name, setName] = useState(() => defaultName());
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(defaultName());
      setDescription("");
      setError(null);
      setSaving(false);
    }
  }, [open]);

  const uniqueCount = useMemo(
    () => new Set(queue.filter((track) => Boolean(track?.id)).map((track) => track.id)).size,
    [queue],
  );

  const trimmed = name.trim();
  const canSave = uniqueCount > 0 && trimmed.length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const result = await finalizeImportedPlaylist(trimmed, description, queue.map(toApiTrack));
      showToast(t("player.queue_save_success", { count: result.saved }), "checkmark", {
        description: trimmed,
      });
      window.dispatchEvent(new Event("library:changed"));
      onOpenChange(false);
    } catch {
      setError(t("player.queue_save_failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} maxWidth={380}>
      <div className="flex flex-col gap-[14px] p-[18px]" style={font}>
        <div className="flex flex-col gap-[3px]">
          <span className="text-[15px] font-[600] text-text-primary">
            {t("player.queue_save_title")}
          </span>
          <span className="text-[12.5px] leading-relaxed text-text-tertiary">
            {t("player.queue_save_description", { count: uniqueCount })}
          </span>
        </div>

        <TextInput
          aria-label={t("common.playlist_name")}
          placeholder={t("common.playlist_name")}
          value={name}
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void handleSave();
          }}
          autoFocus
        />

        <TextInput
          aria-label={t("common.description_placeholder")}
          placeholder={t("common.description_placeholder")}
          value={description}
          maxLength={2000}
          onChange={(event) => setDescription(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void handleSave();
          }}
        />

        {error && <span className="text-[12px] leading-snug text-red-500">{error}</span>}

        <div className="flex items-center justify-end gap-[8px]">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="sm" onClick={() => void handleSave()} disabled={!canSave}>
            {saving ? t("player.queue_saving") : t("player.queue_save_action")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export default SaveQueueDialog;
