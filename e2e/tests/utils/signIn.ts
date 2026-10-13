import { Browser, BrowserContext } from "@playwright/test";
import { desc, eq } from "drizzle-orm";

import { authDb } from "../../db/auth-client";
import { company, membership, user, verification } from "../../db/auth-schema";

export const APP_BASE_URL =
  process.env.APP_BASE_URL ?? "http://app.taimei-code.local:3001";
export const AUTH_BASE_URL =
  process.env.AUTH_BASE_URL ?? "http://auth.taimei-code.local:3100";

type MembershipOptions = {
  companyId?: string;
  role?: "OWNER" | "ADMIN" | "MEMBER";
};

export async function createTestUser(
  options: MembershipOptions = {},
): Promise<string> {
  const uuid = crypto.randomUUID();
  const email = `e2e-${uuid}@example.com`;
  await authDb.insert(user).values({
    id: uuid,
    name: "E2E Test User",
    email,
    emailVerified: false,
  });
  // dashboard は事業所所属を要求する (ADR-0002)。sign-in (verify) の前に company /
  // membership / last_used_company_id を用意し、companyId を session cookie へ焼き込ませる。
  await provisionCompanyForUser(uuid, options);
  return email;
}

// session の companyId source は user.last_used_company_id (ADR-009)。
export async function provisionCompanyForUser(
  userId: string,
  {
    companyId = `cmp_e2e${userId.replace(/-/g, "").slice(0, 22)}`,
    role = "OWNER",
  }: MembershipOptions = {},
): Promise<string> {
  await authDb
    .insert(company)
    .values({
      id: companyId,
      name: "E2E Company",
      orgCode: "CORPORATE",
    })
    .onConflictDoNothing();
  await authDb
    .insert(membership)
    .values({ id: crypto.randomUUID(), userId, companyId, role })
    .onConflictDoNothing();
  await authDb
    .update(user)
    .set({ lastUsedCompanyId: companyId })
    .where(eq(user.id, userId));
  return companyId;
}

// Better Auth 1.5.6 の magic-link plugin は verification.value に
//   { email, name?, attempt: number }
// の JSON を保存するため、完全一致でなく email キーで post-filter する。
// (storeToken の default は "plain" のため identifier = raw token と一致。)
export async function getVerificationToken(
  email: string,
  options: { maxRetries?: number; retryDelay?: number } = {},
): Promise<string> {
  const { maxRetries = 20, retryDelay = 1000 } = options;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const records = await authDb
      .select()
      .from(verification)
      .orderBy(desc(verification.createdAt))
      .limit(20);

    const record = records.find((r) => {
      try {
        const parsed = JSON.parse(r.value);
        return parsed.email === email;
      } catch {
        return false;
      }
    });

    if (record) {
      return record.identifier;
    }

    if (attempt < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }

  throw new Error(
    `Verification token not found for ${email} after ${maxRetries} attempts`,
  );
}

export async function signInWithMagicLink(
  browser: Browser,
  email: string,
): Promise<BrowserContext> {
  // 1. taimei-auth に Magic Link 送信リクエスト (verification record が DB に書かれる)
  const sendResp = await fetch(`${AUTH_BASE_URL}/api/auth/sign-in/magic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!sendResp.ok) {
    throw new Error(`Magic link request failed: ${sendResp.status}`);
  }

  return verifyMagicLinkAndGetContext(
    browser,
    await getVerificationToken(email),
  );
}

export async function verifyMagicLinkAndGetContext(
  browser: Browser,
  token: string,
): Promise<BrowserContext> {
  const context = await browser.newContext();
  // context.request は context の cookie を共有するので、verify の Set-Cookie (Domain=.taimei-code.local) が context に入る
  const response = await context.request.get(
    `${AUTH_BASE_URL}/api/auth/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent(`${APP_BASE_URL}/auth/after-signin`)}`,
    { maxRedirects: 0 },
  );
  if (response.status() !== 302)
    throw new Error(`Magic Link の verify が ${response.status()}`);
  return context;
}
