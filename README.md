# ontime-meet

A browser extension that automatically opens a Google Calendar event's meeting URL in a new tab a few minutes before the event starts. Unpublished, personal use only.

## How it works

Paste your Google Calendar's private ICS URL (iCal feed) into the popup. The extension polls that feed once a minute in the background — no Google sign-in or OAuth required — and opens the event's URL (Google Meet, Zoom, or Microsoft Teams) shortly before it begins, bringing the browser to the foreground so you don't miss it.

## Setup

1. `npm ci && npm run build`
2. Open `brave://extensions` (or `chrome://extensions`), enable Developer mode, and "Load unpacked" the generated `dist` directory
3. In Google Calendar, open Settings for the calendar you want to link, go to "Integrate calendar", and copy the "Secret address in iCal format" URL
4. Click the extension's popup icon and paste that URL into the ICS URL field

Events refresh automatically every minute; the popup's refresh button forces an immediate update.

## Development

```
npm run test    # unit tests (vitest)
npm run build   # typecheck + production build into dist/
```

### Adding new video conference tools

1. Add a new element into `urlRules` in `src/config.ts`
2. Add tests in `src/config.test.ts`

## License

MIT. Forked from [crx-gcal-url-opener](https://github.com/Leko/crx-gcal-url-opener) by Shingo Inoue.
