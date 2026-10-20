import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The "Listen on CloudMusic" Rich Presence button must point at the CloudTIX
 * domain. electron/discord.ts runs in the main process (it imports electron),
 * so instead of importing it we assert on the link literals in the source.
 */
const DISCORD_SOURCE = resolve(process.cwd(), "electron/discord.ts");
const ANDROID_SOURCE = resolve(
  process.cwd(),
  "android/app/src/main/java/com/hkamori/cloudmusic/DiscordRpc.java",
);

describe("discord rpc profile buttons", () => {
  it("points the listen button at the CloudTIX domain", () => {
    const source = readFileSync(DISCORD_SOURCE, "utf-8");
    expect(source).toContain('LISTEN_ON_CLOUDMUSIC_URL = "https://cloudtix.up.railway.app"');
    expect(source).toContain("url: LISTEN_ON_CLOUDMUSIC_URL,");
    expect(source).not.toContain("link.tryliner.fun/track");
    expect(source).not.toMatch(/label: "Listen on CloudMusic",\s*\n\s*url: `https:\/\/link\.tryliner\.fun/);
  });

  it("keeps the download button on the current repository", () => {
    const source = readFileSync(DISCORD_SOURCE, "utf-8");
    expect(source).toContain('DOWNLOAD_CLOUDMUSIC_URL = "https://github.com/Fufi1925/cloudmusic/releases"');
    expect(source).not.toContain("https://github.com/Fufi1925/Music./releases");
  });

  it("uses the same link in the android activity", () => {
    const source = readFileSync(ANDROID_SOURCE, "utf-8");
    expect(source).toContain('LISTEN_ON_CLOUDMUSIC_URL = "https://cloudtix.up.railway.app"');
    expect(source).toContain('buttons.put(button("Listen on CloudMusic", LISTEN_ON_CLOUDMUSIC_URL))');
  });
});
