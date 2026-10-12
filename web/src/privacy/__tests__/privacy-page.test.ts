import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import PrivacyPage from "../privacy-page";

const html = renderToStaticMarkup(createElement(PrivacyPage));

it("taimei のデータベースはシンガポールにあると書く", () => {
  expect(html).toContain(
    "データベース (taimei): Neon (AWS アジア太平洋・シンガポール)",
  );
});

it("ページを最後の節まで描く", () => {
  expect(html).toContain("<h1");
  expect(html).toContain(">問い合わせ先</h2>");
});

it("もう使っていない Vercel を書かない", () => {
  expect(html).not.toContain("Vercel");
});

it("アプリは Cloudflare で動くと書く", () => {
  expect(html).toContain("<li>アプリ: Cloudflare</li>");
});

it("Sentry にはエラーだけを送り、入力した内容は送らないと書く", () => {
  expect(html).toContain(
    "<li>エラーの記録: Sentry (米国)。入力した内容は送らない</li>",
  );
});

it("消した後も復元用の履歴に残る期間は、Neon の Free の上限の 6 時間と書く", () => {
  expect(html).toContain("消した後も 6 時間残ります");
});

it("もうしていない画面の操作の記録と性能の計測を書かない", () => {
  expect(html).not.toContain("画面の操作の記録");
  expect(html).not.toContain("性能の計測");
});
