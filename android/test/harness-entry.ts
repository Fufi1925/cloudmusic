// test-only bundle: exposes renderer modules to the desktop harness (never shipped in the APK)
import { resolveDirectAudioStream, downloadAudioBytes, searchCatalog, innertubeCatalog } from "@/shared/media/innertube";
import { PLAYBACK_PROFILES } from "@/shared/media/innertube/playbackProfiles";
import { resolveSoundCloudStream, soundcloudCatalog } from "@/shared/media/soundcloud";
import { getClientVisitorData } from "@/shared/api/visitorSession";

(window as any).__test = {
  resolveDirectAudioStream,
  downloadAudioBytes,
  searchCatalog,
  innertubeCatalog,
  PLAYBACK_PROFILES,
  resolveSoundCloudStream,
  soundcloudCatalog,
  getClientVisitorData,
};
