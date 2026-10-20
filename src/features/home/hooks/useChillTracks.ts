import { useEffect, useState } from "react";
import { api, toClientTrack } from "@/shared/api";
import type { PopularItem } from "./usePopularTracks";

/**
 * Curated "chill" row for the home page. The cloudmusic server has no
 * dedicated editorial endpoint, so the row is assembled from a handful of
 * artist searches (quiet pop) whose results are interleaved and deduplicated
 * client side. Results are cached for ten minutes so switching pages does not
 * re-run eight searches.
 */
const CHILL_QUERIES = [
  "Lana Del Rey",
  "Billie Eilish",
  "Taylor Swift",
  "Gracie Abrams",
  "Olivia Rodrigo",
  "Adele",
  "Phoebe Bridgers",
  "girl in red",
] as const;

const PER_QUERY = 3;
const CACHE_KEY = "chill_row_v1";
const CACHE_TTL = 10 * 60_000;

const cache = new Map<string, { data: PopularItem[]; timestamp: number }>();

function interleave(lists: PopularItem[][]): PopularItem[] {
  const out: PopularItem[] = [];
  const seen = new Set<string>();
  const maxLength = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < maxLength; index += 1) {
    for (const list of lists) {
      const entry = list[index];
      if (!entry) continue;
      const id = entry.item.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(entry);
    }
  }
  return out;
}

export function useChillTracks(limit = 24) {
  const [data, setData] = useState<PopularItem[]>(
    () => cache.get(CACHE_KEY)?.data ?? [],
  );
  const [isLoading, setIsLoading] = useState(() => !cache.has(CACHE_KEY));

  useEffect(() => {
    const cached = cache.get(CACHE_KEY);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setData(cached.data);
      setIsLoading(false);
      return;
    }

    let active = true;
    let cancelled = false;

    const run = async () => {
      const results = await Promise.all(
        CHILL_QUERIES.map(async (query) => {
          try {
            const response = await api.search(query, "track");
            return response.items
              .filter((item) => item.type === "track")
              .slice(0, PER_QUERY)
              .map<PopularItem>((item) => ({
                type: "track",
                item: toClientTrack(item),
                playCount: 0,
              }));
          } catch {
            return [] as PopularItem[];
          }
        }),
      );
      if (cancelled) return;
      const items = interleave(results).slice(0, limit);
      if (items.length > 0) {
        cache.set(CACHE_KEY, { data: items, timestamp: Date.now() });
        if (active) setData(items);
      }
      if (active) setIsLoading(false);
    };

    void run();
    return () => {
      active = false;
      cancelled = true;
    };
  }, [limit]);

  return { data, isLoading };
}
