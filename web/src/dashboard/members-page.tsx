import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { membersAtom, useLoadedValue } from "@/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import CardMessage from "@/dashboard/card-message";

// taimei-auth の画面と同じ表示名
const roleLabels = { OWNER: "オーナー", ADMIN: "管理者", MEMBER: "メンバー" };

export default function MembersPage() {
  const { members } = useLoadedValue(membersAtom);

  return (
    <MembersFrame>
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th scope="col" className="px-6 py-3 font-medium">
                名前
              </th>
              <th scope="col" className="py-3 font-medium">
                メールアドレス
              </th>
              <th scope="col" className="px-6 py-3 font-medium">
                役割
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {members.map((member) => (
              <tr key={member.email}>
                <td className="px-6 py-4 font-medium">{member.name}</td>
                <td className="py-4 text-muted-foreground">{member.email}</td>
                <td className="px-6 py-4">
                  {member.role ? roleLabels[member.role] : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </MembersFrame>
  );
}

export function MembersError() {
  return (
    <MembersFrame>
      <CardMessage>メンバー一覧を取得できませんでした</CardMessage>
    </MembersFrame>
  );
}

function MembersFrame({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">メンバー</h1>
          <p className="text-sm text-muted-foreground">
            事業所に所属している人です。チームへの割り当てはチームの画面で行います
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a
            href="/auth/account/members"
            target="_blank"
            rel="noopener noreferrer"
          >
            メンバーを招待
            <ExternalLink aria-hidden="true" />
            <span className="sr-only">(新しいタブで開きます)</span>
          </a>
        </Button>
      </div>
      <Card className="overflow-hidden">{children}</Card>
    </div>
  );
}
