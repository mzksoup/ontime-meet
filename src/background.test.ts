import { describe, it, expect, vi, beforeEach } from "vitest";
import { willParticipate } from "./calendar";

vi.mock("./calendar", () => ({
  willParticipate: vi.fn(() => false),
}));

type MockOverrides = {
  icsUrl?: string;
  icsResponse?: string;
  fetchRejects?: boolean;
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
    alarms: {
      getAll: vi.fn(() => Promise.resolve([])),
      create: vi.fn(() => Promise.resolve()),
      clear: vi.fn(() => Promise.resolve(true)),
      clearAll: vi.fn(() => Promise.resolve(true)),
      onAlarm: { addListener: vi.fn((cb) => listeners.onAlarm.push(cb)) },
    },
    action: {
      setBadgeText: vi.fn(() => Promise.resolve()),
      setBadgeBackgroundColor: vi.fn(() => Promise.resolve()),
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
      if (overrides.fetchRejects) {
        return Promise.reject(new Error("network down"));
      }
      if (overrides.icsResponse && url === overrides.icsUrl) {
        return Promise.resolve({
          text: () => Promise.resolve(overrides.icsResponse),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    })
  );
  return listeners;
}

async function loadBackgroundModule(overrides: MockOverrides = {}) {
  vi.resetModules();
  const listeners = setupChromeMocks(overrides);
  await import("./background");
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
  // reset between tests - individual tests opt into willParticipate: true,
  // and without this it leaks into whichever test runs next
  (willParticipate as any).mockReturnValue(false);
});

const icsUrl =
  "https://calendar.google.com/calendar/ical/test%40example.com/private-abc/basic.ics";

describe("background service worker ICS feed mode", () => {
  it("fetches events from the configured ICS URL", async () => {
    const start = new Date(Date.now() + 1000 * 60 * 60);
    const end = new Date(start.getTime() + 1000 * 60 * 60);
    const listeners = await loadBackgroundModule({
      icsUrl,
      icsResponse: buildIcsFixture(start, end),
    });
    (fetch as any).mockClear();

    const refetchHandler = listeners.onAlarm[0];
    await refetchHandler({ name: "CRX_GCAL_REFRESH" });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

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
    expect(reminders as any[]).toHaveLength(1);
    expect((reminders as any[])[0].url).toBe(
      "https://meet.google.com/ics-test-1234"
    );
  });

  it("starts watching on init when an ICS URL is configured", async () => {
    const start = new Date(Date.now() + 1000 * 60 * 60);
    const end = new Date(start.getTime() + 1000 * 60 * 60);
    await loadBackgroundModule({
      icsUrl,
      icsResponse: buildIcsFixture(start, end),
    });

    expect(fetch).toHaveBeenCalledWith(icsUrl);
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      "CRX_GCAL_REFRESH",
      expect.objectContaining({ periodInMinutes: expect.any(Number) })
    );
  });

  it("does nothing when no ICS URL is configured", async () => {
    const listeners = await loadBackgroundModule();
    (fetch as any).mockClear();

    const refetchHandler = listeners.onAlarm[0];
    await refetchHandler({ name: "CRX_GCAL_REFRESH" });
    await new Promise((r) => setTimeout(r, 0));

    expect(fetch).not.toHaveBeenCalled();
    expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
  });
});

describe("background service worker badge", () => {
  it("shows today's remaining event count in blue on a successful fetch", async () => {
    (willParticipate as any).mockReturnValue(true);
    const start = new Date(Date.now() + 1000 * 60 * 60);
    const end = new Date(start.getTime() + 1000 * 60 * 60);
    const listeners = await loadBackgroundModule({
      icsUrl,
      icsResponse: buildIcsFixture(start, end),
    });
    (chrome.action.setBadgeText as any).mockClear();
    (chrome.action.setBadgeBackgroundColor as any).mockClear();

    const refetchHandler = listeners.onAlarm[0];
    await refetchHandler({ name: "CRX_GCAL_REFRESH" });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: "1" });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({
      color: "#1A73E8",
    });
  });

  it("shows a red error badge when the ICS fetch fails", async () => {
    const listeners = await loadBackgroundModule({
      icsUrl,
      fetchRejects: true,
    });
    (chrome.action.setBadgeText as any).mockClear();
    (chrome.action.setBadgeBackgroundColor as any).mockClear();

    const refetchHandler = listeners.onAlarm[0];
    await refetchHandler({ name: "CRX_GCAL_REFRESH" });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: "!" });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({
      color: "#D93025",
    });
  });
});
