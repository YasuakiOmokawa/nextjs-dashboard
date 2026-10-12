import { privacyFacts } from "./facts";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-12">
      <h1 className="font-lusitana text-2xl md:text-3xl">
        プライバシーポリシー
      </h1>
      <Section title="預かる情報">
        <p>
          認証 (taimei-auth)
          は、名前・メールアドレスと、所属する事業所での役割を預かります。taimei
          は事業所ごとに、チーム・スキル・チームへの割り当てと、各メンバーが自分について記入したレベルと学びたいを預かります。
        </p>
      </Section>
      <Section title="使い道">
        <p>
          星取表と、チームとしての集計 (偏り、スキルごとの学びたいの人数)
          の表示だけに使います。レベルと学びたいを、人の評価・ランキング・エクスポートに使いません。人ごとの合計も作りません。
        </p>
      </Section>
      <Section title="見える人">
        <p>
          星取表を見られるのは、同じ事業所の管理者 (OWNER・ADMIN)
          と、そのチームに割り当てられたメンバーです。レベルと学びたいを書けるのは本人だけで、管理者も他人の行を書き換えられません。ほかの事業所からは見えません。
        </p>
      </Section>
      <Section title="保存場所">
        <ul className="list-disc space-y-1 pl-6">
          <li>データベース (taimei): Neon ({privacyFacts.databaseRegion})</li>
          <li>データベース (認証): Neon ({privacyFacts.authDatabaseRegion})</li>
          <li>アプリ: Cloudflare</li>
          <li>認証: Cloudflare</li>
          <li>メールの送信: Resend</li>
          <li>エラーの記録: Sentry (米国)。入力した内容は送らない</li>
        </ul>
      </Section>
      <Section title="消す時期">
        <p>
          除名・退会・事業所の削除の後、1 時間ごとの処理で、taimei
          にあるその人・その事業所のデータを物理削除します
          (通常は数時間以内)。データベースの復元用の履歴には、消した後も{" "}
          {privacyFacts.backupRetention}
          残ります。チーム・スキル・割り当てを消した時は、そこに記入したレベルと学びたいもすぐに消えます。
        </p>
      </Section>
      <Section title="問い合わせ先">
        <p>{privacyFacts.contact}</p>
      </Section>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}
