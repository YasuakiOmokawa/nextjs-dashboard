import { Result } from "effect";
import type { CompanyId } from "@/db/ids";
import { withCompanyScope } from "@/db/scoped";
import type { Db } from "./db-service";
import { type DbFailure, failureOfDbError } from "./failures";

class WriteDefect {
  constructor(readonly defect: unknown) {}
}

// drizzle は callback が throw した時にしか rollback しない
class WriteFailure<E> {
  constructor(readonly failure: E) {}
}

// docs/adr/0002-company-data-scoping.md の D3 に従い、companyId は index.ts の実行口が session から導く。例外は事業所の行を読む purgeDeparted だけ
export const writeInCompanyScope = async <A, E>(
  db: Db["Service"],
  companyId: CompanyId,
  write: (tx: Db["Service"]) => Promise<Result.Result<A, E>>,
): Promise<Result.Result<A, E | DbFailure>> => {
  try {
    return await withCompanyScope(db, companyId, async (tx) => {
      const written = await Promise.try(write, tx).catch((defect: unknown) => {
        throw new WriteDefect(defect);
      });
      if (Result.isFailure(written)) throw new WriteFailure(written.failure);
      return written;
    });
  } catch (error) {
    if (error instanceof WriteDefect) throw error.defect;
    return Result.fail(
      error instanceof WriteFailure ? error.failure : failureOfDbError(error),
    );
  }
};
