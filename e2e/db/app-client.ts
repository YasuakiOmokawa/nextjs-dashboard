import { Pool } from "pg";

// taimei の DB (e2e では superuser で接続し、RLS を通らない)。チーム・スキル・割り当て・記入の画面 (#583〜#585) の代わりに直に入れる
const appDb = new Pool({ connectionString: process.env.APP_DATABASE_URL });

export const insertTeam = async (companyId: string, name: string) => {
  const { rows } = await appDb.query<{ id: string }>(
    "INSERT INTO teams (company_id, name) VALUES ($1, $2) RETURNING id",
    [companyId, name],
  );
  return rows[0].id;
};

export const insertSkill = async (
  companyId: string,
  teamId: string,
  name: string,
) => {
  const { rows } = await appDb.query<{ id: string }>(
    "INSERT INTO skills (company_id, team_id, name) VALUES ($1, $2, $3) RETURNING id",
    [companyId, teamId, name],
  );
  return rows[0].id;
};

export const assignMember = (
  companyId: string,
  teamId: string,
  userId: string,
) =>
  appDb.query(
    "INSERT INTO team_assignments (company_id, team_id, user_id) VALUES ($1, $2, $3)",
    [companyId, teamId, userId],
  );

export const insertLevel = (
  companyId: string,
  teamId: string,
  skillId: string,
  userId: string,
  level: number,
) =>
  appDb.query(
    "INSERT INTO member_skills (company_id, team_id, skill_id, user_id, level, wants_to_learn) VALUES ($1, $2, $3, $4, $5, false)",
    [companyId, teamId, skillId, userId, level],
  );
