# src/lib

失敗の文言・API の状態コード・報告するかどうかは `team-failure.ts` の表が tag ごとに決め、`failureMessage`・`failureStatus` で引く (表に tag を足す手順は `src/services/CLAUDE.md`)。予期しない失敗は `reportUnexpectedFailure` で 1 回だけ報告する。

報告は `report-error.ts` の `reportError` を通す。`console.error` に出し、Worker の入口 (`src/worker.ts`) が登録した送り先 (Sentry) にも渡す。Sentry の SDK を import できるのは `src/worker.ts` だけで、`biome.json` の `noRestrictedImports` が止める。利用者の入力 (書き込みの body、SQL の params) は Sentry に送らない。落とすのは `src/worker.ts` の `sentryOptions` で、手で報告した失敗も SDK が拾った例外もそこを通る。
