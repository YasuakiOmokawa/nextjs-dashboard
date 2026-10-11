import { eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { teamAssignments, teams } from "@/db/drizzle/schema";
import { CompanyId } from "@/db/ids";
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
import { Db, DbUnavailable } from "../db-service";
import { NotManager, TeamNotFound, TeamServiceError } from "../team-errors";
import { TeamReads } from "../team-reads";
import { TeamManagement, TeamService } from "../team-service";
import {
  currentCompanySetting,
  dbInRollback,
  type TestDb,
  withRollbackDb,
} from "./db/test-db";

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

  it("本体の予期しない失敗は、その失敗を返し、原因を 1 回報告する", async () => {
    const failure = new MemberListError({ cause: 2 });

    const result = await runServiceWithoutDb(session, () =>
      Effect.fail(failure),
    );

    expect(result).toEqual(Result.fail(failure));
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      "listMembers failed",
      2,
    );
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

  it("本体の予期しない失敗は、その失敗を返し、1 回報告する", async () => {
    const failure = new TeamServiceError({ cause: "connection lost" });

    const result = await runReadService(session, () => Effect.fail(failure));

    expect(result).toEqual(Result.fail(failure));
    expect(consoleError).toHaveBeenCalledExactlyOnceWith("connection lost");
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

  it("transaction を開けない時は、reject せず DbUnavailable の失敗を返し、原因を 1 回報告する", () =>
    withRollbackDb(async (tx) => {
      const cause = new Error("connection refused");
      vi.spyOn(tx, "transaction").mockRejectedValue(cause);

      const result = await runScopedService(session, () =>
        Effect.succeed("unreachable"),
      );

      expect(result).toEqual(Result.fail(new DbUnavailable({ cause })));
      expect(consoleError).toHaveBeenCalledExactlyOnceWith(cause);
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

  it("本体の予期しない失敗は、その失敗を返し、原因を 1 回報告する", () =>
    withRollbackDb(async () => {
      const cause = new Error("query failed");

      const result = await runScopedService(session, () =>
        Effect.fail(new TeamServiceError({ cause })),
      );

      expect(result).toEqual(Result.fail(new TeamServiceError({ cause })));
      expect(consoleError).toHaveBeenCalledExactlyOnceWith(cause);
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

  it("管理の本体の予期しない失敗は、その失敗を返し、原因を 1 回報告する", () =>
    withRollbackDb(async () => {
      const cause = new Error("query failed");

      const result = await runManagerScopedService(session, () =>
        TeamManagement.use(() => Effect.fail(new TeamServiceError({ cause }))),
      );

      expect(result).toEqual(Result.fail(new TeamServiceError({ cause })));
      expect(consoleError).toHaveBeenCalledExactlyOnceWith(cause);
    }));

  it("本体は TeamService を要求できない (bun run typecheck で見る)", () => {
    const bodyRequiringTeamService = () => TeamService.use(() => Effect.void);
    const requiresTeamService = () =>
      // @ts-expect-error 記入はメンバーも通る runScopedService で走らせる
      runManagerScopedService(session, bodyRequiringTeamService);

    expect(requiresTeamService).toBeTypeOf("function");
  });
});
