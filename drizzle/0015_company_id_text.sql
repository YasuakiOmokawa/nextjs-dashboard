DROP POLICY "company_isolation" ON "company_team_list_versions";--> statement-breakpoint
DROP POLICY "company_isolation" ON "member_skills";--> statement-breakpoint
DROP POLICY "company_isolation" ON "skills";--> statement-breakpoint
DROP POLICY "company_isolation" ON "team_assignments";--> statement-breakpoint
DROP POLICY "company_isolation" ON "teams";--> statement-breakpoint
ALTER TABLE "company_team_list_versions" ALTER COLUMN "company_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "member_skills" ALTER COLUMN "company_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "skills" ALTER COLUMN "company_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "team_assignments" ALTER COLUMN "company_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "company_id" SET DATA TYPE text;--> statement-breakpoint
CREATE POLICY "company_isolation" ON "company_team_list_versions" AS PERMISSIVE FOR ALL TO public USING ("company_team_list_versions"."company_id" = current_setting('app.company_id', true)) WITH CHECK ("company_team_list_versions"."company_id" = current_setting('app.company_id', true));--> statement-breakpoint
CREATE POLICY "company_isolation" ON "member_skills" AS PERMISSIVE FOR ALL TO public USING ("member_skills"."company_id" = current_setting('app.company_id', true)) WITH CHECK ("member_skills"."company_id" = current_setting('app.company_id', true));--> statement-breakpoint
CREATE POLICY "company_isolation" ON "skills" AS PERMISSIVE FOR ALL TO public USING ("skills"."company_id" = current_setting('app.company_id', true)) WITH CHECK ("skills"."company_id" = current_setting('app.company_id', true));--> statement-breakpoint
CREATE POLICY "company_isolation" ON "team_assignments" AS PERMISSIVE FOR ALL TO public USING ("team_assignments"."company_id" = current_setting('app.company_id', true)) WITH CHECK ("team_assignments"."company_id" = current_setting('app.company_id', true));--> statement-breakpoint
CREATE POLICY "company_isolation" ON "teams" AS PERMISSIVE FOR ALL TO public USING ("teams"."company_id" = current_setting('app.company_id', true)) WITH CHECK ("teams"."company_id" = current_setting('app.company_id', true));