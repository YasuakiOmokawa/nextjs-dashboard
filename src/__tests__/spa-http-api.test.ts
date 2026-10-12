import { Effect, Layer, Result } from "effect";
import { expect, it } from "vitest";
import { type TeamsGroup, Unauthenticated } from "@/src/spa-contract";
import {
  type DecodedHandlers,
  SpaApiLive,
  spaApiResponder,
} from "@/src/spa-http-api";

type DeleteHandler = DecodedHandlers<typeof TeamsGroup>["delete"];

it("handler の表の型は、宣言していない失敗・生の request の読み取り・書き漏らしを型エラーにする (bun run typecheck で見る)", () => {
  // @ts-expect-error teams.delete は NotDeclared を宣言していない
  const undeclaredFailure: DeleteHandler = () => Effect.fail("NotDeclared");
  // @ts-expect-error handler は decode した params・payload だけを受ける
  const readsRawRequest: DeleteHandler = ({ request }) => Effect.succeed({});
  // @ts-expect-error teams の endpoint は list だけではない
  const missingHandlers: DecodedHandlers<typeof TeamsGroup> = {
    list: () => Effect.succeed({ teams: [] }),
  };
  expect([undeclaredFailure, readsRawRequest, missingHandlers]).toHaveLength(3);
});

it("web handler は作った時には組まず、最初の要求で 1 回組み、2 回目の要求では組まない", async () => {
  let builds = 0;
  const respond = spaApiResponder(
    SpaApiLive.pipe(
      Layer.provideMerge(Layer.effectDiscard(Effect.sync(() => builds++))),
    ),
  );
  const request = () =>
    respond(
      new Request("http://app.example/api/me"),
      Result.fail(new Unauthenticated()),
    );

  const beforeRequest = builds;
  await request();
  const afterFirst = builds;
  await request();

  expect([beforeRequest, afterFirst, builds]).toEqual([0, 1, 1]);
});
