import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const SDK_WIRE_TERMS =
  /RESULT_|ROLE_|sessionToken|session_token|defaultCompanyId|currentRole|Connect-|X-Service-Key|CheckMemberships|companyActive|memberUserIds|Response\.json|TextDecoder|\/rpc\//;

it.each([
  "src/__tests__/app.test.ts",
  "src/__tests__/auth.test.ts",
  "src/__tests__/worker.test.ts",
])(
  "auth を偽にする試験 %s は、SDK の通信の形 (RPC 名・proto の JSON・Connect の header・cookie の名前) を書かない (SDK の通信の互換は taimei-auth の CI と e2e が守る)",
  (path) => {
    expect(
      readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => SDK_WIRE_TERMS.test(line)),
    ).toEqual([]);
  },
);
