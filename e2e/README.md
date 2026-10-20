# E2E テスト

Playwright + Docker Compose で taimei + taimei-auth (認証サーバー) を統合的に検証する。

## 構成

```
docker-compose.e2e.yml
├── include: SDK の compose の断片 (taimei-auth と auth の DB。設定は taimei-auth.env)
│   └── taimei-auth     (port 3100, alias: auth.taimei-code.local)
├── e2e-postgres        (taimei DB, port 5433)
├── e2e-application     (taimei の SPA と Worker を wrangler dev で配る, port 3001, alias: app.taimei-code.local)
└── e2e                 (Playwright runner。root の SDK を read-only で mount する)
```

host には port を公開しない (Playwright UI の 9323 のみ) ので、dev 環境の compose と並行して動かせる。すべて compose の project の `default` network 内で `app/auth.taimei-code.local` を network alias で解決する。Cookie domain `.taimei-code.local` で cross-subdomain SSO を成立させる。

## 前提

### 1. `NPM_TOKEN`

`@taimei-code/auth-client` (GitHub Packages, private) を image の build と root の `bun install` で取得するため `read:packages` 権限を持つ GitHub PAT が必要。プロジェクトルート `.env` に書いておけば docker compose が自動読み込み。

### 2. taimei-auth

`docker-compose.e2e.yml` は root の `node_modules` にある `@taimei-code/auth-client` の compose の断片を `include:` し、taimei-auth に渡す値は `taimei-auth.env` に書く。taimei-auth を上げるのは root の SDK の版上げだけ (ADR-0009)。compose の前に次を済ませる。

- root で `bun install` する
- `/opt/homebrew/bin/gh auth token | docker login ghcr.io -u <GitHub の user> --password-stdin` する。断片の image は private
- 断片の image は linux/amd64 だけで、arm64 の host では emulation で動く

### 3. TLS 復号 proxy 配下の場合

proxy の CA を `certs/palo-root.pem` に置く (gitignore 済み)。無いと image build 中の `bun install` / `npm ci` が `SELF_SIGNED_CERT_IN_CHAIN` で落ちる。

## 実行

### 全テスト実行

```bash
E2E_SERVICE_COMMAND='npm test' \
  docker compose -p taimei-e2e -f docker-compose.e2e.yml \
  up --build --abort-on-container-exit --exit-code-from e2e
```

`-p taimei-e2e` は dev compose (`docker-compose.yml`) と project / volume / network を分離するため必須。

### 特定 spec のみ実行 (高速)

```bash
E2E_SERVICE_COMMAND='npx playwright test --grep "プライバシーポリシー" --reporter=line --retries=0' \
  docker compose -p taimei-e2e -f docker-compose.e2e.yml \
  up --build --abort-on-container-exit --exit-code-from e2e
```

### Cleanup

```bash
docker compose -p taimei-e2e -f docker-compose.e2e.yml down
```

`--volumes` を付けると `pg-data` も削除される (DB を完全リセットしたい時)。taimei-auth の DB は毎回空から始まる。

## ログの確認

### Playwright HTML report

`./playwright-report/index.html` (test 結果)
`./test-results/<test-name>/error-context.md` + `trace.zip` (失敗時の DOM snapshot / 再生)

## test 構成

| spec | 内容 |
|------|------|
| `public.spec.ts` | 公開ページ (`/`・`/privacy`) の表示と遷移。hydrate の食い違いを含め、console の error が 0 件 |
| `auth.spec.ts` | 未ログインの誘導、ランディングページのログイン、事業所の登録を経てチーム一覧に戻ること |
| `teams.spec.ts` | チーム一覧、他の事業所のチームが出ないこと (画面と API)、事業所の切り替え、空と失敗の表示、JS が描く前にランディングページを見せないこと |

## ローカル開発時の動作確認 (e2e と別)

実際にブラウザで認証フローを動かす場合は **dev compose (`docker-compose.yml`)** を使う。詳細は project ルートの `README.md` 参照。
