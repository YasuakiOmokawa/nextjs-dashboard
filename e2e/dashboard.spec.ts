import { test, expect } from "@playwright/test";

test.describe("app/dashboard/page.tsx", () => {
  test.beforeEach(async ({ page }) => {
    // TODO: 環境変数ファイルにlocalhost:3000の部分を分離する
    await page.goto("http://localhost:3000/dashboard");
  });

  test("has heading", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Dashboard" })
    ).toBeVisible();
  });
});
