import type { ExecutionContext } from "hono";
import { db } from "@/db/drizzle/client";
// biome-ignore lint/style/noRestrictedImports: 要求ごとの Pool を開くのは Worker の入口だけ (db/CLAUDE.md)
import { runWithRequestPool } from "@/db/drizzle/pool";
import { purgeDeparted } from "@/src/lib/purge-departed";
import { app, type Env } from "./app";
import { checkMembershipsOf } from "./auth";

const inRequestPool = <T>(
  env: Env,
  ctx: ExecutionContext,
  fn: () => Promise<T>,
) =>
  runWithRequestPool(
    env.HYPERDRIVE.connectionString,
    (promise) => ctx.waitUntil(promise),
    fn,
  );

export const handler = {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
    inRequestPool(env, ctx, async () => app.fetch(request, env, ctx)),
  scheduled: async (_controller: unknown, env: Env, ctx: ExecutionContext) => {
    const report = await inRequestPool(env, ctx, () =>
      purgeDeparted({
        db,
        checkMemberships: checkMembershipsOf(env),
        startedAt: new Date(),
      }),
    );
    console.info("purge-departed", report);
  },
};

export default handler;
