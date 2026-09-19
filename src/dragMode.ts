/**
 * The one-time explanation of what the drag mode changed.
 *
 * A setting that moves a gesture the user already has in their fingers has to
 * say so the first time it is turned on, or the map simply feels broken: the
 * press that used to draw a box now moves the whole canvas, and nothing on
 * screen says why. Once, and not on every switch -- an explanation that comes
 * back is one people learn to dismiss without reading.
 *
 * The rule lives here rather than beside the `Notice` in `settings.ts` for the
 * same reason `updateNotice.ts` does: `node --test` runs this file as it is and
 * cannot reach a module that imports Obsidian. The only import is the
 * dictionary, which is free of Obsidian too.
 */

import { t } from "./i18n.ts";

/** How long the explanation stays up, in ms. Long enough to read it once. */
export const DRAG_MODE_NOTICE_MS = 12000;

/**
 * The explanation itself.
 *
 * A `Notice` is plain text -- no code spans, no links -- so the gestures are
 * spelled out in words and the setting is named by where it sits.
 */
export function dragModeNotice(): string {
	return t("main.notice.dragMode");
}

/**
 * Whether this turn of the setting is the one worth explaining.
 *
 * `explained` is what has been written down, not what is on screen: the notice
 * fades on its own, and a user who turned the mode on, read it and turned it
 * back off has been told. Turning it on a second time is not news.
 */
export function shouldExplainDragMode(enabled: boolean, explained: boolean): boolean {
	return enabled && !explained;
}
