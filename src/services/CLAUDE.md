# src/services

- Effect の中から DB と外部 API/SDK は Service 越しに触る。Service は `Db` (drizzle) を直接使い、Repository 層は作らない。
- Service は `index.ts` の実行口 (`run*`) で走らせる。実行口が session の事業所と権限を provide し、書き込みの実行口は RLS の事業所を設定した transaction を開く。
- 管理者だけの操作は `TeamManagement` に置き、method で role を見ない。
- 事業所データを読む Service は method 内で `CompanyContext` を `yield*` する (ADR-0002)。
- チームの一覧を変える書き込みは `company-team-list.ts` の `writeTeamList` を通す (ADR-0008)。
- 利用者の操作で起きる失敗は `src/spa-contract.ts` の `OperationFailure` に足し、予期しない失敗は `failures.ts` の `UnexpectedFailure` に足す。
- 割り当て・スキルがチームにあること・名前の一意は事前の query で確かめず、`team-queries.ts` の `runWrite` で書いて制約の違反を tagged error に写す。
