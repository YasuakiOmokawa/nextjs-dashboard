import { expect, type Page, test } from "@playwright/test";
import { createTestingClient } from "@taimei-code/auth-client/testing";
import { insertTeam } from "../db/app-client";

const APP_BASE_URL = process.env.APP_BASE_URL ?? "http://app.taimei-code.local:3001";
const testing = createTestingClient(
  process.env.AUTH_BASE_URL ?? "http://auth.taimei-code.local:3100",
);

const teamItem = (page: Page, name: string) =>
  page.getByRole("link", { name, exact: true });

test("SDK の testing client で作った利用者でログインし、事業所を切り替えると切り替えた先の事業所のチームだけが出る", async ({
  browser,
}) => {
  const signedIn = await testing.createSignedInUser({
    companies: [{ role: "OWNER" }, { role: "OWNER" }],
    returnTo: `${APP_BASE_URL}/auth/after-signin`,
  });
  const [companyA, companyB] = signedIn.companyIds as [string, string];
  const teamA = `A のチーム ${crypto.randomUUID()}`;
  const teamB = `B のチーム ${crypto.randomUUID()}`;
  await insertTeam(companyA, teamA);
  await insertTeam(companyB, teamB);

  const context = await browser.newContext();
  const login = await context.request.get(signedIn.loginUrl, { maxRedirects: 0 });
  expect(login.status()).toBe(302);
  const page = await context.newPage();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard\/teams$/);
  await expect(teamItem(page, teamA)).toHaveCount(1);

  await testing.setCurrentCompany({ userId: signedIn.userId, companyId: companyB });
  const reloadedBySessionChange = page.waitForEvent("load");
  await page.getByRole("link", { name: "チーム", exact: true }).click();
  await reloadedBySessionChange;

  await expect(teamItem(page, teamB)).toHaveCount(1);
  await expect(teamItem(page, teamA)).toHaveCount(0);
  await context.close();
});
