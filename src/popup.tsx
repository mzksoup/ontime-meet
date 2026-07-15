import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import ReactDOM from "react-dom/client";
import { Box, Button, TextField, Typography } from "@mui/material";
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
  // ponytail: no separate "loading" flag - icsUrl starts null until storage
  // read resolves, so this defaults to the input, then flips to the summary
  // once a saved value arrives. Re-runs only when icsUrl itself changes
  // (load/save/delete), so it never fights the "Change" button's manual open.
  const [isEditingIcsUrl, setIsEditingIcsUrl] = useState(!hasIcsUrl);
  useEffect(() => {
    setIsEditingIcsUrl(!icsUrl);
  }, [icsUrl]);
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
        {isEditingIcsUrl ? (
          <TextField
            label={t("icsUrlLabel")}
            helperText={t("icsUrlHelp")}
            onBlur={(e) => {
              const value = e.target.value.trim();
              if (!value) {
                // nothing typed - cancel back to whatever was already saved,
                // don't wipe an existing URL just because the field lost focus
                setIsEditingIcsUrl(!icsUrl);
                return;
              }
              // set explicitly (rather than relying on the icsUrl effect):
              // re-saving the same URL string is a same-value setState, which
              // React bails out of, so the effect would never re-fire
              saveIcsUrlAndRefresh(value).then(() => setIsEditingIcsUrl(false));
            }}
            fullWidth
            size="small"
            data-testid="ics-url-input"
          />
        ) : (
          <Box
            display="flex"
            alignItems="center"
            justifyContent="space-between"
          >
            <Typography variant="body2" data-testid="ics-url-configured">
              {t("icsUrlConfigured")}
            </Typography>
            <Box>
              <Button
                size="small"
                onClick={() => setIsEditingIcsUrl(true)}
                data-testid="ics-url-change-button"
              >
                {t("change")}
              </Button>
              <Button
                size="small"
                color="error"
                onClick={() => saveIcsUrlAndRefresh("")}
                data-testid="ics-url-delete-button"
              >
                {t("delete")}
              </Button>
            </Box>
          </Box>
        )}
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
