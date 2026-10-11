import { and, inArray, lte, sql } from "drizzle-orm";
import { teamAssignments, teams } from "@/db/drizzle/schema";
import { CompanyId } from "@/db/ids";
import { companyFilter, withCompanyScope } from "@/db/scoped";
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
  startedAt,
}: {
  db: Db["Service"];
  checkMemberships: CheckMemberships;
  startedAt: Date;
}): Promise<PurgeReport> => {
  const report: PurgeReport = {
    deletedCompanyIds: [],
    removedAssignments: 0,
    skippedCompanyIds: [],
  };
  const { rows } = await db.execute<{ company_id: string }>(
    sql`select company_id from company_ids_with_teams() as company_id`,
  );
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
      await withCompanyScope(db, companyId, (tx) =>
        tx.delete(teams).where(companyFilter(teams, companyId)),
      );
      report.deletedCompanyIds.push(companyId);
      continue;
    }
    const members = new Set(answer.memberUserIds);
    const departed = userIds.filter((userId) => !members.has(userId));
    if (departed.length === 0) continue;
    const removed = await withCompanyScope(db, companyId, (tx) =>
      tx
        .delete(teamAssignments)
        .where(
          and(
            companyFilter(teamAssignments, companyId),
            inArray(teamAssignments.userId, departed),
            lte(teamAssignments.createdAt, startedAt),
          ),
        )
        .returning({ userId: teamAssignments.userId }),
    );
    report.removedAssignments += removed.length;
  }
  return report;
};
