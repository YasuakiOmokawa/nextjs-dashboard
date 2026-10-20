import { env } from "cloudflare:workers";
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Effect, Layer } from "effect";
import { Client } from "pg";
// 既存の schema と事業所スコープの実行口をそのまま使う (RLS・withCompanyScope を維持する案)。scripts/copy-repo-db.sh が写す
import * as schema from "./repo-db/drizzle/schema";
import type { CompanyId, TeamId } from "./repo-db/ids";
import { companyFilter, withCompanyScope } from "./repo-db/scoped";
import {
  makeHandler,
  type Matrix,
  seedShape,
  TeamNotFound,
  TeamRepo,
} from "../../shared/api";

type Env = { HYPERDRIVE: Hyperdrive; POC_SECRET: string };
const { teams, skills, teamAssignments, memberSkills } = schema;

// Hyperdrive は request ごとに Client を作る。query の回数は Free 枠 (1 日 10 万文) の消費を数えるため
const withDb = async <A>(
  use: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<A>,
) => {
  const client = new Client({ connectionString: (env as Env).HYPERDRIVE.connectionString });
  let statements = 0;
  const query = client.query.bind(client);
  client.query = ((...args: Parameters<typeof query>) => {
    statements++;
    return query(...args);
  }) as typeof client.query;
  await client.connect();
  try {
    const result = await use(drizzle(client, { schema }));
    return { result, statements };
  } finally {
    await client.end();
  }
};

const getMatrix = (companyId: string, teamId: string, withFilter: boolean) =>
  withDb((db) =>
    withCompanyScope(db, companyId as CompanyId, async (tx) => {
      const id = teamId as TeamId;
      const [team] = await tx
        .select({ id: teams.id, name: teams.name })
        .from(teams)
        .where(withFilter ? and(eq(teams.id, id), companyFilter(teams, companyId as CompanyId)) : eq(teams.id, id));
      if (!team) return null;
      const teamSkills = await tx
        .select({ id: skills.id, name: skills.name })
        .from(skills)
        .where(eq(skills.teamId, id));
      const assignments = await tx
        .select({ userId: teamAssignments.userId })
        .from(teamAssignments)
        .where(eq(teamAssignments.teamId, id));
      const levels = await tx
        .select({
          skillId: memberSkills.skillId,
          userId: memberSkills.userId,
          level: memberSkills.level,
          wantsToLearn: memberSkills.wantsToLearn,
        })
        .from(memberSkills)
        .where(eq(memberSkills.teamId, id));
      return {
        team,
        skills: teamSkills,
        userIds: assignments.map((a) => a.userId),
        levels,
      } satisfies Matrix;
    }),
  );

const seed = (companyId: string) =>
  withDb((db) =>
    withCompanyScope(db, companyId as CompanyId, async (tx) => {
      const cid = companyId as CompanyId;
      const [team] = await tx
        .insert(teams)
        .values({ companyId: cid, name: `開発チーム-${crypto.randomUUID().slice(0, 8)}` })
        .returning({ id: teams.id });
      const skillRows = await tx
        .insert(skills)
        .values(
          Array.from({ length: seedShape.skills }, (_, j) => ({
            companyId: cid,
            teamId: team.id,
            name: `スキル${j}`,
          })),
        )
        .returning({ id: skills.id });
      const userIds = Array.from({ length: seedShape.people }, (_, i) => `u${i}`);
      await tx
        .insert(teamAssignments)
        .values(userIds.map((userId) => ({ companyId: cid, teamId: team.id, userId })));
      await tx.insert(memberSkills).values(
        userIds.flatMap((userId, i) =>
          skillRows.map((s, j) => ({
            companyId: cid,
            teamId: team.id,
            skillId: s.id,
            userId,
            level: seedShape.level(i, j) as 0 | 1 | 2 | 3,
            wantsToLearn: seedShape.wantsToLearn(i, j),
          })),
        ),
      );
      return { teamId: team.id as string };
    }),
  );

// set_config を流さない接続で teams が見えるか。RLS と transaction ローカルの設定が pool で漏れないことの確認
const countUnscoped = () =>
  withDb(async (db) => {
    const [row] = await db.select({ n: count() }).from(teams);
    return { teams: row.n };
  });

const repo = Layer.succeed(
  TeamRepo,
  TeamRepo.of({
    getMatrix: (companyId, teamId, withFilter) =>
      Effect.promise(() => getMatrix(companyId, teamId, withFilter)).pipe(
        Effect.flatMap(({ result }) =>
          result ? Effect.succeed(result) : Effect.fail(new TeamNotFound()),
        ),
      ),
    seed: (companyId) => Effect.promise(() => seed(companyId).then((r) => r.result)),
    countUnscoped: () => Effect.promise(() => countUnscoped().then((r) => r.result)),
  }),
);

const { handler } = makeHandler(repo, () => (env as Env).POC_SECRET);

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const auth = request.headers.get("authorization");
    const prefix = `Bearer ${(env as Env).POC_SECRET}:`;
    // API 層 (Effect HttpApi) の CPU を切り分けるための、Effect を通さない比較用の口。文の数も返す
    const raw = url.pathname.match(/^\/raw\/teams\/([^/]+)\/matrix$/);
    if (raw && auth?.startsWith(prefix)) {
      const { result, statements } = await getMatrix(auth.slice(prefix.length), raw[1], true);
      return result
        ? Response.json(result, { headers: { "x-statements": String(statements) } })
        : new Response(null, { status: 404 });
    }
    // CPU が接続の確立 (1 request に 1 回) によるものかを切り分ける口: 接続して select 1 を 1 回流すだけ
    if (url.pathname === "/raw/ping" && auth?.startsWith(prefix)) {
      const { statements } = await withDb((db) => db.execute("select 1"));
      return Response.json({ statements });
    }
    return handler(request);
  },
};
