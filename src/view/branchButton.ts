/**
 * What the branch-side button on a card does, and how it says so.
 *
 * Here rather than in `settings.ts` because the interaction layer answers the
 * same question when the button is clicked, and that layer is tested against a
 * stubbed DOM with no Obsidian in it -- `settings.ts` pulls the plugin API in,
 * this does not.
 */

/** What a press on the branch button does. */
export type BranchAction = "add" | "fold";

export interface BranchButtonState {
	/** The card has anything to fold, body cards included. */
	hasChildren: boolean;
	/** The branch is closed behind the count. */
	collapsed: boolean;
	/** The card is the picked one -- the selection ring is on it. */
	selected: boolean;
}

/**
 * The picked card is working on, and what you do to the card you are working
 * on is add to it -- so the picked card's button is the plus whatever else is
 * true. A branch that is open shows the minus while it is at rest: the button
 * is the only folding affordance the card carries, and it shows while the
 * pointer is on the card, so closing one branch is a press on the button under
 * the pointer. Everything else -- a leaf, a closed branch -- offers the plus.
 *
 * The button itself is visible only while the pointer is on the card or the
 * card is picked; this function says what the visible button means, not when
 * it shows. The visibility matrix is the stylesheet's, next to `.mm-add`.
 */
export function branchAction(state: BranchButtonState): BranchAction {
	if (state.selected) return "add";
	if (state.hasChildren && !state.collapsed) return "fold";
	return "add";
}

/** The icon the action is drawn with. */
export function branchIcon(action: BranchAction): string {
	return action === "fold" ? "minus" : "plus";
}

/** Whether the action's button is the dashed one that grows something new. */
export function showsPlus(action: BranchAction): boolean {
	return action === "add";
}

/** The classes a branch button wears, in one place for tests and callers. */
export const BRANCH_BUTTON_CLASSES = ["mm-add", "is-plus", "is-minus"];
