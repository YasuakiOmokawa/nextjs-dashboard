import { count, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  memberSkills,
  skills,
  teamAssignments,
  teams,
} from "@/db/drizzle/schema";
import { CompanyId } from "@/db/ids";
import {
  functionValue,
  type TestDb,
  withRollback,
} from "@/src/services/__tests__/db/test-db";
import { type CheckMemberships, purgeDeparted } from "../purge-departed";
import { sendErrorReportsTo } from "../report-error";

const seedTeam = async (
  tx: TestDb,
  unbrandedCompanyId: string,
  userIds: readonly string[],
  assignedAt = new Date("2026-10-01T00:00:00Z"),
) => {
  const companyId = CompanyId.make(unbrandedCompanyId);
  const [team] = await tx
    .insert(teams)
    .values({ companyId, name: `${companyId} のチーム` })
    .returning();
  const [skill] = await tx
    .insert(skills)
    .values({ companyId, teamId: team.id, name: "設計" })
    .returning();
  for (const userId of userIds) {
    await tx
      .insert(teamAssignments)
      .values({ companyId, teamId: team.id, userId, createdAt: assignedAt });
    await tx.insert(memberSkills).values({
      companyId,
      teamId: team.id,
      skillId: skill.id,
      userId,
      level: 2,
      wantsToLearn: false,
    });
  }
  return team;
};

const rowsOf = async (tx: TestDb, companyId: string) => {
  const counts: Record<string, number> = {};
  for (const [name, table] of Object.entries({
    teams,
    skills,
    teamAssignments,
    memberSkills,
  })) {
    const [{ value }] = await tx
      .select({ value: count() })
      .from(table)
      .where(eq(table.companyId, CompanyId.make(companyId)));
    counts[name] = value;
  }
  return counts;
};

const assignedUserIds = async (tx: TestDb, companyId: string) =>
  (
    await tx
      .select({ userId: teamAssignments.userId })
      .from(teamAssignments)
      .where(eq(teamAssignments.companyId, CompanyId.make(companyId)))
  )
    .map((row) => row.userId)
    .sort();

const startedAt = new Date("2026-10-06T18:00:00Z");

const replaceTeamList = vi.fn(
  async (_companyId: string, _bumped: unknown) => {},
);
beforeEach(() => replaceTeamList.mockReset());

const listVersion = async (tx: TestDb, companyId: string) =>
  (
    (await functionValue(tx, sql`company_team_list(${companyId})`)) as {
      version: number;
    }
  ).version;

const answering =
  (
    answers: Record<
      string,
      { companyActive: boolean; memberUserIds: string[] } | Error
    >,
  ): CheckMemberships =>
  async ({ companyId }) => {
    const answer = answers[companyId];
    if (answer instanceof Error) throw answer;
    return answer;
  };

describe("purgeDeparted", () => {
  it("ACTIVE でない事業所は、チーム・スキル・割り当て・評価がすべて消える", () =>
    withRollback(async (tx) => {
      await seedTeam(tx, "cmp_gone", ["u_1"]);
      expect(await rowsOf(tx, "cmp_gone")).toEqual({
        teams: 1,
        skills: 1,
        teamAssignments: 1,
        memberSkills: 1,
      });

      await purgeDeparted({
        db: tx,
        replaceTeamList,
        checkMemberships: answering({
          cmp_gone: { companyActive: false, memberUserIds: [] },
        }),
        startedAt,
      });

      expect(await rowsOf(tx, "cmp_gone")).toEqual({
        teams: 0,
        skills: 0,
        teamAssignments: 0,
        memberSkills: 0,
      });
    }));

  it("ACTIVE な事業所では、所属しない人の割り当てと評価だけが消え、所属する人の行は残る", () =>
    withRollback(async (tx) => {
      await seedTeam(tx, "cmp_active", ["u_stays", "u_left"]);
      const before = await tx.select().from(memberSkills);

      const report = await purgeDeparted({
        db: tx,
        replaceTeamList,
        checkMemberships: answering({
          cmp_active: { companyActive: true, memberUserIds: ["u_stays"] },
        }),
        startedAt,
      });

      expect(await assignedUserIds(tx, "cmp_active")).toEqual(["u_stays"]);
      expect(await tx.select().from(memberSkills)).toEqual(
        before.filter((row) => row.userId === "u_stays"),
      );
      expect(report.removedAssignments).toBe(1);
    }));

  it("照合を始めた後に作った割り当ては、所属の答えに無くても消えない", () =>
    withRollback(async (tx) => {
      const afterStart = new Date(startedAt.getTime() + 1000);
      await seedTeam(tx, "cmp_new", ["u_new"], afterStart);

      await purgeDeparted({
        db: tx,
        replaceTeamList,
        checkMemberships: answering({
          cmp_new: { companyActive: true, memberUserIds: [] },
        }),
        startedAt,
      });

      expect(await assignedUserIds(tx, "cmp_new")).toEqual(["u_new"]);
    }));

  it("ある事業所の照合が失敗すると、その事業所は残して飛ばし、ほかの事業所は消す", () =>
    withRollback(async (tx) => {
      await seedTeam(tx, "cmp_unreachable", ["u_1"]);
      await seedTeam(tx, "cmp_gone", ["u_2"]);

      const report = await purgeDeparted({
        db: tx,
        replaceTeamList,
        checkMemberships: answering({
          cmp_unreachable: new Error("taimei-auth unavailable"),
          cmp_gone: { companyActive: false, memberUserIds: [] },
        }),
        startedAt,
      });

      expect(report).toEqual({
        deletedCompanyIds: ["cmp_gone"],
        removedAssignments: 0,
        skippedCompanyIds: ["cmp_unreachable"],
      });
      expect(await assignedUserIds(tx, "cmp_unreachable")).toEqual(["u_1"]);
      expect((await rowsOf(tx, "cmp_gone")).teams).toBe(0);
    }));

  it("照合の失敗は、事業所の id を message に、原因を cause にした Error で 1 回報告する", () =>
    withRollback(async (tx) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const send = vi.fn();
      sendErrorReportsTo(send);
      onTestFinished(() => {
        sendErrorReportsTo(() => {});
        vi.restoreAllMocks();
      });
      const cause = new Error("taimei-auth unavailable");
      await seedTeam(tx, "cmp_unreachable", ["u_1"]);

      await purgeDeparted({
        db: tx,
        replaceTeamList,
        checkMemberships: answering({ cmp_unreachable: cause }),
        startedAt,
      });

      expect(send).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: expect.stringContaining("cmp_unreachable"),
          cause,
        }),
      );
    }));

  it("ある事業所を消しても、ほかの事業所の行は変わらない", () =>
    withRollback(async (tx) => {
      await seedTeam(tx, "cmp_gone", ["u_1"]);
      await seedTeam(tx, "cmp_other", ["u_2"]);
      const before = await rowsOf(tx, "cmp_other");

      await purgeDeparted({
        db: tx,
        replaceTeamList,
        checkMemberships: answering({
          cmp_gone: { companyActive: false, memberUserIds: [] },
          cmp_other: { companyActive: true, memberUserIds: ["u_2"] },
        }),
        startedAt,
      });

      expect(await rowsOf(tx, "cmp_other")).toEqual(before);
    }));

  it("同じ答えで 2 回流すと、2 回目は何も消さない", () =>
    withRollback(async (tx) => {
      await seedTeam(tx, "cmp_gone", ["u_1"]);
      await seedTeam(tx, "cmp_active", ["u_stays", "u_left"]);
      const checkMemberships = answering({
        cmp_gone: { companyActive: false, memberUserIds: [] },
        cmp_active: { companyActive: true, memberUserIds: ["u_stays"] },
      });

      const first = await purgeDeparted({
        db: tx,
        replaceTeamList,
        checkMemberships,
        startedAt,
      });
      const second = await purgeDeparted({
        db: tx,
        replaceTeamList,
        checkMemberships,
        startedAt,
      });

      expect(first).toEqual({
        deletedCompanyIds: ["cmp_gone"],
        removedAssignments: 1,
        skippedCompanyIds: [],
      });
      expect(second).toEqual({
        deletedCompanyIds: [],
        removedAssignments: 0,
        skippedCompanyIds: [],
      });
    }));
});

describe("purgeDeparted が一覧を変えた事業所の DO の一覧", () => {
  it("ACTIVE でない事業所のチームを消した後に、増やした版の空の一覧で書き直す", () =>
    withRollback(async (tx) => {
      await seedTeam(tx, "cmp_gone", ["u_1"]);
      const before = await listVersion(tx, "cmp_gone");

      await purgeDeparted({
        db: tx,
        replaceTeamList,
        checkMemberships: answering({
          cmp_gone: { companyActive: false, memberUserIds: [] },
        }),
        startedAt,
      });

      expect(replaceTeamList).toHaveBeenCalledExactlyOnceWith("cmp_gone", {
        version: before + 1,
        teams: [],
      });
    }));

  it("所属しない人の割り当てを外した事業所は、増やした版の外した後の一覧で書き直し、外す人のいない事業所は書き直さない", () =>
    withRollback(async (tx) => {
      await seedTeam(tx, "cmp_active", ["u_stays", "u_left"]);
      await seedTeam(tx, "cmp_unchanged", ["u_stays"]);
      const before = await listVersion(tx, "cmp_active");
      const unchangedBefore = await listVersion(tx, "cmp_unchanged");

      await purgeDeparted({
        db: tx,
        replaceTeamList,
        checkMemberships: answering({
          cmp_active: { companyActive: true, memberUserIds: ["u_stays"] },
          cmp_unchanged: { companyActive: true, memberUserIds: ["u_stays"] },
        }),
        startedAt,
      });

      expect(replaceTeamList).toHaveBeenCalledOnce();
      const [[companyId, bumped]] = replaceTeamList.mock.calls;
      expect(companyId).toBe("cmp_active");
      expect(bumped).toMatchObject({
        version: before + 1,
        teams: [{ assignedUserIds: ["u_stays"] }],
      });
      expect(await listVersion(tx, "cmp_unchanged")).toBe(unchangedBefore);
    }));

  it("照合に失敗して飛ばした事業所の一覧は書き直さない", () =>
    withRollback(async (tx) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      onTestFinished(() => {
        vi.restoreAllMocks();
      });
      await seedTeam(tx, "cmp_unreachable", ["u_1"]);
      await seedTeam(tx, "cmp_gone", ["u_2"]);

      const report = await purgeDeparted({
        db: tx,
        replaceTeamList,
        checkMemberships: answering({
          cmp_unreachable: new Error("taimei-auth unavailable"),
          cmp_gone: { companyActive: false, memberUserIds: [] },
        }),
        startedAt,
      });

      expect(report.skippedCompanyIds).toEqual(["cmp_unreachable"]);
      expect(replaceTeamList).toHaveBeenCalledOnce();
      expect(replaceTeamList.mock.calls[0][0]).toBe("cmp_gone");
    }));

  it("一覧を書き直せなくても 1 回報告し、次の事業所を続ける", () =>
    withRollback(async (tx) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const send = vi.fn();
      sendErrorReportsTo(send);
      onTestFinished(() => {
        sendErrorReportsTo(() => {});
        vi.restoreAllMocks();
      });
      await seedTeam(tx, "cmp_gone", ["u_1"]);
      await seedTeam(tx, "cmp_also_gone", ["u_2"]);
      replaceTeamList.mockRejectedValueOnce(new Error("DO に届かない"));

      const report = await purgeDeparted({
        db: tx,
        replaceTeamList,
        checkMemberships: answering({
          cmp_gone: { companyActive: false, memberUserIds: [] },
          cmp_also_gone: { companyActive: false, memberUserIds: [] },
        }),
        startedAt,
      });

      expect(send).toHaveBeenCalledOnce();
      expect(report.deletedCompanyIds.sort()).toEqual([
        "cmp_also_gone",
        "cmp_gone",
      ]);
    }));
});
