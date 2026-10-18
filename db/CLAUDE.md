# db

- migration の生成と調べ方は `drizzle/CLAUDE.md`。
- 事業所のデータの読み書きは `scoped.ts` の `companyFilter` で絞る (ADR-0002 D4)。付け忘れは RLS が止めるが、test_db と e2e の DB は superuser で RLS を通らないので試験では見えない。
- policy を観測するテストは、`src/services/__tests__/db/test-db.ts` の `switchToRoleWithoutRlsBypass` で BYPASSRLS の無い role に切り替える。切り替え忘れのテストは superuser のまま空振りで通る。
- SQL の中でチームが見える範囲 (管理者か、割り当てられた人) を決めるのは関数 `team_visible_to` だけにする。実行時に呼ばれない `team_list` は、`TeamReads` の絞り込みが `team_visible_to` と食い違うと落ちる試験の比べ相手なので消さない。
- id の brand (`CompanyId`・`TeamId`・`SkillId`) の値は Schema で作り、`as` は使わない。試験の事業所 id は `src/services/__tests__/db/seed.ts` の `fixtureCompanyId` で作る。
- DB のテストは `withRollback` で 1 テスト 1 transaction。一意制約の違反を見るテストは、書き込みを savepoint (`db.transaction`) に入れないと transaction ごと中断する。`set_config(..., true)` は savepoint を抜けても外側の transaction の終わりまで残る。
- 版を増やさずにチームの一覧を変えた後 (手作業の SQL) と、DB を backup から戻した後 (版が過去に戻る) は、GitHub Actions の Deploy を流し直す。流し直すまで事業所の DO に古い一覧が残る (ADR-0008)。
