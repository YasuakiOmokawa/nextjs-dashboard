CREATE TABLE "company_team_list_versions" (
	"company_id" varchar(32) PRIMARY KEY NOT NULL,
	"version" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_team_list_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "company_isolation" ON "company_team_list_versions" AS PERMISSIVE FOR ALL TO public USING ("company_team_list_versions"."company_id" = current_setting('app.company_id', true)) WITH CHECK ("company_team_list_versions"."company_id" = current_setting('app.company_id', true));