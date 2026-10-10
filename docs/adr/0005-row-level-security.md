# ADR-0005: 事業所の分離を RLS でも強制し、アプリは RLS を bypass しない role で接続する

- **Status**: Accepted
- **Date**: 2026-10-06
- **References**: ADR-0002 (事業所ごとのデータの分離。RLS の前倒しのトリガー「最初の実顧客受入前」)、ADR-0004 (他人の個人情報を預かる)

## Context

taimei は事業所ごとのデータを `companyFilter` (ADR-0002 D4) で絞っている。条件の付け忘れは型で防げず、レビューとテストで見つけるしかない。星取表のレベルは他人の個人情報で (ADR-0004)、はじめから全事業所が使える。ADR-0002 は「最初の実顧客受入前」に RLS を defense-in-depth として入れると決めていた。

Neon の既定の role (project の作成時の owner と、console・CLI・API で作った role) は RLS を bypass する。PostgreSQL の superuser と BYPASSRLS の role は、FORCE ROW LEVEL SECURITY を付けた表でも policy を通らない。アプリが既定の role で接続する限り、policy は何も止めない。

## Decision

- `teams`・`skills`・`team_assignments`・`member_skills` で RLS を有効にし、policy `company_isolation` を `company_id = current_setting('app.company_id', true)` で USING と WITH CHECK に置く (`drizzle/0009_enable_rls.sql`)。設定の無い接続では、どの行も一致しない
- 事業所スコープの実行口 (`runScopedService`・`runManagerScopedService`) が 1 request の本体を transaction で包み、先頭で `set_config('app.company_id', <session の事業所>, true)` を流す (`db/scoped.ts` の `withCompanyScope`)。第 3 引数の true で値は transaction の中だけに効き、pool の接続に残らない。transaction を開けない時は reject せず `DbUnavailable` の失敗を返す
- `Db` を要る Service は `app/services/index.ts` の `RequestScoped` (管理者だけの操作は `ManagerScoped`) に置き、request ごとにその transaction の `Db` で作る。`Live` には `Db` を置かない (型の番兵が止める)。実行口の本体が使える Service は、`Live` とその実行口が provide する Layer から導出する
- FORCE ROW LEVEL SECURITY は付けない。table owner (migration の role) は policy を通らず、migration と、FK の CASCADE が今までどおり動く
- アプリ (Vercel の `DATABASE_URL`) は、SQL で作った BYPASSRLS の無い role `taimei_app` で接続する。migration (GitHub の secret の `DATABASE_URL`) は owner のまま
- `companyFilter` は残す。RLS は付け忘れを DB で止める二重の守りで、アプリの絞り込みを置き換えない
- policy の回帰は `db/__tests__/rls.test.ts` が、transaction の中で作った BYPASSRLS の無い role に切り替えて確かめる。test と e2e の DB は superuser で接続し、それだけでは policy を観測できない

`taimei_app` は Neon の SQL editor で owner として作る (console で作ると RLS を bypass する role になる)。

```sql
CREATE ROLE taimei_app LOGIN PASSWORD '<生成した値>';
GRANT USAGE ON SCHEMA public TO taimei_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON teams, skills, team_assignments, member_skills TO taimei_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO taimei_app;
-- taimei_app で接続して、両方 false であること
SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user;
```

## Considered Options

- **`companyFilter` だけを続ける (ADR-0002 の当初の決定)**: 付け忘れを型で防げず、他人の個人情報を預かる今は、漏れた後に気づく形になる
- **FORCE ROW LEVEL SECURITY を付けて owner でも policy を通す**: Neon の既定の role は BYPASSRLS を持つので、FORCE を付けてもアプリの接続は縛れない。owner の migration と CASCADE を policy の下に置く手間だけが増える
- **全事業所を読む処理のために管理用の接続文字列をアプリに置く**: RLS を bypass する資格情報がアプリに入り、守りの意味が薄れる。事業所をまたぐ読み取りが要る時は、owner が所有する関数で返す値を絞る

## Consequences

- 展開の順序: `withCompanyScope` のコードを先に本番へ展開し、その後に 0009 を merge する。0009 の後に `DATABASE_URL` を `taimei_app` に切り替える。切り替えるまでアプリは owner で接続し、policy は効かないが壊しもしない
- 割り当て (`TeamManagement.assign`) は transaction の中で taimei-auth への RPC (メンバー一覧) を待ち、その間も接続を 1 本持つ。待つのは RPC の timeout (10 秒) まで。DB を使わないメンバー一覧の画面は transaction を開かない (`runServiceWithoutDb`)
- 新しい表を足す時は、`company_id` と policy を同じ migration に入れる。`ALTER DEFAULT PRIVILEGES` で `taimei_app` の権限は自動で付く
- test と e2e の DB は superuser なので、アプリの分離のテスト (`team-service.test.ts`、e2e) は RLS を通らない。RLS の回帰は `rls.test.ts` だけが捕まえる
