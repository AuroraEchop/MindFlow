/**
 * Where a card sits, written out.
 *
 * A map zoomed out far enough to see all of it is a map whose cards are too
 * small to read, and the one thing still worth knowing is which heading the
 * card you are on belongs to. This is that answer, as a row of steps across the
 * top of the map.
 *
 * It lives outside `MindmapView.ts` for the usual reason: the path is a
 * question about the tree, and a question about the tree is answerable without
 * a canvas, a camera, or a single line of the map's own state. `crumbTrail` is
 * the whole of the thinking and takes nothing but a node.
 */

import { t } from "../i18n.ts";
import { plainText } from "../model/inlineText.ts";
import type { MindNode } from "../model/types.ts";

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
 * that is no longer selected. Hidden rather than emptied when there is nothing
 * to say, so the row does not hold a space it is not using -- and so the map
 * does not jump when a card is picked.
 */
export class Breadcrumb {
	private readonly el: HTMLElement;

	constructor(parent: HTMLElement) {
		this.el = parent.createDiv({ cls: "mm-breadcrumb is-hidden" });
		this.el.setAttribute("aria-label", t("view.breadcrumb"));
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
}
