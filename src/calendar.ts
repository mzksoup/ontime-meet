export type CalendarAPIResponse = {
  id: string;
  summary: string;
  status: string;
  start: {
    dateTime: string;
  };
  end: {
    dateTime: string;
  };
  hangoutLink?: string;
  description?: string;
};

export function willParticipate(event: CalendarAPIResponse): boolean {
  return event.status !== "cancelled";
}
