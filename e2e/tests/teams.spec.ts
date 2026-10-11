import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  type Route,
  test,
} from "@playwright/test";
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

const setUserName = (userId: string, name: string) =>
  authDb.update(user).set({ name }).where(eq(user.id, userId));

const matrixRowOf = (page: Page, name: string) =>
  page.getByRole("row").filter({ hasText: name });

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
  await setUserName(myId, myName);
  await setUserName(colleagueId, colleagueName);
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
  await expect(matrixRowOf(page, myName)).toContainText("○");
  await expect(matrixRowOf(page, colleagueName)).toContainText("◎");

  await context.close();
});

const openMyTeamWithLevel = async (browser: Browser, level: number) => {
  const companyId = uniqueCompanyId("l");
  const myName = `自分 ${crypto.randomUUID()}`;
  const myEmail = await createTestUser({ companyId, role: "MEMBER" });
  const myId = await userIdOf(myEmail);
  await setUserName(myId, myName);
  const teamId = await insertTeam(companyId, `開発 ${crypto.randomUUID()}`);
  const skillId = await insertSkill(companyId, teamId, "設計");
  await assignMember(companyId, teamId, myId);
  await insertLevel(companyId, teamId, skillId, myId, level);
  const context = await signInWithMagicLink(browser, myEmail);
  const page = await context.newPage();
  await page.goto(`/dashboard/teams/${teamId}`);
  await expect(
    page.getByRole("heading", { name: "自分のレベル" }),
  ).toBeVisible();
  return {
    context,
    page,
    teamId,
    myRow: matrixRowOf(page, myName),
    levelSelect: page.getByLabel("設計 のレベル"),
    wantsToLearn: page.getByLabel("設計 を学びたい"),
    saveButton: page.getByRole("button", { name: "保存" }),
  };
};

test("自分のレベルは保存を押した時点で星取表に出て、保存に失敗すると前の値に戻り、失敗の文言を出す", async ({
  browser,
}) => {
  const { context, page, myRow, levelSelect, wantsToLearn, saveButton } =
    await openMyTeamWithLevel(browser, 2);
  const heldSave = Promise.withResolvers<Route>();
  await page.route("**/api/teams/*/my-levels", heldSave.resolve);

  await levelSelect.selectOption("3");
  await wantsToLearn.check();
  await saveButton.click();
  const save = await heldSave.promise;

  await expect(myRow).toContainText("◎");
  await expect(myRow).toContainText("学");
  await expect(saveButton).toBeDisabled();

  await save.fulfill({
    status: 403,
    json: {
      _tag: "NotAssigned",
      message: "チームに割り当てられた人だけが記入できます",
    },
  });

  await expect(myRow).toContainText("○");
  await expect(myRow).not.toContainText("学");
  await expect(page.getByRole("alert")).toHaveText(
    "チームに割り当てられた人だけが記入できます",
  );
  await expect(levelSelect).toHaveValue("3");
  await expect(wantsToLearn).toBeChecked();

  await context.close();
});

test("保存した自分のレベルは、チームを取り直さずに星取表に残り、再読み込みしても残る", async ({
  browser,
}) => {
  const {
    context,
    page,
    teamId,
    myRow,
    levelSelect,
    wantsToLearn,
    saveButton,
  } = await openMyTeamWithLevel(browser, 2);
  await expect(levelSelect.locator("option")).toHaveText([
    "空欄: 未経験",
    "△: 支援があればできる",
    "○: 一人でできる",
    "◎: 教えられる",
  ]);
  await expect(levelSelect).toHaveValue("2");
  await expect(wantsToLearn).not.toBeChecked();
  const teamRefetches: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      new URL(request.url()).pathname === `/api/teams/${teamId}`
    )
      teamRefetches.push(request.url());
  });

  await levelSelect.selectOption("3");
  await wantsToLearn.check();
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().endsWith(`/api/teams/${teamId}/my-levels`),
  );
  await saveButton.click();

  expect((await saved).status()).toBe(200);
  await expect(saveButton).toBeEnabled();
  await expect(myRow).toContainText("◎");
  await expect(myRow).toContainText("学");
  expect(teamRefetches).toEqual([]);

  await page.reload();

  await expect(myRow).toContainText("◎");
  await expect(myRow).toContainText("学");

  await context.close();
});

const teamTitle = (page: Page, name: string) =>
  page.getByRole("heading", { name, exact: true, level: 1 });

test("管理者は一覧でチームを作り、チームの画面で名前を変え、確認の後に消せる", async ({
  browser,
}) => {
  const companyId = uniqueCompanyId("g");
  const existingName = `既存 ${crypto.randomUUID()}`;
  await insertTeam(companyId, existingName);
  const context = await signInWithMagicLink(
    browser,
    await createTestUser({ companyId }),
  );
  const page = await context.newPage();
  const deleteRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "DELETE") deleteRequests.push(request.url());
  });
  await openTeams(page);
  const nameInput = page.getByLabel("チーム名");
  const createButton = page.getByRole("button", { name: "チームを作る" });

  await expect(nameInput).toHaveAttribute("required", "");
  await expect(nameInput).not.toHaveAttribute("maxlength");
  await expect(createButton).toBeVisible();

  await nameInput.fill(existingName);
  await createButton.click();

  await expect(page.getByRole("alert")).toHaveText("同じ名前がすでにあります");
  await expect(page).toHaveURL(/\/dashboard\/teams$/);

  const createdName = `新しいチーム ${crypto.randomUUID()}`;
  const heldCreate = Promise.withResolvers<Route>();
  await page.route("**/api/teams", (route) =>
    route.request().method() === "POST"
      ? heldCreate.resolve(route)
      : route.continue(),
  );
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/teams",
  );
  await nameInput.fill(createdName);
  await createButton.click();
  const createRoute = await heldCreate.promise;

  await expect(createButton).toBeDisabled();

  await createRoute.continue();
  const { id } = await (await created).json();
  await page.unroute("**/api/teams");

  await expect(page).toHaveURL(new RegExp(`/dashboard/teams/${id}$`));
  await expect(teamTitle(page, createdName)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "チーム名", exact: true }),
  ).toBeVisible();
  const teamNameInput = page.getByLabel("チーム名");
  const renameButton = page.getByRole("button", { name: "名前を変える" });
  const deleteButton = page.getByRole("button", { name: "チームを削除" });
  await expect(teamNameInput).toHaveValue(createdName);
  await expect(renameButton).toBeVisible();
  await expect(deleteButton).toBeVisible();

  await teamNameInput.fill(existingName);
  await renameButton.click();

  await expect(page.getByRole("alert")).toHaveText("同じ名前がすでにあります");
  await expect(teamTitle(page, createdName)).toBeVisible();
  await expect(teamNameInput).toHaveValue(existingName);

  const renamed = `新しい名前 ${crypto.randomUUID()}`;
  await teamNameInput.fill(`  ${renamed}  `);
  await renameButton.click();

  await expect(teamTitle(page, renamed)).toBeVisible();
  await expect(teamNameInput).toHaveValue(renamed);

  let confirmationMessage = "";
  page.once("dialog", (dialog) => {
    confirmationMessage = dialog.message();
    void dialog.dismiss();
  });
  await deleteButton.click();

  expect(confirmationMessage).toBe(
    `「${renamed}」を削除します。スキル・割り当て・記入したレベルも消え、元に戻せません。`,
  );
  await expect(teamTitle(page, renamed)).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  const deleteResponse = page.waitForResponse(
    (response) => response.request().method() === "DELETE",
  );
  await deleteButton.click();

  expect((await deleteResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard\/teams$/);
  await expect(teamItem(page, existingName)).toBeVisible();
  await expect(teamItem(page, renamed)).toHaveCount(0);
  expect(deleteRequests).toHaveLength(1);

  await context.close();
});

test("メンバーにはチームの管理の部品が出ず、API を直に呼んでも 403 で、チームは変わらない", async ({
  browser,
}) => {
  const companyId = uniqueCompanyId("n");
  const teamName = `開発 ${crypto.randomUUID()}`;
  const email = await createTestUser({ companyId, role: "MEMBER" });
  const teamId = await insertTeam(companyId, teamName);
  const skillId = await insertSkill(companyId, teamId, "設計");
  const myId = await userIdOf(email);
  await assignMember(companyId, teamId, myId);
  const context = await signInWithMagicLink(browser, email);
  const page = await context.newPage();
  await openTeams(page);

  await expect(teamItem(page, teamName)).toBeVisible();
  await expect(page.getByLabel("チーム名")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "チームを作る" })).toHaveCount(
    0,
  );

  await teamItem(page, teamName).click();

  await expect(page.getByRole("heading", { name: "星取表" })).toBeVisible();
  await expect(page.getByRole("button", { name: "名前を変える" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "チームを削除" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("スキル名")).toHaveCount(0);
  await expect(page.getByLabel("割り当てるメンバー")).toHaveCount(0);
  for (const name of ["スキルを足す", "割り当てる", /を削除$/, /を外す$/])
    await expect(page.getByRole("button", { name })).toHaveCount(0);

  const headers = { Origin: new URL(page.url()).origin };
  for (const response of [
    await context.request.post("/api/teams", {
      data: { name: "作れない" },
      headers,
    }),
    await context.request.patch(`/api/teams/${teamId}`, {
      data: { name: "変えられない" },
      headers,
    }),
    await context.request.delete(`/api/teams/${teamId}`, { headers }),
    await context.request.post(`/api/teams/${teamId}/skills`, {
      data: { name: "足せない" },
      headers,
    }),
    await context.request.delete(`/api/skills/${skillId}`, { headers }),
    await context.request.put(`/api/teams/${teamId}/assignments/${myId}`, {
      headers,
    }),
    await context.request.delete(`/api/teams/${teamId}/assignments/${myId}`, {
      headers,
    }),
  ]) {
    expect(response.status()).toBe(403);
    expect((await response.json())._tag).toBe("NotManager");
  }
  const teamAfterRejectedRequests = await context.request.get(
    `/api/teams/${teamId}`,
  );
  expect(teamAfterRejectedRequests.status()).toBe(200);
  const { team } = await teamAfterRejectedRequests.json();
  expect(team.name).toBe(teamName);
  expect(team.skills).toEqual([{ id: skillId, name: "設計" }]);
  expect(team.assignedUserIds).toEqual([myId]);

  await context.close();
});

const nextDialog = (page: Page, answer: "accept" | "dismiss") => {
  const message = Promise.withResolvers<string>();
  page.once("dialog", (dialog) => {
    message.resolve(dialog.message());
    void dialog[answer]();
  });
  return message.promise;
};

const createNamedUser = async (
  companyId: string,
  role: "OWNER" | "MEMBER",
  label: string,
) => {
  const email = await createTestUser({ companyId, role });
  const id = await userIdOf(email);
  const name = `${label} ${crypto.randomUUID()}`;
  await setUserName(id, name);
  return { email, id, name };
};

test("管理者はチームの画面でスキルを足し・消し、メンバーを割り当て・外せる", async ({
  browser,
}) => {
  const companyId = uniqueCompanyId("k");
  const teamName = `開発 ${crypto.randomUUID()}`;
  const [owner, assigned, candidate] = await Promise.all([
    createNamedUser(companyId, "OWNER", "管理者"),
    createNamedUser(companyId, "MEMBER", "割り当て済み"),
    createNamedUser(companyId, "MEMBER", "候補"),
  ]);
  const departedId = `departed-${crypto.randomUUID()}`;
  const teamId = await insertTeam(companyId, teamName);
  await insertSkill(companyId, teamId, "設計");
  await assignMember(companyId, teamId, assigned.id);
  await assignMember(companyId, teamId, departedId);
  const context = await signInWithMagicLink(browser, owner.email);
  const page = await context.newPage();
  await page.goto(`/dashboard/teams/${teamId}`);
  await expect(teamTitle(page, teamName)).toBeVisible();
  const skillItem = (name: string) =>
    page.getByRole("listitem").filter({ hasText: name });
  const skillName = page.getByLabel("スキル名");
  const addSkillButton = page.getByRole("button", { name: "スキルを足す" });
  const memberSelect = page.getByLabel("割り当てるメンバー");

  const options = memberSelect.locator("option");
  await expect(options).toHaveCount(2);
  expect(
    await options.evaluateAll((elements) =>
      elements
        .map((e) => [e.textContent, (e as HTMLOptionElement).value])
        .sort(),
    ),
  ).toEqual(
    [
      [owner.name, owner.id],
      [candidate.name, candidate.id],
    ].sort(),
  );

  await skillName.fill("実装");
  await addSkillButton.click();

  await expect(skillItem("実装")).toBeVisible();
  await expect(skillName).toHaveValue("");

  await skillName.fill("設計");
  await addSkillButton.click();

  await expect(page.getByRole("alert")).toHaveText("同じ名前がすでにあります");

  await memberSelect.selectOption(candidate.id);
  await page.getByRole("button", { name: "割り当てる" }).click();

  await expect(matrixRowOf(page, candidate.name)).toBeVisible();

  const unassignMessage = nextDialog(page, "accept");
  await page.getByRole("button", { name: `${candidate.name} を外す` }).click();

  expect(await unassignMessage).toBe(
    `${candidate.name} をこのチームから外します。このチームに記入したレベルも消え、元に戻せません。`,
  );
  await expect(matrixRowOf(page, candidate.name)).toHaveCount(0);

  const removeSkill = page.getByRole("button", { name: "実装 を削除" });
  const dismissedMessage = nextDialog(page, "dismiss");
  await removeSkill.click();

  expect(await dismissedMessage).toBe(
    "スキル「実装」を削除します。このスキルに記入したレベルも消え、元に戻せません。",
  );
  await expect(skillItem("実装")).toBeVisible();

  const removeMessage = nextDialog(page, "accept");
  await removeSkill.click();
  await removeMessage;

  await expect(skillItem("実装")).toHaveCount(0);

  await expect(
    page.getByRole("heading", { name: "事業所にいない人の割り当て" }),
  ).toBeVisible();
  await expect(page.getByText(departedId)).toBeVisible();
  const departedMessage = nextDialog(page, "accept");
  await page.getByRole("button", { name: `${departedId} を外す` }).click();
  await departedMessage;

  await expect(page.getByText(departedId)).toHaveCount(0);

  await context.close();
});

test("メンバー一覧が取れないと、管理者にも割り当ての部品を出さず、その旨を出す", async ({
  browser,
}) => {
  const companyId = uniqueCompanyId("u");
  const email = await createTestUser({ companyId });
  const teamName = `開発 ${crypto.randomUUID()}`;
  const teamId = await insertTeam(companyId, teamName);
  await assignMember(companyId, teamId, await userIdOf(email));
  const context = await signInWithMagicLink(browser, email);
  const page = await context.newPage();
  await page.route(`**/api/teams/${teamId}`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), members: null },
    });
  });

  await page.goto(`/dashboard/teams/${teamId}`);

  await expect(page.getByRole("heading", { name: "星取表" })).toBeVisible();
  await expect(
    page.getByText("メンバー一覧を取得できませんでした"),
  ).toHaveCount(2);
  await expect(page.getByLabel("割り当てるメンバー")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /を外す$/ })).toHaveCount(0);

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
