import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const linesMatching = (path: string, terms: RegExp) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => terms.test(line));

const SDK_WIRE_TERMS =
  /RESULT_|ROLE_|sessionToken|session_token|defaultCompanyId|currentRole|Connect-|X-Service-Key|CheckMemberships|companyActive|memberUserIds|Response\.json|TextDecoder|\/rpc\b/;

describe("auth を偽にする試験", () => {
  it.each([
    "src/__tests__/app.test.ts",
    "src/__tests__/auth.test.ts",
    "src/__tests__/worker.test.ts",
  ])(
    "%s は、SDK の通信の形 (RPC 名・proto の JSON・Connect の header・cookie の名前) を書かない (SDK の通信の互換は taimei-auth の CI と e2e が守る)",
    (path) => {
      expect(linesMatching(path, SDK_WIRE_TERMS)).toEqual([]);
    },
  );
});

const TAIMEI_AUTH_INTERNAL_TERMS =
  /service_name|redirect_url|reason=|\/auth\/error|\/auth\/signup\/|AUTH_URL\}\/|"\/account|5 \* 60|300_000|\/rpc\b|\/api\/auth\/|\/api\/account\/|\/testing\/v1|auth-schema|verification|session_token|db:migrate|src\/index\.ts|testing\/server\.ts|target: dev|\bAUTH_COOKIE_DOMAIN|\bAUTH_TRUSTED_ORIGINS|\bAUTH_SECRET|\bAPP_ENV|\bAPP_NAME|MFA_TOTP|\bAUTH_DATABASE_URL|auth-postgres|cmp_|taimei-network|\.\.\/taimei-auth/;

const scannedPaths = execFileSync(
  "git",
  [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "src",
    "db",
    "e2e",
    "scripts",
    "docker-compose*.yml",
    "README.md",
    ".github",
  ],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(
    (path) =>
      existsSync(path) &&
      path !== "src/__tests__/taimei-auth-knowledge.test.ts",
  );

it.each(["docker-compose.taimei-auth-port.yml", "scripts/qa-serve.sh"])(
  "%s は、断片の taimei-auth を host の loopback だけに開く (試験用の server は OWNER の session を作れるので LAN に開かない)",
  (path) => {
    const published = linesMatching(path, /^\s*- "[^"]*:3100"$/);
    expect(published).not.toEqual([]);
    expect(
      published.filter((line) => !/^\s*- "127\.0\.0\.1:/.test(line)),
    ).toEqual([]);
  },
);

it.each(scannedPaths)(
  "%s は、taimei-auth の画面の URL・Magic Link の有効期限・内部の API の path・表・token の保存形式・起動の command・内部の環境変数・事業所 id の形・共有ネットワーク・sibling の clone の path を書かず、SDK の公開 API と断片の公開の設定 (TAIMEI_AUTH_*) だけを使う (taimei-auth が変えた時に SDK の版上げだけで済ませる)",
  (path) => {
    expect(linesMatching(path, TAIMEI_AUTH_INTERNAL_TERMS)).toEqual([]);
  },
);
