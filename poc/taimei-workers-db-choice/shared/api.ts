import { Context, Effect, Layer, Redacted, Schema } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSecurity,
} from "effect/http-api";

export class CurrentCompany extends Context.Service<CurrentCompany, string>()(
  "poc/CurrentCompany",
) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  {},
  { httpApiStatus: 401 },
) {}

export class TeamNotFound extends Schema.TaggedError<TeamNotFound>()(
  "TeamNotFound",
  {},
  { httpApiStatus: 404 },
) {}

// taimei-auth の検証は両案で同じ時間がかかるので外し、bearer の `<secret>:<companyId>` を検証済みの事業所として扱う
export class CompanyAuth extends HttpApiMiddleware.Service<
  CompanyAuth,
  { provides: CurrentCompany; requires: never }
>()("poc/CompanyAuth", {
  security: { bearer: HttpApiSecurity.bearer },
  error: Unauthorized,
}) {}

export const Matrix = Schema.Struct({
  team: Schema.Struct({ id: Schema.String, name: Schema.String }),
  skills: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  userIds: Schema.Array(Schema.String),
  levels: Schema.Array(
    Schema.Struct({
      skillId: Schema.String,
      userId: Schema.String,
      level: Schema.Number,
      wantsToLearn: Schema.Boolean,
    }),
  ),
});
export type Matrix = typeof Matrix.Type;

const Seeded = Schema.Struct({ teamId: Schema.String });
const Visible = Schema.Struct({ teams: Schema.Number });

export class MatrixGroup extends HttpApiGroup.make("matrix")
  .add(
    HttpApiEndpoint.get("get", "/api/teams/:teamId/matrix", {
      params: { teamId: Schema.String },
      query: { nofilter: Schema.optional(Schema.String) },
      success: Matrix,
      error: TeamNotFound,
    }),
    HttpApiEndpoint.post("seed", "/api/seed", { success: Seeded }),
    HttpApiEndpoint.get("unscoped", "/api/unscoped", { success: Visible }),
  )
  .middleware(CompanyAuth) {}

export class Api extends HttpApi.make("poc").add(MatrixGroup) {}

export class TeamRepo extends Context.Service<
  TeamRepo,
  {
    readonly getMatrix: (
      companyId: string,
      teamId: string,
      withFilter: boolean,
    ) => Effect.Effect<Matrix, TeamNotFound>;
    readonly seed: (companyId: string) => Effect.Effect<{ teamId: string }>;
    readonly countUnscoped: () => Effect.Effect<{ teams: number }>;
  }
>()("poc/TeamRepo") {}

export const makeHandler = (
  repo: Layer.Layer<TeamRepo>,
  secret: () => string,
) => {
  const auth = Layer.succeed(
    CompanyAuth,
    CompanyAuth.of({
      bearer: (httpEffect, { credential }) => {
        const [given, companyId] = Redacted.value(credential).split(":");
        if (given !== secret() || !companyId)
          return Effect.fail(new Unauthorized());
        return Effect.provideService(httpEffect, CurrentCompany, companyId);
      },
    }),
  );
  const handlers = HttpApiBuilder.group(
    Api,
    "matrix",
    Effect.fn(function* (h) {
      const teams = yield* TeamRepo;
      return h.handleAll({
        get: ({ params, query }) =>
          Effect.gen(function* () {
            const companyId = yield* CurrentCompany;
            return yield* teams.getMatrix(
              companyId,
              params.teamId,
              query.nofilter !== "1",
            );
          }),
        seed: () =>
          Effect.gen(function* () {
            return yield* teams.seed(yield* CurrentCompany);
          }),
        unscoped: () => teams.countUnscoped(),
      });
    }),
  );
  return HttpRouter.toWebHandler(
    HttpApiBuilder.layer(Api).pipe(
      Layer.provide(handlers),
      Layer.provide(auth),
      Layer.provide(repo),
      Layer.provide(HttpServer.layerServices),
    ),
  );
};

export const seedShape = {
  people: 15,
  skills: 20,
  level: (i: number, j: number) => (i * 7 + j * 3) % 4,
  wantsToLearn: (i: number, j: number) => (i + j) % 5 === 0,
};
