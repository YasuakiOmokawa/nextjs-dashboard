import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("Company DO", () => {
  it("seed した星取表を返し、他の事業所の DO からは見えない", async () => {
    const a = env.COMPANY.get(env.COMPANY.idFromName("cmp_a"));
    const b = env.COMPANY.get(env.COMPANY.idFromName("cmp_b"));
    const { teamId } = await a.seed();
    expect((await a.getMatrix(teamId))?.levels).toHaveLength(300);
    expect(await b.getMatrix(teamId)).toBeNull();
  });

  it("CASCADE ありで親の表を作り直すと子の行が消えることをテストで捕まえられる", async () => {
    const trial = env.TRIAL.get(env.TRIAL.idFromName("cascade"));
    await trial.prepare("cascade");
    const result = await trial.upgrade("cascade", "plain");
    expect(result.lost).toEqual(["skills", "team_assignments", "member_skills"]);
  });
});
