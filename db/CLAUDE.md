# db

- 表の定義は `drizzle/schema.ts`、migration は root の `drizzle/` (生成の手順は `drizzle/CLAUDE.md`)。
- `drizzle/client.ts` の `db` は、Node (テスト) では `DATABASE_URL` の単一の Pool を、Worker では `drizzle/pool.ts` の `runWithRequestPool` が開く要求ごとの Pool を使う。`drizzle/pool.ts` を import できるのは Worker の入口と `client.ts` だけで、`biome.json` の `noRestrictedImports` が止める。入口は `biome-ignore` で 1 行だけ許す。要求ごとの Pool は、入口が渡す `waitUntil` の中で `runWithRequestPool` が閉じる。
- 事業所のデータの表は `company_id` と `companyIsolation(table)` の policy を持つ。`__tests__/rls.test.ts` が付け忘れを落とす (ADR-0005)。
- 読み書きは `scoped.ts` の `companyFilter` で絞る (ADR-0002 D4)。RLS が読む `app.company_id` は `withCompanyScope` が transaction の中だけに設定する。
- 画面の読み取りの関数 (`team_list`・`team_matrix`、migration `0012`) は、先頭の `set_config(..., true)` で、その関数を呼んだ SQL 文の中だけに `app.company_id` を設定し、SECURITY INVOKER で RLS を効かせる。関数の中の絞り込みは `companyFilter` を通らないので `<別名>.company_id = p_company_id` で書く。チームが見える範囲 (管理者か、割り当てられた人) は関数 `team_visible_to` だけが決め、`team_list`・`team_matrix` と `TeamService` の `saveMyLevels` が呼ぶ。`__tests__/team-functions.test.ts` が、この形の絞り込みを `TRUE` にしても RLS だけで他社が見えないことと、設定が次の文に漏れないことを見る。
- 事業所・チーム・スキルの id は `ids.ts` の brand で、列の `$type` が付ける。値は Schema で作り、`as` は使わない。`TeamId`・`SkillId` は decode で、`CompanyId` は形を検査する `make` で作る。テスト以外で `CompanyId` を作るのは、session を確かめる `src/auth.ts` の `requestSessionOf` と、DB の行を読む `purgeDeparted` だけ。作る箇所を足したら、ここに書く。
- test_db と e2e の DB は superuser で接続し、RLS を通らない。policy を観測するテストは、`src/services/__tests__/db/test-db.ts` の `switchToRoleWithoutRlsBypass` で transaction の中で BYPASSRLS の無い role に切り替える。
- DB のテストは `src/services/__tests__/db/test-db.ts` の `withRollback` で 1 テスト 1 transaction。一意制約の違反を見るテストは、書き込みを savepoint (`db.transaction`) に入れないと transaction ごと中断する。`set_config(..., true)` は savepoint を抜けても外側の transaction の終わりまで残る。
