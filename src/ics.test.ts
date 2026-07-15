import { describe, it, expect } from "vitest";
import { parseIcsToEvents } from "./ics";

// Window used by most tests: 2026-07-15T00:00:00+09:00 - 2026-07-18T00:00:00+09:00
const windowStart = new Date("2026-07-15T00:00:00+09:00");
const windowEnd = new Date("2026-07-18T00:00:00+09:00");

describe("parseIcsToEvents", () => {
  it("parses a single non-recurring VEVENT within the window", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//Test//EN",
      "BEGIN:VEVENT",
      "UID:single-1@example.com",
      "DTSTAMP:20260701T000000Z",
      "DTSTART:20260716T060000Z",
      "DTEND:20260716T070000Z",
      "SUMMARY:単発MTG",
      "STATUS:CONFIRMED",
      "X-GOOGLE-CONFERENCE:https://meet.google.com/single-1234",
      "DESCRIPTION:単発の予定",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const events = parseIcsToEvents(ics, windowStart, windowEnd);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      summary: "単発MTG",
      status: "confirmed",
      hangoutLink: "https://meet.google.com/single-1234",
      description: "単発の予定",
      start: { dateTime: "2026-07-16T06:00:00.000Z" },
      end: { dateTime: "2026-07-16T07:00:00.000Z" },
    });
  });

  it("unfolds a CRLF-folded continuation line before parsing SUMMARY", () => {
    // Line 2 below is a folded continuation of SUMMARY (RFC5545: CRLF + single
    // leading space). It must be joined back before ical.js parses it.
    const longSummary =
      "これは75文字を超えるように意図的に長くした定例ミーティングのタイトルです。テスト用の文字列。";
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//Test//EN",
      "BEGIN:VEVENT",
      "UID:folded-1@example.com",
      "DTSTAMP:20260701T000000Z",
      "DTSTART:20260716T060000Z",
      "DTEND:20260716T070000Z",
      "SUMMARY:これは75文字を超えるように意図的に長くした定例ミーティン",
      " グのタイトルです。テスト用の文字列。",
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const events = parseIcsToEvents(ics, windowStart, windowEnd);

    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe(longSummary);
  });

  it("expands RRULE occurrences within the window and honors EXDATE", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//Test//EN",
      "BEGIN:VTIMEZONE",
      "TZID:Asia/Tokyo",
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      "TZOFFSETFROM:+0900",
      "TZOFFSETTO:+0900",
      "TZNAME:JST",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:recurring-1@example.com",
      "DTSTAMP:20260701T000000Z",
      "DTSTART;TZID=Asia/Tokyo:20260713T150000",
      "DTEND;TZID=Asia/Tokyo:20260713T160000",
      "SUMMARY:定例MTG",
      "STATUS:CONFIRMED",
      "RRULE:FREQ=DAILY;COUNT=10",
      "EXDATE;TZID=Asia/Tokyo:20260716T150000",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const events = parseIcsToEvents(ics, windowStart, windowEnd);
    const starts = events.map((e) => e.start.dateTime).sort();

    // Window covers 07-15..07-17 (JST). Daily occurrences at 15:00 JST are
    // 07-15, 07-16 (excluded via EXDATE), 07-17.
    expect(starts).toEqual([
      "2026-07-15T06:00:00.000Z", // 2026-07-15T15:00+09:00
      "2026-07-17T06:00:00.000Z", // 2026-07-17T15:00+09:00
    ]);
  });

  it("applies a RECURRENCE-ID override to replace one occurrence", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//Test//EN",
      "BEGIN:VTIMEZONE",
      "TZID:Asia/Tokyo",
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      "TZOFFSETFROM:+0900",
      "TZOFFSETTO:+0900",
      "TZNAME:JST",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:recurring-2@example.com",
      "DTSTAMP:20260701T000000Z",
      "DTSTART;TZID=Asia/Tokyo:20260713T150000",
      "DTEND;TZID=Asia/Tokyo:20260713T160000",
      "SUMMARY:定例MTG",
      "STATUS:CONFIRMED",
      "RRULE:FREQ=DAILY;COUNT=10",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:recurring-2@example.com",
      "RECURRENCE-ID;TZID=Asia/Tokyo:20260717T150000",
      "DTSTAMP:20260701T000000Z",
      "DTSTART;TZID=Asia/Tokyo:20260717T170000",
      "DTEND;TZID=Asia/Tokyo:20260717T180000",
      "SUMMARY:定例MTG（変更）",
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const events = parseIcsToEvents(ics, windowStart, windowEnd);
    const overridden = events.find((e) => e.summary === "定例MTG（変更）");

    expect(overridden).toBeDefined();
    expect(overridden!.start.dateTime).toBe("2026-07-17T08:00:00.000Z"); // 17:00+09:00
    // The original (unmodified) 07-17T15:00 occurrence must not also appear.
    expect(
      events.filter((e) => e.start.dateTime === "2026-07-17T06:00:00.000Z")
    ).toHaveLength(0);
  });

  it("finds an override whose original slot is beyond windowEnd but whose overridden start is inside the window", () => {
    // Base: weekly on Monday from 2026-07-13. Natural slots: 07-13 (before
    // window) and 07-20 (after windowEnd 07-18) - neither is in-window on
    // its own. The override moves the 07-20 slot earlier, to 07-16, which
    // IS inside the window. A naive early-break on the *original* schedule
    // time would exit the loop at 07-20 before ever discovering the
    // override's actual (in-window) start time.
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//Test//EN",
      "BEGIN:VTIMEZONE",
      "TZID:Asia/Tokyo",
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      "TZOFFSETFROM:+0900",
      "TZOFFSETTO:+0900",
      "TZNAME:JST",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:recurring-3@example.com",
      "DTSTAMP:20260701T000000Z",
      "DTSTART;TZID=Asia/Tokyo:20260713T150000",
      "DTEND;TZID=Asia/Tokyo:20260713T160000",
      "SUMMARY:週次MTG",
      "STATUS:CONFIRMED",
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:recurring-3@example.com",
      "RECURRENCE-ID;TZID=Asia/Tokyo:20260720T150000",
      "DTSTAMP:20260701T000000Z",
      "DTSTART;TZID=Asia/Tokyo:20260716T150000",
      "DTEND;TZID=Asia/Tokyo:20260716T160000",
      "SUMMARY:週次MTG（前倒し）",
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const events = parseIcsToEvents(ics, windowStart, windowEnd);

    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("週次MTG（前倒し）");
    expect(events[0].start.dateTime).toBe("2026-07-16T06:00:00.000Z"); // 15:00+09:00
  });

  it("excludes events with STATUS:CANCELLED", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//Test//EN",
      "BEGIN:VEVENT",
      "UID:cancelled-1@example.com",
      "DTSTAMP:20260701T000000Z",
      "DTSTART:20260716T080000Z",
      "DTEND:20260716T090000Z",
      "SUMMARY:キャンセルされた予定",
      "STATUS:CANCELLED",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const events = parseIcsToEvents(ics, windowStart, windowEnd);

    expect(events).toHaveLength(0);
  });

  const selfIcsUrl =
    "https://calendar.google.com/calendar/ical/self%40example.com/private-abc123/basic.ics";

  it("excludes events where the self ATTENDEE (matched via the ICS URL's calendar id) has PARTSTAT=DECLINED", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//Test//EN",
      "BEGIN:VEVENT",
      "UID:declined-1@example.com",
      "DTSTAMP:20260701T000000Z",
      "DTSTART:20260716T100000Z",
      "DTEND:20260716T110000Z",
      "SUMMARY:辞退した予定",
      "STATUS:CONFIRMED",
      "ATTENDEE;PARTSTAT=DECLINED;CN=Self:mailto:self@example.com",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const events = parseIcsToEvents(ics, windowStart, windowEnd, selfIcsUrl);

    expect(events).toHaveLength(0);
  });

  it("keeps events where a co-attendee declined but self is still tentative/needs-action", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//Test//EN",
      "BEGIN:VEVENT",
      "UID:co-declined-1@example.com",
      "DTSTAMP:20260701T000000Z",
      "DTSTART:20260716T100000Z",
      "DTEND:20260716T110000Z",
      "SUMMARY:他の人が辞退した予定",
      "STATUS:CONFIRMED",
      "ATTENDEE;PARTSTAT=NEEDS-ACTION;CN=Self:mailto:self@example.com",
      "ATTENDEE;PARTSTAT=DECLINED;CN=Other:mailto:other@example.com",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const events = parseIcsToEvents(ics, windowStart, windowEnd, selfIcsUrl);

    expect(events).toHaveLength(1);
  });

  it("keeps events with a declined co-attendee when self's email cannot be determined", () => {
    // ponytail: without a resolvable self email we can't tell who "I" am, so
    // lean toward inclusion rather than reintroducing the over-exclusion bug.
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//Test//EN",
      "BEGIN:VEVENT",
      "UID:unknown-self-1@example.com",
      "DTSTAMP:20260701T000000Z",
      "DTSTART:20260716T100000Z",
      "DTEND:20260716T110000Z",
      "SUMMARY:自分が誰か分からない予定",
      "STATUS:CONFIRMED",
      "ATTENDEE;PARTSTAT=DECLINED;CN=Other:mailto:other@example.com",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const events = parseIcsToEvents(ics, windowStart, windowEnd);

    expect(events).toHaveLength(1);
  });

  it("skips all-day events (DTSTART;VALUE=DATE)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//Test//EN",
      "BEGIN:VEVENT",
      "UID:allday-1@example.com",
      "DTSTAMP:20260701T000000Z",
      "DTSTART;VALUE=DATE:20260717",
      "DTEND;VALUE=DATE:20260718",
      "SUMMARY:終日イベント",
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const events = parseIcsToEvents(ics, windowStart, windowEnd);

    expect(events).toHaveLength(0);
  });

  it("excludes single events entirely outside the window", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//Test//EN",
      "BEGIN:VEVENT",
      "UID:outside-1@example.com",
      "DTSTAMP:20260701T000000Z",
      "DTSTART:20260601T060000Z",
      "DTEND:20260601T070000Z",
      "SUMMARY:窓の外の予定",
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const events = parseIcsToEvents(ics, windowStart, windowEnd);

    expect(events).toHaveLength(0);
  });
});
