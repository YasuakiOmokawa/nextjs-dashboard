-- 一覧の読み取りを事業所ごとの DO に写すための、版つきの一覧 (docs/adr/0008)
CREATE FUNCTION "company_team_list"(p_company_id varchar)
RETURNS json LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.company_id', p_company_id, true);
  RETURN (
    SELECT json_build_object(
      'version', COALESCE((
        SELECT v.version FROM company_team_list_versions v WHERE v.company_id = p_company_id
      ), 0),
      'teams', COALESCE((
        SELECT json_agg(
          json_build_object(
            'id', t.id,
            'name', t.name,
            'assignedUserIds', COALESCE((
              SELECT json_agg(a.user_id ORDER BY a.user_id)
              FROM team_assignments a
              WHERE a.team_id = t.id AND a.company_id = p_company_id
            ), '[]')
          )
          ORDER BY t.created_at, t.id
        )
        FROM teams t
        WHERE t.company_id = p_company_id
      ), '[]')
    )
  );
END $$;
--> statement-breakpoint
CREATE FUNCTION "bump_company_team_list"(p_company_id varchar)
RETURNS json LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.company_id', p_company_id, true);
  -- 1 文にすると、前の書き込みの commit を待つ前の snapshot で一覧を読み、新しい版に古い一覧が付く
  INSERT INTO company_team_list_versions AS v (company_id, version) VALUES (p_company_id, 1)
  ON CONFLICT (company_id) DO UPDATE SET version = v.version + 1;
  RETURN company_team_list(p_company_id);
END $$;
