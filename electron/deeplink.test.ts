import { describe, expect, it } from "vitest";
import { findDeeplinkArg, parseDeeplink } from "./deeplink";

describe("parseDeeplink", () => {
  it("accepts real share targets", () => {
    expect(parseDeeplink("cloudmusic://artist?id=UCGtGpOIGHfRu1KYL9pi-mNQ")).toEqual({
      type: "artist",
      id: "UCGtGpOIGHfRu1KYL9pi-mNQ",
    });
    expect(parseDeeplink("cloudmusic://album?id=MPREb_xCxkOKReFZv")).toEqual({
      type: "album",
      id: "MPREb_xCxkOKReFZv",
    });
    expect(
      parseDeeplink("cloudmusic://playlist?id=VLPLD8jNKEyHYB2DHh5vXSI4USLFo29vzUYl"),
    ).toEqual({ type: "playlist", id: "VLPLD8jNKEyHYB2DHh5vXSI4USLFo29vzUYl" });
    expect(parseDeeplink("cloudmusic://track?id=RGdkabupfPI")).toEqual({
      type: "track",
      id: "RGdkabupfPI",
    });
  });

  it("rejects smuggled urls", () => {
    expect(parseDeeplink("https://evil.com")).toBeNull();
    expect(parseDeeplink("javascript:alert(1)")).toBeNull();
    expect(parseDeeplink("cloudmusic://artist?id=UCaaaaaaaaaaaaaaaaaaaaaa&x=1&y=2")).toEqual({
      type: "artist",
      id: "UCaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(
      parseDeeplink("cloudmusic://artist?id=UCaaaaaaaaaaaaaaaaaaaaaa&id=UCbbbbbbbbbbbbbbbbbbbbbb"),
    ).toBeNull();
    expect(parseDeeplink("cloudmusic://artist")).toBeNull();
    expect(parseDeeplink("cloudmusic://evil?id=RGdkabupfPI")).toBeNull();
    expect(parseDeeplink("cloudmusic://track?id=RGdkabupfPIextra")).toBeNull();
    expect(parseDeeplink("cloudmusic://artist?id=ABaaaaaaaaaaaaaaaaaaaaaa")).toBeNull();
    expect(parseDeeplink("cloudmusic://artist?id=UCaaa/../../../../etc")).toBeNull();
    expect(parseDeeplink("not a url")).toBeNull();
  });

  it("finds the deeplink arg anywhere in argv", () => {
    expect(
      findDeeplinkArg(["/usr/bin/cloudmusic", "cloudmusic://track?id=RGdkabupfPI"]),
    ).toBe("cloudmusic://track?id=RGdkabupfPI");
    expect(findDeeplinkArg(["/usr/bin/cloudmusic", "--no-sandbox"])).toBeUndefined();
  });
});
