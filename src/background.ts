import { CalendarAPIResponse, willParticipate } from "./calendar";
import { loadConfig } from "./config";
import { parseIcsToEvents } from "./ics";
import {
  clearOpenedFlag,
  getAllEvents,
  getEvent,
  getIcsUrl,
  isOpened,
  markAsOpened,
  removeEvent,
  upsertEvent,
} from "./storage";

type IncomingMessage =
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

const BADGE_COLOR_SUCCESS = "#1A73E8";
const BADGE_COLOR_ERROR = "#D93025";

let loading = Promise.resolve();

async function dispatch(message: IncomingMessage) {
  switch (message.type) {
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

async function fetchTargetEvents(
  icsUrl: string
): Promise<CalendarAPIResponse[]> {
  const text = await fetch(icsUrl).then((res) => res.text());
  const windowStart = startOfDay(new Date());
  const windowEnd = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3);
  return parseIcsToEvents(text, windowStart, windowEnd);
}

async function calcPatches(
  events: CalendarAPIResponse[],
  alarms: Map<string, chrome.alarms.Alarm>
): Promise<AlermPatch[]> {
  const config = await loadConfig();
  return events.map((e): AlermPatch => {
    if (willParticipate(e)) {
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

async function startWatching() {
  const icsUrl = await getIcsUrl();
  if (!icsUrl) {
    return; // ICS URL not configured yet - nothing to fetch, leave badge as-is.
  }

  try {
    const [allEvents, config] = await Promise.all([
      fetchTargetEvents(icsUrl),
      loadConfig(),
    ]);
    const targetEvents = allEvents.filter((e) => !!config.extractValidUrl(e));
    const alarms = new Map(
      (await chrome.alarms.getAll()).map((a) => [a.name, a])
    );
    const patches = await calcPatches(targetEvents, alarms);

    // Anything known that is no longer in the current feed window is
    // stale: deleted, declined, moved outside the 3-day window, or (for a
    // recurring occurrence) shifted to a new start time - which changes its
    // id (see ics.ts). Sweep it so old times don't linger forever.
    // Union alarms with getAllEvents(): a one-shot alarm is auto-cleared by
    // Chrome once it fires, so an already-fired event's storage/opened
    // entry would otherwise never be caught by this sweep and would linger
    // in the popup list even after the event is deleted from the calendar.
    const targetIds = new Set(targetEvents.map((e) => e.id));
    const knownIds = new Set([
      ...alarms.keys(),
      ...(await getAllEvents()).keys(),
    ]);
    const staleIds = [...knownIds].filter(
      (name) => name !== Alerms.refetch && !targetIds.has(name)
    );
    await Promise.all(
      staleIds.map((id) =>
        Promise.all([
          chrome.alarms.clear(id),
          removeEvent(id),
          clearOpenedFlag(id),
        ])
      )
    );

    const upcomingEvents = targetEvents.filter(
      (e) =>
        willParticipate(e) &&
        isSameDay(new Date(e.start.dateTime), new Date()) &&
        new Date(e.start.dateTime).getTime() > Date.now()
    );

    for (const p of patches) {
      switch (p.type) {
        case "update": {
          const event = targetEvents.find((e) => e.id === p.id)!;
          const { url } = config.extractValidUrl(event)!;
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
              url,
            }),
            // The start time moved, so a stale "already opened" flag from
            // the old time must not suppress the tab-open at the new time.
            clearOpenedFlag(p.id),
          ]);
          break;
        }
        case "add": {
          const event = targetEvents.find((e) => e.id === p.id)!;
          const { url } = config.extractValidUrl(event)!;
          await Promise.all([
            chrome.alarms.create(p.id, {
              when: p.when.getTime() - config.offset,
            }),
            upsertEvent(p.id, {
              id: event.id,
              title: event.summary,
              startsAt: event.start.dateTime,
              endsAt: event.end.dateTime,
              url,
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

    await chrome.action.setBadgeText({ text: String(upcomingEvents.length) });
    await chrome.action.setBadgeBackgroundColor({
      color: BADGE_COLOR_SUCCESS,
    });
  } catch (err) {
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR_ERROR });
    throw err;
  }
}

async function init() {
  const config = await loadConfig();
  loading = startWatching().catch(() => {});
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
      loading = startWatching().catch(() => {});
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
