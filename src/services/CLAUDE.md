# src/services

- Effect の中から DB と外部 API/SDK は Service 越しに触る。Service は `Db` (drizzle) を直接使い、Repository 層は作らない。Service の書き方は `node_modules/effect/AGENTS.md` に従う。
- Service は `index.ts` の `runServiceWithoutDb` と `runScopedService` だけが走らせる。session は Worker の middleware (`src/app.ts`) が作り、`CompanyContext`・`AuthorizationContext`・`CompanyMembers` (session と同じ guard で taimei-auth に一覧を問い合わせる) を持つ。両方の実行口がこれらを request ごとに provide する。`runScopedService` は加えて RLS の事業所を設定した transaction (`db/scoped.ts` の `withCompanyScope`) の `Db` を provide し、本体が失敗したら transaction を戻す (理由は `docs/adr/0005-row-level-security.md`)。SQL を流さない本体は `runServiceWithoutDb` で走らせ、transaction を開かない (本体が `Db` を要求すると型エラー)。API の handler の書き方は `src/CLAUDE.md`。
- Service に失敗の型を足したら `team-errors.ts` の `TeamFailure` に入れ、`src/lib/team-failure.ts` の表に文言・状態コード・報告するかどうかを書く (書くまで型エラーになる)。
- 管理者だけの操作は `TeamManagement` に置き、method で role を見ない。管理者かどうかは `TeamManagement.layer` を組み立てる時に 1 回だけ判定し、管理者でなければ組み立てが `NotManager` で失敗する。
- 事業所データを読む Service は method 内で `CompanyContext` を `yield*` する。理由は `docs/adr/0002-company-data-scoping.md`。
- レベルを記入する人のチームへの割り当て、記入するスキルがそのチームにあること、名前の一意は、事前の query で確かめない。`team-service.ts` の `runWrite` で savepoint の中で書き、制約の違反を tagged error に写す (制約の名前は `db/drizzle/schema.ts` の定数)。レベルを 1 つも送らない保存だけは書き込みが無いので、割り当てを読んで確かめる。
