import ICAL from "ical.js";
import { CalendarAPIResponse } from "./calendar";

const MAX_OCCURRENCES_PER_EVENT = 1000;

export function parseIcsToEvents(
  icsText: string,
  windowStart: Date,
  windowEnd: Date
): CalendarAPIResponse[] {
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

    if (isCancelledOrDeclined(vc)) {
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
      const occStart = next.toJSDate();
      if (occStart > windowEnd) break;
      if (occStart < windowStart) continue;
      const details = event.getOccurrenceDetails(next);
      if (isCancelledOrDeclined(details.item.component)) continue;
      results.push(
        toApiEvent(
          details.item.component,
          `${event.uid}_${occStart.toISOString()}`,
          details.startDate.toJSDate(),
          details.endDate.toJSDate()
        )
      );
    }
  }

  return results;
}

// ponytail: ICS-only mode has no reliable "this attendee is me" signal, so
// any declined attendee drops the whole event (including ones we organized
// where a guest declined). Upgrade path: pass an ICS_SELF_EMAIL to match only
// our own PARTSTAT if this over-excludes in practice.
function isCancelledOrDeclined(vc: any): boolean {
  const status = (vc.getFirstPropertyValue("status") ?? "").toLowerCase();
  if (status === "cancelled") return true;
  const attendees = vc.getAllProperties("attendee") ?? [];
  return attendees.some(
    (a: any) => (a.getParameter("partstat") ?? "").toUpperCase() === "DECLINED"
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
