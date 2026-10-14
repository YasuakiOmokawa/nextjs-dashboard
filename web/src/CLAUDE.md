# web/src

- 画面のデータは `web/src/api.ts` の atom と hook だけで読み書きする。読み取りは route の loader が `loadAtom` で待ち、画面が `useLoadedValue` で値を、`errorComponent` が `useLoadFailure` で失敗を読む。書き込みは `api.ts` に更新の定義 (`apiMutation` に送る処理と、何を変えたかの宣言 `changed`) を足し、画面は `useApiMutation` で流す。成功の後にどの atom を古くするかは `changed` の variant から `refreshAfter` が導く。
