import { Result } from "@taimei-code/auth-client";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { Unauthenticated } from "@/src/spa-contract";
import { CompanyMembers } from "../company-members-service";

const members = [
  { userId: "u_1", name: "A", email: "a@example.com", role: "OWNER" as const },
];

it("SDK の一覧が取れればメンバーを返す", async () => {
  const { list } = CompanyMembers.fromListMembers(async () => ({
    ok: true,
    data: { companyId: "cmp_a", members },
  }));

  expect(await Effect.runPromise(list)).toEqual(members);
});

it("SDK が UNSPECIFIED で失敗すれば、その名前を cause に持つ MemberListError で失敗する", async () => {
  const { list } = CompanyMembers.fromListMembers(async () => ({
    ok: false,
    reason: Result.UNSPECIFIED,
  }));

  const error = await Effect.runPromise(Effect.flip(list));

  expect(error).toMatchObject({
    _tag: "MemberListError",
    cause: "UNSPECIFIED",
  });
});

it("UNSPECIFIED 以外の理由 (session が使えなくなった) では Unauthenticated で失敗する", async () => {
  const { list } = CompanyMembers.fromListMembers(async () => ({
    ok: false,
    reason: Result.SESSION_EXPIRED,
  }));

  const error = await Effect.runPromise(Effect.flip(list));

  expect(error).toEqual(new Unauthenticated());
});

it("SDK の呼び出しが reject すれば MemberListError で失敗する", async () => {
  const { list } = CompanyMembers.fromListMembers(() =>
    Promise.reject(new Error("network")),
  );

  const error = await Effect.runPromise(Effect.flip(list));

  expect(error._tag).toBe("MemberListError");
});
