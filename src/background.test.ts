import { describe, it, expect, vi, beforeEach } from "vitest";
import { willParticipate } from "./calendar";

vi.mock("./calendar", () => ({
  listAllEvents: vi.fn(() => Promise.resolve([])),
  willParticipate: vi.fn(() => false),
}));

type MockOverrides = {
  icsUrl?: string;
  icsResponse?: string;
};

function setupChromeMocks(overrides: MockOverrides = {}) {
  const listeners = {
    onMessage: [] as Array<(msg: any, sender: any, cb: any) => any>,
    onAlarm: [] as Array<(alarm: any) => any>,
  };
  const fakeStorage: Record<string, string> = {};
  if (overrides.icsUrl) {
    fakeStorage["ics_url_1"] = overrides.icsUrl;
  }
  vi.stubGlobal("chrome", {
    identity: {
      getAuthToken: vi.fn((_opts, cb) => cb("token-abc")),
      removeCachedAuthToken: vi.fn((_opts, cb) => cb()),
      clearAllCachedAuthTokens: vi.fn((cb) => cb()),
    },
    alarms: {
      getAll: vi.fn(() => Promise.resolve([])),
      create: vi.fn(() => Promise.resolve()),
      clear: vi.fn(() => Promise.resolve(true)),
      clearAll: vi.fn(() => Promise.resolve(true)),
      onAlarm: { addListener: vi.fn((cb) => listeners.onAlarm.push(cb)) },
    },
    action: {
      setBadgeText: vi.fn(() => Promise.resolve()),
    },
    storage: {
      local: {
        get: vi.fn((keys: string[]) => {
          const result: Record<string, string> = {};
          for (const k of keys) {
            if (k in fakeStorage) result[k] = fakeStorage[k];
          }
          return Promise.resolve(result);
        }),
        set: vi.fn((items: Record<string, string>) => {
          Object.assign(fakeStorage, items);
          return Promise.resolve();
        }),
        remove: vi.fn((keys: string[]) => {
          for (const k of keys) delete fakeStorage[k];
          return Promise.resolve();
        }),
      },
    },
    runtime: {
      onMessage: {
        addListener: vi.fn((cb) => listeners.onMessage.push(cb)),
      },
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (overrides.icsResponse && url === overrides.icsUrl) {
        return Promise.resolve({
          text: () => Promise.resolve(overrides.icsResponse),
        });
      }
      return Promise.resolve({
        json: () => Promise.resolve({ sub: "1", email: "a@example.com" }),
      });
    })
  );
  return listeners;
}

async function loadBackgroundModule(overrides: MockOverrides = {}) {
  vi.resetModules();
  const listeners = setupChromeMocks(overrides);
  await import("./background");
  // let init()'s async chain settle
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return listeners;
}

function toIcsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function buildIcsFixture(start: Date, end: Date): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//Test//EN",
    "BEGIN:VEVENT",
    "UID:ics-event-1@example.com",
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    "SUMMARY:ICS MTG",
    "STATUS:CONFIRMED",
    "X-GOOGLE-CONFERENCE:https://meet.google.com/ics-test-1234",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("background service worker auth behavior", () => {
  it("does not force an interactive prompt when the periodic refetch alarm fires", async () => {
    const listeners = await loadBackgroundModule();
    (chrome.identity.getAuthToken as any).mockClear();

    const refetchHandler = listeners.onAlarm[0];
    await refetchHandler({ name: "CRX_GCAL_REFRESH" });
    await new Promise((r) => setTimeout(r, 0));

    for (const call of (chrome.identity.getAuthToken as any).mock.calls) {
      expect(call[0]).toEqual({ interactive: false });
    }
  });

  it("still allows an interactive prompt when the user explicitly signs in", async () => {
    const listeners = await loadBackgroundModule();
    (chrome.identity.getAuthToken as any).mockClear();

    const messageHandler = listeners.onMessage[0];
    await new Promise((resolve) =>
      messageHandler({ type: "SignInRequest" }, {}, resolve)
    );
    await new Promise((r) => setTimeout(r, 0));

    const calls = (chrome.identity.getAuthToken as any).mock.calls;
    expect(calls.some((call: any) => call[0].interactive === true)).toBe(
      true
    );
  });
});

describe("background service worker silent-auth failure handling", () => {
  it("does not throw or leave an unhandled rejection when silent token refresh fails on the refetch alarm", async () => {
    const listeners = await loadBackgroundModule();
    (chrome.identity.getAuthToken as any).mockImplementation(
      (opts: { interactive: boolean }, cb: (token?: string) => void) =>
        opts.interactive ? cb("token-abc") : cb(undefined)
    );

    const refetchHandler = listeners.onAlarm[0];
    await expect(refetchHandler({ name: "CRX_GCAL_REFRESH" })).resolves.not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe("background service worker ICS feed mode", () => {
  const icsUrl =
    "https://calendar.google.com/calendar/ical/test%40example.com/private-abc/basic.ics";

  it("fetches events from the configured ICS URL instead of calling the Google Calendar API, without requesting an auth token", async () => {
    const start = new Date(Date.now() + 1000 * 60 * 60);
    const end = new Date(start.getTime() + 1000 * 60 * 60);
    const listeners = await loadBackgroundModule({
      icsUrl,
      icsResponse: buildIcsFixture(start, end),
    });
    (chrome.identity.getAuthToken as any).mockClear();
    (fetch as any).mockClear();

    const refetchHandler = listeners.onAlarm[0];
    await refetchHandler({ name: "CRX_GCAL_REFRESH" });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(chrome.identity.getAuthToken).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(icsUrl);
  });

  it("does not append an authuser query parameter to Google Meet links found via an ICS feed", async () => {
    (willParticipate as any).mockReturnValue(true);
    const start = new Date(Date.now() + 1000 * 60 * 60);
    const end = new Date(start.getTime() + 1000 * 60 * 60);
    const listeners = await loadBackgroundModule({
      icsUrl,
      icsResponse: buildIcsFixture(start, end),
    });

    const refetchHandler = listeners.onAlarm[0];
    await refetchHandler({ name: "CRX_GCAL_REFRESH" });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(chrome.alarms.create).toHaveBeenCalled();
    const messageHandler = listeners.onMessage[0];
    const reminders = await new Promise((resolve) =>
      messageHandler({ type: "ListReminders" }, {}, resolve)
    );
    expect((reminders as any[])).toHaveLength(1);
    expect((reminders as any[])[0].url).toBe(
      "https://meet.google.com/ics-test-1234"
    );
  });

  it("starts watching on init even without a cached Google auth token, when an ICS URL is configured", async () => {
    const start = new Date(Date.now() + 1000 * 60 * 60);
    const end = new Date(start.getTime() + 1000 * 60 * 60);
    setupChromeMocks({ icsUrl, icsResponse: buildIcsFixture(start, end) });
    (chrome.identity.getAuthToken as any).mockImplementation(
      (_opts: any, cb: (token?: string) => void) => cb(undefined)
    );
    vi.resetModules();
    await import("./background");
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetch).toHaveBeenCalledWith(icsUrl);
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      "CRX_GCAL_REFRESH",
      expect.objectContaining({ periodInMinutes: expect.any(Number) })
    );
  });
});
