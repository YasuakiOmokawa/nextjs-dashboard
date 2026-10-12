import { DatabaseSync } from "node:sqlite";
import type { SqlStorage } from "../company-team-list";

// node の vitest には DO の SQLite が無いので、ctx.storage.sql と同じ形を node:sqlite の上に作る
export const sqliteStorage = (): SqlStorage => {
  const db = new DatabaseSync(":memory:");
  return {
    exec: (query, ...bindings) => {
      const rows = db.prepare(query).all(...bindings);
      return { toArray: () => rows };
    },
  };
};
