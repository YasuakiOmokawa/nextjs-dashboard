import { eq, sql } from "drizzle-orm";
import { Effect, Exit, Result } from "effect";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { teams } from "@/db/drizzle/schema";
import { CompanyId, TeamId } from "@/db/ids";
import { sendErrorReportsTo } from "@/src/lib/report-error";
import {
  CompanyTeamList,
  decodeTeamListSnapshot,
  rewriteTeamList,
  writeTeamList,
} from "../company-team-list";
import type { Db } from "../db-service";
import { DbUnavailable } from "../failures";
import {
  LIFETIME_MS,
  type TeamListSnapshot,
  TeamListStore,
} from "../team-list-store";
import {
  functionValue,
  type TestDb,
  teamListVersion,
  withRollback,
} from "./db/test-db";
import {
  captureReports,
  companyTeamListBackedBy,
  readReplaceClearCounts,
  type TeamListStubSpy,
  teamListStubOf,
} from "./request";
import { sqliteStorage } from "./sqlite-storage";

const snapshotOf = (version: number, name = "開発"): TeamListSnapshot => ({
  version,
  teams: [
    {
      id: TeamId.make("11111111-1111-4111-8111-111111111111"),
      name,
      assignedUserIds: ["u_1", "u_2"],
    },
    {
      id: TeamId.make("22222222-2222-4222-8222-222222222222"),
      name: "設計",
      assignedUserIds: [],
    },
  ],
});

const useFakeClock = () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
};

describe("TeamListStore", () => {
  it("空の storage は何も返さない", () => {
    expect(new TeamListStore(sqliteStorage()).read("w1")).toBeUndefined();
  });

  it("置いた一覧を、同じ Worker の version で同じ並びのまま読める", () => {
    const store = new TeamListStore(sqliteStorage());

    store.replace("w1", snapshotOf(5));

    expect(store.read("w1")).toEqual(snapshotOf(5));
  });

  it("置いた時と違う Worker の version では読めない", () => {
    const store = new TeamListStore(sqliteStorage());
    store.replace("w1", snapshotOf(5));

    expect(store.read("w2")).toBeUndefined();
  });

  it("置いてある版以下の版では置き換えない", () => {
    const store = new TeamListStore(sqliteStorage());
    store.replace("w1", snapshotOf(5, "新しい"));

    store.replace("w1", snapshotOf(5, "同じ版"));
    store.replace("w1", snapshotOf(4, "古い"));

    expect(store.read("w1")).toEqual(snapshotOf(5, "新しい"));
  });

  it("置いてある版より大きい版で置き換える", () => {
    const store = new TeamListStore(sqliteStorage());
    store.replace("w1", snapshotOf(5));

    store.replace("w1", snapshotOf(6, "新しい"));

    expect(store.read("w1")).toEqual(snapshotOf(6, "新しい"));
  });

  it("置いた時と違う Worker の version なら、同じ版で置き換える", () => {
    const store = new TeamListStore(sqliteStorage());
    store.replace("w1", snapshotOf(5));

    store.replace("w2", snapshotOf(5, "deploy の後"));

    expect(store.read("w2")).toEqual(snapshotOf(5, "deploy の後"));
  });

  it("置いた時と違う Worker の version でも、小さい版では置き換えない", () => {
    const store = new TeamListStore(sqliteStorage());
    store.replace("w1", snapshotOf(5, "古い Worker が置いた新しい版"));

    store.replace("w2", snapshotOf(4, "新しい Worker が読んだ古い版"));

    expect(store.read("w1")).toEqual(
      snapshotOf(5, "古い Worker が置いた新しい版"),
    );
  });

  it("置いてから 3,599,999 ms は読め、3,600,000 ms で読めない", () => {
    useFakeClock();
    const store = new TeamListStore(sqliteStorage());
    store.replace("w1", snapshotOf(5));

    vi.advanceTimersByTime(LIFETIME_MS - 1);
    expect(store.read("w1")).toEqual(snapshotOf(5));
    vi.advanceTimersByTime(1);
    expect(store.read("w1")).toBeUndefined();
  });

  it("寿命の切れた後は、版が小さくても置き換える", () => {
    useFakeClock();
    const store = new TeamListStore(sqliteStorage());
    store.replace("w1", snapshotOf(5));
    vi.advanceTimersByTime(LIFETIME_MS);

    store.replace("w1", snapshotOf(3, "寿命の後"));

    expect(store.read("w1")).toEqual(snapshotOf(3, "寿命の後"));
  });

  it("寿命の切れた後に同じ版・同じ Worker の version で置くと、一覧を書き換えずに寿命だけを延ばす", () => {
    useFakeClock();
    const store = new TeamListStore(sqliteStorage());
    store.replace("w1", snapshotOf(5, "置いた一覧"));
    vi.advanceTimersByTime(LIFETIME_MS);

    store.replace("w1", snapshotOf(5, "同じ版の別の一覧"));

    expect(store.read("w1")).toEqual(snapshotOf(5, "置いた一覧"));
  });

  it("置いてある一覧が壊れて読めない時は、表を消して何も返さず、次は同じ版でも置ける", () => {
    const sql = sqliteStorage();
    const store = new TeamListStore(sql);
    store.replace("w1", snapshotOf(5));
    sql.exec("UPDATE team_list SET assigned_user_ids = ?", "壊れた値");

    expect(store.read("w1")).toBeUndefined();
    store.replace("w1", snapshotOf(5, "置き直した一覧"));

    expect(store.read("w1")).toEqual(snapshotOf(5, "置き直した一覧"));
  });

  it("消した後は読めない", () => {
    const store = new TeamListStore(sqliteStorage());
    store.replace("w1", snapshotOf(5));

    store.clear();

    expect(store.read("w1")).toBeUndefined();
  });

  it("hibernate の後の新しい instance も、寿命の内なら置いた一覧を読める", () => {
    const sql = sqliteStorage();
    new TeamListStore(sql).replace("w1", snapshotOf(5));

    expect(new TeamListStore(sql).read("w1")).toEqual(snapshotOf(5));
  });
});

describe("CompanyTeamList", () => {
  const stub = () => ({
    read: vi.fn((): TeamListSnapshot | undefined => snapshotOf(5)),
    replace: vi.fn(),
    clear: vi.fn(),
  });

  it("DO が空なら Missing を返す", async () => {
    const empty = stub();
    empty.read.mockImplementation(() => undefined);

    const read = await Effect.runPromise(
      CompanyTeamList.fromStub(() => empty, "w1").read,
    );

    expect(read).toEqual({ _tag: "Missing" });
  });

  it("DO の読み取りが失敗すると Unreachable を返し、1 回報告する", async () => {
    const reports = captureReports();
    const failing = stub();
    failing.read.mockImplementation(() => {
      throw new Error("DO に届かない");
    });

    const read = await Effect.runPromise(
      CompanyTeamList.fromStub(() => failing, "w1").read,
    );

    expect(read).toEqual({ _tag: "Unreachable" });
    expect(reports).toHaveBeenCalledOnce();
  });

  it("DO の読み取りが 1 秒を超えても返らないと Unreachable を返し、1 回報告する", async () => {
    const reports = captureReports();
    const hanging = stub();
    hanging.read.mockImplementation(() => new Promise(() => {}) as never);

    const read = await Effect.runPromise(
      CompanyTeamList.fromStub(() => hanging, "w1").read,
    );

    expect(read).toEqual({ _tag: "Unreachable" });
    expect(reports).toHaveBeenCalledOnce();
  });

  it("置き換えが 1 回目に失敗しても、もう 1 回試して置ければ報告しない", async () => {
    const reports = captureReports();
    const flaky = stub();
    flaky.replace.mockImplementationOnce(() => {
      throw new Error("DO に届かない");
    });

    await Effect.runPromise(
      CompanyTeamList.fromStub(() => flaky, "w1").replace(snapshotOf(6)),
    );

    expect(flaky.replace).toHaveBeenCalledTimes(2);
    expect(flaky.replace).toHaveBeenLastCalledWith("w1", snapshotOf(6));
    expect(reports).not.toHaveBeenCalled();
  });

  it("置き換えが 2 回とも失敗すると、1 回報告する", async () => {
    const reports = captureReports();
    const failing = stub();
    failing.replace.mockImplementation(() => {
      throw new Error("DO に届かない");
    });

    await Effect.runPromise(
      CompanyTeamList.fromStub(() => failing, "w1").replace(snapshotOf(6)),
    );

    expect(failing.replace).toHaveBeenCalledTimes(2);
    expect(reports).toHaveBeenCalledOnce();
  });

  it("書き込みの後の書き直しが 2 回とも届かないと、DO の一覧を消す", async () => {
    captureReports();
    const failing = stub();
    failing.replace.mockImplementation(() => {
      throw new Error("DO に届かない");
    });

    await Effect.runPromise(
      rewriteTeamList(
        CompanyTeamList.fromStub(() => failing, "w1"),
        snapshotOf(6),
      ),
    );

    expect(failing.clear).toHaveBeenCalledOnce();
  });

  it("消すのが 2 回とも失敗すると、1 回報告する", async () => {
    const reports = captureReports();
    const failing = stub();
    failing.clear.mockImplementation(() => {
      throw new Error("DO に届かない");
    });

    await Effect.runPromise(
      CompanyTeamList.fromStub(() => failing, "w1").clear,
    );

    expect(failing.clear).toHaveBeenCalledTimes(2);
    expect(reports).toHaveBeenCalledOnce();
  });
});

describe("decodeTeamListSnapshot", () => {
  it("有限でない版の一覧は読まない", async () => {
    const decoded = await Effect.runPromiseExit(
      decodeTeamListSnapshot({ version: Number.POSITIVE_INFINITY, teams: [] }),
    );

    expect(Exit.isFailure(decoded)).toBe(true);
  });
});

describe("writeTeamList", () => {
  const companyId = CompanyId.make("cmp_write");
  const stubbedTeamList = () => {
    const stub = teamListStubOf();
    return { stub, teamListOf: companyTeamListBackedBy(stub) };
  };
  const teamNames = async (tx: TestDb) =>
    (
      await tx
        .select({ name: teams.name })
        .from(teams)
        .where(eq(teams.companyId, companyId))
    ).map((team) => team.name);
  const insertTeam = (name: string) => async (tx: Db["Service"]) => {
    await tx.insert(teams).values({ companyId, name });
    return Result.succeed(name);
  };

  it("本体が書いて成功すると、行が残り、版が 1 増え、commit の後に増えた版の一覧で 1 回書き直してから返す", () =>
    withRollback(async (tx) => {
      const { stub, teamListOf } = stubbedTeamList();
      const before = await teamListVersion(tx, companyId);
      const order: string[] = [];
      stub.replace.mockImplementation(async () => {
        await Promise.resolve();
        order.push("replaced");
      });

      const result = await writeTeamList(
        tx,
        companyId,
        teamListOf,
        insertTeam("書いたチーム"),
      );
      order.push("returned");

      expect(result).toEqual(Result.succeed("書いたチーム"));
      expect(order).toEqual(["replaced", "returned"]);
      const [[, snapshot]] = stub.replace.mock.calls;
      expect(snapshot.version).toBe(before + 1);
      expect(snapshot.teams.map((team) => team.name)).toEqual(["書いたチーム"]);
      expect(await teamNames(tx)).toEqual(["書いたチーム"]);
      expect(await teamListVersion(tx, companyId)).toBe(before + 1);
    }));

  it("本体が書いた後に Result の失敗を返すと、行を戻し、版を変えず、DO を触らない", () =>
    withRollback(async (tx) => {
      const { stub, teamListOf } = stubbedTeamList();
      const before = await teamListVersion(tx, companyId);

      const result = await writeTeamList(
        tx,
        companyId,
        teamListOf,
        async (scoped) => {
          await insertTeam("戻るチーム")(scoped);
          return Result.fail("rejected" as const);
        },
      );

      expect(result).toEqual(Result.fail("rejected"));
      expect(await teamNames(tx)).toEqual([]);
      expect(await teamListVersion(tx, companyId)).toBe(before);
      expect(readReplaceClearCounts(stub)).toEqual([0, 0, 0]);
    }));

  it("本体が投げると同じ値で reject し、行を戻し、DO を触らない", () =>
    withRollback(async (tx) => {
      const { stub, teamListOf } = stubbedTeamList();
      const defect = new Error("bug");

      await expect(
        writeTeamList(tx, companyId, teamListOf, async (scoped) => {
          await insertTeam("戻るチーム")(scoped);
          throw defect;
        }),
      ).rejects.toBe(defect);

      expect(await teamNames(tx)).toEqual([]);
      expect(readReplaceClearCounts(stub)).toEqual([0, 0, 0]);
    }));

  it("transaction が DB を通らずに失敗する (commit したか分からない) と、DbUnavailable を返し、DO の一覧を消す", () =>
    withRollback(async (tx) => {
      const { stub, teamListOf } = stubbedTeamList();
      const cause = new Error("connection terminated");
      vi.spyOn(tx, "transaction").mockRejectedValueOnce(cause);

      const result = await writeTeamList(
        tx,
        companyId,
        teamListOf,
        insertTeam("届かないチーム"),
      );

      expect(result).toEqual(Result.fail(new DbUnavailable({ cause })));
      expect(readReplaceClearCounts(stub)).toEqual([0, 0, 1]);
    }));

  it("版を増やす文を DB が拒むと、TeamServiceError を返し、本体の行を戻し、DO を触らない", () =>
    withRollback(async (tx) => {
      const { stub, teamListOf } = stubbedTeamList();

      const result = await writeTeamList(
        tx,
        companyId,
        teamListOf,
        async (scoped) => {
          await scoped.execute(
            sql`alter function bump_company_team_list(varchar) rename to bump_company_team_list_gone`,
          );
          return insertTeam("戻るチーム")(scoped);
        },
      );

      expect(Result.isFailure(result) && result.failure._tag).toBe(
        "TeamServiceError",
      );
      expect(await teamNames(tx)).toEqual([]);
      expect(readReplaceClearCounts(stub)).toEqual([0, 0, 0]);
    }));
});
