import { Page } from "playwright-core";

export class ExtensionPage {
  static async from(
    page: Page,
    extensionId: string,
    initScript?: () => void
  ): Promise<ExtensionPage> {
    // Inject mock Chrome Manifest v3 API
    await page.addInitScript(initScript ?? (() => {}));

    await page.goto(`chrome-extension://${extensionId}/src/popup.html`);

    // mask app version to remove unintended visual diffs
    await page
      .getByTestId("app-version")
      .evaluate((el) => (el.innerHTML = "vX.X.X"));

    return new ExtensionPage(page);
  }

  constructor(public readonly page: Page) {}

  hasIcsUrlInput(): Promise<boolean> {
    return this.page.getByTestId("ics-url-input").isVisible();
  }

  async setIcsUrl(url: string): Promise<void> {
    const input = this.page.getByTestId("ics-url-input").locator("input");
    await input.fill(url);
    await input.blur();
    await this.page.getByTestId("ics-url-configured").waitFor();
  }

  async changeIcsUrl(): Promise<void> {
    await this.page.getByTestId("ics-url-change-button").click();
    await this.page.getByTestId("ics-url-input").waitFor();
  }

  async deleteIcsUrl(): Promise<void> {
    await this.page.getByTestId("ics-url-delete-button").click();
    await this.page.getByTestId("ics-url-input").waitFor();
  }
}
