import { eq, sql } from "drizzle-orm";
import { Effect, Result } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { teamAssignments, teams } from "@/db/drizzle/schema";
import { CompanyId } from "@/db/ids";
import { NotManager, TeamNotFound } from "@/src/spa-contract";
import {
  type RequestSession,
  runManagerScopedService,
  runReadService,
  runScopedService,
  runServiceWithoutDb,
} from "..";
import { AuthorizationContext } from "../authorization-context";
import { CompanyContext } from "../company-context";
import { CompanyMembers, MemberListError } from "../company-members-service";
import { CompanyTeamList } from "../company-team-list";
import { Db, DbUnavailable } from "../db-service";
import { TeamServiceError } from "../team-errors";
import { TeamReads } from "../team-reads";
import { TeamManagement, TeamService } from "../team-service";
import { seedAssignment, seedSkill, seedTeam } from "./db/seed";
import {
  currentCompanySetting,
  dbInRollback,
  functionValue,
  type TestDb,
  withRollbackDb,
} from "./db/test-db";
import {
  companyTeamListBackedBy,
  emptyTeamListStore,
  failureTag,
  type TeamListStubSpy,
  teamListStubOf,
} from "./request";

vi.mock("@/db/drizzle/client", async () => ({
  db: (await import("./db/test-db")).dbInRollback,
}));

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const companyId = CompanyId.make("cmp_from_session");
const sessionMembers = [
  { userId: "u_1", name: "山田 花子", email: "hanako@example.com" },
];
const session: RequestSession = {
  companyId,
  userId: "u_1",
  userName: "山田 花子",
  role: "ADMIN",
  companyMembers: CompanyMembers.of({ list: Effect.succeed(sessionMembers) }),
  companyTeamListOf: () => companyTeamListBackedBy()(),
};
const listCompanyMembers = () => CompanyMembers.use((members) => members.list);

const teamsNamed = (tx: TestDb, name: string) =>
  tx.select().from(teams).where(eq(teams.name, name));

const insertTeam = (name: string) =>
  Db.use((scoped) =>
    Effect.promise(() => scoped.insert(teams).values({ companyId, name })),
  );

describe("runServiceWithoutDb", () => {
  it("session の事業所を CompanyContext として本体に渡す", async () => {
    const result = await runServiceWithoutDb(session, () =>
      CompanyContext.use(({ companyId }) => Effect.succeed(companyId)),
    );

    expect(Result.getOrThrow(result)).toBe("cmp_from_session");
  });

  it("session の user id と role を AuthorizationContext として本体に渡す", async () => {
    const result = await runServiceWithoutDb(session, () =>
      AuthorizationContext.use(Effect.succeed),
    );

    expect(Result.getOrThrow(result)).toEqual({ userId: "u_1", role: "ADMIN" });
  });

  it("session の companyMembers を CompanyMembers として本体に渡す", async () => {
    const result = await runServiceWithoutDb(session, listCompanyMembers);

    expect(Result.getOrThrow(result)).toEqual(sessionMembers);
  });

  it("transaction を開かない (db を使えない状態でも成功する)", async () => {
    const result = await runServiceWithoutDb(session, () =>
      Effect.succeed("ok"),
    );
    const scoped = await runScopedService(session, () => Effect.succeed("ok"));

    expect(Result.getOrThrow(result)).toBe("ok");
    expect(Result.isFailure(scoped) && scoped.failure._tag).toBe(
      "DbUnavailable",
    );
  });

  it("本体の予期しない失敗は、その失敗を返し、報告は HTTP の境界に任せる", async () => {
    const failure = new MemberListError({ cause: 2 });

    const result = await runServiceWithoutDb(session, () =>
      Effect.fail(failure),
    );

    expect(result).toEqual(Result.fail(failure));
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("本体の defect は reject し、失敗の報告をしない", async () => {
    await expect(
      runServiceWithoutDb(session, () => Effect.die("boom")),
    ).rejects.toBe("boom");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("本体は Db と TeamService を要求できない (bun run typecheck で見る)", () => {
    const requiresDb = () =>
      // @ts-expect-error runServiceWithoutDb は Db を provide しない
      runServiceWithoutDb(session, () => Db.use(() => Effect.void));
    const requiresTeamService = () =>
      // @ts-expect-error runServiceWithoutDb は TeamService を provide しない
      runServiceWithoutDb(session, () => TeamService.use(() => Effect.void));

    expect([requiresDb, requiresTeamService]).toHaveLength(2);
  });
});

describe("runReadService", () => {
  it("transaction を開かずに、session の事業所・user・role で TeamReads を走らせる", () =>
    withRollbackDb(async (tx) => {
      await tx.insert(teams).values([
        { companyId, name: "自社のチーム" },
        { companyId: CompanyId.make("cmp_other"), name: "他社のチーム" },
      ]);
      const transaction = vi.spyOn(dbInRollback, "transaction");
      const execute = vi.spyOn(dbInRollback, "execute");

      const result = await runReadService(session, () =>
        TeamReads.use((reads) => reads.listTeams),
      );

      expect(Result.getOrThrow(result).map((team) => team.name)).toEqual([
        "自社のチーム",
      ]);
      expect(execute).toHaveBeenCalledOnce();
      expect(transaction).not.toHaveBeenCalled();
    }));

  it("本体の予期しない失敗は、その失敗を返し、報告は HTTP の境界に任せる", async () => {
    const failure = new TeamServiceError({ cause: "connection lost" });

    const result = await runReadService(session, () => Effect.fail(failure));

    expect(result).toEqual(Result.fail(failure));
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("本体は Db・TeamService・TeamManagement を要求できない (bun run typecheck で見る)", () => {
    const requiresDb = () =>
      // @ts-expect-error runReadService は transaction の Db を provide しない
      runReadService(session, () => Db.use(() => Effect.void));
    const requiresTeamService = () =>
      // @ts-expect-error 書き込みの Service は transaction の外で走らせない
      runReadService(session, () => TeamService.use(() => Effect.void));
    const requiresTeamManagement = () =>
      // @ts-expect-error 書き込みの Service は transaction の外で走らせない
      runReadService(session, () => TeamManagement.use(() => Effect.void));

    expect([
      requiresDb,
      requiresTeamService,
      requiresTeamManagement,
    ]).toHaveLength(3);
  });
});

describe("runScopedService", () => {
  it("session の companyMembers を CompanyMembers として本体に渡す", () =>
    withRollbackDb(async () => {
      const result = await runScopedService(session, listCompanyMembers);

      expect(Result.getOrThrow(result)).toEqual(sessionMembers);
    }));

  it("session の事業所を CompanyContext として本体に渡す", () =>
    withRollbackDb(async () => {
      const result = await runScopedService(session, () =>
        CompanyContext.use(({ companyId }) => Effect.succeed(companyId)),
      );

      expect(Result.getOrThrow(result)).toBe("cmp_from_session");
    }));

  it("session の user id と role を AuthorizationContext として本体に渡す", () =>
    withRollbackDb(async () => {
      const result = await runScopedService(session, () =>
        AuthorizationContext.use(Effect.succeed),
      );

      expect(Result.getOrThrow(result)).toEqual({
        userId: "u_1",
        role: "ADMIN",
      });
    }));

  it("本体の Db は、session の事業所を app.company_id に設定した transaction", () =>
    withRollbackDb(async () => {
      const result = await runScopedService(session, () =>
        Db.use((scoped) => Effect.promise(() => currentCompanySetting(scoped))),
      );

      expect(Result.getOrThrow(result)).toBe("cmp_from_session");
    }));

  it("本体の TeamService は、本体の Db と同じ transaction で読む", () =>
    withRollbackDb(async () => {
      const result = await runScopedService(session, () =>
        Db.use((scoped) =>
          Effect.promise(async () => {
            const [team] = await scoped
              .insert(teams)
              .values({ companyId, name: "未 commit のチーム" })
              .returning({ id: teams.id });
            await scoped
              .insert(teamAssignments)
              .values({ companyId, teamId: team.id, userId: session.userId });
            return team.id;
          }),
        ).pipe(
          Effect.flatMap((teamId) =>
            TeamService.use((service) => service.saveMyLevels(teamId, [])),
          ),
        ),
      );

      expect(Result.isSuccess(result)).toBe(true);
    }));

  it("本体は TeamReads と TeamManagement を要求できない (bun run typecheck で見る)", () => {
    const requiresTeamReads = () =>
      // @ts-expect-error 読み取りは transaction を開かない runReadService で走らせる
      runScopedService(session, () => TeamReads.use(() => Effect.void));
    const requiresTeamManagement = () =>
      // @ts-expect-error 管理の操作は管理者を判定する runManagerScopedService で走らせる
      runScopedService(session, () => TeamManagement.use(() => Effect.void));

    expect([requiresTeamReads, requiresTeamManagement]).toHaveLength(2);
  });

  it("本体が書いた後に失敗すると、その失敗を返し、書いた行を戻す", () =>
    withRollbackDb(async (tx) => {
      const failure = new TeamNotFound({ teamId: "t" });

      const result = await runScopedService(session, () =>
        insertTeam("失敗で戻るチーム").pipe(
          Effect.andThen(Effect.fail(failure)),
        ),
      );

      expect(result).toEqual(Result.fail(failure));
      expect(await teamsNamed(tx, "失敗で戻るチーム")).toEqual([]);
    }));

  it("本体が書いて成功すると、書いた行が残る", () =>
    withRollbackDb(async (tx) => {
      const result = await runScopedService(session, () =>
        insertTeam("成功で残るチーム"),
      );

      expect(Result.isSuccess(result)).toBe(true);
      expect(await teamsNamed(tx, "成功で残るチーム")).toHaveLength(1);
    }));

  it("transaction を開けない時は、reject せず DbUnavailable の失敗を返し、報告は HTTP の境界に任せる", () =>
    withRollbackDb(async (tx) => {
      const cause = new Error("connection refused");
      vi.spyOn(tx, "transaction").mockRejectedValue(cause);

      const result = await runScopedService(session, () =>
        Effect.succeed("unreachable"),
      );

      expect(result).toEqual(Result.fail(new DbUnavailable({ cause })));
      expect(consoleError).not.toHaveBeenCalled();
    }));

  it("本体の defect は reject し、DbUnavailable にしない", () =>
    withRollbackDb(async () => {
      const defect = new Error("bug");

      await expect(
        runScopedService(session, () => Effect.die(defect)),
      ).rejects.toBe(defect);
    }));

  it("Effect を返す前に投げた本体の例外は reject し、DbUnavailable にしない", () =>
    withRollbackDb(async () => {
      const bug = new TypeError("bug");

      await expect(
        runScopedService(session, () => {
          throw bug;
        }),
      ).rejects.toBe(bug);
    }));

  it("利用者の操作で起きる失敗は報告しない", () =>
    withRollbackDb(async () => {
      const result = await runScopedService(session, () =>
        Effect.fail(new TeamNotFound({ teamId: "t" })),
      );

      expect(Result.isFailure(result)).toBe(true);
      expect(consoleError).not.toHaveBeenCalled();
    }));

  it("本体の予期しない失敗は、その失敗を返し、報告は HTTP の境界に任せる", () =>
    withRollbackDb(async () => {
      const cause = new Error("query failed");

      const result = await runScopedService(session, () =>
        Effect.fail(new TeamServiceError({ cause })),
      );

      expect(result).toEqual(Result.fail(new TeamServiceError({ cause })));
      expect(consoleError).not.toHaveBeenCalled();
    }));
});

describe("runManagerScopedService", () => {
  it("管理者には TeamManagement を渡す", () =>
    withRollbackDb(async () => {
      const result = await runManagerScopedService(session, () =>
        TeamManagement.use(() => Effect.void),
      );

      expect(Result.isSuccess(result)).toBe(true);
    }));

  it("管理者でない人には、管理者の要求の後でも NotManager を返し、本体を実行せず、報告しない", () =>
    withRollbackDb(async () => {
      const byManager = await runManagerScopedService(session, () =>
        TeamManagement.use(() => Effect.void),
      );
      const body = vi.fn();

      const byMember = await runManagerScopedService(
        { ...session, role: "MEMBER" },
        () => Effect.sync(body),
      );

      expect(Result.isSuccess(byManager)).toBe(true);
      expect(byMember).toEqual(Result.fail(new NotManager()));
      expect(body).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    }));

  it("管理者でない人には、transaction を開く前に NotManager を返す", async () => {
    const transaction = vi.spyOn(dbInRollback, "transaction");

    const result = await runManagerScopedService(
      { ...session, role: "MEMBER" },
      () => Effect.void,
    );

    expect(result).toEqual(Result.fail(new NotManager()));
    expect(transaction).not.toHaveBeenCalled();
  });

  it("管理の本体の予期しない失敗は、その失敗を返し、報告は HTTP の境界に任せる", () =>
    withRollbackDb(async () => {
      const cause = new Error("query failed");

      const result = await runManagerScopedService(session, () =>
        TeamManagement.use(() => Effect.fail(new TeamServiceError({ cause }))),
      );

      expect(result).toEqual(Result.fail(new TeamServiceError({ cause })));
      expect(consoleError).not.toHaveBeenCalled();
    }));

  it("本体は TeamService を要求できない (bun run typecheck で見る)", () => {
    const bodyRequiringTeamService = () => TeamService.use(() => Effect.void);
    const requiresTeamService = () =>
      // @ts-expect-error 記入はメンバーも通る runScopedService で走らせる
      runManagerScopedService(session, bodyRequiringTeamService);

    expect(requiresTeamService).toBeTypeOf("function");
  });
});

describe("管理者の書き込みは、同じ transaction で版を増やし、応答の前に DO の一覧を書き直す", () => {
  const sessionWithTeamList = (role: RequestSession["role"] = "ADMIN") => {
    const teamList = teamListStubOf();
    return {
      teamList,
      session: {
        ...session,
        role,
        companyTeamListOf: companyTeamListBackedBy(teamList),
      } satisfies RequestSession,
    };
  };
  const listVersion = async (tx: TestDb) =>
    (
      (await functionValue(tx, sql`company_team_list(${companyId})`)) as {
        version: number;
      }
    ).version;
  const doCalls = (teamList: TeamListStubSpy) => [
    teamList.read.mock.calls.length,
    teamList.replace.mock.calls.length,
    teamList.clear.mock.calls.length,
  ];

  it("一覧は session の事業所の id で作る", () =>
    withRollbackDb(async () => {
      const { teamList } = sessionWithTeamList();
      const companyTeamListOf = vi.fn((_: CompanyId) =>
        companyTeamListBackedBy(teamList)(),
      );
      const withTeamListOf = { ...session, companyTeamListOf };

      await runReadService(withTeamListOf, () =>
        TeamReads.use((reads) => reads.listTeams),
      );
      await runManagerScopedService(withTeamListOf, () =>
        TeamManagement.use(() => Effect.void),
      );

      expect(new Set(companyTeamListOf.mock.calls.map(([id]) => id))).toEqual(
        new Set([session.companyId]),
      );
    }));

  it("本体が書いて成功すると、commit の後に、増やした版と書いたチームを含む一覧で 1 回書き直す", () =>
    withRollbackDb(async (tx) => {
      const { teamList, session } = sessionWithTeamList();
      const before = await listVersion(tx);
      const order: string[] = [];
      const transaction = dbInRollback.transaction;
      vi.spyOn(dbInRollback, "transaction").mockImplementation((fn) =>
        transaction(fn).finally(() => order.push("transaction")),
      );
      teamList.replace.mockImplementation(() => {
        order.push("replace");
      });

      const result = await runManagerScopedService(session, () =>
        insertTeam("書いたチーム"),
      );

      expect(Result.isSuccess(result)).toBe(true);
      expect(order).toEqual(["transaction", "replace"]);
      const [[workerVersion, snapshot]] = teamList.replace.mock.calls;
      expect(workerVersion).toBe("v1");
      expect(snapshot.version).toBe(before + 1);
      expect(snapshot.teams.map((team) => team.name)).toContain("書いたチーム");
      expect(await listVersion(tx)).toBe(before + 1);
    }));

  it("書き直し終わるまで結果を返さない", () =>
    withRollbackDb(async () => {
      const { teamList, session } = sessionWithTeamList();
      const replaceReached = Promise.withResolvers<void>();
      const replaceFinished = Promise.withResolvers<void>();
      teamList.replace.mockImplementation(() => {
        replaceReached.resolve();
        return replaceFinished.promise;
      });

      const running = runManagerScopedService(session, () =>
        insertTeam("待つチーム"),
      );
      await replaceReached.promise;
      const beforeFinish = await Promise.race([
        running.then(() => "settled"),
        new Promise((resolve) => setTimeout(() => resolve("pending"), 20)),
      ]);
      replaceFinished.resolve();

      expect(beforeFinish).toBe("pending");
      expect(Result.isSuccess(await running)).toBe(true);
    }));

  it("本体が書いた後に失敗して戻ると、DO を触らず、版も変わらない", () =>
    withRollbackDb(async (tx) => {
      const { teamList, session } = sessionWithTeamList();
      const before = await listVersion(tx);

      const result = await runManagerScopedService(session, () =>
        insertTeam("戻るチーム").pipe(
          Effect.andThen(Effect.fail(new TeamNotFound({ teamId: "t" }))),
        ),
      );

      expect(failureTag(result)).toBe("TeamNotFound");
      expect(doCalls(teamList)).toEqual([0, 0, 0]);
      expect(await listVersion(tx)).toBe(before);
    }));

  it("本体の defect で reject すると、DO を触らない", () =>
    withRollbackDb(async () => {
      const { teamList, session } = sessionWithTeamList();

      await expect(
        runManagerScopedService(session, () => Effect.die(new Error("bug"))),
      ).rejects.toThrow("bug");
      expect(doCalls(teamList)).toEqual([0, 0, 0]);
    }));

  it("transaction を開けない (commit したか分からない) 時は、DO の一覧を消す", () =>
    withRollbackDb(async (tx) => {
      const { teamList, session } = sessionWithTeamList();
      vi.spyOn(tx, "transaction").mockRejectedValue(new Error("refused"));

      const result = await runManagerScopedService(session, () => Effect.void);

      expect(failureTag(result)).toBe("DbUnavailable");
      expect(doCalls(teamList)).toEqual([0, 0, 1]);
    }));

  it("管理者でない人の管理は NotManager で、DO を触らない", async () => {
    const { teamList, session } = sessionWithTeamList("MEMBER");

    const result = await runManagerScopedService(session, () => Effect.void);

    expect(result).toEqual(Result.fail(new NotManager()));
    expect(doCalls(teamList)).toEqual([0, 0, 0]);
  });

  it("メンバーのレベルの保存 (runScopedService) は、DO を触らず、版も変わらない", () =>
    withRollbackDb(async (tx) => {
      const { teamList, session } = sessionWithTeamList("MEMBER");
      const teamId = await seedTeam(tx, companyId, "メンバーのチーム");
      const skillId = await seedSkill(tx, companyId, teamId, "設計");
      await seedAssignment(tx, companyId, teamId, session.userId);
      const before = await listVersion(tx);

      const result = await runScopedService(session, () =>
        TeamService.use((service) =>
          service.saveMyLevels(teamId, [
            { skillId, level: 2, wantsToLearn: true },
          ]),
        ),
      );

      expect(Result.isSuccess(result)).toBe(true);
      expect(doCalls(teamList)).toEqual([0, 0, 0]);
      expect(await listVersion(tx)).toBe(before);
    }));

  it("DB を使わない実行口は DO を触らず、読み取りの実行口は一覧を消さない", () =>
    withRollbackDb(async () => {
      const { teamList, session } = sessionWithTeamList();

      const withoutDb = await runServiceWithoutDb(session, () => Effect.void);
      expect(doCalls(teamList)).toEqual([0, 0, 0]);
      const read = await runReadService(session, () =>
        TeamReads.use((reads) => reads.listTeams),
      );

      expect([Result.isSuccess(withoutDb), Result.isSuccess(read)]).toEqual([
        true,
        true,
      ]);
      expect(teamList.clear).not.toHaveBeenCalled();
    }));

  it("増やした版の一覧を読めないと、本体の成功を返し、一覧を消して 1 回報告する", () =>
    withRollbackDb(async (tx) => {
      const { teamList, session } = sessionWithTeamList();
      await tx.execute(
        sql.raw(
          `CREATE OR REPLACE FUNCTION bump_company_team_list(p_company_id varchar) RETURNS json LANGUAGE sql AS $$ SELECT '{"version": "x"}'::json $$`,
        ),
      );

      const result = await runManagerScopedService(session, () =>
        insertTeam("書けたチーム"),
      );

      expect(Result.isSuccess(result)).toBe(true);
      expect(doCalls(teamList)).toEqual([0, 0, 1]);
      expect(consoleError).toHaveBeenCalledOnce();
    }));

  it("書き直しが 2 回とも失敗しても、本体の成功を返し、1 回報告する", () =>
    withRollbackDb(async () => {
      const { teamList, session } = sessionWithTeamList();
      teamList.replace.mockImplementation(() => {
        throw new Error("DO に届かない");
      });

      const result = await runManagerScopedService(session, () =>
        insertTeam("書けたチーム"),
      );

      expect(Result.isSuccess(result)).toBe(true);
      expect(teamList.replace).toHaveBeenCalledTimes(2);
      expect(consoleError).toHaveBeenCalledOnce();
    }));
});
