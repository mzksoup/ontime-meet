import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./calendar", () => ({
  listAllEvents: vi.fn(() => Promise.resolve([])),
  willParticipate: vi.fn(() => false),
}));

function setupChromeMocks() {
  const listeners = {
    onMessage: [] as Array<(msg: any, sender: any, cb: any) => any>,
    onAlarm: [] as Array<(alarm: any) => any>,
  };
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
        get: vi.fn(() => Promise.resolve({})),
        set: vi.fn(() => Promise.resolve()),
        remove: vi.fn(() => Promise.resolve()),
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
    vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ sub: "1", email: "a@example.com" }),
      })
    )
  );
  return listeners;
}

async function loadBackgroundModule() {
  vi.resetModules();
  const listeners = setupChromeMocks();
  await import("./background");
  // let init()'s async chain settle
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return listeners;
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
