import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { branchAction, branchIcon, showsPlus } from "./branchButton.ts";

/**
 * The branch button is one circle that says what a press does right now: the
 * minus while an open branch sits unpicked, the plus from the moment the card
 * is picked or when there is nothing to close. The press re-asks the same
 * question (`MindmapView.toggleBranch`), so this file is the whole contract --
 * if the answer changes here and not there, the icon and the press disagree.
 *
 * What this file does *not* hold from logic alone is when the button shows.
 * That is the stylesheet's (`opacity` next to `.mm-add`), and it is half the
 * state machine the user dictated: hidden while the card sits unpicked and
 * unhovered, the minus under the pointer, the plus for as long as the card is
 * picked. A pass once gave the button to every branch unconditionally, which
 * made "the button is there" and "the button means fold" read as the button
 * always arguing for a fold. The CSS tests at the bottom pin the matrix.
 */
function state(partial: Partial<Parameters<typeof branchAction>[0]>): Parameters<typeof branchAction>[0] {
	return { hasChildren: false, collapsed: false, selected: false, collapsible: false, ...partial };
}

test("a card that folds its own body collapses and expands, picked or not", () => {
	// A note-content card has no branch, so the selected-card rule that makes
	// the button a plus has nothing to say about one: the only question left is
	// whether the block is folded.
	assert.equal(branchAction(state({ collapsible: true })), "collapse");
	assert.equal(branchAction(state({ collapsible: true, collapsed: true })), "expand");
	assert.equal(branchAction(state({ collapsible: true, selected: true })), "collapse");
	assert.equal(branchIcon(branchAction(state({ collapsible: true }))), "chevrons-down-up");
	assert.equal(branchIcon(branchAction(state({ collapsible: true, collapsed: true }))), "chevrons-up-down");
	assert.equal(showsPlus(branchAction(state({ collapsible: true }))), false);
});

test("an open branch shows the minus while it is not picked", () => {
	// The minus is the folding affordance, and it shows while the pointer is on
	// the card.
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

// --- when the button shows: the stylesheet's half of the state machine --------

const CSS = readFileSync(
	fileURLToPath(new URL("../../styles.css", import.meta.url)),
	"utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule whose selector list has a part ending in the given suffix. */
function visibilityRules(suffix: string): Array<{ selector: string; body: string }> {
	const out: Array<{ selector: string; body: string }> = [];
	const re = new RegExp(`([^{}]+)\\{([^}]*)\\}`, "g");
	for (const [, selector, body] of CSS.matchAll(re)) {
		const parts = selector.split(",").map((part: string) => part.trim());
		if (parts.some((part: string) => part.endsWith(suffix))) {
			out.push({ selector, body });
		}
	}
	return out;
}

test("the branch button is visible on hover and on the picked card, nothing else", () => {
	// The whole matrix the user dictated: hidden at rest, the minus under the
	// pointer, the plus for as long as the card holds focus, hidden again when
	// it lets go. A branch with children once kept its button on screen at all
	// times -- which made an unpicked, unhovered card wear a button that argued
	// for a fold nobody was looking at. `has-children` must never hand out
	// visibility on its own; only the states that mean it do.
	//
	// A folded note-content card is the third of those states, and the only one
	// that is not about the pointer: a block has no branch to count, so the way
	// back out has to stand where a branch's count would. It is keyed on the
	// body kind as well, because a folded *branch* still keeps the count and
	// its button must stay hover-only.
	const rules = visibilityRules(".mm-add");
	const show = rules.filter((rule) => /opacity:\s*1/.test(rule.body));
	assert.ok(show.length > 0, "nothing shows the branch button");
	for (const rule of show) {
		const parts = rule.selector.split(",").map((part) => part.trim());
		for (const part of parts) {
			if (/\.is-collapsed \.mm-add$/.test(part)) {
				assert.match(
					part,
					/\[data-kind="body"\]/,
					`"${part}" shows a folded card's button, which a folded branch must not get`,
				);
				continue;
			}
			assert.match(
				part,
				/:hover \.mm-add$|\.is-selected \.mm-add$/,
				`"${part}" shows the branch button for a state that is neither hover, focus nor a folded block`,
			);
		}
	}
});
