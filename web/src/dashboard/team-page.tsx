import { useSuspenseQuery } from "@tanstack/react-query";
import {
  type ErrorComponentProps,
  Link,
  useParams,
} from "@tanstack/react-router";
import { DetailedError } from "hono/client";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { meQuery, teamQuery } from "@/api";
import { Card } from "@/components/ui/card";
import CardMessage from "@/dashboard/card-message";
import { levels } from "@/dashboard/level";
import {
  BIAS_RULE,
  type Cell,
  type Roster,
  teamSkillMatrix,
} from "@/dashboard/skill-matrix";

type ReadyRoster = Extract<Roster, { _tag: "MatrixReady" }>;

const messagesWithoutMatrix: Record<
  Exclude<Roster["_tag"], "MatrixReady">,
  string
> = {
  MembersUnavailable: "メンバー一覧を取得できませんでした",
  MatrixIncomplete:
    "下のスキルを足してメンバーを割り当てると、ここに星取表が出ます",
};

export default function TeamPage() {
  const { teamId } = useParams({ from: "/dashboard/teams/$teamId" });
  const { data: me } = useSuspenseQuery(meQuery);
  const {
    data: { team, members },
  } = useSuspenseQuery(teamQuery(teamId));
  const { roster } = teamSkillMatrix(team, members, me.userId);

  return (
    <TeamFrame title={team.name}>
      <Section title="星取表">
        {roster._tag === "MatrixReady" ? (
          <SkillMatrix roster={roster} />
        ) : (
          <CardMessage>{messagesWithoutMatrix[roster._tag]}</CardMessage>
        )}
      </Section>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Section title="スキル" description="星取表の列になります">
          <NameList
            items={team.skills.map(({ id, name }) => ({ key: id, name }))}
            empty="スキルがありません"
          />
        </Section>
        <Section title="割り当てたメンバー" description="星取表の行になります">
          {roster._tag === "MembersUnavailable" ? (
            <CardMessage>
              {messagesWithoutMatrix.MembersUnavailable}
            </CardMessage>
          ) : (
            <NameList
              items={roster.assigned.map(({ userId, name }) => ({
                key: userId,
                name,
              }))}
              empty="割り当てたメンバーがいません"
            />
          )}
        </Section>
      </div>
    </TeamFrame>
  );
}

export function TeamError({ error }: ErrorComponentProps) {
  const notFound = error instanceof DetailedError && error.statusCode === 404;
  return (
    <TeamFrame>
      <Card>
        <CardMessage>
          {notFound ? "チームが見つかりません" : "チームを取得できませんでした"}
        </CardMessage>
      </Card>
    </TeamFrame>
  );
}

function TeamFrame({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          to="/dashboard/teams"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          チーム
        </Link>
        {title ? <h1 className="text-2xl font-semibold">{title}</h1> : null}
      </div>
      {children}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="space-y-1 p-6 pb-4">
        <h2 className="font-semibold">{title}</h2>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </Card>
  );
}

function NameList({
  items,
  empty,
}: {
  items: readonly { key: string; name: string }[];
  empty: string;
}) {
  if (items.length === 0) return <CardMessage>{empty}</CardMessage>;
  return (
    <ul className="divide-y border-t">
      {items.map(({ key, name }) => (
        <li key={key} className="px-6 py-3 text-sm">
          {name}
        </li>
      ))}
    </ul>
  );
}

function SkillMatrix({ roster }: { roster: ReadyRoster }) {
  return (
    <>
      <div className="overflow-x-auto border-y">
        <table className="whitespace-nowrap text-sm">
          <thead className="border-b text-muted-foreground">
            <tr>
              <th
                scope="col"
                className="min-w-48 px-6 py-3 text-left font-medium"
              >
                メンバー
              </th>
              {roster.summaries.map(({ skill }) => (
                <th
                  key={skill.id}
                  scope="col"
                  className="min-w-28 px-3 py-3 text-center font-medium"
                >
                  {skill.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {roster.rows.map(({ member, cells }) => (
              <tr key={member.userId}>
                <th scope="row" className="px-6 py-3 text-left font-normal">
                  {member.name}
                </th>
                {cells.map((cell) => (
                  <td key={cell.skill.id} className="px-3 py-3 text-center">
                    <CellContent cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <SummaryRows summaries={roster.summaries} />
        </table>
      </div>
      <Legend />
    </>
  );
}

function SummaryRows({ summaries }: { summaries: ReadyRoster["summaries"] }) {
  return (
    <tfoot className="border-t">
      <tr>
        <th scope="row" className="px-6 py-3 text-left font-medium">
          偏り
        </th>
        {summaries.map((summary) => (
          <td key={summary.skill.id} className="px-3 py-3 text-center">
            {summary.isBiased ? (
              <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
                偏り
              </span>
            ) : null}
          </td>
        ))}
      </tr>
      <tr>
        <th scope="row" className="px-6 py-3 text-left font-medium">
          学びたい
        </th>
        {summaries.map((summary) => (
          <td
            key={summary.skill.id}
            className="px-3 py-3 text-center tabular-nums"
          >
            {summary.wantsToLearnCount}
          </td>
        ))}
      </tr>
    </tfoot>
  );
}

const UNRECORDED_MARK = "—";

function Legend() {
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 px-6 py-4 text-xs text-muted-foreground">
      {Object.values(levels)
        .reverse()
        .map(({ symbol, label }) => (
          <span key={label}>
            <span className="font-symbol font-semibold text-foreground">
              {symbol || "空欄"}
            </span>{" "}
            {label}
          </span>
        ))}
      <span>
        <span className="font-semibold text-foreground">{UNRECORDED_MARK}</span>{" "}
        未記入
      </span>
      <span>
        <span className="font-semibold text-foreground">学</span> 学びたい
      </span>
      <span>
        <span className="font-semibold text-foreground">偏り</span>{" "}
        {levels[BIAS_RULE.atOrAboveLevel].label}以上の人が{" "}
        {BIAS_RULE.atMostPeople} 人以下
      </span>
    </p>
  );
}

function CellContent({ cell }: { cell: Cell }) {
  if (!cell.recorded)
    return (
      <>
        <span aria-hidden="true" className="text-muted-foreground">
          {UNRECORDED_MARK}
        </span>
        <span className="sr-only">未記入</span>
      </>
    );
  return (
    <>
      <span aria-hidden="true" className="inline-flex items-center gap-1">
        <span className="font-symbol text-lg leading-none">
          {levels[cell.level].symbol}
        </span>
        {cell.wantsToLearn ? (
          <span className="rounded-md bg-secondary px-1.5 text-xs font-semibold">
            学
          </span>
        ) : null}
      </span>
      <span className="sr-only">
        {levels[cell.level].label}
        {cell.wantsToLearn ? "、学びたい" : ""}
      </span>
    </>
  );
}
