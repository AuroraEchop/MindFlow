/**
 * Whether a load follows an update the user should be told about, and what to
 * remember afterwards.
 *
 * Free of every Obsidian import -- `node --test` runs this file as it is, and
 * the rule is the part that can be got wrong. Showing the notice is `main.ts`'s
 * job. The one import is the dictionary, which is free of Obsidian too.
 *
 * An update from Obsidian's plugin browser arrives without a word, so a change
 * that redraws notes the user already has gets exactly one notice: the load
 * after the update, and no load after that.
 */

import { t } from "./i18n.ts";

/** How long the notice stays up, in ms. Long enough to read it once. */
export const UPDATE_NOTICE_MS = 10000;

/**
 * The notice itself. A Notice is plain text -- no code spans, no links -- so
 * the syntax is quoted and the setting is named by its path.
 *
 * It belongs to the version that introduced inline annotations; a later version
 * with nothing to announce should drop it rather than repeat it.
 *
 * A function rather than a constant: the language is a setting, and this is
 * read on the load that follows an update, which is after the setting has been
 * applied.
 */
export function updateNotice(): string {
	return t("main.notice.update");
}

/**
 * `freshInstall` is "data.json held no settings", not "the file was missing":
 * a vault that has run this plugin before but never stored a version is an
 * update from a release that kept no record, which is the very update this
 * announces. A first install announces nothing -- there is no change to report
 * to someone meeting the plugin for the first time.
 */
export function shouldAnnounce(
	lastSeen: unknown,
	current: string,
	freshInstall: boolean,
): boolean {
	if (typeof lastSeen === "string" && lastSeen !== "") return lastSeen !== current;
	return !freshInstall;
}

/** The version to store, or null when what is already stored is right. */
export function versionToRecord(lastSeen: unknown, current: string): string | null {
	return lastSeen === current ? null : current;
}
