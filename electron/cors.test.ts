import { describe, expect, it } from "vitest";
import { keepsOwnCors, needsOpenCors, withOpenCors } from "./cors";

describe("cors policy", () => {
  it("opens cors for the known api and stream hosts", () => {
    expect(needsOpenCors("https://api.tryliner.fun/v1/me")).toBe(true);
    expect(needsOpenCors("https://covers.tryliner.fun/x.jpg")).toBe(true);
    expect(needsOpenCors("https://rr3---sn-abc.googlevideo.com/videoplayback")).toBe(true);
    expect(needsOpenCors("https://i.scdn.co/image/abc")).toBe(true);
    expect(needsOpenCors("https://example.com/app.js")).toBe(false);
  });

  it("knows which hosts answer credentialed requests themselves", () => {
    expect(keepsOwnCors("https://api.tryliner.fun/v1/auth/register")).toBe(true);
    expect(keepsOwnCors("https://tryliner.fun/x")).toBe(true);
    expect(keepsOwnCors("https://googlevideo.com/x")).toBe(false);
  });

  it("keeps the api's own credentialed headers untouched", () => {
    const own = {
      "Access-Control-Allow-Origin": ["null"],
      "Access-Control-Allow-Credentials": ["true"],
      "Access-Control-Allow-Headers": ["*"],
    };
    const result = withOpenCors(own, "POST", true);
    expect(result.responseHeaders).toEqual(own);
    expect(result.statusLine).toBeUndefined();
  });

  it("answers a credentialed preflight with a success status", () => {
    const own = {
      "access-control-allow-origin": ["null"],
      "access-control-allow-credentials": ["true"],
    };
    const result = withOpenCors(own, "OPTIONS", true);
    expect(result.responseHeaders).toEqual(own);
    expect(result.statusLine).toBe("HTTP/1.1 200 OK");
  });

  it("still opens everything else up (wildcard, no credentials)", () => {
    const result = withOpenCors(
      { "Access-Control-Allow-Origin": ["https://x"], "Content-Type": ["audio/mpeg"] },
      "GET",
    );
    expect(result.responseHeaders["access-control-allow-origin"]).toEqual(["*"]);
    expect(result.responseHeaders["access-control-allow-credentials"]).toBeUndefined();
    expect(result.responseHeaders["Content-Type"]).toEqual(["audio/mpeg"]);
    expect(result.responseHeaders["access-control-allow-methods"][0]).toContain("POST");
  });

  it("turns every preflight into a 200", () => {
    expect(withOpenCors(undefined, "OPTIONS").statusLine).toBe("HTTP/1.1 200 OK");
    expect(withOpenCors(undefined, "GET").statusLine).toBeUndefined();
  });

  it("ignores a wildcard-only api response (it cannot carry credentials)", () => {
    const result = withOpenCors({ "access-control-allow-origin": ["*"] }, "POST", true);
    expect(result.responseHeaders["access-control-allow-origin"]).toEqual(["*"]);
    expect(result.responseHeaders["access-control-allow-credentials"]).toBeUndefined();
  });
});
