# ADR-0007: SPA が呼ぶ API は Effect HttpApi の契約で書いて Hono の中に載せ、画面のデータ取得は Effect Atom にする

- **Status**: Accepted (2026-10-10)。2026-10-12 に改訂した (#602)。#603〜#605 で移した。データ取得を Atom にする部分は #604 の prototype の結果で、#605 で確定した (2026-10-13)
- **Date**: 2026-10-10 (改訂 2026-10-12)
- **References**: ADR-0002 (事業所のデータに session 無しで触れない)、ADR-0006 (Static Assets の SPA と Worker)、taimei-auth の ADR-0017 (`vendor/taimei-auth/docs/adr/0017-effect-v4-full-adoption.md` の「web への拡大」「SPA の API 契約」)

## Context

2026-10-10 の判断 (「改訂前の判断」節) は、API を Hono + Effect で書き、SPA を `hc` で呼ぶ形にした。決め手は、SPA の bundle の大きさ、`HttpApi` が `@stability unstable` なこと、CPU、taimei-auth と同じ構成で運用できることだった。その節の「見直す条件」の 1〜5 はどれも起きていない。変わったのは次の 2 つの前提である。

- taimei-auth が、SPA の API を Effect HttpApi の契約 (Hono の中に載せる) に、画面のデータ取得を Effect Atom に、router を TanStack Router に移した (taimei-auth の ADR-0017、taimei-code/taimei-auth#265・#266・#267・#269)。「taimei-auth と揃えられるものは揃える」に従うと、Hono + `hc` ではなく契約と Atom を選ぶことになる
- 技術選定の基準 (誰が書いても間違えようがないか。構造・型 > lint > テスト) で比べ直すと、契約のほうが書けなくなる間違いが多い。taimei-auth は同じ基準で 6 案を比べ、Hono の中の HttpApi の契約 + `AtomHttpApi` を 1 位、Hono + hono/client を 5 位にした

taimei で今書ける間違いと、移した後に何が止めるか:

| 間違い | 今 (Hono + `hc` + TanStack Query) | HttpApi の契約 + Atom | HttpApi の契約 + TanStack Query |
| :-- | :-- | :-- | :-- |
| その endpoint が出さない失敗を返す・SPA が起きない失敗を扱う | 止まらない (どの route も `TeamFailure` 全体を返せ、SPA は `failureMessageOf` が型なしで `message` を読む) | 型 | 型 |
| 入力を validator を通さずに読む | lint (`biome-plugins/no-raw-request-input.grit`) | 構造 (handler が `HttpServerRequest` を直接読む抜け道は、`effect/http` の import の禁止で止める。#612) | 構造 (同左) |
| 応答を schema を通さずに返す | lint (`biome-plugins/no-direct-json.grit`) | 構造 (handler が `HttpServerResponse` を返すと encode されない抜け道は、`effect/http` の import の禁止で止める。#612) | 構造 (同左) |
| 認証の 401 | `hc` の型の外 (`web/src/api.ts` の共通の fetch で受ける) | 型 | 型 |
| query の key に入力を入れ忘れる | 慣習 | 構造 (key は引数そのもの) | 慣習 (`queryKey` と `queryFn` を別に書く) |

順位: 1 位 HttpApi の契約 + Atom (5 つを型か構造で止める。2・3 行目の抜け道は lint で止める)。2 位 HttpApi の契約 + TanStack Query (5 行目だけが慣習)。3 位 今の形。1 位と 2 位の差は 5 行目と、taimei-auth と書き方が揃うことだけである。2 位は #603 の形である。

改訂前の節の「型のまま保てるもの」にある「宣言していない失敗を返さないこと」は、`TeamFailure` の外の失敗を返さないことを指す。endpoint ごとに出す失敗を絞ることは、上の表の 1 行目のとおり今は止まらない。

## Decision

- SPA が呼ぶ `/api/*` の全 endpoint は Effect HttpApi の契約で宣言し、Hono の中に載せる。契約は endpoint ごとに path・params・payload・成功・失敗を宣言し、server の handler の型と SPA の client の型を同じ契約から作る
- SPA は契約と失敗の schema を値として import する。契約と失敗の schema は server の module (`db/`・`report-error` など) を import しない module に置き (#603 の決定: `src/spa-contract.ts`。Service が失敗の class と、要求と応答の本文の schema を契約から import する)、`.fallowrc.json` の `boundaries` をその module に開く。server のコードと秘密が SPA に入らないこと (`web/src/__tests__/spa-bundle.test.ts`) は保つ (#603)
- path と method は今のままにする。`web/index.html` が JS を待たずに始める fetch は `/api/<page>` の対応に頼る
- Hono は残し、契約の外側で CSRF、`/auth` の route、`app.onError` の報告、`run_worker_first` で Worker に来た要求の振り分けを受け持つ。契約の handler の予期しない失敗 (defect) は HttpApi が応答にして `app.onError` に届かないので、HttpApi の側からも同じ `reportError` に送る (taimei-auth の `ErrorReporter` と同じ形、#603)。#603 の決定: 予期しない失敗 (DB・taimei-auth の一覧の失敗) も handler で defect にして本文の無い 500 にし、報告は `ErrorReporter` の 1 か所にする。`src/services/index.ts` の実行口は報告しない。予期しない失敗の class は `cause` を schema の項目に持つので、契約の失敗として宣言すると原因を応答に載せてしまう
- 今の `requireSession` の役目 (session の検証、`x-taimei-session` の付与、要求の `x-taimei-session` が今の session と違う時の 409 `SessionChanged`、session を handler に渡すこと) を契約の middleware と Hono にどう分けるかは #603 で決める。session の検証は 1 要求に 1 回にし、409 は契約の失敗として宣言する。#603 の決定: Hono の route が session を確かめて `x-taimei-session` を応答に付け、結果 (session か `Unauthenticated`・`SessionChanged`) を要求ごとの `Context.Reference` で web handler に渡し、契約の middleware がそれを失敗か `CurrentSession` にする。`Context.Reference` で渡すのは、middleware が要求できる service を layer を組む時にしか満たせないからである
- 認証は契約の middleware で行い、401 を client の型に入れる。#603 の決定: `SpaApi` の全 group を `.add` した後に API 全体へ 1 回掛ける
- 画面のデータ取得は Effect Atom (契約の client の query と mutation) にする。router は TanStack Router のまま
- 移す順序:
  1. #603: API を契約に移し、SPA は契約の client で呼ぶ。データ取得は TanStack Query のまま、`queryFn` の中で契約の client を呼ぶ
  2. #604: TanStack Router + Atom の prototype で、#588 の振る舞いを保てるかを確かめる
  3. #605: 画面のデータ取得を Atom に移し、`@tanstack/react-query` を外す
- #604 の prototype で確かめること (#588 で TanStack Router と TanStack Query の上に作った振る舞い):
  1. route の loader で取得を始め、描画の前に待てる
  2. link に hover した時点で先読みし、click で取り直さない
  3. 2 回目以降の表示は cache を先に出し、裏で取り直す
  4. 作成・削除で invalidate した一覧は、取り直しを待って出す (前の一覧を一瞬も出さない)
  5. `web/index.html` が JS を待たずに始めた fetch の応答を、最初の取得に使う
  6. 応答の `x-taimei-session` が変わったら再読み込みする
  7. cache はメモリだけで、ブラウザに永続しない
- 7 点のほかに、レベルの記入の楽観的更新 (`web/src/api.ts` の `writeSavedMyLevels` が取り直さずに cache を書き換え、`web/src/dashboard/team-page.tsx` が保存中の値を表に出す) と、失敗の種類で分ける表示 (`team-page.tsx` の 404) の Atom での書き方も、prototype で確かめる。保つことは #605 の受け入れ条件が求める
- このうち taimei-code/taimei-auth#269 で確かめたのは、loader と `beforeLoad` で atom を読むこと、atom の寿命 (購読が 0 になると registry から外れる) で、2〜7 は確かめていない (taimei-auth は先読みも、`web/index.html` の JS を待たない fetch も使わない)
- #604 で保てない振る舞いがあれば、データ取得は TanStack Query のまま (#603 の形) にし、この ADR の Atom の部分を改める。API の契約の判断はそのまま残す
- #604 の結果: 7 点と追加の 2 点は保てた (既存の e2e が spec を変えずに通った)。#605 で確定した。書き方は `web/src/CLAUDE.md`
  - registry は `createAppRouter` が作る。`main.tsx` が描画の前に `router.load()` を呼ぶため
  - 古くした印 (`markStale`) は loader (`loadAtom`) だけが読む値として registry の外に持ち、回数で比べる。atom の結果からは「古くしたので取り直している」と「裏の取り直し」を区別できず (Query の `isInvalidated` にあたる区別)、印の前に始まった取得の値を新しい値として受けてしまうため
  - 画面の atom は購読が無くなっても 5 分残す。Query の既定の `gcTime` と同じ
  - チームの atom (`teamAtom`) は保存した自分のレベルを書ける writable にする。`Atom.optimistic` は成功の後に取り直すため
  - 更新は、送る処理と、何を変えたかの宣言 (`changed`。`ChangedByMutation` の variant) を持つ定義 (`ApiMutation`) で書き、`changed` を型で省けなくする。取り直す key の付け忘れを型で止めるため。更新の atom は呼び出しごとに作る。`AtomHttpApi.mutation` の atom は endpoint ごとに 1 つで、同じ atom への次の呼び出しが前の呼び出しを中断するため。契約に無い応答と decode の失敗は、query と同じく defect にする
  - 失敗の文言 (`failureMessageOf`) は契約に宣言した失敗の型から選び、読み取りの失敗も router の `error` (`unknown`) ではなく atom から読む (`useLoadFailure`)。Context の表の 1 行目のため

## 引き換えと埋め方

| 引き換え | 大きさ | 埋め方 |
| :-- | :-- | :-- |
| SPA の bundle が大きくなる | taimei-auth では、Atom と契約の client で web の JS の gzip が main 比 +64.6 kB。改訂前の判断の検証の Worker では `HttpApiClient` が effect ごと 116,874 B。taimei の #605 は 180,164 → 182,912 B (+2,748 B、`@tanstack/react-query` を外した分と Atom を足した分がほぼ打ち消し合う) | #603・#605 で変更の前後の SPA の JS (gzip) を記録した。#605 で `@tanstack/react-query` を外した。画面の最初の API は `web/index.html` が JS を待たずに呼ぶので、JS が大きくなっても API の応答を待ち始める時刻は遅れない |
| `HttpApi`・`AtomHttpApi`・`effect/reactivity` が `@stability unstable` | effect の minor の更新で API が変わりうる | `effect` を `package.json` の exact pin のまま、Dependabot の更新の PR で上げる。壊れた箇所は typecheck とテストで一覧になる。taimei-auth と同じ扱い |
| `HttpApi.middleware()` は呼んだ時点で追加済みの group にしか掛からず、後から足した group は認証なしになる | 認証の掛け忘れ | `HttpApi.reflect` で契約の全 endpoint を数え上げ、cookie 無しの要求が 401 になるテストで止める。掛け方 (API 全体に 1 回か、group ごとか) は #603 で決め、Decision の認証の項に書いた |
| Workers Free の CPU が増える | taimei-auth では起動時の JS が 32.7 → 40.7 ms、worker の gzip が +16% | #603 で変更の前後の Worker の bundle と起動時の CPU を記録し、本番に出す前に staging で CPU (p50・p95)・`exceededResources`・cold の TTFB を確かめる。CPU の上限での打ち切りが出たら本番に出さず、Paid にするか、この ADR を改めるかを決める |

taimei-auth の数値は、`taimei-code/taimei-auth@d63097b` の ADR-0017 の「SPA の API 契約」節の費用 (2026-10-11 の計測) である。

## 文書の直し

#603〜#605 で次の文書を直した。

| 文書 | 直す前の記述 | 直す issue |
| :-- | :-- | :-- |
| `src/CLAUDE.md` | route を `app.ts` に `requireSession` の後で足し、公開の route を `PUBLIC_ENDPOINTS` に書く | #603 |
| `src/CLAUDE.md` | `resultJson`・`encodedJson`・`jsonBody`・`hono/validator` と `biome-plugins/` の規則 | #603 |
| `src/CLAUDE.md` | SPA の共通の fetch (`web/src/api.ts`) が、`web/index.html` が JS を待たずに始めた fetch の応答を使う | #603 (client の fetch に移す)。#605 で Atom の取得から見た書き方に直す |
| `src/CLAUDE.md` | SPA が import できるのは `app.ts` の型だけ (`.fallowrc.json` の `boundaries`) | #603 |
| `src/services/CLAUDE.md` | session は Worker の middleware (`src/app.ts`) が作る | #603 (認証の middleware の置き場に合わせる) |
| `src/services/CLAUDE.md` | 失敗の型を `TeamFailure` に入れ、`team-failure.ts` の表に文言・状態コード・報告を書く | #603 (状態コードと文言の置き場を契約の失敗の宣言に合わせる) |
| `src/lib/CLAUDE.md` | 失敗の文言・API の状態コードは `team-failure.ts` の表が決める | #603 |
| `web/src/components/CLAUDE.md` | テストしたいロジックは hook か Service に移す | #605 (atom を加える) |

## Consequences

- 失敗の応答の本文は `{ _tag, message }` (401・409 は `{ _tag }`) から契約の失敗 (`{ _tag }`) に変わり、`message` が無くなる。文言は SPA が失敗の型から引く。deploy の前に開いたタブは、応答の `x-taimei-session` に入る Worker の version が変わるので、次の API の応答で再読み込みして新しい SPA を取り直す (#612)。書き込みの要求は 409 になり、書き込まない
- 型の外に残るもの: アプリの外の失敗 (Workers の CPU の上限での打ち切り、network、本体の予期しない失敗 (defect))、書き込みの後に何を古くするか・取り直すかの正しさ (`changed` を書くことは型が強いるが、宣言の正しさは e2e で止める)
- TanStack Query の既定と違い、次の 3 つをしない。どれも 7 点の外で、要った時に足す
  - focus と再接続での取り直し。Workers Free の CPU を増やすので、足すかは観測で決める。足すなら query の atom に `Atom.refreshOnWindowFocus`
  - 失敗した読み取りの再試行。一時的な網・5xx の失敗がすぐ失敗の表示になる。足すなら `AtomHttpApi.Service` の `transformClient` に `HttpClient.retryTransient`
  - 値が同じ裏の取り直しで描き直さないこと (読む部品は取り直しの前後で 2 回描き直す)。足すなら `waiting` を落とした派生の atom を読ませる

## 改訂前の判断 (2026-10-10)

下は 2026-10-10 の判断の原文である。

### Context

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

### Decision

- API は Hono + Effect の Worker で書き、SPA は `hc` で呼ぶ (`web/src/api.ts`)。`HttpApi` は使わない
- API の schema の宣言 (OpenAPI のような契約) は持たない
- 入力の検証は Service が Effect Schema で decode する (`TeamId`・名前・レベル)。JSON の body や query を取る route には validator を付け、handler で生の値を読まない
- 応答は `src/run-json.ts` の `resultJson`・`encodedJson` だけが返し、route ごとの schema で encode する。schema は契約ではなく許可リストで、書いていない項目は送らない。SPA では応答の JSON がそのまま見え、`c.json` は渡した値をそのまま送るので、画面に出さない他人の個人情報を返さないために置く
- 失敗の tag ごとの状態コードは `src/lib/team-failure.ts` の表が持ち、`Match.valueTags` で網羅する
- 認証の middleware (公開の `/auth*` より後の全 path) が返す 401 は `hc` の型に入らない。SPA が API を呼ぶ共通の `fetch` (`web/src/api.ts`) が受けてログインへ移す

### Consequences

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
