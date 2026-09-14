import { test } from "node:test";
import assert from "node:assert/strict";

import { UNDO_LIMIT, parkUndo, pushRevision, recordExternalEdit, takeUndo } from "./undoPark.ts";
import type { ParkedUndo } from "./undoPark.ts";

const NOTE = "note.md";
const OTHER = "other.md";
const V0 = "# Note\n\n- one\n";
const V1 = "# Note\n\n- one\n- two\n";
const V2 = "# Note\n\n- one\n- two\n- three\n";

/** A history that has made one edit: it can step back to V0 from V1. */
const afterOneEdit = (): ParkedUndo => parkUndo(NOTE, V1, [V0], []);

// --- taking it back ------------------------------------------------------------

test("an unchanged note hands its stacks over as they are", () => {
	const take = takeUndo(afterOneEdit(), NOTE, V1);
	assert.deepEqual(take.stacks, { undo: [V0], redo: [] });
});

test("a note changed while the map was away keeps its history, one step deeper", () => {
	// The document the history was holding is still a legitimate step back, so
	// an edit made in the markdown editor is undone by the map's undo in turn.
	const take = takeUndo(afterOneEdit(), NOTE, V2);
	assert.deepEqual(take.stacks, { undo: [V0, V1], redo: [] });
});

test("a change made in the editor drops the redo branch it left behind", () => {
	const slot = parkUndo(NOTE, V1, [V0], [V2]);
	const take = takeUndo(slot, NOTE, "# Note\n\n- something else\n");
	assert.deepEqual(take.stacks?.redo, []);
});

test("another note's history is never handed over", () => {
	const slot = afterOneEdit();
	const take = takeUndo(slot, OTHER, V1);
	assert.equal(take.stacks, null);
	// And the slot is left alone, so a detour through another note and back
	// still finds this one's history waiting.
	assert.equal(take.slot, slot);
});

test("nothing parked is nothing to take", () => {
	assert.equal(takeUndo(null, NOTE, V1).stacks, null);
});

// --- what the slot holds afterwards --------------------------------------------

test("a match spends the slot, so a second view starts its own history", () => {
	// Two views undoing through the same arrays would undo each other's work.
	const first = takeUndo(afterOneEdit(), NOTE, V1);
	assert.equal(first.slot, null);
	assert.equal(takeUndo(first.slot, NOTE, V1).stacks, null);
});

// --- the copy ------------------------------------------------------------------

test("the parked arrays are copies, so the view cannot push into them", () => {
	const undo = [V0];
	const redo = [V1];
	const slot = parkUndo(NOTE, V1, undo, redo);
	undo.push("later");
	redo.push("later");
	assert.deepEqual(slot.undo, [V0]);
	assert.deepEqual(slot.redo, [V1]);
});

test("taking a changed note's history does not reach back into the slot", () => {
	const slot = afterOneEdit();
	const take = takeUndo(slot, NOTE, V2);
	take.stacks?.undo.push("later");
	assert.deepEqual(slot.undo, [V0]);
});

// --- a change the history did not make ------------------------------------------

test("an external edit files the document the history was holding", () => {
	const next = recordExternalEdit(afterOneEdit(), V2);
	assert.equal(next.path, NOTE);
	assert.equal(next.data, V2);
	assert.deepEqual(next.undo, [V0, V1]);
});

test("an external edit that changed nothing is not a step", () => {
	// The map's own save comes back through the same path, and filing a step
	// for it would put an undo between every keystroke and the last one.
	const slot = afterOneEdit();
	assert.equal(recordExternalEdit(slot, V1), slot);
});

test("an external edit drops the redo branch", () => {
	const slot = parkUndo(NOTE, V1, [V0], [V2]);
	assert.deepEqual(recordExternalEdit(slot, "# Note\n\n- else\n").redo, []);
});

test("a run of edits in the editor walks back through every one of them", () => {
	// The point of the whole arrangement: whoever wrote, the stack is one
	// sequence, and undo steps back over it in the order the changes landed.
	let slot: ParkedUndo = afterOneEdit();
	slot = recordExternalEdit(slot, V2);
	slot = recordExternalEdit(slot, "# Note\n\n- one\n- two\n- three\n- four\n");
	const take = takeUndo(slot, NOTE, "# Note\n\n- one\n- two\n- three\n- four\n");
	assert.deepEqual(take.stacks?.undo, [V0, V1, V2]);
});

// --- the budget ------------------------------------------------------------------

test("the stack stops growing once the budget is spent", () => {
	const stack: string[] = [];
	for (let i = 0; i <= UNDO_LIMIT + 10; i++) pushRevision(stack, `v${i}`);
	assert.equal(stack.length, UNDO_LIMIT);
	// The oldest went, and the newest is what is reachable.
	assert.equal(stack[0], `v${11}`);
	assert.equal(stack[stack.length - 1], `v${UNDO_LIMIT + 10}`);
});

test("an external edit respects the budget too", () => {
	let slot = parkUndo(NOTE, "v0", Array.from({ length: UNDO_LIMIT }, (_, i) => `old${i}`), []);
	slot = recordExternalEdit(slot, "v1");
	assert.equal(slot.undo.length, UNDO_LIMIT);
	assert.equal(slot.undo[slot.undo.length - 1], "v0");
});
