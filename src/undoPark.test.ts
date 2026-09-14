import { test } from "node:test";
import assert from "node:assert/strict";

import { parkUndo, takeUndo } from "./undoPark.ts";

const NOTE = "note.md";
const OTHER = "other.md";
const BEFORE = "# Note\n\n- one\n";
const AFTER = "# Note\n\n- one\n- two\n";

// --- taking it back ------------------------------------------------------------

test("the history comes back when the note is still the one it was", () => {
	const slot = parkUndo(NOTE, AFTER, [BEFORE], []);
	const take = takeUndo(slot, NOTE, AFTER);
	assert.deepEqual(take.stacks, { undo: [BEFORE], redo: [] });
});

test("a note that changed while the map was away does not get its history back", () => {
	// The snapshots would undo an edit made in the markdown editor, which is a
	// worse outcome than arriving with nothing to undo.
	const slot = parkUndo(NOTE, AFTER, [BEFORE], []);
	assert.equal(takeUndo(slot, NOTE, "# Note\n\n- one\n- two\n- three\n").stacks, null);
	// Not even a change that only moves whitespace.
	assert.equal(takeUndo(slot, NOTE, `${AFTER}\n`).stacks, null);
});

test("another note's history is never handed over", () => {
	const slot = parkUndo(NOTE, AFTER, [BEFORE], []);
	assert.equal(takeUndo(slot, OTHER, AFTER).stacks, null);
});

test("nothing parked is nothing to take", () => {
	assert.equal(takeUndo(null, NOTE, AFTER).stacks, null);
});

// --- what the slot holds afterwards --------------------------------------------

test("a match spends the slot, so a second map starts its own history", () => {
	// Two views on one note undoing through the same arrays would undo each
	// other's work, so the arrays are handed over once and never shared.
	const slot = parkUndo(NOTE, AFTER, [BEFORE], []);
	const first = takeUndo(slot, NOTE, AFTER);
	assert.equal(first.slot, null);
	assert.equal(takeUndo(first.slot, NOTE, AFTER).stacks, null);
});

test("a mismatch keeps the slot, so a detour through another note still comes home", () => {
	const slot = parkUndo(NOTE, AFTER, [BEFORE], []);
	const detour = takeUndo(slot, OTHER, "unrelated\n");
	assert.equal(detour.slot, slot);
	// And the note's own history is still there when it is opened again.
	assert.deepEqual(takeUndo(detour.slot, NOTE, AFTER).stacks, { undo: [BEFORE], redo: [] });
});

// --- the copy ------------------------------------------------------------------

test("the parked arrays are copies, so the view cannot push into them", () => {
	const undo = [BEFORE];
	const redo = [AFTER];
	const slot = parkUndo(NOTE, AFTER, undo, redo);
	// A view that keeps editing pushes to the arrays it still holds.
	undo.push("later");
	redo.push("later");
	assert.deepEqual(slot.undo, [BEFORE]);
	assert.deepEqual(slot.redo, [AFTER]);
});

test("both stacks survive the round trip, redo included", () => {
	const slot = parkUndo(NOTE, AFTER, [BEFORE], [AFTER, BEFORE]);
	const take = takeUndo(slot, NOTE, AFTER);
	assert.deepEqual(take.stacks, { undo: [BEFORE], redo: [AFTER, BEFORE] });
});
