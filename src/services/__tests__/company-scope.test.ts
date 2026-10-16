import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { writeInCompanyScope } from "../company-scope";
import { fixtureCompanyId } from "./db/seed";
import { withRollback } from "./db/test-db";

const COMPANY_SCOPE = fixtureCompanyId("scope");

describe("writeInCompanyScope", () => {
  it("本体が promise を返す前に投げても、DB の失敗にせず同じ値で reject する", () =>
    withRollback(async (tx) => {
      const defect = new Error("bug");

      await expect(
        writeInCompanyScope(tx, COMPANY_SCOPE, () => {
          throw defect;
        }),
      ).rejects.toBe(defect);
    }));

  it("companyId を引数で受ける書き込みの口を使えるのは、session から導く実行口と、事業所の行を読む purgeDeparted だけ", () => {
    const callers = execFileSync(
      "git",
      [
        "grep",
        "--untracked",
        "-l",
        "-w",
        "-E",
        "writeInCompanyScope|writeTeamList",
        "--",
        "src",
        "db",
        ":!**/__tests__/**",
        ":!*.md",
      ],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n");

    expect(callers).toEqual([
      "src/lib/purge-departed.ts",
      "src/services/company-scope.ts",
      "src/services/company-team-list.ts",
      "src/services/index.ts",
    ]);
  });
});
