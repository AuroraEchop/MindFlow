/**
 * Where a card sits, written out.
 *
 * A map zoomed out far enough to see all of it is a map whose cards are too
 * small to read, and the one thing still worth knowing is which heading the
 * card you are on belongs to. This is that answer, as a row of steps.
 *
 * The row belongs to the pane's **header**, beside the note's own name and the
 * pane's buttons, rather than drawn across the top of the canvas. Over the map
 * it was a band the reader had to look past -- over the very cards it was
 * describing, on the one surface in the pane that has no room to spare -- and
 * a header is a row that already exists, already says which note this is, and
 * already gives its width up as the pane narrows. Whoever builds the view puts
 * the row in it; see `place`.
 *
 * It lives outside `MindmapView.ts` for the usual reason: the path is a
 * question about the tree, and a question about the tree is answerable without
 * a canvas, a camera, or a single line of the map's own state. `crumbTrail` is
 * the whole of the thinking and takes nothing but a node.
 */

import { t } from "../i18n.ts";
import { plainText } from "../model/inlineText.ts";
import type { MindNode } from "../model/types.ts";

/**
 * The row's own class, so a view can find the one a view before it left behind.
 *
 * The header outlives the view inside it -- swapping a note between the map and
 * the editor hands the same row to the next view -- so a row that was not taken
 * out has to be findable by name rather than by a reference nobody holds.
 */
export const BREADCRUMB_CLASS = "mm-breadcrumb";

/** How much of one title a step shows before it trails off. */
const CRUMB_CHARS = 24;

/** One step of the path: what the card says, and the key that names it. */
export interface Crumb {
	key: string;
	text: string;
}

/**
 * The chain from the root down to `node`, root first.
 *
 * The root included, because the root is where the path starts and a path that
 * began one step in would not say where it began. `fallback` is what a card
 * with no words of its own is called, which is the placeholder the card itself
 * is drawn with.
 */
export function crumbTrail(node: MindNode | null, fallback: string): Crumb[] {
	const chain: MindNode[] = [];
	for (let at: MindNode | null = node; at; at = at.parent) chain.unshift(at);
	return chain.map((step) => ({
		key: step.key,
		text: plainText(step.text).trim() || fallback,
	}));
}

/** Whether a trail is worth writing out: one card has no path to it. */
export function isPath(trail: readonly Crumb[]): boolean {
	return trail.length >= 2;
}

/**
 * The row itself.
 *
 * Rebuilt rather than patched: a selection move changes every step of the path,
 * not one, and a row that kept the steps it could would be describing a card
 * that is no longer selected. Emptied as well as faded when there is nothing to
 * say, so the row that has nothing to say is not holding a gap open in the
 * header it lives in.
 */
export class Breadcrumb {
	private readonly el: HTMLElement;

	constructor(row: HTMLElement) {
		this.el = row.createDiv({ cls: `${BREADCRUMB_CLASS} is-hidden` });
		this.el.setAttribute("aria-label", t("view.breadcrumb"));
	}

	/**
	 * Put the row back where in the header it belongs, and keep it there.
	 *
	 * `before` is the pane's own group of buttons, so the path lands beside them
	 * instead of at the far end of the row. The header is Obsidian's to rebuild
	 * whenever it likes and it does not say so when it does: the caller asks
	 * again on every draw, and these two property reads are what the asking
	 * costs while nothing has moved. A `before` that is no longer in the row --
	 * a rebuilt group of buttons -- is dropped rather than inserted against,
	 * which is a `NotFoundError` and a header left without the row at all.
	 */
	place(row: HTMLElement, before: HTMLElement | null): void {
		const at = before !== null && before.parentElement === row ? before : null;
		if (this.el.parentElement === row && this.el.nextElementSibling === at) return;
		row.insertBefore(this.el, at);
	}

	/**
	 * Write `trail` out, the last step of it marked as the card being looked at.
	 *
	 * `onPick` takes the step's key rather than the step, because the view is
	 * the thing that knows what a key means right now -- a card can have been
	 * re-parsed between this row being drawn and a press landing on it.
	 */
	show(trail: readonly Crumb[], onPick: (key: string) => void): void {
		this.el.removeClass("is-hidden");
		this.el.empty();
		this.el.setAttribute("aria-label", t("view.breadcrumb"));
		trail.forEach((step, index) => {
			if (index > 0) this.el.createSpan({ cls: "mm-crumb-sep", text: "\u203a" });
			const text =
				step.text.length > CRUMB_CHARS
					? `${step.text.slice(0, CRUMB_CHARS)}\u2026`
					: step.text;
			const crumb = this.el.createSpan({
				cls: "mm-crumb",
				text,
				attr: { role: "button" },
			});
			if (index === trail.length - 1) crumb.addClass("is-here");
			crumb.addEventListener("click", (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				onPick(step.key);
			});
		});
	}

	hide(): void {
		this.el.addClass("is-hidden");
		this.el.empty();
	}

	/** Take the row out of a header that is not this view's to leave things in. */
	destroy(): void {
		this.el.detach();
	}
}
