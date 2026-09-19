/**
 * What the branch-side button on a card does, and how it says so.
 *
 * Here rather than in `settings.ts` because the interaction layer answers the
 * same question when the button is clicked, and that layer is tested against a
 * stubbed DOM with no Obsidian in it -- `settings.ts` pulls the plugin API in,
 * this does not.
 */

import type { I18nKey } from "../i18n.ts";

/** What a press on the branch button does. */
export type BranchAction = "add" | "fold" | "collapse" | "expand";

export interface BranchButtonState {
	/** The card has anything to fold, body cards included. */
	hasChildren: boolean;
	/** The branch is closed behind the count. */
	collapsed: boolean;
	/** The card is the picked one -- the selection ring is on it. */
	selected: boolean;
	/**
	 * What folds here is the card's own content rather than a branch under it.
	 *
	 * A note-content card has no branch to open: its lines are the note's and
	 * nothing can be moved under it, so the button would have nothing to say.
	 * What it does have is a body, and a code block's body is as long as the
	 * sample is -- which is the same problem a branch has. So the same button
	 * answers the same question about a different thing.
	 */
	collapsible: boolean;
}

/**
 * The picked card is working on, and what you do to the card you are working
 * on is add to it -- so the picked card's button is the plus whatever else is
 * true. A branch that is open shows the minus while it is at rest: the button
 * is the only folding affordance the card carries, and it shows while the
 * pointer is on the card, so closing one branch is a press on the button under
 * the pointer. Everything else -- a leaf, a closed branch -- offers the plus.
 *
 * A card that folds its own content answers first, because that is the only
 * thing it can be asked: there is no branch under a code block to add to, so
 * the selected-card rule below has nothing to say about one.
 *
 * The button itself is visible only while the pointer is on the card or the
 * card is picked; this function says what the visible button means, not when
 * it shows. The visibility matrix is the stylesheet's, next to `.mm-add`.
 */
export function branchAction(state: BranchButtonState): BranchAction {
	if (state.collapsible) return state.collapsed ? "expand" : "collapse";
	if (state.selected) return "add";
	if (state.hasChildren && !state.collapsed) return "fold";
	return "add";
}

/** The icon the action is drawn with. */
export function branchIcon(action: BranchAction): string {
	if (action === "collapse") return "chevrons-down-up";
	if (action === "expand") return "chevrons-up-down";
	return action === "fold" ? "minus" : "plus";
}

/**
 * The dictionary key an action's label lives under.
 *
 * Typed as an `I18nKey` for the same reason `shortcuts.ts` types its own: an
 * action added to the union without a pair of strings to go with it stops
 * compiling rather than shipping an unnamed button.
 */
export function branchLabelKey(action: BranchAction): I18nKey {
	return LABEL_KEYS[action];
}

const LABEL_KEYS: Record<BranchAction, I18nKey> = {
	add: "view.menu.addChild",
	fold: "view.node.collapse",
	collapse: "view.body.collapse",
	expand: "view.body.expand",
};

/** Whether the action's button is the dashed one that grows something new. */
export function showsPlus(action: BranchAction): boolean {
	return action === "add";
}

/**
 * What the button falls back to when its icon is not in the bundle.
 *
 * Only reached when `setIcon` found nothing, so the character is a last resort
 * rather than the design -- but a button with no face at all is worse than a
 * crude one. `+` and `−` are what the button has always used; the two content
 * actions borrow the same pair, because a press that opens something is a plus
 * and a press that closes it is a minus whatever it is opening.
 */
export const BRANCH_FALLBACK_TEXT: Record<BranchAction, string> = {
	add: "+",
	fold: "−",
	collapse: "−",
	expand: "+",
};

/** The classes a branch button wears, in one place for tests and callers. */
export const BRANCH_BUTTON_CLASSES = ["mm-add", "is-plus", "is-minus"];
