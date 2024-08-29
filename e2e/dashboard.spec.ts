import { test, expect } from "@playwright/test";
import { DashboardPage } from "./pages/dashboard-page";

test.describe("app/dashboard/page.tsx", () => {
  // this is reused by all tests in the file.
  let dashboadPage: DashboardPage;

  test.beforeEach(async ({ page }) => {
    dashboadPage = new DashboardPage(page);
    await dashboadPage.goto();
  });

  test("has heading title", async () => {
    await expect(dashboadPage.getHeadingPageTitle()).toBeVisible();
  });
});
