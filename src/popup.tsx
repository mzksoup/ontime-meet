import React, { useCallback, useLayoutEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { Box, TextField } from "@mui/material";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppBar } from "./components/AppBar";
import { Timeline } from "@mui/lab";
import { Footer } from "./components/Footer";
import { EventTimelineItem } from "./components/EventTimelineItem";
import { useEvents } from "./hooks/useEvents";
import { useIcsUrl } from "./hooks/useIcsUrl";
import { useI18n } from "./hooks/useI18n";

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function App() {
  const { events, refresh } = useEvents();
  const { icsUrl, save: saveIcsUrl } = useIcsUrl();
  const saveIcsUrlAndRefresh = useCallback(
    (value: string) => saveIcsUrl(value).then(refresh),
    [saveIcsUrl, refresh]
  );
  const { t } = useI18n();
  const [mountedAt] = useState(Date.now());
  const hasIcsUrl = !!icsUrl;
  const todaysOrUpcomingEvents = useMemo(() => {
    return events
      .filter(
        (e) =>
          startOfDay(e.endsAt).getTime() >=
          startOfDay(new Date(mountedAt)).getTime()
      )
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }, [mountedAt, events]);

  useLayoutEffect(() => {
    document
      .querySelector(".upcoming")
      ?.previousElementSibling?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
  }, [events]);

  return (
    <div style={{ width: 360 }}>
      <AppBar onRefresh={refresh} />
      {hasIcsUrl ? (
        <Box my={2} mt={8}>
          <Timeline sx={{ padding: 0 }}>
            {todaysOrUpcomingEvents.map((event) => (
              <EventTimelineItem
                key={event.id}
                past={event.startsAt.getTime() < mountedAt}
                event={event}
              />
            ))}
          </Timeline>
        </Box>
      ) : (
        <Box my={2} pt={8} />
      )}
      <Box mx={2} mb={2}>
        <TextField
          // remount once the stored value finishes loading (defaultValue is
          // only read on first render for an uncontrolled input)
          key={icsUrl ?? ""}
          label={t("icsUrlLabel")}
          helperText={t("icsUrlHelp")}
          defaultValue={icsUrl ?? ""}
          onBlur={(e) => saveIcsUrlAndRefresh(e.target.value)}
          fullWidth
          size="small"
          data-testid="ics-url-input"
        />
      </Box>
      <Footer />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
