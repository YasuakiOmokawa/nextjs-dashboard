import { DurableObject, env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { Effect, Layer } from "effect";
import {
  makeHandler,
  seedShape,
  type Matrix,
  TeamNotFound,
  TeamRepo,
} from "../../shared/api";
import cascadeMigrations from "../../m2/drizzle-cascade/migrations.js";
import noactionMigrations from "../../m2/drizzle-noaction/migrations.js";
import migrations from "../drizzle/migrations.js";
import * as schema from "./schema";

type Env = {
  COMPANY: DurableObjectNamespace<Company>;
  TRIAL: DurableObjectNamespace<Trial>;
  POC_SECRET: string;
};

const { teams, skills, teamAssignments, memberSkills } = schema;

export class Company extends DurableObject<Env> {
  private readonly db;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = drizzle(ctx.storage, { schema });
    ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, migrations);
    });
  }

  private queries(teamId: string) {
    return {
      team: this.db.select().from(teams).where(eq(teams.id, teamId)),
      skills: this.db
        .select({ id: skills.id, name: skills.name })
        .from(skills)
        .where(eq(skills.teamId, teamId)),
      assignments: this.db
        .select({ userId: teamAssignments.userId })
        .from(teamAssignments)
        .where(eq(teamAssignments.teamId, teamId)),
      levels: this.db
        .select({
          skillId: memberSkills.skillId,
          userId: memberSkills.userId,
          level: memberSkills.level,
          wantsToLearn: memberSkills.wantsToLearn,
        })
        .from(memberSkills)
        .where(eq(memberSkills.teamId, teamId)),
    };
  }

  getMatrix(teamId: string): Matrix | null {
    const q = this.queries(teamId);
    const team = q.team.get();
    if (!team) return null;
    return {
      team,
      skills: q.skills.all(),
      userIds: q.assignments.all().map((a) => a.userId),
      levels: q.levels.all(),
    };
  }

  // 1 表示あたりの Free 枠の rows read を数えるため、同じ SQL を cursor で流す
  rowsRead(teamId: string) {
    let total = 0;
    for (const query of Object.values(this.queries(teamId))) {
      const { sql, params } = query.toSQL();
      const cursor = this.ctx.storage.sql.exec(sql, ...params);
      cursor.toArray();
      total += cursor.rowsRead;
    }
    return total;
  }

  seed(): { teamId: string } {
    const teamId = crypto.randomUUID();
    const skillIds = Array.from({ length: seedShape.skills }, () =>
      crypto.randomUUID(),
    );
    const userIds = Array.from({ length: seedShape.people }, (_, i) => `u${i}`);
    this.ctx.storage.transactionSync(() => {
      this.db.insert(teams).values({ id: teamId, name: "開発チーム" }).run();
      this.db
        .insert(skills)
        .values(skillIds.map((id, j) => ({ id, teamId, name: `スキル${j}` })))
        .run();
      this.db
        .insert(teamAssignments)
        .values(userIds.map((userId) => ({ teamId, userId })))
        .run();
      const rows = userIds.flatMap((userId, i) =>
        skillIds.map((skillId, j) => ({
          teamId,
          skillId,
          userId,
          level: seedShape.level(i, j),
          wantsToLearn: seedShape.wantsToLearn(i, j),
        })),
      );
      // DO の SQLite は 1 文のバインド変数が 100 個まで (5 列 × 20 行)
      for (let k = 0; k < rows.length; k += 20)
        this.db.insert(memberSkills).values(rows.slice(k, k + 20)).run();
    });
    return { teamId };
  }
}

type Variant = "cascade" | "noaction";
type Mode = "plain" | "deferred" | "guard";
const trialMigrations = { cascade: cascadeMigrations, noaction: noactionMigrations };
const TABLES = ["teams", "skills", "team_assignments", "member_skills"] as const;

// M2: drizzle-kit が生成した「親の表の作り直し」を DO で流し、子の行が残るかを見る
export class Trial extends DurableObject<Env> {
  private readonly db = drizzle(this.ctx.storage);

  counts() {
    return Object.fromEntries(
      TABLES.map((t) => [
        t,
        this.ctx.storage.sql.exec(`SELECT count(*) AS n FROM ${t}`).one().n as number,
      ]),
    );
  }

  async prepare(variant: Variant) {
    const m = trialMigrations[variant];
    await migrate(this.db, {
      journal: { ...m.journal, entries: m.journal.entries.slice(0, 1) },
      migrations: m.migrations,
    });
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      sql.exec("INSERT INTO teams VALUES ('t1', '開発チーム')");
      for (let j = 0; j < seedShape.skills; j++)
        sql.exec("INSERT INTO skills VALUES (?, 't1', ?)", `s${j}`, `スキル${j}`);
      for (let i = 0; i < seedShape.people; i++) {
        sql.exec("INSERT INTO team_assignments VALUES ('t1', ?)", `u${i}`);
        for (let j = 0; j < seedShape.skills; j++)
          sql.exec(
            "INSERT INTO member_skills VALUES ('t1', ?, ?, ?)",
            `s${j}`,
            `u${i}`,
            seedShape.level(i, j),
          );
      }
    });
    return this.counts();
  }

  async upgrade(variant: Variant, mode: Mode) {
    const m = trialMigrations[variant];
    const upgraded =
      mode === "deferred"
        ? {
            ...m,
            migrations: {
              ...m.migrations,
              m0001: m.migrations.m0001
                .replace("PRAGMA foreign_keys=OFF;", "PRAGMA defer_foreign_keys = on;")
                .replace("PRAGMA foreign_keys=ON;", "SELECT 1;"),
            },
          }
        : m;
    const before = this.counts();
    const bookmark =
      mode === "guard" ? await this.ctx.storage.getCurrentBookmark() : null;
    let error: string | null = null;
    try {
      await migrate(this.db, upgraded);
    } catch (e) {
      error = String(e);
    }
    const after = this.counts();
    const lost = TABLES.filter((t) => after[t] < before[t]);
    if (bookmark && lost.length > 0) {
      await this.ctx.storage.onNextSessionRestoreBookmark(bookmark);
      this.ctx.abort("rows lost by migration; restoring");
    }
    const schemaSql = this.ctx.storage.sql
      .exec("SELECT sql FROM sqlite_master WHERE name = 'teams'")
      .one().sql as string;
    return { before, after, error, lost, teamsSchema: schemaSql };
  }
}

const company = (companyId: string) =>
  env.COMPANY.get(env.COMPANY.idFromName(companyId));

const repo = Layer.succeed(
  TeamRepo,
  TeamRepo.of({
    getMatrix: (companyId, teamId) =>
      Effect.promise(() => company(companyId).getMatrix(teamId)).pipe(
        Effect.flatMap((m) =>
          m ? Effect.succeed(m) : Effect.fail(new TeamNotFound()),
        ),
      ),
    seed: (companyId) => Effect.promise(() => company(companyId).seed()),
    countUnscoped: () => Effect.succeed({ teams: -1 }),
  }),
);

const { handler } = makeHandler(repo, () => env.POC_SECRET);

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const auth = request.headers.get("authorization");
    const isAdmin = auth === `Bearer ${env.POC_SECRET}`;
    if (isAdmin && url.pathname === "/debug/rows-read") {
      const { companyId, teamId } = Object.fromEntries(url.searchParams);
      return Response.json({ rowsRead: await company(companyId).rowsRead(teamId) });
    }
    if (isAdmin && url.pathname.startsWith("/debug/m2/")) {
      const [, , , action, variant, mode] = url.pathname.split("/");
      const stub = env.TRIAL.get(env.TRIAL.idFromName(url.searchParams.get("run") ?? "x"));
      try {
        if (action === "prepare") return Response.json(await stub.prepare(variant as Variant));
        if (action === "upgrade")
          return Response.json(await stub.upgrade(variant as Variant, mode as Mode));
        if (action === "counts") return Response.json(await stub.counts());
      } catch (e) {
        return Response.json({ thrown: String(e) }, { status: 500 });
      }
    }
    // API 層 (Effect HttpApi) の CPU を切り分けるための、Effect を通さない比較用の口
    const raw = url.pathname.match(/^\/raw\/teams\/([^/]+)\/matrix$/);
    if (raw && auth?.startsWith(`Bearer ${env.POC_SECRET}:`)) {
      const companyId = auth.slice(`Bearer ${env.POC_SECRET}:`.length);
      const m = await company(companyId).getMatrix(raw[1]);
      return m ? Response.json(m) : new Response(null, { status: 404 });
    }
    return handler(request);
  },
};
