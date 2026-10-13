# components

コンポーネントの表示・スナップショット・DOM のテストは書かない。テストしたいロジックは `web/src/api.ts` の atom・hook か Service に移し、そちらを Vitest で検証する。
