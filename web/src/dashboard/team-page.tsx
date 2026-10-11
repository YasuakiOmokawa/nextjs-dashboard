import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import {
  type ErrorComponentProps,
  Link,
  useParams,
} from "@tanstack/react-router";
import { DetailedError } from "hono/client";
import { ChevronLeft } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import {
  failureMessageOf,
  meQuery,
  saveMyLevels,
  teamQuery,
  writeSavedMyLevels,
} from "@/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import CardMessage from "@/dashboard/card-message";
import {
  levelEntriesOf,
  levelFieldName,
  levels,
  wantsToLearnFieldName,
} from "@/dashboard/level";
import {
  BIAS_RULE,
  type Cell,
  type MyLevelEntry,
  type Roster,
  type TeamDetail,
  teamSkillMatrix,
  withMyLevels,
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
    data: { team: savedTeam, members },
  } = useSuspenseQuery(teamQuery(teamId));
  const { teamWithPendingSave: team, ...myLevelsForm } = useSaveMyLevels(
    teamId,
    me.userId,
    savedTeam,
  );
  const { myCells, roster } = teamSkillMatrix(team, members, me.userId);

  return (
    <TeamFrame title={team.name}>
      <Section title="星取表">
        {roster._tag === "MatrixReady" ? (
          <SkillMatrix roster={roster} />
        ) : (
          <CardMessage>{messagesWithoutMatrix[roster._tag]}</CardMessage>
        )}
      </Section>
      <MyLevelsForm cells={myCells} {...myLevelsForm} />
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

const UNRECORDED_MARK = "—";

const symbolOrBlank = (symbol: string) => symbol || "空欄";

// 記入した値は消せない (消す API が無い) ので、未記入は記入していないスキルにだけ出す
const UNRECORDED_VALUE = "";
const unrecordedOption = (
  <option value={UNRECORDED_VALUE}>{`${UNRECORDED_MARK}: 未記入`}</option>
);

const levelOptions = Object.entries(levels).map(
  ([level, { symbol, label }]) => (
    <option key={level} value={level}>
      {`${symbolOrBlank(symbol)}: ${label}`}
    </option>
  ),
);

function MyLevelsForm({
  cells,
  saving,
  failure,
  onSave,
}: {
  cells: readonly Cell[];
  saving: boolean;
  failure: string | undefined;
  onSave: (entries: readonly MyLevelEntry[]) => void;
}) {
  if (cells.length === 0) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(levelEntriesOf(cells, new FormData(event.currentTarget)));
  };

  return (
    <Section
      title="自分のレベル"
      description="記入すると星取表の自分の行に出ます"
    >
      <form onSubmit={submit} className="space-y-4 px-6 pb-6">
        <ul className="divide-y border-y">
          {cells.map((cell) => (
            <li
              key={cell.skill.id}
              className="flex min-h-14 flex-wrap items-center gap-x-6 gap-y-2 py-2 text-sm"
            >
              <span className="min-w-32 font-medium">{cell.skill.name}</span>
              <select
                name={levelFieldName(cell.skill.id)}
                aria-label={`${cell.skill.name} のレベル`}
                defaultValue={cell.recorded ? cell.level : UNRECORDED_VALUE}
                className="rounded-md border-input font-symbol text-sm"
              >
                {cell.recorded ? null : unrecordedOption}
                {levelOptions}
              </select>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name={wantsToLearnFieldName(cell.skill.id)}
                  aria-label={`${cell.skill.name} を学びたい`}
                  defaultChecked={cell.wantsToLearn}
                  className="size-4 rounded border-input text-primary focus:ring-ring"
                />
                学びたい
              </label>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="submit" size="sm" disabled={saving}>
            保存
          </Button>
          {failure ? (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          ) : null}
        </div>
      </form>
    </Section>
  );
}

function useSaveMyLevels(
  teamId: string,
  myUserId: string,
  savedTeam: TeamDetail,
) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (entries: readonly MyLevelEntry[]) =>
      saveMyLevels(teamId, entries),
    onSuccess: (_saved, entries) =>
      writeSavedMyLevels(queryClient, teamId, myUserId, entries),
  });
  return {
    teamWithPendingSave: save.isPending
      ? withMyLevels(savedTeam, myUserId, save.variables)
      : savedTeam,
    saving: save.isPending,
    failure: save.isError ? failureMessageOf(save.error) : undefined,
    onSave: save.mutate,
  };
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

function Legend() {
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 px-6 py-4 text-xs text-muted-foreground">
      {Object.values(levels)
        .reverse()
        .map(({ symbol, label }) => (
          <span key={label}>
            <span className="font-symbol font-semibold text-foreground">
              {symbolOrBlank(symbol)}
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
