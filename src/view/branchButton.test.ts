import { test } from "node:test";
import assert from "node:assert/strict";

import { branchAction, branchIcon, showsPlus } from "./branchButton.ts";

/**
 * The branch button is one circle that says what a press does right now: the
 * minus while an open branch sits unpicked, the plus from the moment the card
 * is picked or when there is nothing to close. The press re-asks the same
 * question (`MindmapView.toggleBranch`), so this file is the whole contract --
 * if the answer changes here and not there, the icon and the press disagree.
 */
function state(partial: Partial<Parameters<typeof branchAction>[0]>): Parameters<typeof branchAction>[0] {
	return { hasChildren: false, collapsed: false, selected: false, ...partial };
}

test("an open branch shows the minus while it is not picked", () => {
	// The minus is the folding affordance, and it stays visible without a
	// hover: folding has to work from a card the pointer is nowhere near.
	assert.equal(branchAction(state({ hasChildren: true })), "fold");
	assert.equal(branchIcon(branchAction(state({ hasChildren: true }))), "minus");
	assert.equal(showsPlus(branchAction(state({ hasChildren: true }))), false);
});

test("the picked card shows the plus, branch or not", () => {
	// The selection ring is the state the button answers to, and it is visible
	// without a pointer -- that is what keeps one circle from meaning two
	// things the pointer cannot tell apart. What you do to the card you are
	// working on is add to it.
	assert.equal(branchAction(state({ hasChildren: true, selected: true })), "add");
	assert.equal(branchIcon(branchAction(state({ hasChildren: true, selected: true }))), "plus");
	assert.equal(showsPlus(branchAction(state({ hasChildren: true, selected: true }))), true);
});

test("a leaf and a closed branch offer the plus", () => {
	// Nothing to close on a leaf. A closed branch hides what a minus would
	// promise, so it offers the plus too -- and its count sits beside the
	// button for reopening.
	assert.equal(branchAction(state({}),), "add");
	assert.equal(branchAction(state({ hasChildren: true, collapsed: true })), "add");
	for (const s of [state({}), state({ hasChildren: true, collapsed: true })]) {
		assert.equal(branchIcon(branchAction(s)), "plus");
		assert.equal(showsPlus(branchAction(s)), true);
	}
});
