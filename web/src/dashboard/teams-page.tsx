import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  createTeam,
  markTeamListStaleWithoutRefetch,
  meQuery,
  teamsQuery,
} from "@/api";
import { Card } from "@/components/ui/card";
import CardMessage from "@/dashboard/card-message";
import NameForm from "@/dashboard/name-form";

export default function TeamsPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const {
    data: { teams },
  } = useSuspenseQuery(teamsQuery);

  return (
    <TeamsFrame>
      <CreateTeamForm canManage={me.canManage} />
      {teams.length === 0 ? (
        <CardMessage>
          {me.canManage
            ? "まだチームがありません。チームを作ると、スキルを足してメンバーを割り当てられます"
            : "まだどのチームにも割り当てられていません。管理者に割り当てを頼んでください"}
        </CardMessage>
      ) : (
        <ul className="divide-y">
          {teams.map((team) => (
            <li key={team.id}>
              <Link
                to="/dashboard/teams/$teamId"
                params={{ teamId: team.id }}
                className="block px-6 py-4 text-sm font-medium hover:bg-muted/50"
              >
                {team.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </TeamsFrame>
  );
}

function CreateTeamForm({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: createTeam,
    onSuccess: async ({ id }) => {
      await markTeamListStaleWithoutRefetch(queryClient);
      await navigate({
        to: "/dashboard/teams/$teamId",
        params: { teamId: id },
      });
    },
  });
  if (!canManage) return null;

  return (
    <div className="border-b p-6">
      <NameForm
        label="チーム名"
        submitLabel="チームを作る"
        pending={create.isPending}
        error={create.error}
        fallbackMessage="チームを作れませんでした"
        onSubmit={create.mutate}
      />
    </div>
  );
}

export function TeamsError() {
  return (
    <TeamsFrame>
      <CardMessage>チームを取得できませんでした</CardMessage>
    </TeamsFrame>
  );
}

function TeamsFrame({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">チーム</h1>
        <p className="text-sm text-muted-foreground">
          チームを開くと、星取表を見て自分のレベルを記入できます
        </p>
      </div>
      <Card className="overflow-hidden">{children}</Card>
    </div>
  );
}
