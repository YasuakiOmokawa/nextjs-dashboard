# taimei

## Effect

Effect の書き方 (Service・Layer・エラー・テスト) は `node_modules/effect/AGENTS.md` に従い、CLAUDE.md には書かない。書く前に AGENTS.md を最後まで読み、書く API に関わるリンク先を辿る (v4 の API は学習データの v3 と違う)。そこに無い API は `node_modules/effect/src` を検索する。

## 確かめ方

- 規約の多くは型・lint・テストが止め、その文言と試験名が直し方を書く。CLAUDE.md に無い規約は、落ちた時の文言を読んで直す。
- 終える前に `bun run typecheck`・`bun run lint`・`bun run test:db` を通す。bare の `tsc` は `web/` と Effect の診断を見ず、`vitest` は `@ts-expect-error` で書いた型の試験を見ない。
- e2e の流し方と、手元で taimei-auth と一緒に配信して画面を確かめる手順は `e2e/CLAUDE.md`。

## Gotcha

- Stacked PR の上流は `--delete-branch` なしでマージする。付けると下流 PR が auto-close され reopen できない。ブランチは下流のマージ後に消す。
- 既存の写像や規則を変える前に、`git log -S '<識別子>'` で入れた PR の commit の本文を読む。理由と、それと引き換えにしたものが書いてある。
