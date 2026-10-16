import { eq, sql } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgColumn, PgDatabase } from "drizzle-orm/pg-core";
import type { CompanyId } from "./company-id";
import type * as schema from "./drizzle/schema";
import { COMPANY_ID_SETTING } from "./drizzle/schema";

// company_id を持つテーブルの scoping 条件の唯一の入口 (SSOT)。
// 設計詳細: docs/adr/0002-company-data-scoping.md (D4)。
//
// 生の eq(table.companyId, ...) を Service に直書きせず必ずこの helper を通す。
// これにより「scoped テーブルへの companyFilter 無しアクセス」を grep / review / lint で
// 機械的に探せる (CompanyContext 方式は WHERE 付け忘れが型で防げない fail-open のため)。
type ScopedTable = { companyId: PgColumn };

export const companyFilter = <T extends ScopedTable>(
  table: T,
  companyId: CompanyId,
) => eq(table.companyId, companyId);

type ScopedDb = PgDatabase<NodePgQueryResultHKT, typeof schema>;

export const withCompanyScope = <T>(
  db: ScopedDb,
  companyId: CompanyId,
  fn: (tx: ScopedDb) => Promise<T>,
) =>
  db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config(${COMPANY_ID_SETTING}, ${companyId}, true)`,
    );
    return fn(tx);
  });
