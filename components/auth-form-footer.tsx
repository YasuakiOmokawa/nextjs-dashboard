import Link from "next/link";

export default function AuthFormFooter() {
  return (
    <div className="text-balance text-center text-xs text-muted-foreground [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:text-primary  ">
      登録またはログインすることで、<Link href="#">利用規約</Link>または
      <Link href="#">プライバシーポリシー</Link>に同意したものとみなします。
    </div>
  );
}
