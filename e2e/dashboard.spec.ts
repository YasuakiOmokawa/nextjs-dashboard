import { test, expect } from "@playwright/test";

test.describe("dashboard", () => {
  test("has heading", async ({ page }) => {
    await page.goto("http://localhost:3000/dashboard");

    await expect(
      page.getByRole("heading", { name: "Dashboard" })
    ).toBeVisible();
  });
});
