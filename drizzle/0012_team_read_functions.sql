-- 画面の読み取りを 1 つの SQL 文にする (Workers から DB への往復は 1 文あたり約 75 ms)
CREATE FUNCTION "team_visible_to"(p_company_id varchar, p_team_id uuid, p_user_id text, p_is_manager boolean)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p_is_manager OR EXISTS (
    SELECT 1 FROM team_assignments a
    WHERE a.team_id = p_team_id AND a.user_id = p_user_id AND a.company_id = p_company_id
  )
$$;
--> statement-breakpoint
CREATE FUNCTION "team_matrix"(p_company_id varchar, p_team_id uuid, p_user_id text, p_is_manager boolean)
RETURNS json LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.company_id', p_company_id, true);
  RETURN (
    SELECT json_build_object(
      'id', t.id,
      'name', t.name,
      'skills', COALESCE((
        SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.created_at, s.id)
        FROM skills s
        WHERE s.team_id = t.id AND s.company_id = p_company_id
      ), '[]'),
      'assignedUserIds', COALESCE((
        SELECT json_agg(a.user_id ORDER BY a.user_id)
        FROM team_assignments a
        WHERE a.team_id = t.id AND a.company_id = p_company_id
      ), '[]'),
      'levels', COALESCE((
        SELECT json_agg(
          json_build_object('userId', m.user_id, 'skillId', m.skill_id, 'level', m.level, 'wantsToLearn', m.wants_to_learn)
          ORDER BY m.user_id, m.skill_id
        )
        FROM member_skills m
        WHERE m.team_id = t.id AND m.company_id = p_company_id
      ), '[]')
    )
    FROM teams t
    WHERE t.id = p_team_id AND t.company_id = p_company_id
      AND team_visible_to(p_company_id, t.id, p_user_id, p_is_manager)
  );
END $$;
--> statement-breakpoint
CREATE FUNCTION "team_list"(p_company_id varchar, p_user_id text, p_is_manager boolean)
RETURNS json LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.company_id', p_company_id, true);
  RETURN COALESCE((
    SELECT json_agg(json_build_object('id', t.id, 'name', t.name) ORDER BY t.created_at, t.id)
    FROM teams t
    WHERE t.company_id = p_company_id
      AND team_visible_to(p_company_id, t.id, p_user_id, p_is_manager)
  ), '[]');
END $$;
