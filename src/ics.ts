import ICAL from "ical.js";
import { CalendarAPIResponse } from "./calendar";

const MAX_OCCURRENCES_PER_EVENT = 1000;

export function parseIcsToEvents(
  icsText: string,
  windowStart: Date,
  windowEnd: Date,
  icsUrl?: string
): CalendarAPIResponse[] {
  const selfEmail = extractSelfEmailFromIcsUrl(icsUrl);
  const comp = new ICAL.Component(ICAL.parse(icsText));
  const vevents = comp.getAllSubcomponents("vevent");
  const baseComps = vevents.filter((v) => !v.hasProperty("recurrence-id"));
  const exceptionComps = vevents.filter((v) => v.hasProperty("recurrence-id"));

  const results: CalendarAPIResponse[] = [];

  for (const vc of baseComps) {
    const event = new ICAL.Event(vc);
    const related = exceptionComps.filter(
      (e) => new ICAL.Event(e).uid === event.uid
    );
    for (const ex of related) event.relateException(ex);

    if (event.startDate.isDate) {
      continue; // ponytail: all-day events have no meeting URL to open, skip.
    }

    if (isCancelledOrDeclined(vc, selfEmail)) {
      continue;
    }

    if (!event.isRecurring()) {
      const occStart = event.startDate.toJSDate();
      if (occStart >= windowStart && occStart <= windowEnd) {
        results.push(toApiEvent(vc, event.uid, occStart, event.endDate.toJSDate()));
      }
      continue;
    }

    const iterator = event.iterator();
    let next;
    let guard = 0;
    while ((next = iterator.next()) && guard++ < MAX_OCCURRENCES_PER_EVENT) {
      // ponytail: can't break on the original scheduled time - a
      // RECURRENCE-ID override can move an occurrence earlier than its
      // original slot, pulling it into the window after that slot would
      // have been skipped. Bounded by MAX_OCCURRENCES_PER_EVENT instead.
      const originalStart = next.toJSDate();
      const details = event.getOccurrenceDetails(next);
      const occStart = details.startDate.toJSDate();
      if (occStart < windowStart || occStart > windowEnd) continue;
      if (isCancelledOrDeclined(details.item.component, selfEmail)) continue;
      results.push(
        toApiEvent(
          details.item.component,
          `${event.uid}_${originalStart.toISOString()}`,
          occStart,
          details.endDate.toJSDate()
        )
      );
    }
  }

  return results;
}

// Google's private ICS feed URL embeds the calendar id right after
// ".../ical/", which equals the account's email for a primary calendar
// (e.g. https://calendar.google.com/calendar/ical/foo%40example.com/private-xxx/basic.ics).
// ponytail: doesn't resolve for secondary calendars (id like
// xxx@group.calendar.google.com); callers should treat a non-match as
// "self unknown", not as a failure.
function extractSelfEmailFromIcsUrl(icsUrl?: string): string | null {
  if (!icsUrl) return null;
  const match = icsUrl.match(/\/ical\/([^/]+)\//);
  if (!match) return null;
  return decodeURIComponent(match[1]).toLowerCase();
}

function normalizeAttendeeEmail(value: unknown): string {
  return String(value ?? "")
    .replace(/^mailto:/i, "")
    .toLowerCase();
}

// ponytail: when selfEmail is unknown (no ICS URL, or a secondary calendar
// whose id isn't an email), we can't tell who "I" am among the attendees, so
// we don't exclude on PARTSTAT at all rather than risk dropping events the
// user hasn't actually declined. Upgrade path: a settings UI to enter the
// self email explicitly if this proves insufficient.
function isCancelledOrDeclined(vc: any, selfEmail: string | null): boolean {
  const status = (vc.getFirstPropertyValue("status") ?? "").toLowerCase();
  if (status === "cancelled") return true;
  if (!selfEmail) return false;
  const attendees = vc.getAllProperties("attendee") ?? [];
  const self = attendees.find(
    (a: any) => normalizeAttendeeEmail(a.getFirstValue()) === selfEmail
  );
  return (
    (self?.getParameter("partstat") ?? "").toString().toUpperCase() ===
    "DECLINED"
  );
}

function toApiEvent(
  vc: any,
  id: string,
  start: Date,
  end: Date
): CalendarAPIResponse {
  return {
    id,
    summary: vc.getFirstPropertyValue("summary") ?? "",
    status: (vc.getFirstPropertyValue("status") ?? "confirmed").toLowerCase(),
    hangoutLink: vc.getFirstPropertyValue("x-google-conference") ?? undefined,
    description: vc.getFirstPropertyValue("description") ?? undefined,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
}
