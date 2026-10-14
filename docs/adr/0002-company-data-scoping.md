# ADR-0002: taimei 本体ドメインデータの company_id scoping

- **Status**: Accepted
- **実装**: 完了 (2026-05-31)。PR-0〜PR-6 を全 merge ([#514](https://github.com/YasuakiOmokawa/taimei/pull/514)〜[#522](https://github.com/YasuakiOmokawa/taimei/pull/522))。本番 (Neon) migrate-deploy 全 success、`tags` / `tags2` = NOT NULL + index + NULL 行 0 を psql 確認済。各 PR の内訳は plans/taimei `README.md`「直近の次タスク」を参照
- **Date**: 2026-05-26
- **References**: taimei-auth 事業所概念 ADR ([#55](https://github.com/taimei-code/taimei-auth/pull/55)〜[#63](https://github.com/taimei-code/taimei-auth/pull/63)、設計ログは plans/taimei `ADR-009`)。本 ADR 内の `ADR-009 §...` 参照はこの事業所概念 ADR を指す

## Context

### 現状 (account 管理集約 = taimei-auth `/account` 完了時点)

- ドメインテーブルに事業所単位の分離概念が一切ない。`db/drizzle/schema.ts:15-111` の `customers` / `invoices` / `revenue` / `tags` / `tags2` / `_invoicesTotags` は全て `company_id` 列を持たず、PK は `uuid().defaultRandom()` の単一列 (`schema.ts:16,23,34,41`)。今は全 user が全 invoice / customer を共有しており、scoping が **最初の事業所境界** になる。
- 全 DB アクセスは Effect Service に集約済 (`app/services/invoice-service.ts` 等が `PgDrizzle` を直接使用)。実行は `app/services/index.ts:81` の singleton `Live` runtime (`runService`)。
- query は無 scope。`InvoiceService.findById(id)` は `WHERE invoices.id = id` のみで company チェックなし = IDOR の温床。`update` / `delete(id)` / `app/lib/actions.ts` の `updateInvoice(id)` / `deleteInvoice(id)` も同様。
- ページ保護は `app/lib/auth-guard.ts:28-48` の SDK guard 経由 `getSession()` / `requireSession()`。`app/dashboard/layout.tsx` が `requireSession` を使用。`proxy.ts:38-66` の Next middleware は **cookie 存在チェックのみ**で session 検証を taimei-auth に委譲 (RPC を叩かない)。

### 本 ADR の trigger と責任境界 (ADR-009 Q12)

ADR-009 §2.1 D5 / Q12 結論で、taimei-auth 側は「session に `current_company_id` を持つ / proto `Session.company_id` 活性化 / SDK `getSession()` に `companyId` 追加」までを担い、**「taimei 本体のドメインデータを `company_id` で scope する作業」は本体リポ側の別 ADR (= 本 ADR)** に切り出された。trigger は「SDK が `companyId` 提供開始」で、ADR-009 §12 Phase A〜D 完了 (2026-05-25) で充足。

### SDK ギャップ (観測事実・Phase 0 のブロッカー)

本体にインストール済の SDK は **1.0.0** (`package.json:42` の `^1.0.0`) で、`SessionData` は `user` / `session` のみ・**`companyId` を提供していない** (`node_modules/@taimei-code/auth-client/dist/types.d.ts:2-17` で観測)。taimei-auth は ADR-009 §12.1 PR #57 で **`1.1.0`** を publish し `SessionData.companyId` (flat shape: `companyId` / `currentCompanyName` / `currentCompanyRole`、source は `user.last_used_company_id`) を提供済。

→ **本 ADR の Phase 0 は「本体の SDK を `1.1.0` へ upgrade」**。`^1.0.0` のまま放置すると `getSession().companyId` が永遠に来ないため、他全 Phase の前提。

### 既存 query 層が Effect Service に集約済であること

`.claude/rules/effect-patterns.md` の「全データアクセスを Effect-TS サービス経由に統一 / Service が PgDrizzle を直接使用 (Repository 層不要)」が既に徹底されているため、scoping を「各 query に手で WHERE を足す」のではなく **「company context を DI 層で 1 箇所に注入する」**形に倒せる。これが主機構選定 (D2) の前提。

## Decision

### D1. scoping 対象は実ドメイン 5 テーブル全て

`customers` / `invoices` / `revenue` / `tags` / `tags2` の全てに `company_id` を追加し per-company にする。`_invoicesTotags` は join テーブルで両端 (`invoices` / `tags`) が scoped なので列追加は不要 (両端の scope で従属的に分離される)。ただし join 行自体は company 列を持たず DB 制約では cross-company 結合を防げないため、tag 付与は必ず scoped な invoices/tags 経由に限定する。tags scoping は Phase 2 のため **Phase 1 完了時点は leak 窓が開く**点に注意 (MECE IM5)。

`revenue` は `fetchRevenue` が dashboard overview で読まれるため、scope しないと **overview の売上チャートが全社横断で漏れる**。`tags` / `tags2` は社ごとのラベル辞書とする。

`customers` は **company-private** とする: `company_id` 列を足すだけ (中間テーブルなし)、同名取引先でも company ごとに別行を持ち社間で共有・名寄せしない。`customer` (= ある company の請求先) と `company` (= テナント) は別概念 (GLOSSARY.md 参照)。これは freee が取引先/顧客マスタを **事業所スコープ**で持ち社横断共有しない構造と一致する (Sources「freee 参考調査」)。社横断の顧客共有は freee でも顧問 (advisor) 関係限定で、taimei MVP は顧問概念を持たない (ADR-009 D3) ため company-private で確定。

**list / aggregate メソッドも明示 scope (MECE CR2/IM1)**: 行を返す全経路を漏れなく scope する。特に `CustomerService.findAll` は invoice 作成 dropdown のソースで現状 全件返すため `companyFilter` を通す。`fetchFiltered` の `customers × invoices` leftJoin 集計 (`totalPaid`/`totalPending`) は join 先 invoices にも `companyFilter` を AND しないと他社金額が混入する (customers 側を絞っても join で漏れる)。

> 本 ADR の眼目は「customers / invoices で再利用可能な scoping pattern (機構 + IDOR 防御 + redirect 配置) を確立し、残テーブルと将来の新テーブルが同じ規約に従う」こと。

### D2. 主機構: `CompanyContext` (Effect DI)

per-request の companyId / role を保持する Effect サービス。`effect-patterns.md` の「複数 Layer バリアントが要るなら `Effect.Tag`」に該当 (本番は per-request 注入、テストは固定値注入)。

```ts
// app/services/company-context.ts
export interface CompanyContextShape {
  readonly companyId: string;
  // role は持たない (scoping のみ。認可は別層)。SDK 1.1.0 が実際に提供するのは companyId のみで
  // currentCompanyName / currentCompanyRole は未提供 (PR-2 実装時に node_modules 型で観測)。
}

export class CompanyContext extends Effect.Tag("services/CompanyContext")<
  CompanyContext,
  CompanyContextShape
>() {
  static of = (ctx: CompanyContextShape) => Layer.succeed(this, ctx);
}
```

各 Service は `yield* CompanyContext` で companyId を引き、scoped query に適用する:

```ts
// InvoiceService.findById — 他社 id は WHERE で除外 → 空 → InvoiceNotFound (404)
findById: (id: string) =>
  Effect.gen(function* () {
    const { companyId } = yield* CompanyContext;
    const result = yield* Effect.tryPromise({
      try: () => pgdrizzle.select({ /* ... */ }).from(invoices)
        .where(and(eq(invoices.id, id), companyFilter(invoices, companyId)))
        .then((r) => r.at(0)),
      catch: (e) => new InvoiceServiceError({ message: `findById failed: ${e}` }),
    });
    if (!result) return yield* new InvoiceNotFound({ id });
    return result;
  }),

// create — companyId は context から。引数では受けない (取り違え防止)
create: (input) =>
  Effect.gen(function* () {
    const { companyId } = yield* CompanyContext;
    return yield* Effect.tryPromise({
      try: () => pgdrizzle.insert(invoices).values({ ...input, companyId }).returning(),
      /* ... */
    });
  }),
```

**create / update の外部参照 (`customerId`) は別途自社帰属を検証する (MECE CR1)**: `companyFilter` は invoices 行の read/update/delete を絞るが、INSERT/UPDATE 入力の外部 FK (`customerId`) の帰属は絞らない。`customers` FK はグローバルなので、他社 `customerId` を渡すと invoice 自体は自社 companyId で作られてしまう (cross-company 参照注入)。create/update は context の companyId で `customerId` の自社帰属を検証し、スコープ外なら `InvoiceNotFound` 相当で拒否する (型・`companyFilter` だけでは塞がらない = D3 の 3 重閉じの例外)。

**`CompanyContext` は companyId のみ持ち role は入れない (freee 調査で裏付け)**: `CompanyContext` は scoping (= どの company のデータか) のみを担い、authorization (= 何ができるか) を持たない。freee も認可を session/membership とは別の専用層に置く — membership が持つのは「属性」(従業員 / アドバイザー) で、実際の権限判定は `AclKit` / `sekisyo` 権限セット (`PrivilegeControlService#xxx:read/:write` を controller `before_action` でチェック → 401/403) という別レイヤー (Sources「freee 参考調査」)。よって taimei も RBAC が必要になった時は `CompanyContext` を拡張せず、別の authorization 層 (例: `AuthorizationContext` + permission チェック) を新規に足す (Phase E+)。なお SDK 1.1.0 は role を提供しない (companyId のみ) ため、role を要する nav 表示・認可は SDK 側が role を返すようになってから着手する (PR-2 実装時に観測)。

### D3. companyId の source は scoping 境界の内側で session から導出する (呼出側に渡させない)

`runScopedService` は **companyId を引数で受けない**。境界の内側で認証済 session (SDK guard 経由・`react.cache` 済) から導出する。これにより「呼出側が間違った/欠けた companyId を渡す」経路が API から消える。

```ts
// app/services/index.ts。既存 runService (company 不要処理) はそのまま残す。
// makeNextRuntime は runtime を共有 export し、scoped/非 scoped が同一 ManagedRuntime を使う
// (runScopedService が runtime を再構築して runtime 集約の層分離を崩すのを防ぐ):
export const makeNextRuntime = <R, E>(layer: Layer.Layer<R, E, never>) => {
  const runtime = ManagedRuntime.make(layer);
  const run = <A, E2>(body: () => Effect.Effect<A, E2, R>) =>
    runtime.runPromise(Effect.either(body()));
  return { run, runtime };
};
const { run: runService, runtime } = makeNextRuntime(Live);

// AllScopedServices は Live の ROut から機械導出 (手書き union 禁止 = Service 追加時の scoping 漏れ防止)。
type AllScopedServices = Layer.Layer.Success<typeof Live>;

// IDOR backstop 番兵 (閉じ1 を規律でなく型で固定): CompanyContext を Live に含めると
// companyId 無し実行が型で通り backstop が破れる。含めた瞬間に下行がコンパイルエラーになる。
type _NoCompanyContextInLive =
  [CompanyContext] extends [AllScopedServices] ? "ERROR: CompanyContext must NOT be in Live" : true;
const _assertNoCompanyContextInLive: _NoCompanyContextInLive = true;

export const runScopedService = async <A, E>(
  body: () => Effect.Effect<A, E, AllScopedServices | CompanyContext>,
) => {
  // 未選択判定 + redirect は requireCompany と共有 (redirect SSOT、D5)。Next 境界でしか取れない。
  const { companyId } = await resolveCompanyIdOrRedirect();
  return runtime.runPromise(
    Effect.either(
      body().pipe(Effect.provideService(CompanyContext, { companyId })),
    ),
  );
};
```

呼出側 (`app/lib/data.ts` / `app/lib/actions.ts`) は companyId を一切扱わない:

```ts
export async function fetchInvoiceById(id: string) {
  const result = await runScopedService(() =>
    Effect.gen(function* () {
      const service = yield* InvoiceService;
      return yield* service.findById(id);
    }),
  );
  // InvoiceNotFound → null → not-found ページ
}
```

**3 重の閉じ**:
1. Service が `yield* CompanyContext` を持つ → 型上 `CompanyContext` が `R` に乗り、`runScopedService` (provideService 済) でしか実行できない。`runService` に渡すとコンパイルエラー → 「company-scoped 処理を context 無しで実行」が型で不能。**前提不変条件「`CompanyContext` を `Live` に含めない」は規律でなく型で固定する**: 上記 `_NoCompanyContextInLive` 番兵が `Live` の ROut に `CompanyContext` が混入した瞬間コンパイルエラーを出す。`AllScopedServices` も `Live` から機械導出し手書き union にしない (Service 追加時の漏れ防止)。2026-10-09 から `AllScopedServices` の型は無く、実行口ごとに `Live` とその実行口が provide する Layer から導出する (詳細は ADR-0005 の Decision)。`runManagerScopedService` も `runScopedService` と同じ `app/services/index.ts` の `runInCompanyScope` で session から companyId を導くので、この 3 重の閉じと D5 の権威ガードは 2 つの実行口の両方に成り立つ。`bun tsc --noEmit` でこの閉じが成立することを CI で確認 (Phase 1 AC)。
2. `runScopedService` は companyId 引数を持たない → 呼出側が値を供給する経路が存在しない。
3. companyId は認証済 session から導出 → リクエストパラメータ由来の companyId injection (IDOR) も不能。

2026-10-14 追記: 今の実行口は `src/services/index.ts` の `runTeamReads`・`runTeamService`・`runTeamManagement` で、session から companyId を導く。companyId を引数で受ける書き込みの口 (`src/services/company-scope.ts` の `writeInCompanyScope` と `company-team-list.ts` の `writeTeamList`) は、実行口と、事業所の行 (`company_ids_with_teams()`) を読む cron の `purgeDeparted` だけが使う。session の無い cron は事業所を DB から読むしかないため。使える file の一覧は `src/services/__tests__/company-scope.test.ts` が固定する。

**3 重閉じが守らない範囲 (MECE CR1/CR2、Phase 1 で対応)**: この 3 重は「どの company の文脈で実行するか」を保証するが、以下は型・境界・session 導出では塞がらず個別対応が要る —
- **mutation 入力の外部 FK**: `create`/`update` の `customerId` は `companyFilter` 対象外 (グローバル FK)。context の companyId で自社帰属を検証する (D2)。
- **無 scope な list / aggregate メソッド**: `CustomerService.findAll` 等は全件返すため明示的に `companyFilter` を通す。`fetchFiltered` の join 集計も join 先に `companyFilter` を AND する (D1)。
- **update / delete の他社行**: WHERE に `companyFilter` を AND し、他社 id は 0 行 hit = 404 + rows affected=0 (D6)。

**redirect の責務分割**: `redirect()` は Next.js の control-flow throw で Effect 内では実行不能。「未選択判定 + redirect」は素の async fn である `runScopedService` の冒頭 (= Next 境界) に置く。「取り出した companyId で query を絞る」のは Effect の責務。companyId は「Next 境界で session から取り出し → 値として Effect へ注入」の一方向に倒す。

### D4. fail-open backstop: scoped ヘルパー規約 + テーブル別 isolation テスト

`CompanyContext` 方式は「`yield* CompanyContext` で取った companyId を WHERE に入れ忘れても型エラーにならない」点で fail-open。これを以下で塞ぐ:

- **scoped クエリヘルパー規約** (`db/scoped.ts` 新規): 生の `eq(table.companyId, ...)` を Service に直書きせず、唯一の入口 `companyFilter` 経由にする。grep / review / lint が scoping 漏れを機械的に探せる。

```ts
// db/scoped.ts — company_id を持つ全テーブルの scoping 条件の SSOT
export const companyFilter = <T extends ScopedTable>(table: T, companyId: string) =>
  eq(table.companyId, companyId);
// select は and() で合成、update/delete も where に必須合成、insert は values に companyId を必ず set
```

- **テーブル別 isolation テスト** (必須): 2 社 seed し、各 Service method の select / update / delete の cross-company 不可視 + create の company_id 自動付与 + create の他社 customerId 拒否 + findAll の自社限定を検証 (テスト戦略節)。これが backstop の実体。**ただしテスト基盤は net-new**: 現状 factory は `user` のみ・`effect-test-helpers` は `CompanyContext` 未提供のため、factory 群新規作成 + helper への `CompanyContext` 注入が前提 (MECE IM2、Phase 1 タスク)。

当初は RLS を採らなかった (Alternatives Considered、本番課金前には過剰)。2026-10-06 に ADR-0005 で、`companyFilter` を残したまま RLS (設定名は `app.company_id`) を二重の守りとして足した。ast-grep/lint で「scoped テーブルへの `companyFilter` 無し直アクセス」を検出するルールは将来硬化候補 (Phase E+)。

### D5. redirect 配置: `runScopedService` が権威ガード、`requireCompany` は page UX

- **データ層の権威ガード = `runScopedService` 自身**: 未選択は必ず redirect、全 scoped query は session 由来 companyId で絞られる。`proxy.ts` は cookie 存在チェックのまま不変 (RPC を叩かず companyId を見られないため、ここに redirect は置けない)。
- **`requireCompany()` (`app/lib/auth-guard.ts` に追加) は page レベル UX 用**: `requireSession()` を内包し、data fetch に入る前に layout で redirect して描画チラつきを防ぐ / nav に会社名を出す。security backstop ではない。`requireCompany` を呼び忘れた page があっても、その下の `runScopedService` が必ず redirect するので穴にならない。両者は同じ `cache()` 済 getSession を読むので RPC は増えない。

```ts
// app/lib/auth-guard.ts — page UX 用の thin wrapper (redirect/companyId 導出は resolveCompanyIdOrRedirect に集約)
export const requireCompany = async ({ returnTo }: { returnTo: string }) => {
  const { companyId, session } = await resolveCompanyIdOrRedirect(returnTo);
  return { ...session, companyId }; // nav 表示用に session も返す
};
```

redirect 先 `/auth/signup/company` は taimei-auth web SPA 上 (ADR-009 D6)。本体は `NEXT_PUBLIC_AUTH_URL` を base に絶対 URL を組む (`proxy.ts` の AUTH_URL 解決と同型)。`buildCompanySignupUrl(returnTo?)` は returnTo を optional とし、page 経路 (`requireCompany`) は現 path を渡し、data 経路 (`runScopedService`) は省略して default に倒す。SDK 側に同 helper を持たせるかは taimei-auth リポの判断 (本 ADR は consumer 側で構築)。

**redirect / companyId 導出の SSOT (review-design 指摘)**: 未選択判定・redirect・companyId 取り出しが `runScopedService` (D3) と `requireCompany` で二重定義されないよう、`resolveCompanyIdOrRedirect()` 1 helper に集約し両者が呼ぶ。未認証 (session null) と「認証済・事業所未選択」で redirect 先を分岐する:

```ts
// app/lib/auth-guard.ts — redirect + companyId 導出の SSOT
export const resolveCompanyIdOrRedirect = async (returnTo = "/dashboard") => {
  const session = await getSession(); // react.cache 済
  if (!session) redirect(`/auth?callbackUrl=${encodeURIComponent(returnTo)}`); // 未認証 → login
  if (!session.companyId) redirect(buildCompanySignupUrl(returnTo)); // 認証済・事業所未選択 → 登録
  return { companyId: session.companyId, session };
};
```

`requireCompany` は nav 表示用に `session` も返す薄い wrapper、`runScopedService` は `{ companyId }` のみ使う。

### D6. cross-company アクセスは 404 (403 ではない)

scoped query が WHERE で他社行を除外 → `findById` が空 → 既存 `InvoiceNotFound` → not-found ページ (404)。**存在自体を漏らさない**のが best practice。ADR-009 §3.3 の「403 contract」は "事業所未選択" ケース向けで、本体では未選択は redirect (D5)、他社リソースは 404 に倒す。404 を選ぶと「IDOR 防御」と「存在隠蔽」が scoped query 1 つで同時に満たされる。

同様に **`update` / `delete` も WHERE に `companyFilter` を AND** し、他社 id は 0 行 hit = 404 + rows affected=0 (他社データを変更しない)。read だけでなく write/delete の IDOR も塞ぐ (MECE CR1)。

### D7. id はグローバル一意 UUID のまま、`company_id` は非 PK の追加列 (URL 衝突なし)

`company_id` は scoping 用の**追加列**で、PK には**含めない** (composite PK にしない)。id 系は全て `uuid().defaultRandom()` の単一列 PK (`schema.ts:16,23,34,41`) で、DB が company を問わずテーブル全域で一意性を強制する。列を 1 本足しても既存 PK の一意性は変わらないため、`/dashboard/invoices/[id]/edit` の `[id]` は常にちょうど 1 行 (= ちょうど 1 社) に対応し URL が duplicate になる余地はない。

副次効果: id がグローバル一意 (company_id を含まない) なので、id 自体が company を露呈せず、他社 UUID を入手しても scoped query が空を返す (D6) = 列挙攻撃にも強い。

> 例外として「人間可読の社内連番 (例: 請求書番号が社ごとに 1 から振り直す)」が要るなら、それは PK の `id` (UUID) とは別の display-id 列で `(company_id, invoice_no)` 複合一意が必要になる。本 ADR スコープ外で Phase E+ 候補。

### D8. 二重 getSession 経路の扱い

companyId の source は **`runScopedService` 内 / `requireCompany` の SDK guard 経由 `getSession()` 一本**に統一。Effect の `AuthService.getSession` (`app/services/auth-service.ts`、`verifySession` 手動マッピング) は **本番呼出ゼロ (テスト専用)** なので companyId を足さない (proto 新フィールドのマッピング・モック更新の保守負債だけ増え、読む本番コードが無い)。本 ADR では触らない。

なお scoping 経路の実挙動は **SDK guard `getSession` が `!ok` で null を返し `/auth` redirect** であり、`SessionError` を投げる Effect 版とは別物。検証 AC は SDK guard 経路 (null → redirect) を対象にする (`SessionError` は本番呼出ゼロのため非影響確認に留める、MECE IM8)。

`AuthService.getSession` は `Live` に配線されたままだが **companyId を返さない契約**である点をコメント/命名で明示し、将来 consumer が付く時は SDK guard 経由へ寄せる (review-design Hexagonal: 同一 auth port に 2 実装が並立する contract 不明示の緩和。`CompanyContext` 不在なら scoped Service はコンパイル不能 = 閉じ1 が backstop)。

2026-10-08 追記: Effect の `AuthService`・`makeNextRuntime`・`CompanyContext.layer` は Effect v4 stable への移行で削除した。getSession の経路は SDK guard だけである。

### D9. migration / backfill

各テーブルに `company_id varchar(32)` (auth `company.id` = `cmp_<nanoid24>` ≒ 28 文字への論理参照、**FK は張らない** = cross-DB) + index を追加。`revenue` の unique は `(month)` → `(company_id, month)` に変更。`revenue` は id PK を持たず read-only 前提 (アプリに write path なし)。migration 後は `(month)` 単独 unique が残らず `(company_id, month)` のみになることを SQL で確認する (MECE IM4)。company_id 列には index を張り、`fetchFiltered` の検索は company_id 前置の複合 index を検討 (MECE N2)。

**前提 (調査で確定): 永続的な seed データは存在しない**。test DB は factory がトランザクション内で行を生成し毎テスト rollback (`app/services/__tests__/db/effect-test-helpers.ts`)、`scripts/` / `dump/` は空、`app/lib/placeholder-data.ts` は Next.js チュートリアルの未使用残骸。よって「既存 demo データの backfill」はほぼ不要で、対応は 2 系統に分かれる:

- **test DB**: backfill 不要。factory (`app/services/__tests__/factories`) に `company_id` を追加し行生成時に必ず set。isolation テストは 2 つの company_id で seed (D4)。
- **dev/staging DB**: ad-hoc な手入力行のみで throwaway。`company_id NOT NULL` を安全に足すため **nullable 追加 → 既存行があれば placeholder company_id へ backfill (無ければ no-op) → not null 化** の 3 段 (冪等、ADR-009 §2.1 D8 の `drizzle/manual/` 哲学を踏襲)。placeholder は auth の特定 company に結合しない単純固定値で可 (意味あるデータは signup フロー or factory 由来)。意味ある dev データが要るなら dev DB を reset して UI signup で作り直す。

auth-coupled な sentinel (実 company id の埋め込み) は不要 (cross-DB 結合を避ける)。`app/lib/placeholder-data.ts` はこの機に削除 or company_id 対応する (未使用残骸の整理、Phase 1 任意タスク)。

## Alternatives Considered

| 案 | 採用しなかった理由 | 再評価トリガー |
|---|---|---|
| **RLS を主軸 (DB 強制 scoping)** | (当時の理由。2026-10-06 に ADR-0005 で主軸でなく二重の守りとして採り、設定名は `app.company_id` にした) per-tx `SET app.current_company_id` + PgDrizzle pooling 整合・RLS テスト負担が本番前には過剰。全 query が Effect Service に集約済なので DI 注入で十分 | 本番課金開始 / 初の実顧客企業 (company) 受入 / pen-test での IDOR 指摘 |
| **companyId を全 method の明示引数に** | 呼出側が値を供給できる = 取り違え IDOR の面が残る。CompanyContext を選んだ目的 (呼出側を companyId 取り回しから外す) と矛盾 | admin が他社を代理閲覧 / session 非依存の background job で別 companyId scope が要る時 (その時だけ監査ログ必須の明示経路を追加) |
| **Effect 版 `AuthService.getSession` に companyId 追加** | 本番 consumer ゼロのデッドコード (D8) | Effect 版に本番 consumer が付き company context を要する時 |
| **`company_id` を composite PK に含める** | id は UUID で既にグローバル一意。複合化は一意性に寄与せず join/URL を複雑化 | 社内連番 display-id を導入する時 (別列で対応、PK は据え置き) |
| **ast-grep/lint で未 scoped 直アクセス検出** | 初期は `companyFilter` 規約 + isolation テストで十分 | scoped テーブルが 5 を超える / scoping bug が 1 度でも ship した時 |

## Consequences

### Positive

- **課金境界との整合**: データが `company_id` で分離されるので、ADR-009 が定めた「課金単位 = 事業所」に対し、本体データも機械的に同単位で集計・分離できる。
- **IDOR の攻撃面が構造的に消える**: D3 の 3 重閉じにより「付け忘れ / 取り違え / パラメータ injection」が型 + 境界 + session 導出で塞がる。
- **将来テーブルが従う pattern が確立**: `CompanyContext` + `companyFilter` + isolation テスト + `runScopedService` のセットが、新規 company-scoped テーブルの追加手順を予測可能にする。
- **RPC 増加なし**: companyId source を `react.cache` 済 getSession 一本に統一 (D8) し、`requireCompany` (page) と `runScopedService` (data) が同 cache を共有。

### Negative / トレードオフ

| トレードオフ | 緩和策 |
|---|---|
| `CompanyContext` 方式は fail-open (WHERE 付け忘れが型で防げない) | D4 (`companyFilter` 規約 + テーブル別 isolation テスト必須) |
| SDK upgrade 漏れで companyId が永遠に来ない | Phase 0 をブロッカーとして先行。`SessionData.companyId` 型可視 + Network tab 確認を AC 化 |
| cross-DB 論理参照 (FK 無し) で本体 company_id と auth company.id の整合が崩れうる | D9 (FK 不可は受容、整合は「scoping を漏らさない」規律 + isolation テストで担保)。orphan company_id は本番前 backfill + signup フロー (ADR-009) で発生しない設計。ただし auth 側 company hard delete (Phase E+ GDPR) 時の本体 orphan は未解決 — Phase E+ の company 削除設計で削除伝播 (event/バッチ cleanup) として扱う (DA #6) |
| dev DB の ad-hoc 行が NULL のまま not null 化に失敗 | D9 (nullable→placeholder→not null の冪等 3 段)。not null 化前に NULL 0 件を SQL 確認。test DB は factory が company_id を set するため対象外 |
| scoped/非 scoped runtime 経路の混在 (`runService` / `runScopedService`) | D3 (型で取り違え不能。scoped Service は `runService` に渡すとコンパイルエラー) |
| 行 scope だけでは mutation 入力 FK / list-all を塞げない (MECE CR1/CR2) | D1 (list/aggregate も `companyFilter`) + D2 (create/update の customerId 自社帰属検証) + D6 (update/delete も 404) |
| scoping がドメインルールでなく規律 (DI + query helper) 依存 = ドメイン貧血寄り (review-design DDD) | 受容 (`effect-patterns.md` の Repository 不要・Service が drizzle row 直返し方針の帰結)。**非目標**: customer/invoice を Effect.Schema/Data.case のドメイン Entity に昇格させない。規律は閉じ1 の型番兵 + isolation テスト + `companyFilter` SSOT で機械検出に格上げ |
| `companyFilter` を 3 Service・14 query に手で AND する Shotgun Surgery (review-design anti-pattern) | 同一レイヤー (`app/services/`) に閉じる + `companyFilter` 単一入口で grep 可能 + isolation テスト必須 + `from(<scoped table>)` に `companyFilter` 無しを検出する lint を Phase 1 で導入 |

### セキュリティ観点

- **IDOR 防御 = 3 重 (D3)**: 型 (`CompanyContext` in R) + 境界 (companyId 引数なし) + session 導出 (パラメータ injection 不能)。
- **3 重閉じの適用範囲 (MECE CR1/CR2)**: 出力行 scope だけでは mutation 入力 FK (`customerId`) と無 scope な list/aggregate (`findAll`/join 集計) を塞げない。詳細と対応は D3「3 重閉じが守らない範囲」を参照。
- **存在隠蔽 (D6)**: cross-company は 404、id は UUID でグローバル一意 (D7) なので列挙攻撃不能。
- **backstop (D4)**: `companyFilter` 規約 + isolation テストで「付け忘れ」を検出。RLS は再評価トリガー時に defense-in-depth として追加余地。

## Implementation Roadmap

Phase は手動 QA できる end-to-end 単位で分割 (ADR-009 流)。

### Phase 0: SDK upgrade (前提・極小 PR)

- [ ] `package.json` の `@taimei-code/auth-client` を `^1.0.0` → `1.1.0` (**caret なし exact pin** — auth 側の `last_used_company_id` 意味変更を意図せず取り込まないため、DA #4) に上げ `bun install`。SDK contract test を CI 常時実行 (Phase 0 単発でなく)
- [ ] `SessionData.companyId` 型が consumer で見えることを確認 (1.1.0 は `currentCompanyName` / `currentCompanyRole` を提供せず companyId のみだった。PR-2 実装時に node_modules 型で観測)
- [ ] `/api/auth/get-session` レスポンスに `companyId` が乗ることを Network tab / curl で確認
- **AC**: SDK contract test 緑 + `bun tsc --noEmit` で companyId 型可視

### Phase 1: scoping 機構確立 + invoices / customers / revenue + dashboard (本丸)

`company_id` 列が無いと `companyFilter` がコンパイルできないため schema + 機構 + 最初のテーブルが co-land。review surface が大きければ「schema 追加 PR」と「scoping 適用 PR」に 2 分割可。

- [ ] `db/drizzle/schema.ts` の `customers` / `invoices` / `revenue` に `company_id varchar(32)` を **nullable で追加** + `company_id` index (必須、DA #5)。**NOT NULL 化 + `revenue` unique `(company_id, month)` 変更は別 PR** (新アプリデプロイ後 = expand-contract、デプロイ順序 D-1)
- [ ] `bunx drizzle-kit generate` + 3 段 backfill SQL (D9、本番行の backfill 手順含む)
- [ ] cross-company write 試行の構造化ログ (試行 companyId / 対象 id / 経路) を実装 (**Required**、DA D-3。fail-open の本番検知系)
- [ ] `app/services/company-context.ts` (`CompanyContext` Effect.Tag)。companyId の供給元は **session の単一 companyId** と定義 (複数 company 所属は ADR-009 の current company で解決済、本体は単一値を受領、MECE IM6)
- [ ] `db/scoped.ts` (`companyFilter` SSOT)
- [ ] `app/services/index.ts`: `makeNextRuntime` を runtime 共有 export に変更 + `runScopedService` 追加 (companyId は `resolveCompanyIdOrRedirect` 経由)。**`AllScopedServices = Layer.Layer.Success<typeof Live>` 導出 + `_NoCompanyContextInLive` 番兵で閉じ1 を型固定 → `bun tsc --noEmit` で成立確認** (review-design 収束指摘、最重要)
- [ ] `app/lib/auth-guard.ts` に `resolveCompanyIdOrRedirect()` (redirect/companyId 導出 SSOT、未認証→/auth・未選択→signup/company の分岐) + `requireCompany()` (薄い wrapper) + `buildCompanySignupUrl()`
- [ ] `InvoiceService` / `CustomerService` / `DashboardService` の全 query を scoped 化:
  - select は `companyFilter` を AND、insert は companyId を context から set
  - **`update` / `delete` も `companyFilter` を AND** し他社 id は 404 + rows affected=0 (CR1)
  - **`create` / `update` で `customerId` の自社帰属を検証** (グローバル FK 経由の cross-company 注入を防ぐ、CR1)
  - **`CustomerService.findAll` を `companyFilter` 経由に** (invoice 作成 dropdown のソース、CR2)。dashboard 等の全 list/aggregate 経路を棚卸し (T1)
  - **`fetchFiltered` の `customers × invoices` leftJoin に invoices 側 `companyFilter` を AND** (集計金額 leak 防止、IM1)
- [ ] `app/lib/data.ts` / `app/lib/actions.ts` の該当関数を `runScopedService` 経由に
- [ ] `app/dashboard/layout.tsx` を `requireCompany` に
- [ ] **テスト基盤を net-new 整備 (IM2)**: invoice / customer / revenue factory を新規作成 (現状 `factories` は `user` のみ) し company_id を必須 set + `effect-test-helpers` の `createTestServiceLayer` に `CompanyContext` を注入 (固定 companyId、未注入だと scoped 化で既存テストもコンパイル不能)
- [ ] invoices / customers / revenue の isolation テスト (select に加え **update/delete の他社行不可視・create の他社 customerId 拒否・findAll の自社限定** を必須化、CR1/CR2)
- [ ] isolation テストで **集計 method の金額アサーション** (`fetchCardData` / `fetchRevenue` / `fetchFiltered` の `totalPaid`/`totalPending` 等が他社金額を加算しない) を必須化 (review-design anti-pattern: select 存在確認だけでは aggregate/join leak を取り逃す)
- [ ] `from(invoices)` / `from(customers)` / `from(revenue)` に `companyFilter` 参照が無い query を検出する lint (ast-grep) を導入 (Shotgun Surgery backstop の前倒し、review-design)
- **QA**: 2 社で dashboard 完全分離 (overview チャート / 請求書一覧 / 顧客一覧)、他社 invoice id 直打ち → 404、事業所未選択 user → `/auth/signup/company` redirect、**他社 invoice id で update/delete → 404 + 他社行不変**、**他社 customerId で create → 拒否**、**他社 customer が一覧/dropdown に出ない**、**revenue unique が (company_id, month) のみ**

### Phase 2: tags / tags2 scoped (残テーブル)

- [ ] `tags` / `tags2` に `company_id` + index + backfill
- [ ] `Tag2Service` を scoped 化
- [ ] tags / tags2 の isolation テスト
- **QA**: タグ辞書が社ごとに分離

### デプロイ順序・本番運用 (review-design DA、fatal 3 件反映)

**前提 (DA が実機確認)**: migration は `drizzle/**` の main push で `.github/workflows/drizzle-migrate-deploy.yml` が **自動・即・本番適用** する独立 workflow。アプリ本体デプロイは別経路・別タイミング = schema とアプリのアトミック切替は不可能。observability は現状 `console.error` のみ。

**D-1. expand-contract デプロイ順序 (NOT NULL とアプリの非アトミック切替対策)**: `company_id NOT NULL` 化がアプリより先に本番適用されると、`companyId` を書かない旧アプリの INSERT が NOT NULL violation で全 invoice 作成 500 になる。順序を固定する:
1. `company_id` を **nullable で追加** する migration を push (自動適用)
2. 既存行を backfill (本番に実行があれば placeholder、無ければ no-op)
3. `companyId` を INSERT/UPDATE に書く **新アプリコードをデプロイ**
4. 全行 backfill 確認後、**NOT NULL 化 migration を別 PR で** push
- → **NOT NULL 化と `revenue` unique 変更は Phase 1 本体と別 PR に切り出す** (drizzle 自動適用が手順 3 を飛ばすのを防ぐ)。
- 本番 DB の既存行 backfill 手順 (リリース時点の本番行有無の確認 SQL + placeholder) を migration に含める (D9 は dev/staging のみ論じていたので本番分を補う)。

**D-2. 本番リリースは Phase 1 + Phase 2 を束ねる (tag leak 窓を本番に出さない)**: 開発・QA 単位の Phase 分割と本番リリース単位を分離する。`_invoicesTotags` の leak 窓 (D1/IM5) は dev/staging では許容するが、**本番には Phase 2 (tags scoped) 完了まで出さない** — 本番リリースは Phase 1+2 を同一デプロイにまとめる (feature flag 基盤が無いためリリース束ねで対応)。

**D-3. fail-open の検知系は Required + rollback 手順**: fail-open 設計 (D4) で本番 leak が起きても気づけないのは設計矛盾。
- **検知 (Required)**: cross-company write 試行 (他社 customerId / 他社 id mutation) の構造化ログ (試行 companyId / 対象 id / 経路) を **Phase 1 必須**に格上げ (IM7 を Important → Required)。observability が console.error のみでも後で集計可能な構造で出す。
- **rollback**: NOT NULL / unique 変更は forward migration で「アプリだけ rollback」が効かない (新 schema 上で旧アプリが violation)。drizzle-kit に down が無いため revert 用 nullable 戻し SQL を `drizzle/manual/` に用意し、**「rollback は forward-only (戻し migration を別 push)」を運用方針に固定**。
- **RLS 前倒しトリガー**: 「**最初の実顧客受入前**に RLS を defense-in-depth で入れる」を時系列トリガーに追加 (『pen-test 指摘後』= 漏れた後では遅い)。

**D-4. migration の環境間スキーマ出自差 (PR-5 で実際に踏んだ本番障害)**: PR-5 (0004) の本番 migrate-deploy が `cannot drop index "revenue_month_key" because constraint "revenue_month_key" requires it` で失敗した。原因は **同名オブジェクトの内部種別が環境で食い違っていた**こと —
- **本番**: `revenue_month_key` は UNIQUE **constraint** (旧ツール由来。drizzle 0000 は introspect で起こされたため、本番には drizzle 以前から constraint が存在し、0000 の `CREATE UNIQUE INDEX IF NOT EXISTS` は本番では既存ヒットで skip されていた)。
- **test/dev**: 同名が drizzle 0000 由来の **index** (空 DB に 0000 を流すと `CREATE UNIQUE INDEX` で index として作られる)。
- `DROP INDEX` は constraint を落とせない → 本番だけ失敗、空の test DB では再現せず。

対策:
- **両構え drop**: 種別が環境で異なりうる drop は `ALTER TABLE ... DROP CONSTRAINT IF EXISTS` + `DROP INDEX IF EXISTS` を併記する (constraint を落とせば裏付け index も消え、後段の `DROP INDEX IF EXISTS` は no-op で安全)。
- **本番出自での dry-run を検証段に組み込む**: 「空の test DB で通る ≠ 本番で通る」。破壊的 DDL を含む migration は、本番スキーマのダンプ (構造のみ) or 本番への `BEGIN; \i <migration>; ROLLBACK;` dry-run で**適用前に**検証する。
- **drizzle-kit migrate はトランザクション migration (実機確認済み)**: 1 migration ファイルを単一トランザクションで包み、途中失敗時は**前段の文 (backfill UPDATE 等) も含め全ロールバック・journal にも未記録**。よって失敗 migration は「部分適用」を残さず、**ファイルを修正して再 push すれば未適用とみなして atomically 再実行**される (journal 手動編集や手動 DDL 復旧は不要)。これが本 migration 群の forward-only 運用の安全性の根拠。

### Phase E+ (将来トリガー時)

- RLS を defense-in-depth で追加 (Alternatives Considered のトリガー: 本番課金 / 実顧客企業 / pen-test 指摘)
- ast-grep/lint で未 scoped 直アクセス検出 (トリガー: scoped テーブル 5 超 / scoping bug ship)
- 社内連番 display-id (D7、別列 + `(company_id, no)` 複合一意)
- admin 代理閲覧 / background job 用の明示 companyId 経路 (監査ログ必須)
- **RBAC / authorization 層** (role 別の操作制限、例: MEMBER は invoice 削除不可): `CompanyContext` を拡張せず別層 (`AuthorizationContext` + permission チェック) を新設。freee の AclKit / sekisyo 権限セット型 (Sources「freee 参考調査」)。トリガー: role 別操作制限が要件化した時
- **invoice immutability (顧客情報スナップショット)**: 現状 invoice は customer を FK 参照するのみで発行時スナップショットを持たないため、customer 編集が過去 invoice の表示に遡及する。freee は「請求書と取引先マスタの分離」で発行時ワンタイムコピーに変更済 (Sources「freee 参考調査」)。本 ADR の scoping とは別軸なので別 ADR 候補。トリガー: 本番で過去 invoice の改変懸念が顕在化した時

### テスト戦略 (backstop の実体)

`.claude/rules/testing-strategy.md` の `dbEffect` (withRollback + Factory) に乗せ、テーブル別 isolation テストを必須化:

```ts
dbEffect("InvoiceService は他社 invoice を返さない", ({ factory: f }) =>
  Effect.gen(function* () {
    const a = f.invoice.create({ companyId: "cmp_aaa" });
    const b = f.invoice.create({ companyId: "cmp_bbb" });
    const svc = yield* InvoiceService;
    const res = yield* Effect.either(svc.findById(b.id)); // A context で B の id
    expect(Either.isLeft(res)).toBe(true); // InvoiceNotFound (404 相当)
  }).pipe(Effect.provide(CompanyContext.layer({ companyId: "cmp_aaa" }))),
);
```

各 scoped テーブルにつき select / update / delete の cross-company 不可視 + create の company_id 自動付与を検証。

## Sources

### 一次資料 (taimei 本体)

- `db/drizzle/schema.ts:15-111` — 既存ドメインテーブル (company_id なし、単一列 UUID PK)
- `app/services/invoice-service.ts` — 無 scope な query (IDOR 面)
- `app/services/index.ts:59-81` — `Live` runtime / `runService` / `makeNextRuntime`
- `app/lib/auth-guard.ts:28-48` — SDK guard 経由 `getSession()` / `requireSession()`
- `app/lib/data.ts` / `app/lib/actions.ts` — data fetch / mutation 呼出側
- `proxy.ts:38-66` — Next middleware (cookie 存在チェックのみ)
- `app/services/__tests__/db/effect-test-helpers.ts` / `factories` — `dbEffect` + factory (isolation テスト基盤)
- `node_modules/@taimei-code/auth-client/dist/types.d.ts:2-17` — `SessionData` (companyId 未提供、Phase 0 ブロッカーの根拠)
- `package.json:42` — `@taimei-code/auth-client: ^1.0.0`

### プロジェクト規約

- `.claude/rules/effect-patterns.md` — Service が Db を直接使用 / CompanyContext / 外部ライブラリの Service 化
- `.claude/rules/testing-strategy.md` — `dbEffect` / isolation テスト

### freee 参考調査 (社内リソース、2026-05-26)

customers の帰属モデル (案 A = per-company / company-private) と snapshot 発見の根拠:

- 顧客/取引先マスタ構造の現行例 (Slack #pangea-log、PKG-1056 PR by github bot): `useFetchCustomers`(顧客マスタ) / `useFetchPartners`(取引先マスタ) / 仕入先マスタ を会計freee API で分離取得。「各APIは事業所スコープで制限されている」= 事業所単位分離
- 取引先マスタの社横断共有は顧問関係限定 (Jira `VQX-664`「取引先マスタ権限分離」/ `US-6531` / `US-6149` ほか: アドバイザー事業所 ↔ 顧問先の権限自動付与) — taimei MVP 除外概念 (ADR-009 D3)
- 請求書とマスタの分離設計 (Confluence「2019?請求書と取引先マスタを分離 - plan」id 584843535): 取引先マスタを請求書から分離し、発行時に取引先情報をワンタイムコピー。過去 invoice がマスタ編集で遡及変更されないようにする → 本 ADR の invoice immutability 別 ADR 候補 (Phase E+) の根拠

`CompanyContext` を companyId のみにする (D2) / authorization を別層にする根拠:

- 認可は session/membership と別の専用層 (Slack #pj-従業員として利用する取引先の権限制御 by maho-togashi、取引先 controller 実例): OAuth スコープ (アプリ単位) → 403 と AclKit 権限 (ユーザーの事業所内ロール=管理者/一般/閲覧者) → 401 の 2 層。membership 由来 role は AclKit 層で消費される
- membership が持つのは「属性」(従業員 / アドバイザー) で role(権限セット)とは別概念 (Slack #team-iam-acm by hiroki-yoshida)
- RBAC 実装パターン (Slack #team-hr_integrated_master、freee-accounts PR #13451): `sekisyo.yml` 権限定義 + `PrivilegeControlService#xxx:read/:write` を controller `before_action` でチェック → 403。session 非依存の独立層
- 認可バイパスの fail-open 事例 (Jira `VULNS-389` ACL マッピング不足 / `VULNS-348` permission.yaml 設定不足 / `ZUNDA-2138` 他社履歴アクセス遮断) → 本 ADR の backstop (D4 isolation テスト + helper) が狙う失敗モードと一致

## Related ADRs

> plans/taimei の `ADR-NNN` 系列は taimei 全体 (taimei-auth 含む) のアーキ決定ログ。本 repo の `docs/adr/` は app.taimei 個別の決定。

- **taimei-auth 事業所概念 ADR (plans `ADR-009`)** — 本 ADR の trigger。taimei-auth が `company` / `membership` と SDK `companyId` を提供。本 ADR はその `companyId` を本体ドメインデータの scoping に使う consumer 側の対。§2.1 D5 / Q12 / §3.3 / §12 を本文で参照。
- **taimei-auth account 管理集約 ADR (plans `ADR-008`)** — `/account` を taimei-auth に集約した上に事業所概念を載せた前提。
- **taimei-auth SDK 統一 / framework 中立化 ADR (plans `ADR-005` / `ADR-007`)** — 本 ADR が依存する `getSession()` SDK 経路の設計元。
- **`docs/adr/0001-supply-chain-hardening.md`** — 本 repo の既存 ADR (系列の先行例)。

---

## 品質検証

- AC: 6観点 (主軸5 permission/auth_state/data_compat/caller/contract + observability) × 必須3カテゴリ + 非影響確認 4件 = 22項目定義済み → `docs/adr/0002-company-data-scoping.analysis.md`
- 技術リスク: 4件特定済み → `docs/adr/0002-company-data-scoping.analysis.md`
- MECE判定: 要修正（Critical 2件）/ ACカバレッジ 17/30 (うち[MECE追加] 8件) / 漏れ 4件 / 重複 2件 → `docs/adr/0002-company-data-scoping.analysis.md`
- review-design: 構造 reviewer 4 (fatal 0) + DA (fatal 3 → 全解消)、本文 D2/D3/D5/D6/D8/D9 + Roadmap デプロイ順序節に反映済

---

## 実装準備

> 新規セッションで実装する前提の段取り document。AC / MECE / review-design の結論は本文と `docs/adr/0002-company-data-scoping.analysis.md` を SSOT とする。

### ブランチ戦略

- base: `main`。各 PR は `feature/company-scoping-<topic>` で切る (stacked。下流は上流 PR を base にする)。
- **デプロイ順序の制約 (expand-contract)**: full 手順は §「デプロイ順序・本番運用」D-1 を参照。要点は **NOT NULL 化 + revenue unique 変更を別 PR (PR-5) に切り出し、サービス適用 PR (PR-3/4) の本番デプロイ後に push** する (migration は `drizzle/**` push で自動・即・本番適用されるため)。
- **本番リリース束ね (DA D-2)**: dev/staging は PR 段階マージ可。**本番リリースは PR-1〜6 を束ねて出す** (Phase 1 単独本番は `_invoicesTotags` の tag leak 窓を開けるため不可)。

### PR分割計画

| PR | スコープ | 主ファイル | 依存 | 備考 |
|----|----------|-----------|------|------|
| **PR-0** (Phase 0) | SDK `1.1.0` exact pin + contract test (CI 常時) | `package.json` / `bun.lock` / contract test | — | **blocking precondition**。`getSession().companyId` 型可視 + `/api/auth/get-session` に companyId を curl/Network 確認 |
| **PR-1** | schema: 全 scoped 表に `company_id varchar(32)` **nullable** + index 追加 + backfill SQL (`drizzle/manual/`) | `db/drizzle/schema.ts` / `drizzle/NNNN_*.sql` / `drizzle/manual/*.sql` | — | NOT NULL/unique 変更は含めない (PR-5 へ) |
| **PR-2** | scoping 機構 + テスト基盤 | `app/services/company-context.ts` / `db/scoped.ts` / `app/services/index.ts` (makeNextRuntime runtime 共有 + runScopedService + `AllScopedServices` 導出 + `_NoCompanyContextInLive` 番兵) / `app/lib/auth-guard.ts` (resolveCompanyIdOrRedirect + requireCompany + buildCompanySignupUrl) / 各 factory (net-new) + effect-test-helpers (CompanyContext) | PR-1 | `bun tsc --noEmit` で閉じ1 成立確認 |
| **PR-3** | invoice/customer scoping + 呼出側 + isolation テスト | `invoice-service.ts` (findById/update/delete に companyFilter、create/update に customerId 自社帰属検証) / `customer-service.ts` (findAll scope + fetchFiltered join companyFilter) / `data.ts` / `actions.ts` (runScopedService) / cross-company write 試行ログ / isolation テスト | PR-2 | CR1/CR2/IM1 |
| **PR-4** | dashboard scoping + layout | `dashboard-service.ts` (revenue/cards/latest scoped) / `app/dashboard/layout.tsx` (requireCompany) / isolation テスト (集計金額アサート) | PR-2 | overview leak 防止 |
| **PR-5** | **NOT NULL 化 + revenue unique `(company_id, month)`** | `drizzle/NNNN_*.sql` | PR-3/4 **本番デプロイ後** | expand-contract の contract 段。別 PR 必須 (D-1) |
| **PR-6** (Phase 2) | tags/tags2 scoped | `schema.ts` (tags company_id) / `tag2-service.ts` / isolation テスト | PR-2 | 本番は PR-1〜6 束ねリリース (D-2) |

PR ガイドライン (≤2 commits / ≤5 files) 超過は PR-2 (機構 + テスト基盤が密結合) のみ許容。review surface が大きければ PR-2 を「機構」と「テスト基盤」に 2 分割可。

### 手動QA手順 (Chrome DevTools MCP)

**環境**: `http://app.taimei-code.local:3001` (dev compose、taimei-auth → taimei の順。Magic Link は `docker logs <auth-service> | grep "Magic Link"`)。**2 社 (company A / B) のアカウント + 各社の invoice/customer 実 UUID** が前提 (IDOR 直打ち用、実値は QA 実行時にユーザー確認)。権限ロール差は不要 (本 ADR は RBAC 非対象)。

手動カバー (UI/redirect 実挙動、`testing-strategy.md` の「自動で書かない」領域):
- **QA-H-01** A 社 invoice のみ一覧 (B 社不含、別タブ B で対比) / **QA-H-02** 選択済 → redirect なし scoped 描画
- **QA-E-01** 他社 invoice id 直打ち `/dashboard/invoices/<B社id>/edit` → **404** (not-found ページ、403 でない) / **QA-E-02** companyId undefined → 302 → `/auth/signup/company` / **QA-E-06 (=QA-M-06)** session 無効 → SDK guard null → `/auth`
- **QA-D-01 (=QA-M-04)** create dropdown を `evaluate_script` で迂回し B 社 customerId を POST → 作成失敗 (automation 不安定時は localhost curl で Server Action POST 併用) / **QA-D-04** 2 タブ別 company → 各 request 正しい companyId / **QA-D-05** 新規 signup membership 0 → redirect
- **QA-M-01** create dropdown が自社 customer のみ (B 社顧客名が出ない) / **QA-M-05** (customers 一覧 UI 実装後) 集計 totalPaid に他社金額混入なし ※現状 `/dashboard/customers` はスタブ、UI 実装後に実施
- **QA-R-01** Magic Link 送信不変 / **QA-R-02** after-sign 着地不変 / **QA-R-03** 未認証 → `/auth` 維持

> 他社 update/delete (QA-M-03) は UI 導線が存在しない (一覧に出ず edit に入れない) ため「到達不能」を手動確認 + rows=0 の確実性は自動 QA。

### 自動QA (Vitest、テストコード仕様)

**前提 (全 isolation テストのブロッカー、PR-2)**: factory net-new (`customer`/`invoice`/`revenue`、companyId は **デフォルト無し=override 必須**) + `effect-test-helpers` は CompanyContext を**注入しない**設計 (各テストが `.pipe(Effect.provide(CompanyContext.layer({ companyId })))`、provide 漏れがコンパイルエラー=backstop)。

自動カバー (dbEffect isolation / 型 / migration SQL):
- **QA-E-04 ★** (閉じ1): `index.ts` の `_NoCompanyContextInLive` 番兵 + `bun tsc --noEmit` 緑 + `@ts-expect-error` で「scoped Service を runService に渡すと型エラー」を negative type test 固定。Live に CompanyContext を故意 merge して tsc が落ちることを 1 度確認 (Phase 1 手動チェック)
- **QA-E-01 / QA-H-01 / QA-H-04**: `invoice-service.test.ts` — 2 社 seed、A context で B invoice findById → `InvoiceNotFound`、fetchFiltered は自社のみ
- **QA-M-03 ★** (CR1): A context で B invoice を update/delete → `InvoiceNotFound` かつ `tx` 直 select で **B 行が不変** (rows=0 実証)
- **QA-M-04 / QA-D-01 ★** (CR1): A context で B 社 customerId create → 拒否 + A 社 invoice 行が作られない (cross-company 注入なし)。対の正常系: A 社 customerId なら companyId=A 自動付与
- **QA-M-01** (CR2): `customer-service.test.ts` — findAll が自社のみ / **QA-M-05** (IM1): 同名 customer を両社に置き fetchFiltered の `totalPaid===自社分のみ` (leftJoin invoices の companyFilter AND を金額アサート) + `dashboard-service.test.ts` の fetchCardData/fetchRevenue
- **QA-H-03 / QA-M-02 / QA-E-03 / QA-D-03**: `db/company-scoping-migration.test.ts` — `information_schema`/`pg_indexes`/`pg_constraint` で NOT NULL+index+backfill (NULL 0) / revenue unique が `(company_id, month)` のみ / 破壊的 DDL は一時テーブルで検証
- **QA-M-08** (IM7): create 拒否時に構造化ログ (試行 companyId / 対象 id / 経路) が console.error spy で記録される
- **QA-M-07** (Phase 2): `tag2-service.test.ts` — Phase 1 は `dbEffect.skip` で leak 窓を明示、PR-6 で有効化
- 非影響: QA-R-01/R-04 は既存 `auth-service.test.ts` pass + `bun tsc --noEmit` 緑 + `bun run test:db` 全パス

**新規/追記テストファイル**: `invoice-service.test.ts` / `customer-service.test.ts` / `dashboard-service.test.ts` (追記) / `db/company-scoping-migration.test.ts` / `no-company-context-in-live.test-d.ts` / `tag2-service.test.ts` (新規) / `factories/index.ts` / `db/effect-test-helpers.ts` (基盤修正)。

### QAカバレッジ (31 QA-ID)

- 自動: QA-E-04(★型) / QA-E-01 / QA-H-01,03,04 / QA-M-01,02,03★,04★,05,07,08 / QA-D-01,03 / QA-R-01,04 ＝ 16
- 手動: QA-H-02 / QA-E-02,06 / QA-D-02,04,05,06 / QA-M-06,09 / QA-R-02,03 / QA-M-01,05 の UI 部分 ＝ 11
- 両方 (Service=auto / 画面=manual): QA-H-04,05 / QA-D-01(=M-04) / QA-M-03 の到達不能確認 ＝ 4
- 全 31 QA-ID が手動・自動いずれか (or 両方) でカバー。0 件カテゴリなし。
