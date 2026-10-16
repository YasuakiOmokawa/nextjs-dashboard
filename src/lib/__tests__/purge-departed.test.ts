import { count, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { CompanyId } from "@/db/company-id";
import {
  memberSkills,
  skills,
  teamAssignments,
  teams,
} from "@/db/drizzle/schema";
import { fixtureCompanyId } from "@/src/services/__tests__/db/seed";
import {
  functionValue,
  type TestDb,
  teamListVersion,
  withRollback,
} from "@/src/services/__tests__/db/test-db";
import {
  captureReports,
  companyTeamListBackedBy,
  readReplaceClearCounts,
  type TeamListStubSpy,
  teamListStubOf,
} from "@/src/services/__tests__/request";
import { type CheckMemberships, purgeDeparted } from "../purge-departed";
import { sendErrorReportsTo } from "../report-error";

const COMPANY_ACTIVE = fixtureCompanyId("active");
const COMPANY_ALSO_GONE = fixtureCompanyId("also_gone");
const COMPANY_GONE = fixtureCompanyId("gone");
const COMPANY_NEW = fixtureCompanyId("new");
const COMPANY_OTHER = fixtureCompanyId("other");
const COMPANY_UNCHANGED = fixtureCompanyId("unchanged");
const COMPANY_UNREACHABLE = fixtureCompanyId("unreachable");

const seedTeam = async (
  tx: TestDb,
  companyId: CompanyId,
  userIds: readonly string[],
  assignedAt = new Date("2026-10-01T00:00:00Z"),
) => {
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

const rowsOf = async (tx: TestDb, companyId: CompanyId) => {
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
      .where(eq(table.companyId, companyId));
    counts[name] = value;
  }
  return counts;
};

const assignedUserIds = async (tx: TestDb, companyId: CompanyId) =>
  (
    await tx
      .select({ userId: teamAssignments.userId })
      .from(teamAssignments)
      .where(eq(teamAssignments.companyId, companyId))
  )
    .map((row) => row.userId)
    .sort();

const startedAt = new Date("2026-10-06T18:00:00Z");

const teamListStubs = new Map<string, TeamListStubSpy>();
const teamListStubFor = (companyId: string) => {
  const stub = teamListStubs.get(companyId) ?? teamListStubOf();
  teamListStubs.set(companyId, stub);
  return stub;
};
const teamListOf = vi.fn((companyId: CompanyId) =>
  companyTeamListBackedBy(teamListStubFor(companyId))(),
);
beforeEach(() => {
  teamListStubs.clear();
  teamListOf.mockClear();
});
const replacedSnapshots = (companyId: string) =>
  teamListStubs.get(companyId)?.replace.mock.calls.map(([, list]) => list) ??
  [];
const readReplaceClearCountsOf = (companyId: string) => {
  const stub = teamListStubs.get(companyId);
  return stub ? readReplaceClearCounts(stub) : [0, 0, 0];
};

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
      await seedTeam(tx, COMPANY_GONE, ["u_1"]);
      expect(await rowsOf(tx, COMPANY_GONE)).toEqual({
        teams: 1,
        skills: 1,
        teamAssignments: 1,
        memberSkills: 1,
      });

      await purgeDeparted({
        db: tx,
        teamListOf,
        checkMemberships: answering({
          [COMPANY_GONE]: { companyActive: false, memberUserIds: [] },
        }),
        startedAt,
      });

      expect(await rowsOf(tx, COMPANY_GONE)).toEqual({
        teams: 0,
        skills: 0,
        teamAssignments: 0,
        memberSkills: 0,
      });
    }));

  it("ACTIVE な事業所では、所属しない人の割り当てと評価だけが消え、所属する人の行は残る", () =>
    withRollback(async (tx) => {
      await seedTeam(tx, COMPANY_ACTIVE, ["u_stays", "u_left"]);
      const before = await tx.select().from(memberSkills);

      const report = await purgeDeparted({
        db: tx,
        teamListOf,
        checkMemberships: answering({
          [COMPANY_ACTIVE]: { companyActive: true, memberUserIds: ["u_stays"] },
        }),
        startedAt,
      });

      expect(await assignedUserIds(tx, COMPANY_ACTIVE)).toEqual(["u_stays"]);
      expect(await tx.select().from(memberSkills)).toEqual(
        before.filter((row) => row.userId === "u_stays"),
      );
      expect(report.removedAssignments).toBe(1);
    }));

  it("照合を始めた後に作った割り当ては、所属の答えに無くても消えない", () =>
    withRollback(async (tx) => {
      const afterStart = new Date(startedAt.getTime() + 1000);
      await seedTeam(tx, COMPANY_NEW, ["u_new"], afterStart);

      await purgeDeparted({
        db: tx,
        teamListOf,
        checkMemberships: answering({
          [COMPANY_NEW]: { companyActive: true, memberUserIds: [] },
        }),
        startedAt,
      });

      expect(await assignedUserIds(tx, COMPANY_NEW)).toEqual(["u_new"]);
    }));

  it("ある事業所の照合が失敗すると、その事業所は残して飛ばし、ほかの事業所は消す", () =>
    withRollback(async (tx) => {
      await seedTeam(tx, COMPANY_UNREACHABLE, ["u_1"]);
      await seedTeam(tx, COMPANY_GONE, ["u_2"]);

      const report = await purgeDeparted({
        db: tx,
        teamListOf,
        checkMemberships: answering({
          [COMPANY_UNREACHABLE]: new Error("taimei-auth unavailable"),
          [COMPANY_GONE]: { companyActive: false, memberUserIds: [] },
        }),
        startedAt,
      });

      expect(report).toEqual({
        deletedCompanyIds: [COMPANY_GONE],
        removedAssignments: 0,
        skippedCompanyIds: [COMPANY_UNREACHABLE],
      });
      expect(await assignedUserIds(tx, COMPANY_UNREACHABLE)).toEqual(["u_1"]);
      expect((await rowsOf(tx, COMPANY_GONE)).teams).toBe(0);
    }));

  it("照合の失敗は、事業所の id を message に、原因を cause にした Error で 1 回報告する", () =>
    withRollback(async (tx) => {
      const send = captureReports();
      const cause = new Error("taimei-auth unavailable");
      await seedTeam(tx, COMPANY_UNREACHABLE, ["u_1"]);

      await purgeDeparted({
        db: tx,
        teamListOf,
        checkMemberships: answering({ [COMPANY_UNREACHABLE]: cause }),
        startedAt,
      });

      expect(send).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: expect.stringContaining(COMPANY_UNREACHABLE),
          cause,
        }),
      );
    }));

  it("ある事業所を消しても、ほかの事業所の行は変わらない", () =>
    withRollback(async (tx) => {
      await seedTeam(tx, COMPANY_GONE, ["u_1"]);
      await seedTeam(tx, COMPANY_OTHER, ["u_2"]);
      const before = await rowsOf(tx, COMPANY_OTHER);

      await purgeDeparted({
        db: tx,
        teamListOf,
        checkMemberships: answering({
          [COMPANY_GONE]: { companyActive: false, memberUserIds: [] },
          [COMPANY_OTHER]: { companyActive: true, memberUserIds: ["u_2"] },
        }),
        startedAt,
      });

      expect(await rowsOf(tx, COMPANY_OTHER)).toEqual(before);
    }));

  it("同じ答えで 2 回流すと、2 回目は何も消さない", () =>
    withRollback(async (tx) => {
      await seedTeam(tx, COMPANY_GONE, ["u_1"]);
      await seedTeam(tx, COMPANY_ACTIVE, ["u_stays", "u_left"]);
      const checkMemberships = answering({
        [COMPANY_GONE]: { companyActive: false, memberUserIds: [] },
        [COMPANY_ACTIVE]: { companyActive: true, memberUserIds: ["u_stays"] },
      });

      const first = await purgeDeparted({
        db: tx,
        teamListOf,
        checkMemberships,
        startedAt,
      });
      const second = await purgeDeparted({
        db: tx,
        teamListOf,
        checkMemberships,
        startedAt,
      });

      expect(first).toEqual({
        deletedCompanyIds: [COMPANY_GONE],
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
      await seedTeam(tx, COMPANY_GONE, ["u_1"]);
      const before = await teamListVersion(tx, COMPANY_GONE);

      await purgeDeparted({
        db: tx,
        teamListOf,
        checkMemberships: answering({
          [COMPANY_GONE]: { companyActive: false, memberUserIds: [] },
        }),
        startedAt,
      });

      expect(teamListOf).toHaveBeenCalledExactlyOnceWith(COMPANY_GONE);
      expect(replacedSnapshots(COMPANY_GONE)).toEqual([
        { version: before + 1, teams: [] },
      ]);
    }));

  it("所属しない人の割り当てを外した事業所は、増やした版の外した後の一覧で書き直し、外す人のいない事業所は書き直さない", () =>
    withRollback(async (tx) => {
      await seedTeam(tx, COMPANY_ACTIVE, ["u_stays", "u_left"]);
      await seedTeam(tx, COMPANY_UNCHANGED, ["u_stays"]);
      const before = await teamListVersion(tx, COMPANY_ACTIVE);
      const unchangedBefore = await teamListVersion(tx, COMPANY_UNCHANGED);

      await purgeDeparted({
        db: tx,
        teamListOf,
        checkMemberships: answering({
          [COMPANY_ACTIVE]: { companyActive: true, memberUserIds: ["u_stays"] },
          [COMPANY_UNCHANGED]: {
            companyActive: true,
            memberUserIds: ["u_stays"],
          },
        }),
        startedAt,
      });

      expect(replacedSnapshots(COMPANY_ACTIVE)).toMatchObject([
        { version: before + 1, teams: [{ assignedUserIds: ["u_stays"] }] },
      ]);
      expect(await teamListVersion(tx, COMPANY_UNCHANGED)).toBe(
        unchangedBefore,
      );
      expect(readReplaceClearCountsOf(COMPANY_UNCHANGED)).toEqual([0, 0, 0]);
    }));

  it("照合に失敗して飛ばした事業所の一覧は書き直さない", () =>
    withRollback(async (tx) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      onTestFinished(() => {
        vi.restoreAllMocks();
      });
      await seedTeam(tx, COMPANY_UNREACHABLE, ["u_1"]);
      await seedTeam(tx, COMPANY_GONE, ["u_2"]);
      const before = await teamListVersion(tx, COMPANY_UNREACHABLE);

      const report = await purgeDeparted({
        db: tx,
        teamListOf,
        checkMemberships: answering({
          [COMPANY_UNREACHABLE]: new Error("taimei-auth unavailable"),
          [COMPANY_GONE]: { companyActive: false, memberUserIds: [] },
        }),
        startedAt,
      });

      expect(report.skippedCompanyIds).toEqual([COMPANY_UNREACHABLE]);
      expect(readReplaceClearCountsOf(COMPANY_UNREACHABLE)).toEqual([0, 0, 0]);
      expect(await teamListVersion(tx, COMPANY_UNREACHABLE)).toBe(before);
      expect(replacedSnapshots(COMPANY_GONE)).toHaveLength(1);
    }));

  it("一覧を書き直せなくても 1 回報告し、次の事業所を続ける", () =>
    withRollback(async (tx) => {
      const send = captureReports();
      await seedTeam(tx, COMPANY_GONE, ["u_1"]);
      await seedTeam(tx, COMPANY_ALSO_GONE, ["u_2"]);
      teamListStubFor(COMPANY_GONE).replace.mockRejectedValue(
        new Error("DO に届かない"),
      );

      const report = await purgeDeparted({
        db: tx,
        teamListOf,
        checkMemberships: answering({
          [COMPANY_GONE]: { companyActive: false, memberUserIds: [] },
          [COMPANY_ALSO_GONE]: { companyActive: false, memberUserIds: [] },
        }),
        startedAt,
      });

      expect(send).toHaveBeenCalledOnce();
      expect(readReplaceClearCountsOf(COMPANY_GONE)).toEqual([0, 2, 1]);
      expect([...report.deletedCompanyIds].sort()).toEqual(
        [COMPANY_ALSO_GONE, COMPANY_GONE].sort(),
      );
      expect(replacedSnapshots(COMPANY_ALSO_GONE)).toHaveLength(1);
    }));

  it("去った人がいても、照合の開始の後に作った割り当てだけで消した行が 0 なら、版を増やして書き直す", () =>
    withRollback(async (tx) => {
      const afterStart = new Date(startedAt.getTime() + 1000);
      await seedTeam(tx, COMPANY_NEW, ["u_new"], afterStart);
      const before = await teamListVersion(tx, COMPANY_NEW);

      const report = await purgeDeparted({
        db: tx,
        teamListOf,
        checkMemberships: answering({
          [COMPANY_NEW]: { companyActive: true, memberUserIds: [] },
        }),
        startedAt,
      });

      expect(report.removedAssignments).toBe(0);
      expect(await teamListVersion(tx, COMPANY_NEW)).toBe(before + 1);
      expect(replacedSnapshots(COMPANY_NEW)).toHaveLength(1);
    }));

  const failingTransactionCall = (tx: TestDb, failingCall: number) => {
    const transaction = tx.transaction.bind(tx);
    let calls = 0;
    vi.spyOn(tx, "transaction").mockImplementation((fn) =>
      ++calls === failingCall
        ? Promise.reject(new Error("connection terminated"))
        : transaction(fn),
    );
  };

  it("ある事業所の書き込みが commit したか分からないと、その DO の一覧を消して飛ばし、1 回報告して次の事業所を続ける", () =>
    withRollback(async (tx) => {
      const send = captureReports();
      await seedTeam(tx, COMPANY_GONE, ["u_1"]);
      await seedTeam(tx, COMPANY_ALSO_GONE, ["u_2"]);
      // 1 社目の割り当ての読み取りが 1 本目、1 社目の書き込みが 2 本目
      failingTransactionCall(tx, 2);

      const report = await purgeDeparted({
        db: tx,
        teamListOf,
        checkMemberships: answering({
          [COMPANY_GONE]: { companyActive: false, memberUserIds: [] },
          [COMPANY_ALSO_GONE]: { companyActive: false, memberUserIds: [] },
        }),
        startedAt,
      });

      const [failed] = report.skippedCompanyIds;
      const [deleted] = report.deletedCompanyIds;
      expect(report.skippedCompanyIds).toHaveLength(1);
      expect(report.deletedCompanyIds).toHaveLength(1);
      expect(readReplaceClearCountsOf(failed)).toEqual([0, 0, 1]);
      expect(replacedSnapshots(deleted)).toHaveLength(1);
      expect(send).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ message: expect.stringContaining(failed) }),
      );
    }));

  it("ある事業所の処理が投げても、1 回報告して飛ばし、次の事業所を続ける", () =>
    withRollback(async (tx) => {
      const send = captureReports();
      await seedTeam(tx, COMPANY_GONE, ["u_1"]);
      await seedTeam(tx, COMPANY_ALSO_GONE, ["u_2"]);
      failingTransactionCall(tx, 1);

      const report = await purgeDeparted({
        db: tx,
        teamListOf,
        checkMemberships: answering({
          [COMPANY_GONE]: { companyActive: false, memberUserIds: [] },
          [COMPANY_ALSO_GONE]: { companyActive: false, memberUserIds: [] },
        }),
        startedAt,
      });

      const [failed] = report.skippedCompanyIds;
      expect(report.skippedCompanyIds).toHaveLength(1);
      expect(report.deletedCompanyIds).toHaveLength(1);
      expect(readReplaceClearCountsOf(failed)).toEqual([0, 0, 0]);
      expect(send).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ message: expect.stringContaining(failed) }),
      );
    }));
});
