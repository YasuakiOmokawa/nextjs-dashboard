import { and, inArray, lte, sql } from "drizzle-orm";
import { teamAssignments, teams } from "@/db/drizzle/schema";
import { CompanyId } from "@/db/ids";
import { companyFilter, withCompanyScope } from "@/db/scoped";
import { bumpTeamListInWriteTransaction } from "@/src/services/company-team-list";
import type { Db } from "@/src/services/db-service";
import { reportError } from "./report-error";

export type CheckMemberships = (request: {
  companyId: string;
  userIds: string[];
}) => Promise<{ companyActive: boolean; memberUserIds: readonly string[] }>;

export type PurgeReport = {
  deletedCompanyIds: string[];
  removedAssignments: number;
  skippedCompanyIds: string[];
};

export const purgeDeparted = async ({
  db,
  checkMemberships,
  replaceTeamList,
  startedAt,
}: {
  db: Db["Service"];
  checkMemberships: CheckMemberships;
  replaceTeamList: (companyId: CompanyId, bumped: unknown) => Promise<void>;
  startedAt: Date;
}): Promise<PurgeReport> => {
  const replaceReportingFailure = (companyId: CompanyId, bumped: unknown) =>
    replaceTeamList(companyId, bumped).catch((cause: unknown) =>
      reportError(new Error(`replaceTeamList failed: ${companyId}`, { cause })),
    );
  const report: PurgeReport = {
    deletedCompanyIds: [],
    removedAssignments: 0,
    skippedCompanyIds: [],
  };
  const { rows } = await db.execute<{ company_id: string }>(
    sql`select company_id from company_ids_with_teams() as company_id`,
  );
  // ponytail: Service Binding は 1 起動 32 回までで、チームを持つ事業所が約 31 を超えると後ろの事業所を毎回飛ばす。超えたら taimei-auth に複数の事業所を 1 回で照合する RPC を足す
  for (const companyId of rows.map((row) => CompanyId.make(row.company_id))) {
    const userIds = await withCompanyScope(db, companyId, async (tx) =>
      (
        await tx
          .selectDistinct({ userId: teamAssignments.userId })
          .from(teamAssignments)
          .where(companyFilter(teamAssignments, companyId))
      ).map((row) => row.userId),
    );
    const answer = await checkMemberships({ companyId, userIds }).catch(
      (cause: unknown) => {
        reportError(
          new Error(`checkMemberships failed: ${companyId}`, { cause }),
        );
        return undefined;
      },
    );
    if (!answer) {
      report.skippedCompanyIds.push(companyId);
      continue;
    }
    if (!answer.companyActive) {
      const list = await withCompanyScope(db, companyId, async (tx) => {
        await tx.delete(teams).where(companyFilter(teams, companyId));
        return bumpTeamListInWriteTransaction(tx, companyId);
      });
      await replaceReportingFailure(companyId, list);
      report.deletedCompanyIds.push(companyId);
      continue;
    }
    const members = new Set(answer.memberUserIds);
    const departed = userIds.filter((userId) => !members.has(userId));
    if (departed.length === 0) continue;
    const { removed, list } = await withCompanyScope(
      db,
      companyId,
      async (tx) => {
        const removed = await tx
          .delete(teamAssignments)
          .where(
            and(
              companyFilter(teamAssignments, companyId),
              inArray(teamAssignments.userId, departed),
              lte(teamAssignments.createdAt, startedAt),
            ),
          )
          .returning({ userId: teamAssignments.userId });
        return {
          removed,
          list:
            removed.length > 0
              ? await bumpTeamListInWriteTransaction(tx, companyId)
              : undefined,
        };
      },
    );
    if (removed.length > 0) await replaceReportingFailure(companyId, list);
    report.removedAssignments += removed.length;
  }
  return report;
};
