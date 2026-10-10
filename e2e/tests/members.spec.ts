import { expect, type Page, test } from "@playwright/test";
import { createTestUser, signInWithMagicLink } from "./utils/signIn";

const openMembers = async (page: Page) => {
  await page.goto("/dashboard/members");
  await expect(
    page.getByRole("heading", { name: "メンバー", exact: true }),
  ).toBeVisible();
};

const inviteLink = (page: Page) =>
  page.getByRole("link", { name: /メンバーを招待.*新しいタブで開きます/ });

test("自社のメンバーが出て、別の事業所の人は画面にも API にも出ない", async ({
  browser,
}) => {
  const otherCompanyEmail = await createTestUser();
  const email = await createTestUser();
  const context = await signInWithMagicLink(browser, email);
  const page = await context.newPage();

  await openMembers(page);

  const ownRow = page.getByRole("row").filter({ hasText: email });
  await expect(ownRow).toContainText("E2E Test User");
  await expect(ownRow).toContainText("オーナー");
  await expect(page.getByText(otherCompanyEmail)).toHaveCount(0);
  const body = await (await context.request.get("/api/members")).text();
  expect(body).toContain(email);
  expect(body).not.toContain(otherCompanyEmail);

  await context.close();
});

test("header のメンバーからメンバー画面に移り、招待は taimei-auth を新しいタブで開く", async ({
  browser,
}) => {
  const context = await signInWithMagicLink(browser, await createTestUser());
  const page = await context.newPage();
  await page.goto("/dashboard/teams");

  const nav = page.getByRole("link", { name: "メンバー", exact: true });
  await nav.click();

  await expect(page).toHaveURL(/\/dashboard\/members$/);
  await expect(nav).toHaveAttribute("aria-current", "page");
  await expect(inviteLink(page)).toHaveAttribute(
    "href",
    "/auth/account/members",
  );
  await expect(inviteLink(page)).toHaveAttribute("target", "_blank");
  await expect(inviteLink(page)).toHaveAttribute("rel", "noopener noreferrer");

  await context.close();
});
