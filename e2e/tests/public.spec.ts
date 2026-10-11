import { expect, test } from "@playwright/test";

// hydrate が食い違っても React は client で描き直して動くので、画面の操作では気付けない
let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
});
test.afterEach(() => expect(errors).toEqual([]));

test("モバイルの幅で / のメニューを開くとログインが出る", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "心安らかな",
  );

  await page.getByRole("button", { name: "メニュー" }).click();

  await expect(page.getByRole("link", { name: "ログイン" })).toBeVisible();
});

test("/ からプライバシーポリシーを開ける", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("link", { name: "プライバシーポリシー" }).click();

  await expect(page).toHaveURL("/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "プライバシーポリシー",
  );
});

test("/ を開いても API を呼ばない", async ({ page }) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      apiRequests.push(request.url());
  });

  await page.goto("/", { waitUntil: "load" });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "心安らかな",
  );

  expect(apiRequests).toEqual([]);
});
