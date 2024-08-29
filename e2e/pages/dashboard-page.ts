import type { Page, Locator } from "@playwright/test";

export class DashboardPage {
  private readonly headingPageTitle: Locator;

  constructor(public readonly page: Page) {
    this.headingPageTitle = this.page.getByRole("heading", {
      name: "Dashboard",
    });
  }

  async goto() {
    await this.page.goto("/dashboard");
  }

  getHeadingPageTitle() {
    return this.headingPageTitle;
  }
}
