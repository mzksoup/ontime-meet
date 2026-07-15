import { ExtensionPage } from "./ExtensionPage.js";
import { test, expect } from "./fixture.js";

const secretIcsUrl =
  "https://calendar.google.com/calendar/ical/secret-test-token/basic.ics";

test("shows the input and guidance text when no ICS URL is configured", async ({
  page,
  extensionId,
}) => {
  const extPage = await ExtensionPage.from(page, extensionId);
  await expect(await extPage.hasIcsUrlInput()).toEqual(true);
  await expect(page.getByTestId("ics-url-configured")).toBeHidden();
});

test("hides the URL after saving and shows a configured summary instead", async ({
  page,
  extensionId,
}) => {
  const extPage = await ExtensionPage.from(page, extensionId);
  await extPage.setIcsUrl(secretIcsUrl);

  await expect(await extPage.hasIcsUrlInput()).toEqual(false);
  await expect(page.getByTestId("ics-url-configured")).toBeVisible();

  // the saved URL must never render into the DOM once configured
  const html = await page.content();
  expect(html).not.toContain(secretIcsUrl);
});

test("Change shows an empty input, not the previously saved URL", async ({
  page,
  extensionId,
}) => {
  const extPage = await ExtensionPage.from(page, extensionId, () => {
    chrome.storage.local.set({
      ics_url_1:
        "https://calendar.google.com/calendar/ical/secret-test-token/basic.ics",
    });
  });
  await extPage.changeIcsUrl();

  const input = page.getByTestId("ics-url-input").locator("input");
  await expect(input).toHaveValue("");
  const html = await page.content();
  expect(html).not.toContain(secretIcsUrl);
});

test("Change then re-saving the same URL still returns to the configured summary", async ({
  page,
  extensionId,
}) => {
  const extPage = await ExtensionPage.from(page, extensionId);
  await extPage.setIcsUrl(secretIcsUrl);
  await extPage.changeIcsUrl();
  await extPage.setIcsUrl(secretIcsUrl);

  await expect(await extPage.hasIcsUrlInput()).toEqual(false);
  await expect(page.getByTestId("ics-url-configured")).toBeVisible();
});

test("Delete clears the ICS URL and returns to the unset state", async ({
  page,
  extensionId,
}) => {
  const extPage = await ExtensionPage.from(page, extensionId);
  await extPage.setIcsUrl(secretIcsUrl);
  await extPage.deleteIcsUrl();

  await expect(await extPage.hasIcsUrlInput()).toEqual(true);
  await expect(page.getByTestId("ics-url-configured")).toBeHidden();
});
