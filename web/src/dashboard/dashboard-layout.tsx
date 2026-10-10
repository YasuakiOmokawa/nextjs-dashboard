import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, type LinkProps, Outlet } from "@tanstack/react-router";
import { meQuery } from "@/api";
import MyServiceName from "@/components/my-service-name";

// ponytail: 導線が header に収まらなくなったら shadcn の sidebar にする
export default function DashboardLayout() {
  const { data: me } = useSuspenseQuery(meQuery);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
          <Link to="/dashboard/teams" className="text-lg font-bold text-brand">
            <MyServiceName />
          </Link>
          <nav className="flex gap-4 text-sm font-medium">
            <NavLink to="/dashboard/teams">チーム</NavLink>
            <NavLink to="/dashboard/members">メンバー</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <span className="truncate">{me.name}</span>
            <a
              href="/auth/account"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground underline-offset-4 hover:underline"
            >
              設定
            </a>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 p-6 md:p-12">
        <Outlet />
      </main>
      <footer className="mx-auto w-full max-w-5xl px-6 py-4">
        <Link
          to="/privacy"
          className="text-xs text-muted-foreground underline underline-offset-4"
        >
          プライバシーポリシー
        </Link>
      </footer>
    </div>
  );
}

function NavLink({ to, children }: { to: LinkProps["to"]; children: string }) {
  return (
    <Link
      to={to}
      className="hover:text-foreground"
      activeProps={{ className: "text-foreground" }}
      inactiveProps={{ className: "text-muted-foreground" }}
    >
      {children}
    </Link>
  );
}

export function DashboardError() {
  return (
    <main className="mx-auto max-w-5xl p-6 text-sm text-muted-foreground md:p-12">
      画面を読み込めませんでした
    </main>
  );
}
