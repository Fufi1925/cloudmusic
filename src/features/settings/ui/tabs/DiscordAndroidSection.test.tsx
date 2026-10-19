import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nProvider } from "@/languages";
import { DiscordAndroidSection } from "./DiscordAndroidSection";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

type Api = Record<string, unknown>;

function setApi(api: Api | undefined) {
  (window as unknown as { cloudMusicElectron?: Api }).cloudMusicElectron = api;
}

function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <I18nProvider>
        <DiscordAndroidSection />
      </I18nProvider>,
    );
  });
  return { host, root };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function click(el: Element | null) {
  expect(el).toBeTruthy();
  act(() => {
    (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function button(host: HTMLElement, label: string) {
  return Array.from(host.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(label),
  );
}

function androidApi(overrides: Api = {}) {
  return {
    getDiscordStatus: vi.fn(async () => ({ connected: false, hasToken: false, platform: "android" })),
    discordSetToken: vi.fn(),
    discordClearToken: vi.fn(async () => ({ connected: false, hasToken: false })),
    discordOpenLogin: vi.fn(async () => null),
    ...overrides,
  };
}

describe("DiscordAndroidSection", () => {
  let mounts: { host: HTMLElement; root: Root }[] = [];

  beforeEach(() => {
    mounts = [];
    setApi(undefined);
    window.localStorage.setItem("cloudmusic_locale", "de");
  });

  afterEach(() => {
    for (const mount of mounts) {
      act(() => mount.root.unmount());
      mount.host.remove();
    }
    setApi(undefined);
    window.localStorage.removeItem("cloudmusic_locale");
    vi.restoreAllMocks();
  });

  function mount() {
    const m = render();
    mounts.push(m);
    return m;
  }

  it("stays hidden on desktop builds without the android bridge", async () => {
    setApi({ getDiscordStatus: vi.fn(async () => ({ connected: false })) });
    const { host } = mount();
    await flush();
    expect(host.textContent).toBe("");
  });

  it("shows the connect button and the disconnected state", async () => {
    setApi(androidApi());
    const { host } = mount();
    await flush();

    expect(host.textContent).toContain("Mit Discord verbinden");
    expect(host.textContent).toContain("Nicht verbunden");
    // no manual token field any more: the login window does it
    expect(host.querySelector("input")).toBeNull();
  });

  it("opens the in-app discord login", async () => {
    const api = androidApi();
    setApi(api);
    const { host } = mount();
    await flush();

    click(button(host, "Mit Discord verbinden") ?? null);
    await flush();

    expect(api.discordOpenLogin).toHaveBeenCalled();
  });

  it("shows the connected account once the login produced a token", async () => {
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce({ connected: false, hasToken: false, platform: "android" })
      .mockResolvedValue({ connected: true, hasToken: true, username: "fufi", platform: "android" });
    setApi(androidApi({ getDiscordStatus: getStatus }));
    const { host } = mount();
    await flush();

    window.dispatchEvent(new Event("focus"));
    await flush();

    expect(host.textContent).toContain("Verbunden als fufi");
    expect(host.textContent).toContain("Neu anmelden");
  });

  it("deletes a stored token", async () => {
    const clearToken = vi.fn(async () => ({ connected: false, hasToken: false }));
    setApi(
      androidApi({
        getDiscordStatus: vi.fn(async () => ({ connected: true, hasToken: true, username: "fufi", platform: "android" })),
        discordClearToken: clearToken,
      }),
    );
    const { host } = mount();
    await flush();

    click(button(host, "Token löschen") ?? null);
    await flush();

    expect(clearToken).toHaveBeenCalled();
    expect(host.textContent).toContain("Token gelöscht");
  });
});
