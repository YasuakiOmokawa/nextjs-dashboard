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

const TAIMEI_AUTH_CONTRACT = "src/taimei-auth-contract.ts";

const TAIMEI_AUTH_CONTRACT_TERMS =
  /service_name|redirect_url|reason=|\/auth\/error|\/auth\/signup\/|AUTH_URL\}\/|"\/account|5 \* 60|300_000|\/rpc\b/;

const srcFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "src"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(
    (path) =>
      /\.tsx?$/.test(path) &&
      existsSync(path) &&
      path !== TAIMEI_AUTH_CONTRACT &&
      path !== "src/__tests__/taimei-auth-knowledge.test.ts",
  );

it.each(srcFiles)(
  `%s は、taimei-auth の画面の URL・Magic Link の有効期限・RPC の path を書かず ${TAIMEI_AUTH_CONTRACT} から読む (taimei-auth が変えた時に直すのをその 1 file にする)`,
  (path) => {
    expect(linesMatching(path, TAIMEI_AUTH_CONTRACT_TERMS)).toEqual([]);
  },
);
