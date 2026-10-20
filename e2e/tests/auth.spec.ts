import { expect, test } from "@playwright/test";
import { AUTH_BASE_URL, createUser, signIn } from "./utils/testing-auth";

const authLoginUrl = new RegExp(
  `^${AUTH_BASE_URL.replace(/\./g, "\\.")}/auth/\\?service_name=taimei&`,
);

test("未ログインで /dashboard を開くと、dashboard に戻る taimei-auth のログインへ移る", async ({
  page,
}) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(authLoginUrl);
  const redirectUrl = new URL(
    new URL(page.url()).searchParams.get("redirect_url") ?? "",
  );
  expect(redirectUrl.pathname).toBe("/auth/after-signin");
  // SPA は /dashboard を /dashboard/teams へ移してから API の 401 を受ける
  expect(redirectUrl.searchParams.get("callbackUrl")).toMatch(/^\/dashboard/);
});

test("ランディングページのログインから taimei-auth のログインへ移る", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByRole("link", { name: "ログイン" }).first().click();

  await expect(page).toHaveURL(authLoginUrl);
});

test("事業所の無い利用者がログインすると、事業所の登録を経て /dashboard/teams に戻る", async ({
  browser,
}) => {
  const context = await signIn(browser, await createUser({ companies: [] }));
  const authedPage = await context.newPage();
  await authedPage.goto("/dashboard");

  await expect(authedPage).toHaveURL(/\/auth\/signup\/company/);
  await authedPage.getByLabel("事業所名").fill("E2E 事業所");
  await authedPage.getByRole("button", { name: "事業所を作成" }).click();
  await expect(authedPage).toHaveURL(/\/dashboard\/teams$/);
  await expect(
    authedPage.getByRole("heading", { name: "チーム", exact: true }),
  ).toBeVisible();

  await context.close();
});
