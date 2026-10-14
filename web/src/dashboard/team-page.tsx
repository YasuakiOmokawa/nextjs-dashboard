import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ComponentProps, FormEvent, ReactNode, SubmitEvent } from "react";
import {
  addSkill,
  assignMember,
  deleteTeam,
  failureMessageOf,
  meAtom,
  removeSkill,
  renameTeam,
  type ShownFailure,
  teamAtom,
  unassignMember,
  useApiMutation,
  useLoadedValue,
  useLoadFailure,
  useSaveMyLevels,
} from "@/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import CardMessage from "@/dashboard/card-message";
import FailureAlert from "@/dashboard/failure-alert";
import {
  levelEntriesOf,
  levelFieldName,
  levels,
  wantsToLearnFieldName,
} from "@/dashboard/level";
import NameForm from "@/dashboard/name-form";
import {
  BIAS_RULE,
  type Cell,
  type Member,
  type MyLevelEntry,
  type Roster,
  type TeamDetail,
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
  const me = useLoadedValue(meAtom);
  const { team: savedTeam, members } = useLoadedValue(teamAtom(teamId));
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
        <SkillsSection
          teamId={teamId}
          skills={team.skills}
          canManage={me.canManage}
        />
        <AssignmentsSection
          teamId={teamId}
          roster={roster}
          canManage={me.canManage}
        />
      </div>
      <TeamNameAndDeletion
        teamId={teamId}
        team={team}
        canManage={me.canManage}
      />
    </TeamFrame>
  );
}

function SkillsSection({
  teamId,
  skills,
  canManage,
}: {
  teamId: string;
  skills: TeamDetail["skills"];
  canManage: boolean;
}) {
  const add = useApiMutation(addSkill(teamId));
  const remove = useApiMutation(removeSkill(teamId));

  return (
    <Section title="スキル" description="星取表の列になります">
      <NameList
        items={skills.map(({ id, name }) => ({
          key: id,
          name,
          action: canManage ? (
            <ConfirmedRemoveButton
              label="削除"
              itemName={name}
              warning={`スキル「${name}」を削除します。このスキルに記入したレベルも消え、元に戻せません。`}
              disabled={remove.isPending}
              onConfirm={() => remove.mutate(id)}
            />
          ) : null,
        }))}
        empty="スキルがありません"
      />
      {canManage ? (
        <div className="space-y-2 border-t px-6 py-4">
          <FailureAlert
            failure={remove.failure}
            fallbackMessage="スキルを削除できませんでした"
          />
          <NameForm
            label="スキル名"
            submitLabel="スキルを足す"
            pending={add.isPending}
            failure={add.failure}
            fallbackMessage="スキルを足せませんでした"
            onSubmit={add.mutate}
          />
        </div>
      ) : null}
    </Section>
  );
}

const unassignWarning = (who: string) =>
  `${who} をこのチームから外します。このチームに記入したレベルも消え、元に戻せません。`;

function AssignmentsSection({
  teamId,
  roster,
  canManage,
}: {
  teamId: string;
  roster: Roster;
  canManage: boolean;
}) {
  const unassign = useApiMutation(unassignMember(teamId));
  const assignedItem = (userId: string, name: string) => ({
    key: userId,
    name,
    action: canManage ? (
      <ConfirmedRemoveButton
        label="外す"
        itemName={name}
        warning={unassignWarning(name)}
        disabled={unassign.isPending}
        onConfirm={() => unassign.mutate(userId)}
      />
    ) : null,
  });

  return (
    <Section title="割り当てたメンバー" description="星取表の行になります">
      {roster._tag === "MembersUnavailable" ? (
        <CardMessage>{messagesWithoutMatrix.MembersUnavailable}</CardMessage>
      ) : (
        <>
          <NameList
            items={roster.assigned.map(({ userId, name }) =>
              assignedItem(userId, name),
            )}
            empty="割り当てたメンバーがいません"
          />
          {canManage ? (
            <>
              <DepartedAssignments
                items={roster.departedUserIds.map((userId) =>
                  assignedItem(userId, userId),
                )}
              />
              <AssignmentFooter
                teamId={teamId}
                candidates={roster.candidates}
                unassignFailure={unassign.failure}
              />
            </>
          ) : null}
        </>
      )}
    </Section>
  );
}

function AssignmentFooter({
  teamId,
  candidates,
  unassignFailure,
}: {
  teamId: string;
  candidates: readonly Member[];
  unassignFailure: ShownFailure | undefined;
}) {
  if (candidates.length === 0 && !unassignFailure) return null;
  return (
    <div className="space-y-2 border-t px-6 py-4">
      <FailureAlert
        failure={unassignFailure}
        fallbackMessage="外せませんでした"
      />
      <AssignForm teamId={teamId} candidates={candidates} />
    </div>
  );
}

function DepartedAssignments({
  items,
}: {
  items: ComponentProps<typeof NameList>["items"];
}) {
  if (items.length === 0) return null;
  return (
    <>
      <h3 className="border-t px-6 pt-4 pb-2 text-sm font-medium">
        事業所にいない人の割り当て
      </h3>
      <NameList items={items} />
    </>
  );
}

function AssignForm({
  teamId,
  candidates,
}: {
  teamId: string;
  candidates: readonly Member[];
}) {
  const assign = useApiMutation(assignMember(teamId));
  if (candidates.length === 0) return null;

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const userId = new FormData(event.currentTarget).get("userId");
    if (typeof userId === "string") assign.mutate(userId);
  };

  return (
    <form onSubmit={submit} className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <select
          name="userId"
          aria-label="割り当てるメンバー"
          required
          className="w-full max-w-xs rounded-md border-input text-sm"
        >
          {candidates.map(({ userId, name }) => (
            <option key={userId} value={userId}>
              {name}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" disabled={assign.isPending}>
          割り当てる
        </Button>
      </div>
      <FailureAlert
        failure={assign.failure}
        fallbackMessage="割り当てられませんでした"
      />
    </form>
  );
}

function ConfirmedRemoveButton({
  label,
  itemName,
  warning,
  disabled,
  onConfirm,
}: {
  label: string;
  itemName?: string;
  warning: string;
  disabled: boolean;
  onConfirm: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-label={itemName ? `${itemName} を${label}` : undefined}
      disabled={disabled}
      onClick={() => {
        if (window.confirm(warning)) onConfirm();
      }}
      className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
    >
      {label}
    </Button>
  );
}

function TeamNameAndDeletion({
  teamId,
  team,
  canManage,
}: {
  teamId: string;
  team: TeamDetail;
  canManage: boolean;
}) {
  const navigate = useNavigate();
  const rename = useApiMutation(renameTeam(teamId));
  const remove = useApiMutation(deleteTeam(teamId), {
    onSuccess: () => navigate({ to: "/dashboard/teams" }),
  });
  if (!canManage) return null;

  return (
    <Section title="チーム名">
      <div className="px-6 pb-6">
        <NameForm
          key={team.name}
          label="チーム名"
          defaultValue={team.name}
          submitLabel="名前を変える"
          pending={rename.isPending}
          failure={rename.failure}
          fallbackMessage="名前を変えられませんでした"
          onSubmit={rename.mutate}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t px-6 py-4">
        <p className="text-sm text-muted-foreground">
          チームを削除すると、スキル・割り当て・記入したレベルも消えます
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <FailureAlert
            failure={remove.failure}
            fallbackMessage="チームを削除できませんでした"
          />
          <ConfirmedRemoveButton
            label="チームを削除"
            warning={`「${team.name}」を削除します。スキル・割り当て・記入したレベルも消え、元に戻せません。`}
            disabled={remove.isPending}
            onConfirm={() => remove.mutate()}
          />
        </div>
      </div>
    </Section>
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
  failure: ShownFailure | undefined;
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
          <FailureAlert
            failure={failure}
            fallbackMessage="保存できませんでした"
          />
        </div>
      </form>
    </Section>
  );
}

export function TeamError() {
  const { teamId } = useParams({ from: "/dashboard/teams/$teamId" });
  const failure = useLoadFailure(teamAtom(teamId));
  return (
    <TeamFrame>
      <Card>
        <CardMessage>
          {failureMessageOf(failure, "チームを取得できませんでした")}
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
  items: readonly { key: string; name: string; action?: ReactNode }[];
  empty?: string;
}) {
  if (items.length === 0)
    return empty ? <CardMessage>{empty}</CardMessage> : null;
  return (
    <ul className="divide-y border-t">
      {items.map(({ key, name, action }) => (
        <li
          key={key}
          className="flex min-h-12 items-center justify-between gap-4 px-6 py-3 text-sm"
        >
          <span className="min-w-0 break-words">{name}</span>
          {action}
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
