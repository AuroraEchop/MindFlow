/**
 * A map's undo history, parked where it outlives the view that made it.
 *
 * Obsidian destroys the view when a leaf changes view type. The plugin's toggle
 * works by swapping the view type on the leaf that already holds the note, so
 * toggling to markdown to read something and then back arrives as a brand new
 * view instance with brand new -- empty -- stacks. Parking them here is what
 * makes that round trip survivable.
 *
 * Free of every import, Obsidian included: `node --test` runs this file as it
 * is, and the matching rule is the part that can be got wrong.
 *
 * One slot rather than a table keyed by path. The case worth paying for is the
 * round trip, and a slot that survives a detour through another note covers it
 * -- the stacks are arrays of references to strings the view already held, so
 * what is really kept is one array of pointers, not a copy of the documents.
 */

/** The stacks a view undoes and redoes through, oldest first. */
export interface UndoStacks {
	undo: string[];
	redo: string[];
}

/** A map's stacks, and the exact document they were recorded against. */
export interface ParkedUndo {
	path: string;
	data: string;
	undo: string[];
	redo: string[];
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

/** The parked stacks for exactly this document, and the slot that is left. */
export interface UndoTake {
	/** What the slot holds afterwards: spent on a match, kept otherwise. */
	slot: ParkedUndo | null;
	/** The stacks to adopt, or null when the slot was not for this document. */
	stacks: UndoStacks | null;
}

/**
 * Take the parked history, if it is this document's.
 *
 * The document has to match to the byte, which is the whole safety of this: a
 * note edited in the markdown editor while the map was away is a note whose
 * snapshots would undo those edits, and that is worse than arriving with no
 * history at all.
 *
 * A mismatch keeps the slot rather than clearing it, so a detour through
 * another note and back still finds this one's history waiting. A match spends
 * it, because a second view on the same note has to start its own -- two views
 * undoing through the same arrays would undo each other's work.
 */
export function takeUndo(slot: ParkedUndo | null, path: string, data: string): UndoTake {
	if (!slot || slot.path !== path || slot.data !== data) return { slot, stacks: null };
	return { slot: null, stacks: { undo: slot.undo, redo: slot.redo } };
}
