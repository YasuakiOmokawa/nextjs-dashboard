// biome-ignore lint/style/noRestrictedImports: Sentry の SDK を使うのは Worker の入口だけ (src/lib/CLAUDE.md)
import * as Sentry from "@sentry/cloudflare";
import type { ExecutionContext } from "hono";
import { db } from "@/db/drizzle/client";
// biome-ignore lint/style/noRestrictedImports: 要求ごとの Pool を開くのは Worker の入口だけ (db/CLAUDE.md)
import { runWithRequestPool } from "@/db/drizzle/pool";
import { purgeDeparted } from "@/src/lib/purge-departed";
import { sendErrorReportsTo } from "@/src/lib/report-error";
import { app, type Env } from "./app";
import { checkMembershipsOf } from "./auth";

sendErrorReportsTo(Sentry.captureException);

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

const PARAMS_IN_DRIZZLE_ERROR_MESSAGE = /\nparams: [\s\S]*/;

const withoutQueryParams = (event: Sentry.ErrorEvent) => {
  for (const exception of event.exception?.values ?? [])
    exception.value = exception.value?.replace(
      PARAMS_IN_DRIZZLE_ERROR_MESSAGE,
      "",
    );
  return event;
};

export const sentryOptions = (env: Env): Sentry.CloudflareOptions => ({
  dsn: env.SENTRY_DSN,
  integrations: [
    Sentry.httpServerIntegration({ maxRequestBodySize: "none" }),
    Sentry.consoleIntegration({ levels: [] }),
  ],
  beforeSend: withoutQueryParams,
});

export default Sentry.withSentry(sentryOptions, handler);
