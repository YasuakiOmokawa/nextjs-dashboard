# components

コンポーネントの表示・スナップショット・DOM のテストは書かない。テストしたいロジックは `web/src/api.ts` の atom・hook か、描画から切り離した module (`web/src/dashboard/level.ts` など) に移し、そちらを Vitest で検証する。
