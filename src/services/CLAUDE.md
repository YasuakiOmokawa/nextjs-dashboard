# src/services

- Effect の中から DB と外部 API/SDK は Service 越しに触る。Service は `Db` (drizzle) を直接使い、Repository 層は作らない。Service の書き方は `node_modules/effect/AGENTS.md` に従う。
- Service は `index.ts` の実行口だけが走らせ、実行口は Service ごとに 1 つ: `TeamReads` (画面の読み取り、`team-reads.ts`) は `runTeamReads`、`TeamService` (自分のレベルの記入) は `runTeamService`、`TeamManagement` (チームの管理、`team-management.ts`) は `runTeamManagement`、Service を使わない本体は `runServiceWithoutDb`。本体は Service を引数で受け、別の Service と Durable Object (DO) に写したチームの一覧 (`CompanyTeamList`) を要求すると型エラーになる。
- どの実行口も session の `CompanyContext`・`AuthorizationContext`・`CompanyMembers` (session を確かめた時に taimei-auth の GetSession が一緒に返した一覧を読む) を provide する (session は `src/app.ts` が要求ごとに作り、型は `request-session.ts`)。`runTeamService` と `runTeamManagement` は RLS の事業所を設定した transaction (`company-scope.ts` の `writeInCompanyScope`) の `Db` を provide し、本体が失敗したら transaction を戻す (理由は `docs/adr/0005-row-level-security.md`)。`runTeamManagement` は管理者でない session を transaction を開く前に `NotManager` で返す。
- 一覧 (`listTeams`) は事業所の DO の表から読み、DO が空なら DB の関数 `company_team_list` を 1 文読んで DO に置く (関数の書き方は `db/CLAUDE.md`)。見える範囲は要求ごとに `TeamReads` が `team_visible_to` と同じ規則で絞る。星取表 (`getTeam`) は DB の関数 `team_matrix` を 1 文読む。
- 実行口は失敗を報告せずに `Result` で返し、報告は API の handler の側が 1 回だけ行う (`src/lib/CLAUDE.md`)。API の handler の書き方は `src/CLAUDE.md`。
- 一覧を変える書き込み (チームの管理と `purgeDeparted`) は `company-team-list.ts` の `writeTeamList` を通す。版を増やし、commit の後に DO の一覧を書き直し、commit したか分からなければ消す (`docs/adr/0008-company-teams-cache.md`)。
- 利用者の操作で起きる失敗は契約 (`src/spa-contract.ts`) に `httpApiStatus` を付けた class で足し、`OperationFailure` に入れて、SPA の文言の表 (`web/src/api.ts` の `failureMessages`) に書く (書くまで型エラーになる)。予期しない失敗は `failures.ts` の `UnexpectedFailure` と `defectOf` に足す。DB の失敗は `failureOfDbError` が分ける。
- 管理者だけの操作は `TeamManagement` に置き、method で role を見ない。
- 事業所データを読む Service は method 内で `CompanyContext` を `yield*` する。理由は `docs/adr/0002-company-data-scoping.md`。
- レベルを記入する人のチームへの割り当て、記入するスキルがそのチームにあること、名前の一意は、事前の query で確かめない。`team-queries.ts` の `runWrite` で savepoint の中で書き、書き込みが期待する制約の違反を、同じ file の制約名の表で tagged error に写す (制約名は `db/drizzle/schema.ts` の定数)。表に無い違反と名前の無い違反は予期しない失敗になる。制約を足したら表に足す。レベルを 1 つも送らない保存だけは書き込みが無いので、割り当てを読んで確かめる。
