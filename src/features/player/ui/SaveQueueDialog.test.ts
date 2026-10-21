import { describe, expect, it } from "vitest";
import { toApiTrack } from "./SaveQueueDialog";
import type { Track as PlayerTrack } from "@/shared/types/track";

function playerTrack(overrides: Partial<PlayerTrack> = {}): PlayerTrack {
  return {
    id: "yt:abc123",
    title: "Blinding Lights",
    artists: "The Weeknd",
    coverUrl: "https://img.example/cover.jpg",
    durationMs: 200_040,
    playCount: 12,
    ...overrides,
  };
}

describe("toApiTrack", () => {
  it("maps the player shape to a playlist snapshot", () => {
    const snapshot = toApiTrack(playerTrack());

    expect(snapshot).toMatchObject({
      id: "yt:abc123",
      title: "Blinding Lights",
      durationMs: 200_040,
      cover: { url: "https://img.example/cover.jpg", width: 480, height: 480 },
    });
    expect(snapshot.artists).toEqual([{ id: "queue_yt:abc123_0", name: "The Weeknd" }]);
    expect(snapshot.album).toBeUndefined();
  });

  it("prefers artistList entries and splits a comma joined artist string", () => {
    const withList = toApiTrack(
      playerTrack({ artistList: [{ id: "UC_1", name: "Kendrick Lamar" }], artists: "Kendrick Lamar" }),
    );
    expect(withList.artists).toEqual([{ id: "UC_1", name: "Kendrick Lamar" }]);

    const joined = toApiTrack(playerTrack({ artists: "A$AP Rocky, Skepta" }));
    expect(joined.artists.map((artist) => artist.name)).toEqual(["A$AP Rocky", "Skepta"]);
  });

  it("keeps album and explicit flags, and drops an empty cover", () => {
    const snapshot = toApiTrack(
      playerTrack({
        coverUrl: "",
        explicit: true,
        album: { id: "album_1", title: "After Hours" },
      }),
    );

    expect(snapshot.album).toEqual({ id: "album_1", title: "After Hours" });
    expect(snapshot.explicit).toBe(true);
    expect(snapshot.cover).toBeUndefined();
  });
});
