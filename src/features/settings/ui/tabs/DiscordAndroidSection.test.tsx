import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nProvider } from "@/languages";
import { DiscordAndroidSection } from "./DiscordAndroidSection";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// clearly fake, never token-shaped: GitHub push protection rejects discord-like secrets
const TOKEN = ["fake", "token", "only", "for", "unit", "tests"].join("-");

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

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
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

  it("shows the connect flow once the android bridge is present", async () => {
    setApi({
      getDiscordStatus: vi.fn(async () => ({ connected: false, hasToken: false, platform: "android" })),
      discordSetToken: vi.fn(),
      discordClearToken: vi.fn(),
      discordOpenLogin: vi.fn(async () => null),
    });
    const { host } = mount();
    await flush();

    expect(host.textContent).toContain("Discord verbinden");
    expect(host.textContent).toContain("Kein Token gespeichert");
    expect(host.querySelector("input")).toBeTruthy();
  });

  it("stores the pasted token through the bridge", async () => {
    const setToken = vi.fn(async () => ({
      connected: false,
      hasToken: true,
      platform: "android",
    }));
    setApi({
      getDiscordStatus: vi.fn(async () => ({ connected: false, hasToken: false, platform: "android" })),
      discordSetToken: setToken,
      discordClearToken: vi.fn(async () => ({ connected: false, hasToken: false })),
      discordOpenLogin: vi.fn(async () => null),
    });
    const { host } = mount();
    await flush();

    const input = host.querySelector("input") as HTMLInputElement;
    type(input, TOKEN);

    const buttons = Array.from(host.querySelectorAll("button"));
    const save = buttons.find((b) => b.textContent?.includes("Speichern"));
    click(save ?? null);
    await flush();

    expect(setToken).toHaveBeenCalledWith(TOKEN);
    expect(host.textContent).toContain("Token gespeichert");
  });

  it("opens the discord login page in the browser", async () => {
    const openLogin = vi.fn(async () => null);
    setApi({
      getDiscordStatus: vi.fn(async () => ({ connected: false, hasToken: false, platform: "android" })),
      discordSetToken: vi.fn(),
      discordClearToken: vi.fn(),
      discordOpenLogin: openLogin,
    });
    const { host } = mount();
    await flush();

    const buttons = Array.from(host.querySelectorAll("button"));
    click(buttons.find((b) => b.textContent?.includes("im Browser")) ?? null);
    await flush();

    expect(openLogin).toHaveBeenCalled();
  });

  it("deletes a stored token", async () => {
    const clearToken = vi.fn(async () => ({ connected: false, hasToken: false }));
    setApi({
      getDiscordStatus: vi.fn(async () => ({ connected: false, hasToken: true, platform: "android" })),
      discordSetToken: vi.fn(),
      discordClearToken: clearToken,
      discordOpenLogin: vi.fn(async () => null),
    });
    const { host } = mount();
    await flush();

    const buttons = Array.from(host.querySelectorAll("button"));
    click(buttons.find((b) => b.textContent?.includes("löschen")) ?? null);
    await flush();

    expect(clearToken).toHaveBeenCalled();
  });
});
