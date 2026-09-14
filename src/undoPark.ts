/**
 * The undo history of one note, shared by every view that shows it.
 *
 * The plugin toggles a note between the map and the markdown editor by swapping
 * the view type on the leaf that already holds it. Obsidian answers by
 * destroying the view, so a history that lived in the view would be lost on
 * every switch -- and the two views would each be undoing a different idea of
 * what happened.
 *
 * So the history lives here instead: one stack per note, recording what the map
 * did and what the markdown editor did, in the order it happened. Whoever
 * writes next, the next undo steps back over whichever change came last.
 *
 * Free of every import, Obsidian included: `node --test` runs this file as it
 * is, and the rules below are the part that can be got wrong.
 */

/**
 * How many revisions a history keeps.
 *
 * Deep enough that a session's worth of work is reachable, shallow enough that
 * the stack cannot grow without bound on a note somebody edits all day. The
 * strings are the documents themselves, so this is a real budget and not a
 * count of pointers.
 */
export const UNDO_LIMIT = 100;

/** The stacks a view undoes and redoes through. */
export interface UndoStacks {
	undo: string[];
	redo: string[];
}

/** A note's history, and the exact document it was last known to hold. */
export interface ParkedUndo {
	path: string;
	data: string;
	undo: string[];
	redo: string[];
}

/**
 * File a revision as a step back, dropping the oldest once the budget is spent.
 *
 * In place, because every caller already owns the array and is standing in the
 * middle of its own bookkeeping.
 */
export function pushRevision(stack: string[], data: string): void {
	stack.push(data);
	if (stack.length > UNDO_LIMIT) stack.shift();
}

/**
 * Record a map's history against the document it was recorded from.
 *
 * The arrays are copied, and the copy is shallow: the strings are shared with
 * the stacks the view is still using, and a view that keeps pushing to its own
 * array must not push into the parked one as well.
 */
export function parkUndo(
	path: string,
	data: string,
	undo: readonly string[],
	redo: readonly string[],
): ParkedUndo {
	return { path, data, undo: [...undo], redo: [...redo] };
}

/**
 * A document that changed without the history's knowledge.
 *
 * Which is the markdown editor, a second window, a sync client -- anyone but
 * this map. The revision the history was holding is still a legitimate step
 * back, so it joins the stack rather than the history being thrown away. That
 * is the whole point: an edit made in the editor and an edit made on the map
 * end up on one stack, and undo walks back over them in the order they landed.
 *
 * The redo branch is dropped, because it describes a future the new document
 * has already left.
 *
 * A document that matches what is already recorded is not a change at all, and
 * returns the history untouched -- which is what keeps the map's own saves from
 * filing a step every time Obsidian hands the text back.
 */
export function recordExternalEdit(slot: ParkedUndo, data: string): ParkedUndo {
	if (slot.data === data) return slot;
	const undo = [...slot.undo];
	pushRevision(undo, slot.data);
	return { path: slot.path, data, undo, redo: [] };
}

/** The parked history for exactly this note, and the slot that is left. */
export interface UndoTake {
	/** What the slot holds afterwards: spent on a match, kept otherwise. */
	slot: ParkedUndo | null;
	/** The stacks to adopt, or null when the slot was not for this note. */
	stacks: UndoStacks | null;
}

/**
 * Take the parked history, if it is this note's.
 *
 * A note that came back unchanged hands its stacks over as they are. A note
 * that changed while the map was away keeps its history too, with the document
 * the history was holding filed as one more step back -- so an edit made in the
 * markdown editor is undone by the map's undo, in its turn.
 *
 * A different note takes nothing, and the slot is left alone: a detour through
 * another note and back still finds this one's history waiting.
 *
 * A match spends the slot, because a second view on the same note has to start
 * its own -- two views undoing through the same arrays would undo each other's
 * work.
 */
export function takeUndo(slot: ParkedUndo | null, path: string, data: string): UndoTake {
	if (!slot || slot.path !== path) return { slot, stacks: null };
	if (slot.data === data) return { slot: null, stacks: { undo: slot.undo, redo: slot.redo } };

	const undo = [...slot.undo];
	pushRevision(undo, slot.data);
	return { slot: null, stacks: { undo, redo: [] } };
}
