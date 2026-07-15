import { describe, it, expect, vi, beforeEach } from "vitest";
import { willParticipate } from "./calendar";
import { loadConfig } from "./config";

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
  // ponytail: a real chrome.alarms.getAll must reflect prior create/clear
  // calls in the same test, or a second refetch can never observe "this
  // alarm already exists" - which is exactly what the cleanup/update logic
  // under test needs to see.
  const fakeAlarms = new Map<string, { name: string; scheduledTime: number }>();
  vi.stubGlobal("chrome", {
    alarms: {
      getAll: vi.fn(() => Promise.resolve([...fakeAlarms.values()])),
      create: vi.fn((name: string, info: { when?: number } = {}) => {
        fakeAlarms.set(name, { name, scheduledTime: info.when ?? Date.now() });
        return Promise.resolve();
      }),
      clear: vi.fn((name: string) => Promise.resolve(fakeAlarms.delete(name))),
      clearAll: vi.fn(() => {
        fakeAlarms.clear();
        return Promise.resolve(true);
      }),
      onAlarm: { addListener: vi.fn((cb) => listeners.onAlarm.push(cb)) },
    },
    action: {
      setBadgeText: vi.fn(() => Promise.resolve()),
      setBadgeBackgroundColor: vi.fn(() => Promise.resolve()),
    },
    tabs: {
      create: vi.fn(() => Promise.resolve({ windowId: 1 })),
    },
    windows: {
      update: vi.fn(() => Promise.resolve()),
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
  await flush();
  return { ...listeners, overrides };
}

// ponytail: mirrors the two microtask hops the tests already waited on
// individually before each assertion; named so intent reads at call sites.
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0)).then(
    () => new Promise((r) => setTimeout(r, 0))
  );
}

function toIcsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function buildIcsFixture(
  start: Date,
  end: Date,
  uid = "ics-event-1@example.com"
): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//Test//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
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

function buildEmptyIcsFixture(): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "END:VCALENDAR"].join("\r\n");
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

describe("background service worker stale-entry cleanup", () => {
  it("removes the alarm and stored event once it disappears from the feed, but leaves the refetch alarm alone", async () => {
    (willParticipate as any).mockReturnValue(true);
    const start = new Date(Date.now() + 1000 * 60 * 60);
    const end = new Date(start.getTime() + 1000 * 60 * 60);
    const { onAlarm, onMessage, overrides } = await loadBackgroundModule({
      icsUrl,
      icsResponse: buildIcsFixture(start, end),
    });
    const refetchHandler = onAlarm[0];
    await refetchHandler({ name: "CRX_GCAL_REFRESH" });
    await flush();
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      "ics-event-1@example.com",
      expect.anything()
    );

    overrides.icsResponse = buildEmptyIcsFixture();
    (chrome.alarms.clear as any).mockClear();
    await refetchHandler({ name: "CRX_GCAL_REFRESH" });
    await flush();

    expect(chrome.alarms.clear).toHaveBeenCalledWith(
      "ics-event-1@example.com"
    );
    expect(chrome.alarms.clear).not.toHaveBeenCalledWith("CRX_GCAL_REFRESH");

    const reminders = await new Promise((resolve) =>
      onMessage[0]({ type: "ListReminders" }, {}, resolve)
    );
    expect(reminders as any[]).toHaveLength(0);
  });

  it("drops the old occurrence's alarm and creates a new one when a recurring occurrence's id changes with its time", async () => {
    (willParticipate as any).mockReturnValue(true);
    const oldStart = new Date(Date.now() + 1000 * 60 * 60);
    const oldEnd = new Date(oldStart.getTime() + 1000 * 60 * 60);
    const oldId = "series@example.com_2026-07-15T10:00:00.000Z";
    const { onAlarm, overrides } = await loadBackgroundModule({
      icsUrl,
      icsResponse: buildIcsFixture(oldStart, oldEnd, oldId),
    });
    const refetchHandler = onAlarm[0];
    await refetchHandler({ name: "CRX_GCAL_REFRESH" });
    await flush();
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      oldId,
      expect.anything()
    );

    const newStart = new Date(Date.now() + 1000 * 60 * 60 * 2);
    newStart.setMilliseconds(0); // ICS DTSTART has second precision only
    const newEnd = new Date(newStart.getTime() + 1000 * 60 * 60);
    const newId = "series@example.com_2026-07-15T12:00:00.000Z";
    overrides.icsResponse = buildIcsFixture(newStart, newEnd, newId);
    (chrome.alarms.clear as any).mockClear();
    (chrome.alarms.create as any).mockClear();
    await refetchHandler({ name: "CRX_GCAL_REFRESH" });
    await flush();

    expect(chrome.alarms.clear).toHaveBeenCalledWith(oldId);
    const config = await loadConfig();
    expect(chrome.alarms.create).toHaveBeenCalledWith(newId, {
      when: newStart.getTime() - config.offset,
    });
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
