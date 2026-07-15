import React, { useLayoutEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { Box, TextField } from "@mui/material";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppBar } from "./components/AppBar";
import { Timeline } from "@mui/lab";
import { Footer } from "./components/Footer";
import { UnauthorizedAlert } from "./components/UnauthorizedAlert";
import { EventTimelineItem } from "./components/EventTimelineItem";
import { useAuth } from "./hooks/useAuth";
import { useEvents } from "./hooks/useEvents";
import { useIcsUrl } from "./hooks/useIcsUrl";
import { useI18n } from "./hooks/useI18n";

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function App() {
  const { isAuthenticated, signIn, signOut } = useAuth();
  const { events, refresh } = useEvents();
  const { icsUrl, save: saveIcsUrl } = useIcsUrl();
  const { t } = useI18n();
  const [mountedAt] = useState(Date.now());
  // ponytail: ICS mode is an alternative to Google sign-in, not layered on
  // top of the auth flow itself - it only widens the gate that decides
  // whether the timeline (vs. the sign-in prompt) renders.
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
      <AppBar
        isAuthenticated={isAuthenticated}
        onRefresh={refresh}
        onSignOut={signOut}
      />
      {isAuthenticated || hasIcsUrl ? (
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
        <Box my={2} pt={8}>
          <UnauthorizedAlert onSignIn={signIn} />
        </Box>
      )}
      <Box mx={2} mb={2}>
        <TextField
          // remount once the stored value finishes loading (defaultValue is
          // only read on first render for an uncontrolled input)
          key={icsUrl ?? ""}
          label={t("icsUrlLabel")}
          helperText={t("icsUrlHelp")}
          defaultValue={icsUrl ?? ""}
          onBlur={(e) => saveIcsUrl(e.target.value)}
          required
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
