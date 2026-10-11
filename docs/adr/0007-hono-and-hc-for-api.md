# ADR-0007: API は Hono + Effect で書き、SPA は hc で型をつないで呼ぶ。API の schema の宣言は持たない

- **Status**: Accepted
- **Date**: 2026-10-10
- **References**: ADR-0002 (事業所のデータに session 無しで触れない)、ADR-0006 (Static Assets の SPA と Worker)

## Context

ADR-0006 で画面を SPA、API を Worker にした。API 層には 2 つの候補があった。

- Effect の `HttpApi`: endpoint ごとに path・params・payload・成功・失敗を schema で宣言する。handler には decode 済みの値だけが来て、成功は schema で encode される。SPA は同じ定義から作る `HttpApiClient` で呼ぶ
- Hono + Effect: route のコードから型が推論され、SPA は Hono の `hc` で呼ぶ。schema は validator や応答の encode に、必要な所だけ差し込む

検証の Worker で比べた (DB を除き、15 人 × 20 スキルの星取表を返す):

- SPA の API クライアント (minify + gzip): `hc` は 2,059 B。`HttpApiClient` は effect ごと入り 116,874 B
- Worker の bundle (gzip): Hono + Effect 162 KiB、`HttpApi` 211 KiB
- CPU: 応答を schema で encode しても warm p95 は 6 → 4 ms。cold は 12 / 9 / 4 ms 対 2 / 2 / 6 ms。差は小さい
- effect 4.0.0 では `HttpApi`・`HttpApiClient` が `@stability unstable`。Hono v4 は安定版。taimei-auth は Hono + Effect を使う

`HttpApi` は書き忘れを構造で止められる。一方で構造の保証にも穴がある。`HttpApi.middleware()` は呼んだ時点で追加済みの group にしか掛からず、後から足した group は認証なしになる。

API を呼ぶのは同じ repo で同時に build して配る SPA だけで、型が食い違わない。書き手は少なく、入力を取る endpoint も少ない。

## Decision

- API は Hono + Effect の Worker で書き、SPA は `hc` で呼ぶ (`web/src/api.ts`)。`HttpApi` は使わない
- API の schema の宣言 (OpenAPI のような契約) は持たない
- 入力の検証は Service が Effect Schema で decode する (`TeamId`・名前・レベル)。JSON の body や query を取る route には validator を付け、handler で生の値を読まない
- 応答は `src/run-json.ts` の `resultJson`・`encodedJson` だけが返し、route ごとの schema で encode する。schema は契約ではなく許可リストで、書いていない項目は送らない。SPA では応答の JSON がそのまま見え、`c.json` は渡した値をそのまま送るので、画面に出さない他人の個人情報を返さないために置く
- 失敗の tag ごとの状態コードは `src/lib/team-failure.ts` の表が持ち、`Match.valueTags` で網羅する
- 認証の middleware (公開の `/auth*` より後の全 path) が返す 401 は `hc` の型に入らない。SPA が API を呼ぶ共通の `fetch` (`web/src/api.ts`) が受けてログインへ移す

## Consequences

- SPA の bundle に effect が入らない。API 層は安定版の Hono に乗り、taimei-auth と同じ構成で運用できる
- `HttpApi` なら構造で止まった入力の検証と応答の項目の書き忘れが、lint (`biome-plugins/` の規則、#580) で止める形に下がる。lint は書き方の形だけを見るので穴がある。規則と、規則に当たらない書き方は `src/CLAUDE.md`
- 型のまま保てるもの: path と method、成功の本文の型、宣言していない失敗を返さないこと、事業所のデータに session 無しで触れないこと (Service が `CompanyContext` を要求し、provide できるのは `src/services/index.ts` の実行口だけ。実行口の一覧は `src/services/CLAUDE.md`。ADR-0002)
- どちらの方式でも型の外に残るもの: 認証の掛け忘れ (全 route を cookie 無しで叩くと 401 になるテストで止める) と、アプリの外の失敗 (Workers の打ち切り、network、本体の defect)
- 認証の middleware は、session を見ない公開の route (`/auth*`) の後に全 path へ掛けるので、後から足した route にも掛かる。middleware より前に登録した route には掛からない (#580)
- 次のどれかが起きたら、`HttpApi` か schema-first の契約を採り直す。決め手は規模 (行数) ではなく、呼び手の数と規則を守らせる相手の多さ
  1. API の呼び手が SPA 以外に増える (スマホのアプリ、提携先、他言語の client)。呼び手ごとに古い版が残り、API の形の変化が呼び手ごとの不具合になる
  2. 呼び手が既に Effect を使う (server 間、CLI、バッチ)。bundle の大きさが問題にならず、失敗が Effect の型付きの失敗として届く
  3. 書き手が増え、validator や `encodedJson` を通す規則を lint や慣習で揃えにくくなる
  4. 画面と API を別の人が並行に作り、契約を実装より先に決めたい
  5. 入力の種類 (payload・query・header・multipart) が多く、endpoint ごとの細かい検証を構造で防ぎたい
