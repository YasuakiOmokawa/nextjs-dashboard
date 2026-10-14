import { count, eq, type SQL, sql } from "drizzle-orm";
import { Effect, Layer, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  COMPANY_ID_SETTING,
  memberSkills,
  skills,
  teamAssignments,
  teams,
} from "@/db/drizzle/schema";
import { CompanyId, TeamId } from "@/db/ids";
import type { Level } from "@/src/spa-contract";
import type { AuthorizationContext } from "../authorization-context";
import type { CompanyContext } from "../company-context";
import { CompanyMembers } from "../company-members-service";
import { Db } from "../db-service";
import { MemberListError } from "../failures";
import { TeamManagement } from "../team-management";
import { TeamService } from "../team-service";
import {
  seedAssignment,
  seedLevel,
  seedSkill,
  seedTeam,
  teamName,
} from "./db/seed";
import {
  switchToRoleWithoutRlsBypass,
  type TestDb,
  withRollback,
} from "./db/test-db";
import {
  type Actor,
  ADMIN,
  failureTag,
  MEMBER,
  NO_ROLE,
  runAsActor,
} from "./request";

type ManagerActor = Actor & {
  companyMemberIds?: readonly string[] | "listMembersFails";
};

const companyMembersLayer = (
  companyMemberIds: ManagerActor["companyMemberIds"] = [],
) =>
  CompanyMembers.layerTest(
    companyMemberIds === "listMembersFails"
      ? Effect.fail(new MemberListError({ cause: "rpc failed" }))
      : Effect.succeed(
          companyMemberIds.map((userId) => ({ userId, name: "", email: "" })),
        ),
  );

const runInRequest = <A, E>(
  tx: TestDb,
  actor: Actor,
  effect: Effect.Effect<A, E, Db | CompanyContext | AuthorizationContext>,
) => runAsActor(actor, effect.pipe(Effect.provideService(Db, tx)));

const runAs =
  (tx: TestDb, actor: Actor) =>
  <A, E>(
    f: (
      service: TeamService["Service"],
    ) => Effect.Effect<A, E, CompanyContext | AuthorizationContext>,
  ) =>
    runInRequest(
      tx,
      actor,
      TeamService.use(f).pipe(Effect.provide(TeamService.layer)),
    );

const manageAs =
  (tx: TestDb, actor: ManagerActor) =>
  <A, E>(
    f: (
      service: TeamManagement["Service"],
    ) => Effect.Effect<A, E, CompanyContext>,
  ) =>
    runInRequest(
      tx,
      actor,
      TeamManagement.use(f).pipe(
        Effect.provide(
          TeamManagement.layer.pipe(
            Layer.provide(companyMembersLayer(actor.companyMemberIds)),
          ),
        ),
      ),
    );

const countRows = async (
  tx: TestDb,
  table: typeof teams | typeof skills | typeof teamAssignments,
  where?: SQL,
) => {
  const [row] = await tx.select({ n: count() }).from(table).where(where);
  return row.n;
};

describe("TeamManagement", () => {
  it.each([
    ["MEMBER", MEMBER],
    ["role の無い人", NO_ROLE],
  ])("%s には組み立てられず、どの操作も実行しない", (_, actor) =>
    withRollback(async (tx) => {
      const use = vi.fn((_: TeamManagement["Service"]) => Effect.void);

      const result = await manageAs(tx, actor)(use);

      expect(failureTag(result)).toBe("NotManager");
      expect(use).not.toHaveBeenCalled();
    }),
  );
});

describe("createTeam", () => {
  it("管理者は自社のチームを作れる。名前の前後の空白は除く", () =>
    withRollback(async (tx) => {
      const result = await manageAs(tx, ADMIN)((s) => s.createTeam("  開発  "));

      const { id } = Result.getOrThrow(result);
      const rows = await tx
        .select()
        .from(teams)
        .where(eq(teams.id, TeamId.make(id)));
      expect(rows).toMatchObject([{ companyId: "cmp_a", name: "開発" }]);
    }));

  it("空白だけの名前では作れない", () =>
    withRollback(async (tx) => {
      const before = await countRows(tx, teams);

      const result = await manageAs(tx, ADMIN)((s) => s.createTeam("   "));

      expect(failureTag(result)).toBe("InvalidName");
      expect(await countRows(tx, teams)).toBe(before);
    }));

  it("同じ事業所に同じ名前のチームは作れず、他社とは同じ名前でよい", () =>
    withRollback(async (tx) => {
      await seedTeam(tx, "cmp_a", "開発");
      await seedTeam(tx, "cmp_b", "営業");
      const before = await countRows(tx, teams);
      const admin = manageAs(tx, ADMIN);

      const duplicate = await admin((s) => s.createTeam(" 開発 "));
      const otherCompanyName = await admin((s) => s.createTeam("営業"));

      expect(failureTag(duplicate)).toBe("DuplicateName");
      expect(failureTag(otherCompanyName)).toBe("success");
      expect(await countRows(tx, teams)).toBe(before + 1);
    }));
});

describe("renameTeam", () => {
  it("管理者は名前を変えられる。名前の前後の空白は除く", () =>
    withRollback(async (tx) => {
      const id = await seedTeam(tx, "cmp_a", "旧");

      await manageAs(tx, ADMIN)((s) => s.renameTeam(id, "  新  "));

      expect(await teamName(tx, id)).toBe("新");
    }));

  it("他社のチームは見つからず、名前は変わらない", () =>
    withRollback(async (tx) => {
      const id = await seedTeam(tx, "cmp_b", "他社");

      const result = await manageAs(tx, ADMIN)((s) => s.renameTeam(id, "新"));

      expect(failureTag(result)).toBe("TeamNotFound");
      expect(await teamName(tx, id)).toBe("他社");
    }));

  it("空白だけの名前には変えられない", () =>
    withRollback(async (tx) => {
      const id = await seedTeam(tx, "cmp_a", "旧");

      const result = await manageAs(tx, ADMIN)((s) => s.renameTeam(id, "   "));

      expect(failureTag(result)).toBe("InvalidName");
      expect(await teamName(tx, id)).toBe("旧");
    }));
  it("同じ事業所のほかのチームと同じ名前には変えられない", () =>
    withRollback(async (tx) => {
      await seedTeam(tx, "cmp_a", "開発");
      const id = await seedTeam(tx, "cmp_a", "旧");

      const result = await manageAs(tx, ADMIN)((s) => s.renameTeam(id, "開発"));

      expect(failureTag(result)).toBe("DuplicateName");
      expect(await teamName(tx, id)).toBe("旧");
    }));
});

describe("deleteTeam", () => {
  it("チームを消すと、そのスキルと割り当ても消え、ほかのチームは残る", () =>
    withRollback(async (tx) => {
      const id = await seedTeam(tx, "cmp_a", "消す");
      await seedSkill(tx, "cmp_a", id, "a");
      await seedSkill(tx, "cmp_a", id, "b");
      await seedAssignment(tx, "cmp_a", id, "u_1");
      await seedAssignment(tx, "cmp_a", id, "u_2");
      const kept = await seedTeam(tx, "cmp_a", "残す");
      await seedSkill(tx, "cmp_a", kept, "c");
      await seedAssignment(tx, "cmp_a", kept, "u_1");

      const result = await manageAs(tx, ADMIN)((s) => s.deleteTeam(id));

      expect(failureTag(result)).toBe("success");
      const remaining = async (teamId: TeamId) => [
        await countRows(tx, teams, eq(teams.id, teamId)),
        await countRows(tx, skills, eq(skills.teamId, teamId)),
        await countRows(
          tx,
          teamAssignments,
          eq(teamAssignments.teamId, teamId),
        ),
      ];
      expect(await remaining(id)).toEqual([0, 0, 0]);
      expect(await remaining(kept)).toEqual([1, 1, 1]);
    }));

  it("他社のチームは見つからず、残る", () =>
    withRollback(async (tx) => {
      const id = await seedTeam(tx, "cmp_b", "他社");

      const result = await manageAs(tx, ADMIN)((s) => s.deleteTeam(id));

      expect(failureTag(result)).toBe("TeamNotFound");
      expect(await teamName(tx, id)).toBe("他社");
    }));

  it("UUID でない id は DB の失敗ではなく見つからない", () =>
    withRollback(async (tx) => {
      const result = await manageAs(tx, ADMIN)((s) => s.deleteTeam("x"));

      expect(failureTag(result)).toBe("TeamNotFound");
    }));
});

describe("addSkill", () => {
  it("確かめた後に書く前にチームが消えていれば、見つからず、スキルを作らない", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");
      // 確認と書き込みの間の削除を、書き込みの直前に走る trigger で起こす
      await tx.execute(sql`
        create function delete_team_before_skill() returns trigger
        language plpgsql as $$
        begin delete from teams where id = new.team_id; return new; end $$`);
      await tx.execute(sql`
        create trigger delete_team_before_skill before insert on skills
        for each row execute function delete_team_before_skill()`);

      const result = await manageAs(
        tx,
        ADMIN,
      )((s) => s.addSkill(teamId, "設計"));

      expect(failureTag(result)).toBe("TeamNotFound");
      expect(await countRows(tx, skills)).toBe(0);
    }));

  it("管理者は自社のチームにスキルを足せる。名前の前後の空白は除く", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");

      await manageAs(tx, ADMIN)((s) => s.addSkill(teamId, "  設計  "));

      const rows = await tx
        .select()
        .from(skills)
        .where(eq(skills.teamId, teamId));
      expect(rows).toMatchObject([{ companyId: "cmp_a", name: "設計" }]);
    }));

  it.each([
    ["他社のチーム", "cmp_b", "設計", "TeamNotFound"],
    ["空白だけの名前", "cmp_a", "   ", "InvalidName"],
  ])("%s には足せない", (_, companyId, name, tag) =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, companyId, "X");
      const before = await countRows(tx, skills);

      const result = await manageAs(tx, ADMIN)((s) => s.addSkill(teamId, name));

      expect(failureTag(result)).toBe(tag);
      expect(await countRows(tx, skills)).toBe(before);
    }),
  );
  it("同じチームに同じ名前のスキルは足せず、別のチームには足せる", () =>
    withRollback(async (tx) => {
      const x = await seedTeam(tx, "cmp_a", "X");
      const y = await seedTeam(tx, "cmp_a", "Y");
      await seedSkill(tx, "cmp_a", x, "設計");
      const admin = manageAs(tx, ADMIN);

      const duplicate = await admin((s) => s.addSkill(x, "設計"));
      const otherTeam = await admin((s) => s.addSkill(y, "設計"));

      expect(failureTag(duplicate)).toBe("DuplicateName");
      expect(failureTag(otherTeam)).toBe("success");
      expect(await countRows(tx, skills)).toBe(2);
    }));
});

describe("removeSkill", () => {
  it("管理者はスキルを消せ、同じチームのほかのスキルは残る", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");
      const removed = await seedSkill(tx, "cmp_a", teamId, "a");
      const kept = await seedSkill(tx, "cmp_a", teamId, "b");

      await manageAs(tx, ADMIN)((s) => s.removeSkill(removed));

      const rows = await tx
        .select({ id: skills.id })
        .from(skills)
        .where(eq(skills.teamId, teamId));
      expect(rows).toEqual([{ id: kept }]);
    }));

  it("他社のスキルは消せない", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_b", "X");
      const skillId = await seedSkill(tx, "cmp_b", teamId, "a");

      const result = await manageAs(tx, ADMIN)((s) => s.removeSkill(skillId));

      expect(failureTag(result)).toBe("SkillNotFound");
      expect(await countRows(tx, skills)).toBe(1);
    }));

  it("UUID でない id は DB の失敗ではなく見つからない", () =>
    withRollback(async (tx) => {
      const result = await manageAs(tx, ADMIN)((s) => s.removeSkill("x"));

      expect(failureTag(result)).toBe("SkillNotFound");
    }));
});

describe("assign", () => {
  it("割り当てる人を確かめる間にチームが消えていれば、見つからず、行を作らない", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");
      const listWhileTeamIsDeleted = Effect.promise(async () => {
        await tx.delete(teams).where(eq(teams.id, teamId));
        return [{ userId: "u_2", name: "", email: "" }];
      });

      const result = await runInRequest(
        tx,
        ADMIN,
        TeamManagement.use((s) => s.assign(teamId, "u_2")).pipe(
          Effect.provide(
            TeamManagement.layer.pipe(
              Layer.provide(CompanyMembers.layerTest(listWhileTeamIsDeleted)),
            ),
          ),
        ),
      );

      expect(failureTag(result)).toBe("TeamNotFound");
      expect(await countRows(tx, teamAssignments)).toBe(0);
    }));

  it("事業所のメンバーをチームに割り当て、同じ割り当ての繰り返しは 1 行のまま", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");
      const admin = manageAs(tx, { ...ADMIN, companyMemberIds: ["u_2"] });

      await admin((s) => s.assign(teamId, "u_2"));
      const again = await admin((s) => s.assign(teamId, "u_2"));

      expect(failureTag(again)).toBe("success");
      const rows = await tx.select().from(teamAssignments);
      expect(rows).toMatchObject([
        { teamId, userId: "u_2", companyId: "cmp_a" },
      ]);
    }));

  it.each([
    [
      "事業所の一覧にいない人",
      { ...ADMIN, companyMemberIds: ["u_2"] },
      "cmp_a",
      "NotCompanyMember",
    ],
    [
      "一覧を取れない時",
      { ...ADMIN, companyMemberIds: "listMembersFails" as const },
      "cmp_a",
      "MemberListError",
    ],
    [
      "他社のチーム",
      { ...ADMIN, companyMemberIds: ["u_x"] },
      "cmp_b",
      "TeamNotFound",
    ],
  ])("%s は割り当てられない", (_, actor, companyId, tag) =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, companyId, "X");

      const result = await manageAs(tx, actor)((s) => s.assign(teamId, "u_x"));

      expect(failureTag(result)).toBe(tag);
      expect(await countRows(tx, teamAssignments)).toBe(0);
    }),
  );
});

describe("unassign", () => {
  it("管理者は割り当てを外せ、同じチームのほかの割り当ては残る", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");
      await seedAssignment(tx, "cmp_a", teamId, "u_1");
      await seedAssignment(tx, "cmp_a", teamId, "u_2");

      await manageAs(tx, ADMIN)((s) => s.unassign(teamId, "u_1"));

      const rows = await tx
        .select({ userId: teamAssignments.userId })
        .from(teamAssignments);
      expect(rows).toEqual([{ userId: "u_2" }]);
    }));

  it("割り当てていない人を外しても失敗せず、何も消えない", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");
      await seedAssignment(tx, "cmp_a", teamId, "u_1");

      const result = await manageAs(
        tx,
        ADMIN,
      )((s) => s.unassign(teamId, "u_x"));

      expect(failureTag(result)).toBe("success");
      expect(await countRows(tx, teamAssignments)).toBe(1);
    }));

  it("他社のチームの割り当ては外せない", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_b", "X");
      await seedAssignment(tx, "cmp_b", teamId, "u_1");

      const result = await manageAs(
        tx,
        ADMIN,
      )((s) => s.unassign(teamId, "u_1"));

      expect(failureTag(result)).toBe("TeamNotFound");
      expect(await countRows(tx, teamAssignments)).toBe(1);
    }));
});

describe("事業所をまたぐ参照は DB が拒否する", () => {
  const foreignKeyViolation = (insert: () => Promise<unknown>) =>
    expect(insert()).rejects.toMatchObject({ cause: { code: "23503" } });

  it("他社のチームを指すスキル", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");

      await foreignKeyViolation(() =>
        tx.transaction((sp) =>
          sp
            .insert(skills)
            .values({ companyId: CompanyId.make("cmp_b"), teamId, name: "a" }),
        ),
      );
    }));

  it("他社のチームを指す割り当て", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");

      await foreignKeyViolation(() =>
        tx.transaction((sp) =>
          sp.insert(teamAssignments).values({
            companyId: CompanyId.make("cmp_b"),
            teamId,
            userId: "u_1",
          }),
        ),
      );
    }));
});

const memberSkillRows = async (tx: TestDb) =>
  (await tx.select().from(memberSkills)).map(({ updatedAt: _, ...row }) => row);

describe("saveMyLevels", () => {
  it("割り当てられた人は自分の行にレベルと学びたいを保存できる", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");
      const skillId = await seedSkill(tx, "cmp_a", teamId, "設計");
      await seedAssignment(tx, "cmp_a", teamId, MEMBER.userId);

      const result = await runAs(
        tx,
        MEMBER,
      )((s) =>
        s.saveMyLevels(teamId, [{ skillId, level: 2, wantsToLearn: true }]),
      );

      expect(failureTag(result)).toBe("success");
      expect(await memberSkillRows(tx)).toEqual([
        {
          companyId: "cmp_a",
          teamId,
          skillId,
          userId: MEMBER.userId,
          level: 2,
          wantsToLearn: true,
        },
      ]);
    }));

  it("もう一度保存すると、同じ行を今の値で上書きする", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");
      const skillId = await seedSkill(tx, "cmp_a", teamId, "設計");
      await seedAssignment(tx, "cmp_a", teamId, MEMBER.userId);
      const save = (level: number, wantsToLearn: boolean) =>
        runAs(
          tx,
          MEMBER,
        )((s) => s.saveMyLevels(teamId, [{ skillId, level, wantsToLearn }]));
      await save(2, true);

      const result = await save(3, false);

      expect(failureTag(result)).toBe("success");
      expect(await memberSkillRows(tx)).toMatchObject([
        { level: 3, wantsToLearn: false },
      ]);
    }));

  it("管理者の保存は自分の行だけを作り、同じチームのほかの人の行は変えない", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");
      const skillId = await seedSkill(tx, "cmp_a", teamId, "設計");
      await seedAssignment(tx, "cmp_a", teamId, ADMIN.userId);
      await seedAssignment(tx, "cmp_a", teamId, MEMBER.userId);
      await runAs(
        tx,
        MEMBER,
      )((s) =>
        s.saveMyLevels(teamId, [{ skillId, level: 1, wantsToLearn: true }]),
      );

      await runAs(
        tx,
        ADMIN,
      )((s) =>
        s.saveMyLevels(teamId, [{ skillId, level: 3, wantsToLearn: false }]),
      );

      const rows = await memberSkillRows(tx);
      expect(rows).toHaveLength(2);
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ userId: ADMIN.userId, level: 3 }),
          expect.objectContaining({
            userId: MEMBER.userId,
            level: 1,
            wantsToLearn: true,
          }),
        ]),
      );
    }));

  it("割り当てられていない管理者は、見えるチームでも書けない", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");
      const skillId = await seedSkill(tx, "cmp_a", teamId, "設計");

      const result = await runAs(
        tx,
        ADMIN,
      )((s) =>
        s.saveMyLevels(teamId, [{ skillId, level: 2, wantsToLearn: false }]),
      );

      expect(failureTag(result)).toBe("NotAssigned");
      expect(await memberSkillRows(tx)).toEqual([]);
    }));

  it("割り当てられていないチームは、MEMBER には見つからない", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");
      const skillId = await seedSkill(tx, "cmp_a", teamId, "設計");

      const result = await runAs(
        tx,
        MEMBER,
      )((s) =>
        s.saveMyLevels(teamId, [{ skillId, level: 2, wantsToLearn: false }]),
      );

      expect(failureTag(result)).toBe("TeamNotFound");
      expect(await memberSkillRows(tx)).toEqual([]);
    }));

  it("role の無い人も、割り当てられていれば自分の行を書ける", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");
      const skillId = await seedSkill(tx, "cmp_a", teamId, "設計");
      await seedAssignment(tx, "cmp_a", teamId, NO_ROLE.userId);

      const result = await runAs(
        tx,
        NO_ROLE,
      )((s) =>
        s.saveMyLevels(teamId, [{ skillId, level: 1, wantsToLearn: false }]),
      );

      expect(failureTag(result)).toBe("success");
      expect(await memberSkillRows(tx)).toMatchObject([
        { userId: NO_ROLE.userId, level: 1 },
      ]);
    }));

  it("他社のチームは見つからず、他社の行は変わらない", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_b", "X");
      const skillId = await seedSkill(tx, "cmp_b", teamId, "設計");
      await seedAssignment(tx, "cmp_b", teamId, MEMBER.userId);
      await seedLevel(tx, {
        companyId: "cmp_b",
        teamId,
        skillId,
        userId: MEMBER.userId,
      });

      const result = await runAs(
        tx,
        MEMBER,
      )((s) =>
        s.saveMyLevels(teamId, [{ skillId, level: 3, wantsToLearn: true }]),
      );

      expect(failureTag(result)).toBe("TeamNotFound");
      expect(await memberSkillRows(tx)).toMatchObject([
        { companyId: "cmp_b", level: 1, wantsToLearn: false },
      ]);
    }));

  it("UUID でないチームの id は DB の失敗ではなく見つからない", () =>
    withRollback(async (tx) => {
      const result = await runAs(
        tx,
        MEMBER,
      )((s) => s.saveMyLevels("not-a-uuid", []));

      expect(failureTag(result)).toBe("TeamNotFound");
    }));

  it.each([4, -1, 1.5])(
    "0〜3 の整数でないレベル (%s) が 1 つでもあれば、どの値も保存しない",
    (outOfRange) =>
      withRollback(async (tx) => {
        const teamId = await seedTeam(tx, "cmp_a", "X");
        const valid = await seedSkill(tx, "cmp_a", teamId, "設計");
        const invalid = await seedSkill(tx, "cmp_a", teamId, "テスト");
        await seedAssignment(tx, "cmp_a", teamId, MEMBER.userId);

        const result = await runAs(
          tx,
          MEMBER,
        )((s) =>
          s.saveMyLevels(teamId, [
            { skillId: valid, level: 2, wantsToLearn: false },
            { skillId: invalid, level: outOfRange, wantsToLearn: false },
          ]),
        );

        expect(failureTag(result)).toBe("InvalidLevel");
        expect(await memberSkillRows(tx)).toEqual([]);
      }),
  );

  it("ほかのチームのスキルが 1 つでもあれば、どの値も保存しない", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");
      const otherTeamId = await seedTeam(tx, "cmp_a", "Y");
      const valid = await seedSkill(tx, "cmp_a", teamId, "設計");
      const otherTeamSkill = await seedSkill(tx, "cmp_a", otherTeamId, "設計");
      await seedAssignment(tx, "cmp_a", teamId, MEMBER.userId);

      const result = await runAs(
        tx,
        MEMBER,
      )((s) =>
        s.saveMyLevels(teamId, [
          { skillId: valid, level: 2, wantsToLearn: false },
          { skillId: otherTeamSkill, level: 2, wantsToLearn: false },
        ]),
      );

      expect(failureTag(result)).toBe("SkillNotFound");
      expect(await memberSkillRows(tx)).toEqual([]);
    }));

  it("別チームのスキルの行を持つ人がそのスキルを含めて保存しても、別チームの行は変わらない", () =>
    withRollback(async (tx) => {
      const x = await seedTeam(tx, "cmp_a", "X");
      const y = await seedTeam(tx, "cmp_a", "Y");
      const ySkill = await seedSkill(tx, "cmp_a", y, "設計");
      await seedAssignment(tx, "cmp_a", x, MEMBER.userId);
      await seedAssignment(tx, "cmp_a", y, MEMBER.userId);
      await seedLevel(tx, {
        companyId: "cmp_a",
        teamId: y,
        skillId: ySkill,
        userId: MEMBER.userId,
      });
      const before = await memberSkillRows(tx);

      const result = await runAs(
        tx,
        MEMBER,
      )((s) =>
        s.saveMyLevels(x, [{ skillId: ySkill, level: 3, wantsToLearn: true }]),
      );

      expect(failureTag(result)).toBe("SkillNotFound");
      expect(await memberSkillRows(tx)).toEqual(before);
    }));

  it("別の事業所で行を持つスキルを含める保存は form の書き換えでしか起きないので、RLS の下でも予期しない失敗ではなく見つからないにし、その行は変わらない", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");
      await seedAssignment(tx, "cmp_a", teamId, MEMBER.userId);
      const otherTeamId = await seedTeam(tx, "cmp_b", "Y");
      const otherSkill = await seedSkill(tx, "cmp_b", otherTeamId, "設計");
      await seedAssignment(tx, "cmp_b", otherTeamId, MEMBER.userId);
      await seedLevel(tx, {
        companyId: "cmp_b",
        teamId: otherTeamId,
        skillId: otherSkill,
        userId: MEMBER.userId,
      });
      const before = await memberSkillRows(tx);
      await tx.execute(
        sql`select set_config(${COMPANY_ID_SETTING}, ${MEMBER.companyId}, true)`,
      );
      await switchToRoleWithoutRlsBypass(tx);

      const result = await runAs(
        tx,
        MEMBER,
      )((s) =>
        s.saveMyLevels(teamId, [
          { skillId: otherSkill, level: 3, wantsToLearn: true },
        ]),
      );
      await tx.execute(sql`RESET ROLE`);

      expect(failureTag(result)).toBe("SkillNotFound");
      expect(await memberSkillRows(tx)).toEqual(before);
    }));

  it("member_skills に書く権限が無い role で保存すると、見つからないではなく予期しない失敗になり、行は変わらない", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");
      const skillId = await seedSkill(tx, "cmp_a", teamId, "設計");
      await seedAssignment(tx, "cmp_a", teamId, MEMBER.userId);
      const before = await memberSkillRows(tx);
      await tx.execute(
        sql`select set_config(${COMPANY_ID_SETTING}, ${MEMBER.companyId}, true)`,
      );
      const role = await switchToRoleWithoutRlsBypass(tx);
      await tx.execute(sql`RESET ROLE`);
      await tx.execute(
        sql.raw(`REVOKE INSERT, UPDATE ON member_skills FROM "${role}"`),
      );
      await tx.execute(sql.raw(`SET LOCAL ROLE "${role}"`));

      const result = await runAs(
        tx,
        MEMBER,
      )((s) =>
        s.saveMyLevels(teamId, [{ skillId, level: 2, wantsToLearn: false }]),
      );
      await tx.execute(sql`RESET ROLE`);

      expect(failureTag(result)).toBe("TeamServiceError");
      expect(await memberSkillRows(tx)).toEqual(before);
    }));

  it("UUID でないスキルの id は DB の失敗ではなく見つからない", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");
      await seedAssignment(tx, "cmp_a", teamId, MEMBER.userId);

      const result = await runAs(
        tx,
        MEMBER,
      )((s) =>
        s.saveMyLevels(teamId, [
          { skillId: "not-a-uuid", level: 2, wantsToLearn: false },
        ]),
      );

      expect(failureTag(result)).toBe("SkillNotFound");
    }));

  it.each([
    ["学びたいなし", false],
    ["学びたいあり (できないけれど学びたい)", true],
  ])("未経験 (0) も %s で保存する", (_, wantsToLearn) =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");
      const skillId = await seedSkill(tx, "cmp_a", teamId, "設計");
      await seedAssignment(tx, "cmp_a", teamId, MEMBER.userId);

      const result = await runAs(
        tx,
        MEMBER,
      )((s) => s.saveMyLevels(teamId, [{ skillId, level: 0, wantsToLearn }]));

      expect(failureTag(result)).toBe("success");
      expect(await memberSkillRows(tx)).toMatchObject([
        { level: 0, wantsToLearn },
      ]);
    }),
  );

  it("未経験 (0) の保存は、既にある行を 1 行のまま上書きする", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");
      const skillId = await seedSkill(tx, "cmp_a", teamId, "設計");
      await seedAssignment(tx, "cmp_a", teamId, MEMBER.userId);
      const save = (level: number, wantsToLearn: boolean) =>
        runAs(
          tx,
          MEMBER,
        )((s) => s.saveMyLevels(teamId, [{ skillId, level, wantsToLearn }]));
      await save(2, true);

      const result = await save(0, false);

      expect(failureTag(result)).toBe("success");
      expect(await memberSkillRows(tx)).toMatchObject([
        { level: 0, wantsToLearn: false },
      ]);
    }));

  it("空の保存は、割り当てられていれば何もせず成功し、割り当てられていなければ失敗する", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");
      await seedAssignment(tx, "cmp_a", teamId, MEMBER.userId);

      const assigned = await runAs(
        tx,
        MEMBER,
      )((s) => s.saveMyLevels(teamId, []));
      const notAssigned = await runAs(
        tx,
        ADMIN,
      )((s) => s.saveMyLevels(teamId, []));

      expect(failureTag(assigned)).toBe("success");
      expect(failureTag(notAssigned)).toBe("NotAssigned");
      expect(await memberSkillRows(tx)).toEqual([]);
    }));

  it.each([
    ["同じ表記", (id: string) => id],
    ["大文字の表記", (id: string) => id.toUpperCase()],
  ])("同じスキルが 2 回 (%s) あれば、どの値も保存しない", (_, formatSkillId) =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");
      const skillId = await seedSkill(tx, "cmp_a", teamId, "設計");
      await seedAssignment(tx, "cmp_a", teamId, MEMBER.userId);

      const result = await runAs(
        tx,
        MEMBER,
      )((s) =>
        s.saveMyLevels(teamId, [
          { skillId, level: 1, wantsToLearn: false },
          { skillId: formatSkillId(skillId), level: 3, wantsToLearn: true },
        ]),
      );

      expect(failureTag(result)).toBe("InvalidLevel");
      expect(await memberSkillRows(tx)).toEqual([]);
    }),
  );

  it("レベルとスキルの両方が不正なら、レベルの失敗を返す", () =>
    withRollback(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_a", "X");
      const otherTeamId = await seedTeam(tx, "cmp_a", "Y");
      const skillId = await seedSkill(tx, "cmp_a", teamId, "設計");
      const otherTeamSkill = await seedSkill(tx, "cmp_a", otherTeamId, "設計");
      await seedAssignment(tx, "cmp_a", teamId, MEMBER.userId);

      const result = await runAs(
        tx,
        MEMBER,
      )((s) =>
        s.saveMyLevels(teamId, [
          { skillId: "not-a-uuid", level: 2, wantsToLearn: false },
          { skillId, level: 4, wantsToLearn: false },
          { skillId: otherTeamSkill, level: 2, wantsToLearn: false },
        ]),
      );

      expect(failureTag(result)).toBe("InvalidLevel");
    }));
});

describe("評価は割り当て・スキル・チームと一緒に消える", () => {
  const seedTwoTeams = async (tx: TestDb) => {
    const x = await seedTeam(tx, "cmp_a", "X");
    const y = await seedTeam(tx, "cmp_a", "Y");
    const s1 = await seedSkill(tx, "cmp_a", x, "設計");
    const s2 = await seedSkill(tx, "cmp_a", x, "テスト");
    const ySkill = await seedSkill(tx, "cmp_a", y, "設計");
    for (const userId of ["u_m", "u_2"])
      await seedAssignment(tx, "cmp_a", x, userId);
    await seedAssignment(tx, "cmp_a", y, "u_m");
    for (const row of [
      { teamId: x, skillId: s1, userId: "u_m" },
      { teamId: x, skillId: s2, userId: "u_m" },
      { teamId: x, skillId: s1, userId: "u_2" },
      { teamId: y, skillId: ySkill, userId: "u_m" },
    ])
      await seedLevel(tx, { companyId: "cmp_a", ...row });
    return { x, y, s1, s2 };
  };

  const remaining = async (tx: TestDb) =>
    (await memberSkillRows(tx)).map(
      ({ teamId, skillId, userId }) => `${teamId}/${skillId}/${userId}`,
    );

  it("割り当てを外すと、そのチームのその人の行だけが消える", () =>
    withRollback(async (tx) => {
      const { x, y } = await seedTwoTeams(tx);

      await manageAs(tx, ADMIN)((s) => s.unassign(x, "u_m"));

      const rows = await memberSkillRows(tx);
      expect(rows.filter((r) => r.teamId === x && r.userId === "u_m")).toEqual(
        [],
      );
      expect(rows.some((r) => r.teamId === x && r.userId === "u_2")).toBe(true);
      expect(rows.some((r) => r.teamId === y && r.userId === "u_m")).toBe(true);
    }));

  it("スキルを消すと、そのスキルの行だけが消える", () =>
    withRollback(async (tx) => {
      const { s1, s2 } = await seedTwoTeams(tx);

      await manageAs(tx, ADMIN)((s) => s.removeSkill(s1));

      const rows = await remaining(tx);
      expect(rows.filter((r) => r.includes(s1))).toEqual([]);
      expect(rows.filter((r) => r.includes(s2))).toHaveLength(1);
    }));

  it("チームを消すと、そのチームの行だけが消える", () =>
    withRollback(async (tx) => {
      const { x, y } = await seedTwoTeams(tx);

      await manageAs(tx, ADMIN)((s) => s.deleteTeam(x));

      const rows = await remaining(tx);
      expect(rows.filter((r) => r.startsWith(x))).toEqual([]);
      expect(rows.filter((r) => r.startsWith(y))).toHaveLength(1);
    }));
});

describe("評価の行の整合は DB が守る", () => {
  const violation = (code: string, insert: () => Promise<unknown>) =>
    expect(insert()).rejects.toMatchObject({ cause: { code } });

  it("ほかのチームのスキルを指す行", () =>
    withRollback(async (tx) => {
      const x = await seedTeam(tx, "cmp_a", "X");
      const y = await seedTeam(tx, "cmp_a", "Y");
      const ySkill = await seedSkill(tx, "cmp_a", y, "設計");
      await seedAssignment(tx, "cmp_a", x, "u_1");

      await violation("23503", () =>
        tx.transaction((sp) =>
          seedLevel(sp, {
            companyId: "cmp_a",
            teamId: x,
            skillId: ySkill,
            userId: "u_1",
          }),
        ),
      );
    }));

  it("他社の company_id で自社のチームとスキルを指す行", () =>
    withRollback(async (tx) => {
      const x = await seedTeam(tx, "cmp_a", "X");
      const skillId = await seedSkill(tx, "cmp_a", x, "設計");
      await seedAssignment(tx, "cmp_a", x, "u_1");

      await violation("23503", () =>
        tx.transaction((sp) =>
          seedLevel(sp, {
            companyId: "cmp_b",
            teamId: x,
            skillId,
            userId: "u_1",
          }),
        ),
      );
    }));

  it("チームに割り当てられていない人の行", () =>
    withRollback(async (tx) => {
      const x = await seedTeam(tx, "cmp_a", "X");
      const skillId = await seedSkill(tx, "cmp_a", x, "設計");

      await violation("23503", () =>
        tx.transaction((sp) =>
          seedLevel(sp, {
            companyId: "cmp_a",
            teamId: x,
            skillId,
            userId: "u_1",
          }),
        ),
      );
    }));

  it("レベルが 0〜3 でない行", () =>
    withRollback(async (tx) => {
      const x = await seedTeam(tx, "cmp_a", "X");
      const skillId = await seedSkill(tx, "cmp_a", x, "設計");
      await seedAssignment(tx, "cmp_a", x, "u_1");

      await violation("23514", () =>
        tx.transaction((sp) =>
          seedLevel(sp, {
            companyId: "cmp_a",
            teamId: x,
            skillId,
            userId: "u_1",
            level: 4 as Level,
          }),
        ),
      );
    }));
});
