import { afterEach, describe, expect, it, vi } from "vitest";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

interface FakeRuntime {
  localStorage: MemoryStorage;
  sessionStorage: MemoryStorage;
  appendedScripts: Array<{ src: string; remove(): void }>;
  removedScripts: Array<{ src: string; remove(): void }>;
  cookieWrites: string[];
  reload: ReturnType<typeof vi.fn>;
  window: Window;
}

function installBrowserRuntime({
  consent,
  pathname = "/",
  cookie = ""
}: {
  consent?: "granted" | "denied";
  pathname?: string;
  cookie?: string;
} = {}): FakeRuntime {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  if (consent) localStorage.setItem("skill-reverse:analytics-consent", consent);
  const appendedScripts: Array<{ src: string; remove(): void }> = [];
  const removedScripts: Array<{ src: string; remove(): void }> = [];
  const cookieWrites: string[] = [];
  const reload = vi.fn();
  const legacyScript = {
    src: "https://www.googletagmanager.com/gtm.js?id=legacy",
    remove: vi.fn()
  };
  removedScripts.push(legacyScript);
  const head = {
    appendChild(script: { src: string; remove(): void }) {
      appendedScripts.push(script);
      return script;
    }
  };
  const document = {
    head,
    createElement: vi.fn(() => ({
      async: false,
      nonce: "",
      referrerPolicy: "",
      src: "",
      remove: vi.fn()
    })),
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => [legacyScript]),
    get cookie() {
      return cookie;
    },
    set cookie(value: string) {
      cookieWrites.push(value);
    }
  };
  const fakeWindow = {
    localStorage,
    sessionStorage,
    location: {
      hostname: "skill-reverse.vibeencode.dev",
      pathname,
      reload
    },
    btoa: (value: string) => globalThis.btoa(value),
    dataLayer: undefined
  } as unknown as Window;
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", document);
  return {
    localStorage,
    sessionStorage,
    appendedScripts,
    removedScripts,
    cookieWrites,
    reload,
    window: fakeWindow
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("browser analytics consent", () => {
  it.each([undefined, "denied"] as const)(
    "keeps %s consent free of dataLayer and scripts while clearing legacy identity",
    async (consent) => {
      const runtime = installBrowserRuntime({
        consent,
        cookie: "_ga=legacy; _clck=clarity; sr_actor=necessary"
      });
      runtime.localStorage.setItem("_ga_ABC", "legacy");
      runtime.localStorage.setItem("mp_project_mixpanel", "legacy");
      runtime.localStorage.setItem("skill-reverse:locale", "en");
      runtime.sessionStorage.setItem("clarity-session", "legacy");
      runtime.sessionStorage.setItem("skill-reverse:job", "necessary");
      runtime.window.dataLayer = [{ event: "legacy" }];
      const analytics = await import("../src/analytics");

      analytics.initializeAnalytics();
      expect(analytics.track("target_url_entered")).toBeUndefined();

      expect(runtime.window.dataLayer).toBeUndefined();
      expect(runtime.appendedScripts).toHaveLength(0);
      expect(runtime.removedScripts[0].remove).toHaveBeenCalledOnce();
      expect(runtime.localStorage.getItem("_ga_ABC")).toBeNull();
      expect(runtime.localStorage.getItem("mp_project_mixpanel")).toBeNull();
      expect(runtime.localStorage.getItem("skill-reverse:locale")).toBe("en");
      expect(runtime.localStorage.getItem("skill-reverse:analytics-consent")).toBe(
        consent ?? null
      );
      expect(runtime.sessionStorage.getItem("clarity-session")).toBeNull();
      expect(runtime.sessionStorage.getItem("skill-reverse:job")).toBe("necessary");
      expect(runtime.cookieWrites.some((value) => value.startsWith("_ga="))).toBe(true);
      expect(runtime.cookieWrites.some((value) => value.startsWith("_clck="))).toBe(true);
      expect(runtime.cookieWrites.some((value) => value.startsWith("sr_actor="))).toBe(false);
    }
  );

  it("initializes once after consent and does not replay pre-consent events", async () => {
    const runtime = installBrowserRuntime();
    runtime.localStorage.setItem("_ga_ABC", "keep-after-grant");
    const analytics = await import("../src/analytics");

    expect(analytics.track("target_url_entered")).toBeUndefined();
    analytics.setAnalyticsContext({
      occupation_code: "pre-consent-occupation",
      research_stage: "pre-consent-stage"
    });
    expect(analytics.setAnalyticsConsent("granted")).toBe(true);
    analytics.setAnalyticsContext({ locale: "en", route_kind: "home" });
    analytics.initializeAnalytics();
    analytics.initializeAnalytics();
    analytics.track("page_view", { locale: "en", route_kind: "home" });

    expect(runtime.appendedScripts).toHaveLength(1);
    expect(runtime.appendedScripts[0].src).toContain("GTM-MS7BKGDZ");
    expect(runtime.localStorage.getItem("_ga_ABC")).toBe("keep-after-grant");
    expect(runtime.cookieWrites).toHaveLength(0);
    expect(runtime.window.dataLayer?.filter((entry) => entry.event === "gtm.js")).toHaveLength(1);
    expect(
      runtime.window.dataLayer
        ?.filter((entry) => entry.event === "product_event")
        .map((entry) => entry.event_name)
    ).toEqual(["page_view"]);
    expect(runtime.window.dataLayer?.at(-1)).not.toHaveProperty("occupation_code");
    expect(runtime.window.dataLayer?.at(-1)).not.toHaveProperty("research_stage");
    expect(runtime.window.dataLayer?.at(-1)).toMatchObject({
      locale: "en",
      route_kind: "home"
    });
  });

  it("clears known provider state and reloads when consent is withdrawn", async () => {
    const runtime = installBrowserRuntime({
      consent: "granted",
      cookie: "_ga=one; _ga_ABC=two; mp_project_mixpanel=three; sr_actor=necessary"
    });
    runtime.localStorage.setItem("mp_project_mixpanel", "stored");
    runtime.localStorage.setItem("skill-reverse:locale", "zh-TW");
    runtime.sessionStorage.setItem("_clsk", "stored");
    const analytics = await import("../src/analytics");
    analytics.initializeAnalytics();
    analytics.track("page_view");

    analytics.revokeAnalyticsConsent();

    expect(runtime.localStorage.getItem("skill-reverse:analytics-consent")).toBe("denied");
    expect(runtime.localStorage.getItem("skill-reverse:locale")).toBe("zh-TW");
    expect(runtime.localStorage.getItem("mp_project_mixpanel")).toBeNull();
    expect(runtime.sessionStorage.getItem("_clsk")).toBeNull();
    expect(runtime.window.dataLayer).toBeUndefined();
    expect(runtime.cookieWrites.some((value) => value.startsWith("_ga_ABC="))).toBe(true);
    expect(runtime.cookieWrites.some((value) => value.startsWith("sr_actor="))).toBe(false);
    expect(runtime.reload).toHaveBeenCalledOnce();
    expect(analytics.track("page_view")).toBeUndefined();
  });

  it("never initializes analytics on the admin route", async () => {
    const runtime = installBrowserRuntime({ consent: "granted", pathname: "/admin" });
    const analytics = await import("../src/analytics");

    analytics.initializeAnalytics();
    expect(analytics.track("page_view")).toBeUndefined();
    expect(runtime.appendedScripts).toHaveLength(0);
    expect(runtime.window.dataLayer).toBeUndefined();

    runtime.window.location.pathname = "/";
    analytics.initializeAnalytics();
    analytics.track("page_view", { route_kind: "home" });
    expect(runtime.appendedScripts).toHaveLength(1);
    expect(runtime.window.dataLayer?.at(-1)).toMatchObject({
      event: "product_event",
      event_name: "page_view",
      route_kind: "home"
    });
  });
});
