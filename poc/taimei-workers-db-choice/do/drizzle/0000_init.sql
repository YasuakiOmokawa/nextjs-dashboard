CREATE TABLE `member_skills` (
	`team_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`user_id` text NOT NULL,
	`level` integer NOT NULL,
	`wants_to_learn` integer NOT NULL,
	PRIMARY KEY(`skill_id`, `user_id`),
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`,`user_id`) REFERENCES `team_assignments`(`team_id`,`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "member_skills_level_range" CHECK("member_skills"."level" BETWEEN 0 AND 3)
);
--> statement-breakpoint
CREATE INDEX `member_skills_team_id_user_id_idx` ON `member_skills` (`team_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skills_team_id_name_unique` ON `skills` (`team_id`,`name`);--> statement-breakpoint
CREATE TABLE `team_assignments` (
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`team_id`, `user_id`),
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
