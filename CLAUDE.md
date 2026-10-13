# taimei

## Effect

Effect の書き方 (Service・Layer・エラー・テスト) は `node_modules/effect/AGENTS.md` に従い、CLAUDE.md には書かない。書く前に AGENTS.md を最後まで読み、書く API に関わるリンク先を辿る (v4 の API は学習データの v3 と違う)。そこに無い API は `node_modules/effect/src` を検索する。

## Gotcha

- 型チェックは `bun run typecheck`。bare の `tsc` は `web/` も Effect の診断も検査しない。
- `bun vitest run <file>` の前に `docker compose up -d test_db --wait` が要る。全件は `bun run test:db`。
- Stacked PR の上流は `--delete-branch` なしでマージする。付けると下流 PR が auto-close され reopen できない。ブランチは下流のマージ後に消す。
- e2e の流し方と、手元で taimei-auth と一緒に配信して画面を確かめる手順は `e2e/CLAUDE.md`。
- 既存の写像や規則を変える前に、`git log -S '<識別子>'` で入れた PR の commit の本文を読む。理由と、それと引き換えにしたものが書いてある。
- `bun run lint` の `fallow audit` は変更した関数の CRAP を見る。tag ごとに分ける処理は `switch` ではなく `Match.valueTags` の表にする。
