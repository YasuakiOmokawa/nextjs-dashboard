import { sql } from "drizzle-orm";
import { Effect, Result } from "effect";
import { DatabaseError } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendErrorReportsTo } from "@/src/lib/report-error";
import { type AuthorizationContext, isManager } from "../authorization-context";
import type { CompanyContext } from "../company-context";
import { CompanyTeamList } from "../company-team-list";
import { ReadDb } from "../db-service";
import { TeamReads } from "../team-reads";
import {
  createdAtMinute,
  seedAssignment,
  seedLevel,
  seedSkill,
  seedTeam,
} from "./db/seed";
import { functionValue, withRollback } from "./db/test-db";
import {
  type Actor,
  ADMIN,
  companyTeamListBackedBy,
  failureTag,
  MEMBER,
  NO_ROLE,
  runAsActor,
  type TeamListStubSpy,
  teamListStubOf,
} from "./request";

const readAs =
  (
    db: ReadDb["Service"],
    actor: Actor,
    teamList: TeamListStubSpy = teamListStubOf(),
  ) =>
  <A, E>(
    f: (
      reads: TeamReads["Service"],
    ) => Effect.Effect<
      A,
      E,
      CompanyContext | AuthorizationContext | CompanyTeamList
    >,
  ) =>
    runAsActor(
      actor,
      TeamReads.use(f).pipe(
        Effect.provide(TeamReads.layer),
        Effect.provideService(ReadDb, db),
        Effect.provideService(
          CompanyTeamList,
          companyTeamListBackedBy(teamList)(),
        ),
      ),
    );

const reports = vi.fn();
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  sendErrorReportsTo(reports);
});
afterEach(() => {
  vi.restoreAllMocks();
  reports.mockReset();
  sendErrorReportsTo(() => {});
});

describe("getTeam", () => {
  it("管理者には名前・作成の古い順のスキル・割り当てた user id・そのチームの記録を返す", () =>
    withRollback(async (tx) => {
      const id = await seedTeam(tx, "cmp_a", "開発");
      const second = await seedSkill(
        tx,
        "cmp_a",
        id,
        "テスト",
        createdAtMinute(2),
      );
      const first = await seedSkill(
        tx,
        "cmp_a",
        id,
        "設計",
        createdAtMinute(1),
      );
      await seedAssignment(tx, "cmp_a", id, "u_2");
      await seedAssignment(tx, "cmp_a", id, "u_1");
      await seedLevel(tx, {
        companyId: "cmp_a",
        teamId: id,
        skillId: first,
        userId: "u_1",
        level: 3,
        wantsToLearn: true,
      });

      const result = await readAs(tx, ADMIN)((r) => r.getTeam(id));

      expect(Result.getOrThrow(result)).toEqual({
        id,
        name: "開発",
        skills: [
          { id: first, name: "設計" },
          { id: second, name: "テスト" },
        ],
        assignedUserIds: ["u_1", "u_2"],
        levels: [
          { userId: "u_1", skillId: first, level: 3, wantsToLearn: true },
        ],
      });
    }));

  it.each([
    ["MEMBER", MEMBER],
    ["role の無い人", NO_ROLE],
  ])("%s には割り当てられたチームだけが見つかる", (_, actor) =>
    withRollback(async (tx) => {
      const assigned = await seedTeam(tx, "cmp_a", "X");
      const unassigned = await seedTeam(tx, "cmp_a", "Y");
      await seedAssignment(tx, "cmp_a", assigned, "u_m");
      const read = readAs(tx, actor);

      expect(Result.getOrThrow(await read((r) => r.getTeam(assigned))).id).toBe(
        assigned,
      );
      expect(failureTag(await read((r) => r.getTeam(unassigned)))).toBe(
        "TeamNotFound",
      );
    }),
  );

  it("大文字で書いた UUID でも、DB の関数と同じくそのチームが見つかる", () =>
    withRollback(async (tx) => {
      const id = await seedTeam(tx, "cmp_a", "開発");

      const result = await readAs(
        tx,
        ADMIN,
      )((r) => r.getTeam(id.toUpperCase()));

      expect(Result.getOrThrow(result).id).toBe(id);
    }));

  it("他社のチームは見つからない", () =>
    withRollback(async (tx) => {
      const id = await seedTeam(tx, "cmp_b", "他社");

      const result = await readAs(tx, ADMIN)((r) => r.getTeam(id));

      expect(failureTag(result)).toBe("TeamNotFound");
    }));

  it("他社のチームへの割り当ては、自社の事業所で開いても見えない", () =>
    withRollback(async (tx) => {
      const other = await seedTeam(tx, "cmp_b", "他社");
      await seedAssignment(tx, "cmp_b", other, "u_m");

      const result = await readAs(tx, MEMBER)((r) => r.getTeam(other));

      expect(failureTag(result)).toBe("TeamNotFound");
    }));

  it("UUID でない id は文を流さずに見つからない", () =>
    withRollback(async (tx) => {
      const id = await seedTeam(tx, "cmp_a", "開発");
      const execute = vi.spyOn(tx, "execute");

      const invalid = await readAs(tx, ADMIN)((r) => r.getTeam("not-a-uuid"));
      const callsForInvalid = execute.mock.calls.length;
      await readAs(tx, ADMIN)((r) => r.getTeam(id));

      expect(failureTag(invalid)).toBe("TeamNotFound");
      expect(callsForInvalid).toBe(0);
      expect(execute).toHaveBeenCalledOnce();
    }));

  it("記録はそのチームの行だけで、同じ事業所のほかのチームと他社の行を含まない", () =>
    withRollback(async (tx) => {
      const x = await seedTeam(tx, "cmp_a", "X");
      const y = await seedTeam(tx, "cmp_a", "Y");
      const other = await seedTeam(tx, "cmp_b", "X");
      const xSkill = await seedSkill(tx, "cmp_a", x, "設計");
      const ySkill = await seedSkill(tx, "cmp_a", y, "設計");
      const otherSkill = await seedSkill(tx, "cmp_b", other, "設計");
      await seedAssignment(tx, "cmp_a", x, "u_1");
      await seedAssignment(tx, "cmp_a", y, "u_1");
      await seedAssignment(tx, "cmp_b", other, "u_1");
      await seedLevel(tx, {
        companyId: "cmp_a",
        teamId: x,
        skillId: xSkill,
        userId: "u_1",
        level: 2,
      });
      await seedLevel(tx, {
        companyId: "cmp_a",
        teamId: y,
        skillId: ySkill,
        userId: "u_1",
      });
      await seedLevel(tx, {
        companyId: "cmp_b",
        teamId: other,
        skillId: otherSkill,
        userId: "u_1",
      });

      const result = await readAs(tx, ADMIN)((r) => r.getTeam(x));

      expect(Result.getOrThrow(result).levels).toEqual([
        { userId: "u_1", skillId: xSkill, level: 2, wantsToLearn: false },
      ]);
    }));
});

describe("listTeams", () => {
  it("管理者には自社の全チームを作成の古い順で返し、他社のチームを返さない", () =>
    withRollback(async (tx) => {
      const later = await seedTeam(tx, "cmp_a", "後", createdAtMinute(2));
      const earlier = await seedTeam(tx, "cmp_a", "先", createdAtMinute(1));
      await seedTeam(tx, "cmp_b", "他社", createdAtMinute(0));

      const result = await readAs(tx, ADMIN)((r) => r.listTeams);

      expect(Result.getOrThrow(result)).toMatchObject([
        { id: earlier, name: "先" },
        { id: later, name: "後" },
      ]);
    }));

  it.each([
    ["MEMBER", MEMBER],
    ["role の無い人", NO_ROLE],
  ])("%s には割り当てられたチームだけを返す", (_, actor) =>
    withRollback(async (tx) => {
      const x = await seedTeam(tx, "cmp_a", "X", createdAtMinute(1));
      const y = await seedTeam(tx, "cmp_a", "Y", createdAtMinute(2));
      await seedTeam(tx, "cmp_a", "Z");
      await seedAssignment(tx, "cmp_a", x, "u_m");
      await seedAssignment(tx, "cmp_a", y, "u_m");

      const result = await readAs(tx, actor)((r) => r.listTeams);

      expect(Result.getOrThrow(result).map((t) => t.id)).toEqual([x, y]);
    }),
  );

  it("どのチームにも割り当てられていない MEMBER には何も返さない", () =>
    withRollback(async (tx) => {
      await seedTeam(tx, "cmp_a", "X");
      const other = await seedTeam(tx, "cmp_b", "他社");
      await seedAssignment(tx, "cmp_b", other, "u_m");

      const forMember = await readAs(tx, MEMBER)((r) => r.listTeams);
      const forAdmin = await readAs(tx, ADMIN)((r) => r.listTeams);

      expect(Result.getOrThrow(forMember)).toEqual([]);
      expect(Result.getOrThrow(forAdmin)).toHaveLength(1);
    }));
});

describe("関数の値を読めないとき", () => {
  const teamList = teamListStubOf();
  const readWith = (execute: () => Promise<unknown>) =>
    readAs({ execute } as unknown as ReadDb["Service"], ADMIN, teamList);

  it("schema に合わない値は、どちらの読み取りも DB の失敗にし、一覧を DO に置かない", async () => {
    const read = readWith(async () => ({
      rows: [{ result: { id: "x", name: "開発" } }],
    }));

    const team = await read((r) => r.getTeam(crypto.randomUUID()));
    const teams = await read((r) => r.listTeams);

    expect([failureTag(team), failureTag(teams)]).toEqual([
      "TeamServiceError",
      "TeamServiceError",
    ]);
    expect(teamList.replace).not.toHaveBeenCalled();
  });

  it("DB が返したエラーで execute が失敗すると、どちらの読み取りも DB の失敗にする", async () => {
    const read = readWith(() =>
      Promise.reject(
        new Error("Failed query", {
          cause: new DatabaseError("function does not exist", 0, "error"),
        }),
      ),
    );

    const team = await read((r) => r.getTeam(crypto.randomUUID()));
    const teams = await read((r) => r.listTeams);

    expect([failureTag(team), failureTag(teams)]).toEqual([
      "TeamServiceError",
      "TeamServiceError",
    ]);
  });

  it("DB に接続できずに execute が失敗すると、どちらの読み取りも DB に繋がらない失敗にする", async () => {
    const read = readWith(() =>
      Promise.reject(
        new Error("Failed query", {
          cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
        }),
      ),
    );

    const team = await read((r) => r.getTeam(crypto.randomUUID()));
    const teams = await read((r) => r.listTeams);

    expect([failureTag(team), failureTag(teams)]).toEqual([
      "DbUnavailable",
      "DbUnavailable",
    ]);
    expect(teamList.replace).not.toHaveBeenCalled();
  });
});

describe("DO の一覧を通した値と星取表は、見える範囲が関数と同じ", () => {
  const UNASSIGNED: Actor = { ...MEMBER, userId: "u_none" };

  it.each([
    ["管理者", ADMIN],
    ["一部のチームに割り当てたメンバー", MEMBER],
    ["role の無い人", NO_ROLE],
    ["どのチームにも割り当てていないメンバー", UNASSIGNED],
  ])("%s", (_, actor) =>
    withRollback(async (tx) => {
      const assigned = await seedTeam(tx, "cmp_a", "X", createdAtMinute(1));
      const unassigned = await seedTeam(tx, "cmp_a", "Y", createdAtMinute(2));
      const other = await seedTeam(tx, "cmp_b", "他社");
      const skill = await seedSkill(tx, "cmp_a", assigned, "設計");
      await seedAssignment(tx, "cmp_a", assigned, "u_m");
      await seedAssignment(tx, "cmp_b", other, "u_m");
      await seedLevel(tx, {
        companyId: "cmp_a",
        teamId: assigned,
        skillId: skill,
        userId: "u_m",
        level: 2,
      });
      const manager = isManager(actor.role);
      const read = readAs(tx, actor, teamListStubOf());

      expect(
        Result.getOrThrow(await read((r) => r.listTeams)).map(
          ({ id, name }) => ({ id, name }),
        ),
      ).toEqual(
        await functionValue(
          tx,
          sql`team_list(${actor.companyId}, ${actor.userId}, ${manager})`,
        ),
      );
      for (const teamId of [assigned, unassigned, other]) {
        const expected = await functionValue(
          tx,
          sql`team_matrix(${actor.companyId}, ${teamId}, ${actor.userId}, ${manager})`,
        );
        const result = await read((r) => r.getTeam(teamId));
        if (expected === null) expect(failureTag(result)).toBe("TeamNotFound");
        else expect(Result.getOrThrow(result)).toEqual(expected);
      }
    }),
  );
});

describe("事業所の DO の一覧", () => {
  it("UUID でない id の getTeam は、DO も DB も読まない", () =>
    withRollback(async (tx) => {
      const teamList = teamListStubOf();
      const execute = vi.spyOn(tx, "execute");

      const result = await readAs(tx, ADMIN, teamList)((r) => r.getTeam("x"));

      expect(failureTag(result)).toBe("TeamNotFound");
      expect(execute).not.toHaveBeenCalled();
      expect(teamList.read).not.toHaveBeenCalled();
    }));

  it("getTeam は DO を読み書きせず、team_matrix を読む", () =>
    withRollback(async (tx) => {
      const id = await seedTeam(tx, "cmp_a", "開発");
      const teamList = teamListStubOf();

      const result = await readAs(tx, ADMIN, teamList)((r) => r.getTeam(id));

      expect(Result.getOrThrow(result).id).toBe(id);
      expect([
        teamList.read.mock.calls.length,
        teamList.replace.mock.calls.length,
        teamList.clear.mock.calls.length,
      ]).toEqual([0, 0, 0]);
    }));

  it("DO に一覧がある時の listTeams は DB を読まない", () =>
    withRollback(async (tx) => {
      const id = await seedTeam(tx, "cmp_a", "開発");
      const read = readAs(tx, ADMIN, teamListStubOf());
      await read((r) => r.listTeams);
      const execute = vi.spyOn(tx, "execute");

      const teams = await read((r) => r.listTeams);

      expect(Result.getOrThrow(teams)).toMatchObject([{ id, name: "開発" }]);
      expect(execute).not.toHaveBeenCalled();
    }));

  it("DO が空の時の listTeams は company_team_list の 1 文で読み、その値で DO に置く", () =>
    withRollback(async (tx) => {
      await seedTeam(tx, "cmp_a", "開発");
      const teamList = teamListStubOf();
      const execute = vi.spyOn(tx, "execute");

      await readAs(tx, ADMIN, teamList)((r) => r.listTeams);

      expect(execute).toHaveBeenCalledOnce();
      expect(JSON.stringify(execute.mock.calls[0][0])).toContain(
        "company_team_list(",
      );
      expect(teamList.replace).toHaveBeenCalledExactlyOnceWith(
        "v1",
        await functionValue(tx, sql`company_team_list('cmp_a')`),
      );
    }));

  it("DO を読めない時は DB の値で答え、1 回報告し、DO に置きに行かない", () =>
    withRollback(async (tx) => {
      const id = await seedTeam(tx, "cmp_a", "開発");
      const teamList = teamListStubOf();
      teamList.read.mockImplementation(() => {
        throw new Error("DO に届かない");
      });

      const result = await readAs(tx, ADMIN, teamList)((r) => r.listTeams);

      expect(Result.getOrThrow(result)).toMatchObject([{ id, name: "開発" }]);
      expect(reports).toHaveBeenCalledOnce();
      expect(teamList.replace).not.toHaveBeenCalled();
    }));

  it("DO に置けない時も DB の値で答え、1 回報告する", () =>
    withRollback(async (tx) => {
      const id = await seedTeam(tx, "cmp_a", "開発");
      const teamList = teamListStubOf();
      teamList.replace.mockImplementation(() => {
        throw new Error("DO に届かない");
      });

      const result = await readAs(tx, ADMIN, teamList)((r) => r.listTeams);

      expect(Result.getOrThrow(result)).toMatchObject([{ id, name: "開発" }]);
      expect(reports).toHaveBeenCalledOnce();
    }));
});
