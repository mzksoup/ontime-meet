export type CalendarAPIResponse = {
  id: string;
  summary: string;
  status: string;
  attendees?: { responseStatus: string }[];
  start: {
    dateTime: string;
  };
  end: {
    dateTime: string;
  };
  hangoutLink?: string;
  description?: string;
  conferenceData?: any;
};

export function willParticipate(
  event: CalendarAPIResponse,
  selfEmail: string
): boolean {
  return !!(
    event.status !== "cancelled" &&
    event.attendees?.find((a: any) => a.email === selfEmail)?.responseStatus !==
      "declined"
  );
}
