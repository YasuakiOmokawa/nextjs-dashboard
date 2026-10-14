import { Effect, Result } from "effect";
import { expect, it, vi } from "vitest";
import { teams } from "@/db/drizzle/schema";
import { CompanyId } from "@/db/ids";
import { runTeamManagement, runTeamReads } from "..";
import { CompanyMembers } from "../company-members-service";
import { CompanyTeamList } from "../company-team-list";
import { Db } from "../db-service";
import type { RequestSession } from "../request-session";
import type { TeamListStub } from "../team-list-store";
import { TeamReads } from "../team-reads";
import { seedTeam } from "./db/seed";
import { withRollbackDb } from "./db/test-db";
import { companyTeamListBackedBy, emptyTeamListStore } from "./request";

vi.mock("@/db/drizzle/client", async () => ({
  db: (await import("./db/test-db")).dbInRollback,
}));

const companyId = CompanyId.make("cmp_a");
const adminSessionWith = (teamList: TeamListStub): RequestSession => ({
  companyId,
  userId: "u_admin",
  userName: "管理者",
  role: "ADMIN",
  companyMembers: CompanyMembers.of({ list: Effect.succeed([]) }),
  companyTeamListOf: companyTeamListBackedBy(teamList),
});

it("外れの読み取りが DB を読んだ後に管理者の書き込みが新しい版を置くと、遅れて届いた古い版の一覧は置かない", () =>
  withRollbackDb(async (tx) => {
    await seedTeam(tx, "cmp_a", "前からあるチーム");
    const store = emptyTeamListStore();
    const readerReplaceReached = Promise.withResolvers<void>();
    const readerReplaceReleased = Promise.withResolvers<void>();
    let replaceCalls = 0;
    const session = adminSessionWith({
      read: (workerVersion) => store.read(workerVersion),
      replace: async (workerVersion, snapshot) => {
        replaceCalls += 1;
        if (replaceCalls === 1) {
          readerReplaceReached.resolve();
          await readerReplaceReleased.promise;
        }
        store.replace(workerVersion, snapshot);
      },
      clear: () => store.clear(),
    });

    const staleRead = runTeamReads(session, (reads) => reads.listTeams);
    await readerReplaceReached.promise;
    const written = await runTeamManagement(session, () =>
      Db.use((scoped) =>
        Effect.promise(() =>
          scoped.insert(teams).values({ companyId, name: "新しいチーム" }),
        ),
      ),
    );
    readerReplaceReleased.resolve();
    await staleRead;

    expect(Result.isSuccess(written)).toBe(true);
    expect(new Set(store.read("v1")?.teams.map((team) => team.name))).toEqual(
      new Set(["前からあるチーム", "新しいチーム"]),
    );
  }));
