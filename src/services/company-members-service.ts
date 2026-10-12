import {
  type ListMembersResult,
  type Member,
  Result,
} from "@taimei-code/auth-client";
import { Context, Effect, Layer, Schema } from "effect";
import { Unauthenticated } from "@/src/spa-contract";

export class MemberListError extends Schema.TaggedError<MemberListError>()(
  "MemberListError",
  {
    cause: Schema.Defect(),
  },
) {}

type ListFailure = MemberListError | Unauthenticated;

// SDK は事業所の食い違いと通信の失敗を UNSPECIFIED で返す。それ以外は session が使えなくなった理由
const failureOf = (reason: Result): ListFailure =>
  reason === Result.UNSPECIFIED
    ? new MemberListError({ cause: Result[reason] })
    : new Unauthenticated();

export class CompanyMembers extends Context.Service<
  CompanyMembers,
  { readonly list: Effect.Effect<readonly Member[], ListFailure> }
>()("taimei/src/services/CompanyMembers") {
  static readonly fromListMembers = (
    listMembers: () => Promise<ListMembersResult>,
  ) =>
    CompanyMembers.of({
      list: Effect.tryPromise({
        try: listMembers,
        catch: (cause) => new MemberListError({ cause }),
      }).pipe(
        Effect.flatMap((result) =>
          result.ok
            ? Effect.succeed(result.data.members)
            : Effect.fail(failureOf(result.reason)),
        ),
        Effect.withSpan("CompanyMembers.list"),
      ),
    });

  static readonly layerTest = (
    list: Effect.Effect<readonly Member[], ListFailure>,
  ) => Layer.succeed(CompanyMembers, CompanyMembers.of({ list }));
}
