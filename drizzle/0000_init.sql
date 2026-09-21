CREATE TABLE `users` (
  `id` text PRIMARY KEY NOT NULL,
  `email` text NOT NULL,
  `name` text,
  `avatar_url` text,
  `username` text,
  `country_code` text,
  `role` text DEFAULT 'member' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);
CREATE INDEX `users_country_idx` ON `users` (`country_code`);

CREATE TABLE `sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `expires_at` integer NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `community_countries` (
  `code` text PRIMARY KEY NOT NULL,
  `first_registered_at` integer NOT NULL
);
INSERT INTO `community_countries` (`code`, `first_registered_at`) VALUES ('UY', 0);

CREATE TABLE `learn_visits` (
  `user_id` text NOT NULL,
  `lesson_id` text NOT NULL,
  `visited_at` integer NOT NULL,
  PRIMARY KEY (`user_id`, `lesson_id`)
);

CREATE TABLE `threads` (
  `id` text PRIMARY KEY NOT NULL,
  `forum_slug` text NOT NULL,
  `title` text NOT NULL,
  `content` text NOT NULL,
  `author_id` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `reply_count` integer DEFAULT 0 NOT NULL,
  `last_reply_at` integer,
  `last_reply_author_id` text,
  `next_reply_ordinal` integer DEFAULT 1 NOT NULL,
  `is_pinned` integer DEFAULT false NOT NULL,
  `is_locked` integer DEFAULT false NOT NULL,
  `deleted_at` integer,
  `deleted_by` text
);
CREATE INDEX `threads_forum_slug_idx` ON `threads` (`forum_slug`,`created_at`);
CREATE INDEX `threads_author_idx` ON `threads` (`author_id`);

CREATE TABLE `posts` (
  `id` text PRIMARY KEY NOT NULL,
  `thread_id` text NOT NULL,
  `content` text NOT NULL,
  `author_id` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `reply_ordinal` integer DEFAULT 0 NOT NULL,
  `is_edited` integer DEFAULT false NOT NULL,
  `deleted_at` integer,
  `deleted_by` text
);
CREATE INDEX `posts_thread_idx` ON `posts` (`thread_id`,`created_at`);

CREATE TABLE `signatures` (
  `user_id` text PRIMARY KEY NOT NULL,
  `content` text NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE TABLE `reports` (
  `id` text PRIMARY KEY NOT NULL,
  `reporter_id` text NOT NULL,
  `target_type` text NOT NULL,
  `target_id` text NOT NULL,
  `reason` text NOT NULL,
  `status` text DEFAULT 'open' NOT NULL,
  `resolved_by` text,
  `resolved_at` integer,
  `created_at` integer NOT NULL
);
CREATE INDEX `reports_status_idx` ON `reports` (`status`,`created_at`);
CREATE UNIQUE INDEX `reports_open_unique_idx` ON `reports` (`reporter_id`,`target_type`,`target_id`) WHERE "reports"."status" = 'open';

CREATE TABLE `notification_prefs` (
  `user_id` text PRIMARY KEY NOT NULL,
  `email_enabled` integer DEFAULT true NOT NULL
);

CREATE TABLE `notifications` (
  `id` text PRIMARY KEY NOT NULL,
  `recipient_id` text NOT NULL,
  `type` text NOT NULL,
  `thread_id` text,
  `post_id` text,
  `actor_id` text,
  `payload_json` text DEFAULT '{}' NOT NULL,
  `read_at` integer,
  `created_at` integer NOT NULL,
  `source_event_id` text
);
CREATE INDEX `notifications_recipient_idx` ON `notifications` (`recipient_id`,`created_at`);
CREATE INDEX `notifications_unread_idx` ON `notifications` (`recipient_id`,`read_at`);

CREATE TABLE `achievement_events` (
  `seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `id` text NOT NULL,
  `user_id` text NOT NULL,
  `type` text NOT NULL,
  `payload` text NOT NULL,
  `ts` integer NOT NULL
);
CREATE UNIQUE INDEX `achievement_events_id_unique` ON `achievement_events` (`id`);
CREATE INDEX `ach_events_user_seq` ON `achievement_events` (`user_id`,`seq`);
CREATE INDEX `ach_events_user_type` ON `achievement_events` (`user_id`,`type`);

CREATE TABLE `user_achievements` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `achievement_id` text NOT NULL,
  `unlocked_at` integer NOT NULL
);
CREATE INDEX `user_achievements_user_idx` ON `user_achievements` (`user_id`,`unlocked_at`);

CREATE TABLE `achievement_projection` (
  `user_id` text PRIMARY KEY NOT NULL,
  `state` text NOT NULL,
  `snapshot` text NOT NULL,
  `last_seq` integer NOT NULL
);

-- Reply ordinal allocation (required by social createPost uniqueness)
CREATE UNIQUE INDEX `posts_thread_reply_ordinal_unique_idx` ON `posts` (`thread_id`, `reply_ordinal`);

CREATE TRIGGER `posts_require_live_unlocked_parent`
BEFORE INSERT ON `posts`
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'CREATE_POST_PARENT_NOT_FOUND')
  WHERE NOT EXISTS (
    SELECT 1 FROM `threads` WHERE `id` = NEW.`thread_id` AND `deleted_at` IS NULL
  );
  SELECT RAISE(ABORT, 'CREATE_POST_PARENT_LOCKED')
  WHERE EXISTS (
    SELECT 1 FROM `threads` WHERE `id` = NEW.`thread_id` AND `deleted_at` IS NULL AND `is_locked` = 1
  );
END;

CREATE TRIGGER `posts_reject_forged_reply_ordinal`
BEFORE INSERT ON `posts`
FOR EACH ROW
WHEN NEW.`reply_ordinal` <> 0
BEGIN
  SELECT RAISE(ABORT, 'CREATE_POST_REPLY_ORDINAL_FORGED');
END;

CREATE TRIGGER `posts_allocate_reply_ordinal`
AFTER INSERT ON `posts`
FOR EACH ROW
WHEN NEW.`reply_ordinal` = 0
BEGIN
  UPDATE `posts`
  SET `reply_ordinal` = (
    SELECT `next_reply_ordinal` FROM `threads` WHERE `id` = NEW.`thread_id`
  )
  WHERE `id` = NEW.`id`;
  UPDATE `threads`
  SET `next_reply_ordinal` = `next_reply_ordinal` + 1
  WHERE `id` = NEW.`thread_id`;
END;
