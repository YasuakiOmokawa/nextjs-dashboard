import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  assignMember,
  insertLevel,
  insertSkill,
  insertTeam,
} from "../db/app-client";
import { authDb } from "../db/auth-client";
import { user } from "../db/auth-schema";
import {
  AUTH_BASE_URL,
  createTestUser,
  provisionCompanyForUser,
  signInWithMagicLink,
} from "./utils/signIn";

const uniqueCompanyId = (prefix: string) =>
  `cmp_${prefix}${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

const userIdOf = async (email: string) => {
  const [row] = await authDb
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email));
  return row.id;
};

const teamItem = (page: Page, name: string) =>
  page.getByRole("link", { name, exact: true });

const openTeams = async (page: Page) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard\/teams$/);
  await expect(
    page.getByRole("heading", { name: "チーム", exact: true }),
  ).toBeVisible();
};

const switchCompany = async (context: BrowserContext, companyId: string) => {
  const response = await context.request.post(
    `${AUTH_BASE_URL}/api/account/current-company`,
    { data: { company_id: companyId }, headers: { Origin: AUTH_BASE_URL } },
  );
  expect(response.status()).toBe(200);
};

test("自社のチームが一覧に出て、他の事業所のチームは画面にも API にも出ない", async ({
  browser,
}) => {
  const companyA = uniqueCompanyId("a");
  const companyB = uniqueCompanyId("b");
  const teamA = `A のチーム ${crypto.randomUUID()}`;
  const teamB = `B のチーム ${crypto.randomUUID()}`;
  const teamAId = await insertTeam(companyA, teamA);
  const teamBId = await insertTeam(companyB, teamB);
  const context = await signInWithMagicLink(
    browser,
    await createTestUser({ companyId: companyA }),
  );
  const page = await context.newPage();

  await openTeams(page);

  await expect(teamItem(page, teamA)).toHaveAttribute(
    "href",
    `/dashboard/teams/${teamAId}`,
  );
  await expect(teamItem(page, teamB)).toHaveCount(0);
  const body = await (await context.request.get("/api/teams")).text();
  expect(body).toContain(teamAId);
  expect(body).not.toContain(teamBId);

  await context.close();
});

test("事業所を切り替えると、切り替えた先の事業所のチームだけが出る (ADR-0004 の場面 5)", async ({
  browser,
}) => {
  const companyA = uniqueCompanyId("a");
  const companyB = uniqueCompanyId("b");
  const teamA = `A のチーム ${crypto.randomUUID()}`;
  const teamB = `B のチーム ${crypto.randomUUID()}`;
  await insertTeam(companyA, teamA);
  await insertTeam(companyB, teamB);
  const email = await createTestUser({ companyId: companyB });
  await provisionCompanyForUser(await userIdOf(email), { companyId: companyA });
  const context = await signInWithMagicLink(browser, email);
  const page = await context.newPage();
  await openTeams(page);
  await expect(teamItem(page, teamA)).toHaveCount(1);

  await switchCompany(context, companyB);
  // 再読み込みでなく SPA の中の移動で、前の事業所の cache を出さないことを見る
  await page.getByRole("link", { name: "チーム", exact: true }).click();

  await expect(teamItem(page, teamB)).toHaveCount(1);
  await expect(teamItem(page, teamA)).toHaveCount(0);

  await context.close();
});

test("割り当てられたメンバーは一覧からチームを開き、自分と同僚の記入を星取表で見られる", async ({
  browser,
}) => {
  const companyId = uniqueCompanyId("m");
  const teamName = `開発 ${crypto.randomUUID()}`;
  const myName = `自分 ${crypto.randomUUID()}`;
  const colleagueName = `同僚 ${crypto.randomUUID()}`;
  const myEmail = await createTestUser({ companyId, role: "MEMBER" });
  const colleagueEmail = await createTestUser({ companyId, role: "ADMIN" });
  const myId = await userIdOf(myEmail);
  const colleagueId = await userIdOf(colleagueEmail);
  await authDb.update(user).set({ name: myName }).where(eq(user.id, myId));
  await authDb
    .update(user)
    .set({ name: colleagueName })
    .where(eq(user.id, colleagueId));
  const teamId = await insertTeam(companyId, teamName);
  const skillId = await insertSkill(companyId, teamId, "設計");
  for (const [userId, level] of [
    [myId, 2],
    [colleagueId, 3],
  ] as const) {
    await assignMember(companyId, teamId, userId);
    await insertLevel(companyId, teamId, skillId, userId, level);
  }
  const context = await signInWithMagicLink(browser, myEmail);
  const page = await context.newPage();
  await openTeams(page);

  await teamItem(page, teamName).click();

  await expect(page).toHaveURL(new RegExp(`/dashboard/teams/${teamId}$`));
  await expect(page.getByRole("heading", { name: teamName })).toBeVisible();
  const rowOf = (name: string) =>
    page.getByRole("row").filter({ hasText: name });
  await expect(rowOf(myName)).toContainText("○");
  await expect(rowOf(colleagueName)).toContainText("◎");

  await context.close();
});

test("他の事業所のチームの URL を開いても、見つからないと出し、API も 404 を返す", async ({
  browser,
}) => {
  const otherTeamId = await insertTeam(
    uniqueCompanyId("b"),
    `B のチーム ${crypto.randomUUID()}`,
  );
  const context = await signInWithMagicLink(browser, await createTestUser());
  const page = await context.newPage();

  await page.goto(`/dashboard/teams/${otherTeamId}`);

  await expect(page.getByText("チームが見つかりません")).toBeVisible();
  expect(
    (await context.request.get(`/api/teams/${otherTeamId}`)).status(),
  ).toBe(404);

  await context.close();
});

test("header の設定は taimei-auth の設定を新しいタブで開く", async ({
  browser,
}) => {
  const context = await signInWithMagicLink(browser, await createTestUser());
  const page = await context.newPage();
  await openTeams(page);

  const settings = page.getByRole("link", { name: "設定" });

  await expect(settings).toHaveAttribute("href", "/auth/account");
  await expect(settings).toHaveAttribute("target", "_blank");
  await expect(
    page.getByRole("link", { name: "チーム", exact: true }),
  ).not.toHaveClass(/(^| )text-muted-foreground/);

  await context.close();
});

test("チームの無い事業所の管理者には、チームを作る案内を出す", async ({
  browser,
}) => {
  const context = await signInWithMagicLink(browser, await createTestUser());
  const page = await context.newPage();

  await openTeams(page);

  await expect(
    page.getByText(
      "まだチームがありません。チームを作ると、スキルを足してメンバーを割り当てられます",
    ),
  ).toBeVisible();

  await context.close();
});

test("どのチームにも割り当てられていないメンバーには、割り当てを頼む案内を出す", async ({
  browser,
}) => {
  const context = await signInWithMagicLink(
    browser,
    await createTestUser({ role: "MEMBER" }),
  );
  const page = await context.newPage();

  await openTeams(page);

  await expect(
    page.getByText(
      "まだどのチームにも割り当てられていません。管理者に割り当てを頼んでください",
    ),
  ).toBeVisible();

  await context.close();
});

test("チームを取得できないときは、その旨を出す", async ({ browser }) => {
  const context = await signInWithMagicLink(browser, await createTestUser());
  const page = await context.newPage();
  await page.route("**/api/teams", (route) =>
    route.fulfill({
      status: 503,
      json: { _tag: "DbUnavailable", message: "保存に失敗しました" },
    }),
  );

  await page.goto("/dashboard/teams");

  await expect(page.getByText("チームを取得できませんでした")).toBeVisible();

  await context.close();
});

// index.html の inline script は動かし、SPA の JS (/assets/*.js) だけを止めて、JS が描く前の表示を見る
test("自分の情報を取得できないときは、その旨を出す", async ({ browser }) => {
  const context = await signInWithMagicLink(browser, await createTestUser());
  const page = await context.newPage();
  await page.route("**/api/me", (route) =>
    route.fulfill({ status: 500, body: "Internal Server Error" }),
  );

  await page.goto("/dashboard/teams");

  await expect(page.getByText("画面を読み込めませんでした")).toBeVisible();

  await context.close();
});

test.describe("SPA の JS が描く前の表示", () => {
  test.beforeEach(({ page }) =>
    page.route("**/assets/*.js", (route) => route.abort()),
  );

  test("prerender していない /dashboard/teams では、ランディングページを見せない", async ({
    page,
  }) => {
    await page.goto("/dashboard/teams");

    await expect(page).toHaveTitle("Taimei");
    await expect(page.locator("#root")).toBeEmpty();
    await expect(
      page.getByRole("heading", { name: /心安らかな/ }),
    ).not.toBeVisible();
  });

  test("prerender した / では、ランディングページを見せる", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: /心安らかな/ }),
    ).toBeVisible();
  });
});
