-- Seed the default quantifiers (number-words) the parser requires.
-- The entrypoint runs migrations only (never the opt-in seed), and these
-- moved code->DB, so prod/fresh DBs would otherwise have an empty table.
-- Idempotent (INSERT OR IGNORE) and scoped to the quantifier tables only;
-- runs exactly once per DB via the drizzle migration journal.
INSERT OR IGNORE INTO `quantifier` (`name`, `value`, `sort_order`) VALUES ('ein', 1, 0);
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier` (`name`, `value`, `sort_order`) VALUES ('zwei', 2, 1);
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier` (`name`, `value`, `sort_order`) VALUES ('drei', 3, 2);
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier` (`name`, `value`, `sort_order`) VALUES ('vier', 4, 3);
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier` (`name`, `value`, `sort_order`) VALUES ('fünf', 5, 4);
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier` (`name`, `value`, `sort_order`) VALUES ('sechs', 6, 5);
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier` (`name`, `value`, `sort_order`) VALUES ('sieben', 7, 6);
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier` (`name`, `value`, `sort_order`) VALUES ('acht', 8, 7);
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier` (`name`, `value`, `sort_order`) VALUES ('neun', 9, 8);
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier` (`name`, `value`, `sort_order`) VALUES ('zehn', 10, 9);
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier` (`name`, `value`, `sort_order`) VALUES ('elf', 11, 10);
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier` (`name`, `value`, `sort_order`) VALUES ('zwölf', 12, 11);
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier` (`name`, `value`, `sort_order`) VALUES ('ein halber', 0.5, 12);
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier` (`name`, `value`, `sort_order`) VALUES ('viertel', 0.25, 13);
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier` (`name`, `value`, `sort_order`) VALUES ('dreiviertel', 0.75, 14);
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier` (`name`, `value`, `sort_order`) VALUES ('einige', NULL, 15);
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier` (`name`, `value`, `sort_order`) VALUES ('ein paar', NULL, 16);
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier` (`name`, `value`, `sort_order`) VALUES ('mehrere', NULL, 17);
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier` (`name`, `value`, `sort_order`) VALUES ('some', NULL, 18);
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'eine' FROM `quantifier` WHERE `name` = 'ein';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'einen' FROM `quantifier` WHERE `name` = 'ein';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'einem' FROM `quantifier` WHERE `name` = 'ein';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'einer' FROM `quantifier` WHERE `name` = 'ein';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'eins' FROM `quantifier` WHERE `name` = 'ein';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'a' FROM `quantifier` WHERE `name` = 'ein';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'an' FROM `quantifier` WHERE `name` = 'ein';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'one' FROM `quantifier` WHERE `name` = 'ein';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'two' FROM `quantifier` WHERE `name` = 'zwei';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'three' FROM `quantifier` WHERE `name` = 'drei';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'four' FROM `quantifier` WHERE `name` = 'vier';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'five' FROM `quantifier` WHERE `name` = 'fünf';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'six' FROM `quantifier` WHERE `name` = 'sechs';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'seven' FROM `quantifier` WHERE `name` = 'sieben';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'eight' FROM `quantifier` WHERE `name` = 'acht';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'nine' FROM `quantifier` WHERE `name` = 'neun';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'ten' FROM `quantifier` WHERE `name` = 'zehn';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'eleven' FROM `quantifier` WHERE `name` = 'elf';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'twelve' FROM `quantifier` WHERE `name` = 'zwölf';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'dutzend' FROM `quantifier` WHERE `name` = 'zwölf';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'a dozen' FROM `quantifier` WHERE `name` = 'zwölf';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'eine halbe' FROM `quantifier` WHERE `name` = 'ein halber';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'ein halbes' FROM `quantifier` WHERE `name` = 'ein halber';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'einer halben' FROM `quantifier` WHERE `name` = 'ein halber';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'einen halben' FROM `quantifier` WHERE `name` = 'ein halber';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'einem halben' FROM `quantifier` WHERE `name` = 'ein halber';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'halber' FROM `quantifier` WHERE `name` = 'ein halber';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'halbe' FROM `quantifier` WHERE `name` = 'ein halber';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'halbes' FROM `quantifier` WHERE `name` = 'ein halber';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'halben' FROM `quantifier` WHERE `name` = 'ein halber';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'half' FROM `quantifier` WHERE `name` = 'ein halber';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'ein viertel' FROM `quantifier` WHERE `name` = 'viertel';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'quarter' FROM `quantifier` WHERE `name` = 'viertel';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'three quarters' FROM `quantifier` WHERE `name` = 'dreiviertel';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'several' FROM `quantifier` WHERE `name` = 'einige';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'a few' FROM `quantifier` WHERE `name` = 'ein paar';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'a couple' FROM `quantifier` WHERE `name` = 'ein paar';
--> statement-breakpoint
INSERT OR IGNORE INTO `quantifier_alias` (`quantifier_id`, `name`) SELECT `id`, 'a couple of' FROM `quantifier` WHERE `name` = 'ein paar';
