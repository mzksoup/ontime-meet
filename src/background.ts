import { getAuthToken, getProfileUserInfo } from "./auth";
import {
  CalendarAPIResponse,
  listAllEvents,
  willParticipate,
} from "./calendar";
import { loadConfig } from "./config";
import { parseIcsToEvents } from "./ics";
import {
  clearAllEvents,
  getAllEvents,
  getEvent,
  getIcsUrl,
  isOpened,
  markAsOpened,
  removeEvent,
  upsertEvent,
} from "./storage";

type IncomingMessage =
  | { type: "ListAccountRequest" }
  | { type: "SignInRequest" }
  | { type: "SignOutRequest" }
  | { type: "RefreshRequest" }
  | { type: "ListReminders" };

type AlermPatch =
  | { type: "add"; id: string; when: Date }
  | { type: "update"; id: string; when: Date }
  | { type: "remove"; id: string }
  | { type: "noChange" };

const Alerms = {
  refetch: "CRX_GCAL_REFRESH",
};

let loading = Promise.resolve();

async function dispatch(message: IncomingMessage) {
  switch (message.type) {
    case "SignInRequest":
      await getProfileUserInfo();
      loading = startWatching();
      return;
    case "SignOutRequest": {
      const token = await getAuthToken();
      await Promise.all([
        fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`),
        new Promise<void>((resolve) =>
          chrome.identity.removeCachedAuthToken({ token }, resolve)
        ),
        new Promise<void>((resolve) =>
          chrome.identity.clearAllCachedAuthTokens(resolve)
        ),
        chrome.alarms.clearAll(),
        clearAllEvents(),
      ]);
      return;
    }
    case "RefreshRequest":
      return loading.then(() => startWatching());
    case "ListReminders": {
      return [...(await getAllEvents()).values()];
    }
    default:
      throw new Error(`Unrecognized type: ${JSON.stringify(message)}`);
  }
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// When an ICS URL is configured, prefer it over the Google Calendar API: no
// OAuth token needed, so it also works for accounts without Google sign-in.
async function fetchTargetEvents(
  interactive: boolean
): Promise<{ events: CalendarAPIResponse[]; email: string }> {
  const icsUrl = await getIcsUrl();
  if (icsUrl) {
    const text = await fetch(icsUrl).then((res) => res.text());
    const windowStart = startOfDay(new Date());
    const windowEnd = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3);
    return {
      events: parseIcsToEvents(text, windowStart, windowEnd),
      // ponytail: ICS mode has no Google account email (no OAuth token was
      // requested), so authuser query params are skipped downstream.
      email: "",
    };
  }
  const [accessToken, user] = await Promise.all([
    getAuthToken(interactive),
    getProfileUserInfo(interactive),
  ]);
  return {
    events: await listAllEvents(accessToken, "primary"),
    email: user.email,
  };
}

async function calcPatches(
  events: CalendarAPIResponse[],
  alarms: Map<string, chrome.alarms.Alarm>,
  email: string
): Promise<AlermPatch[]> {
  const config = await loadConfig();
  return events.map((e): AlermPatch => {
    if (willParticipate(e, email)) {
      if (
        alarms.has(e.id) &&
        alarms.get(e.id)!.scheduledTime + config.offset ===
          new Date(e.start.dateTime).getTime()
      ) {
        return { type: "noChange" };
      } else if (alarms.has(e.id)) {
        return { type: "update", id: e.id, when: new Date(e.start.dateTime) };
      } else {
        return { type: "add", id: e.id, when: new Date(e.start.dateTime) };
      }
    } else {
      if (alarms.has(e.id)) {
        return { type: "remove", id: e.id };
      } else {
        return { type: "noChange" };
      }
    }
  });
}

async function startWatching(interactive = true) {
  const [{ events: allEvents, email }, config] = await Promise.all([
    fetchTargetEvents(interactive),
    loadConfig(),
    chrome.action.setBadgeText({ text: "-" }),
  ]);
  const targetEvents = allEvents.filter((e) => !!config.extractValidUrl(e));
  const alarms = new Map(
    (await chrome.alarms.getAll()).map((a) => [a.name, a])
  );
  const patches = await calcPatches(targetEvents, alarms, email);
  const upcomingEvents = targetEvents.filter(
    (e) =>
      willParticipate(e, email) &&
      isSameDay(new Date(e.start.dateTime), new Date()) &&
      new Date(e.start.dateTime).getTime() > Date.now()
  );
  await chrome.action.setBadgeText({
    text: String(upcomingEvents.length),
  });
  for (const p of patches) {
    switch (p.type) {
      case "update": {
        const event = targetEvents.find((e) => e.id === p.id)!;
        let { url, rule } = config.extractValidUrl(event)!;
        if (rule.provider === "Google Meet" && email) {
          const tmp = new URL(url);
          tmp.searchParams.set("authuser", email);
          url = tmp.toString();
        }
        await chrome.alarms.clear(p.id);
        await Promise.all([
          chrome.alarms.create(p.id, {
            when: p.when.getTime() - config.offset,
          }),
          upsertEvent(p.id, {
            id: event.id,
            title: event.summary,
            startsAt: event.start.dateTime,
            endsAt: event.end.dateTime,
            url: url!,
          }),
        ]);
        break;
      }
      case "add": {
        const event = targetEvents.find((e) => e.id === p.id)!;
        let { url, rule } = config.extractValidUrl(event)!;
        if (rule.provider === "Google Meet" && email) {
          const tmp = new URL(url);
          tmp.searchParams.set("authuser", email);
          url = tmp.toString();
        }
        await Promise.all([
          chrome.alarms.create(p.id, {
            when: p.when.getTime() - config.offset,
          }),
          upsertEvent(p.id, {
            id: event.id,
            title: event.summary,
            startsAt: event.start.dateTime,
            endsAt: event.end.dateTime,
            url: url!,
          }),
        ]);
        break;
      }
      case "remove": {
        await Promise.all([chrome.alarms.clear(p.id), removeEvent(p.id)]);
        break;
      }
    }
  }
}

async function init() {
  const [config, authToken, icsUrl] = await Promise.all([
    loadConfig(),
    // No cached token is a normal "not signed in yet" state, not a fatal
    // error - swallow it so an ICS-only user (no Google auth at all) still
    // reaches the alarm setup below.
    getAuthToken(false).catch(() => undefined),
    getIcsUrl(),
  ]);
  if (authToken || icsUrl) {
    loading = startWatching(false).catch(() => {});
  }
  await chrome.alarms.create(Alerms.refetch, {
    periodInMinutes: config.pollInterval,
  });
}

chrome.runtime.onMessage.addListener((message, _sender, callback) => {
  dispatch(message).then(callback, callback);
  return true;
});
chrome.alarms.onAlarm.addListener(async (alerm) => {
  switch (alerm.name) {
    case Alerms.refetch: {
      loading = startWatching(false).catch(() => {});
      return;
    }
    default: {
      const event = await getEvent(alerm.name);
      if (
        !event ||
        (await isOpened(alerm.name)) ||
        new Date(event.startsAt).getTime() < Date.now()
      ) {
        return;
      }
      await markAsOpened(alerm.name);
      const tab = await chrome.tabs.create({ url: event.url });
      await chrome.windows.update(tab.windowId, {
        focused: true,
        drawAttention: true,
      });
    }
  }
});

init();
