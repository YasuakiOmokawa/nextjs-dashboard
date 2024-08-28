import { test, expect } from "@playwright/test";

test.describe("app/dashboard/page.tsx", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
  });

  test("has heading", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Dashboard" })
    ).toBeVisible();
  });
});
