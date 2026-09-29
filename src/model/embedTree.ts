/**
 * Another note's outline, hung under a node of this map.
 *
 * A node whose whole text is a link can be opened into the tree that note
 * describes: press the arrow on the card and the note's own headings and list
 * items arrive as children of that node. This is the half of that feature that
 * builds the nodes. It is a pure function over an already-parsed document --
 * reading the other file is the view's business, and so is deciding when.
 *
 * Two things about the shape of what comes out.
 *
 * Every node is `virtual`, and no id or key is one the current note could
 * produce: both carry the mark below. That is the whole safety story, and it is
 * the same one note-content cards rely on -- a node that is not in
 * `parsed.byId` is missed by every mutation, so rename, move, indent and delete
 * do nothing to it rather than doing something to the wrong note. The
 * projection is a reading of another file, and this map never writes to it.
 *
 * The nodes are a detached forest: their roots have no parent. Hanging them off
 * the link node would put two different trees in one `parent` chain -- walking
 * up from a projected node would cross into this note, and `isAncestor` would
 * start answering about a node whose lines are somewhere else entirely. The
 * layout knows where they go; nothing else needs to.
 *
 * `lineStart` and `blockEnd` are the source note's own line numbers, kept for
 * one purpose: opening that note at the right line. Nothing here may use them
 * as offsets into the note being mapped.
 */

import type { MindNode } from "./types.ts";

/**
 * What separates a projected node's id and key from its link node's.
 *
 * `$` cannot start a heading or a list item, and neither id nor key is ever
 * shown to anyone, so the mark only has to be impossible to collide with. It
 * is spelled the same way as the note-content mark on purpose: both are "this
 * node is not the note's", and anything looking for one should see the other.
 */
export const EMBED_ID_MARK = "$embed";

/**
 * How deep into the source outline the projection goes.
 *
 * A map has no business growing a card for every one of a thousand headings,
 * and the source note's own map would not show them all at once either. Level
 * one is what the arrow opens onto; the rest is there for the levels the user
 * unfolds by hand. Deeper than this is not a projection, it is a copy.
 */
export const EMBED_MAX_LEVELS = 8;

/** One note's outline as nodes of this map. */
export interface EmbedTree {
	/** The source note's top-level nodes, in the order the note has them. */
	roots: MindNode[];
	/** Every projected node, by the id the view will see on its card. */
	byId: Map<string, MindNode>;
	/** Every projected node, by the key a fold or a selection names it with. */
	byKey: Map<string, MindNode>;
	/** The deepest level carried, counting the roots as 1. */
	levels: number;
}

/**
 * Project `outline` under `link`.
 *
 * Ids and keys are built the way the parser builds them, one level at a time
 * from the parent, so a projected branch is named consistently with the note it
 * came from: `link.id + mark + 0.2` for position, and the same
 * `h:`/`l:`-prefixed text chain the parser uses for the key. Reusing that
 * scheme is what lets a remembered fold survive the source note being edited
 * anywhere else, which is the same promise the rest of the map makes.
 *
 * A repeated sibling gets the parser's `#1`, `#2` suffix, from the same
 * per-parent `used` map that `assignIdentity` keeps -- two identical headings
 * under one parent are two different nodes and must not share a key.
 */
export function projectOutline(
	link: MindNode,
	outline: readonly MindNode[],
	maxLevels: number = EMBED_MAX_LEVELS,
): EmbedTree {
	const byId = new Map<string, MindNode>();
	const byKey = new Map<string, MindNode>();
	const tree: EmbedTree = { roots: [], byId, byKey, levels: 0 };

	const clone = (
		source: MindNode,
		idPath: string,
		key: string,
		level: number,
		parent: MindNode | null,
	): MindNode => {
		const node: MindNode = {
			id: `${link.id}${EMBED_ID_MARK}${idPath}`,
			key,
			kind: source.kind,
			// Virtual for the reason the module note gives, and because it is
			// also true: there is no line of *this* note behind the card.
			virtual: true,
			text: source.text,
			level: source.level,
			indentWidth: 0,
			indent: "",
			marker: "",
			spacing: "",
			// A checkbox is the source note's, and is drawn but not clickable:
			// ticking it would write to a file this map does not own.
			checkbox: source.checkbox,
			checkboxSpacing: "",
			suffix: "",
			lineStart: source.lineStart,
			blockEnd: source.blockEnd,
			// Empty on purpose, and load-bearing. It is what keeps
			// `childrenOf` from trying to synthesise note-content cards for a
			// note whose text this view has never held.
			bodyRanges: [],
			annotationIndices: [],
			children: [],
			parent,
		};
		byId.set(node.id, node);
		byKey.set(node.key, node);
		if (level > tree.levels) tree.levels = level;
		if (level >= maxLevels) return node;

		const used = new Map<string, number>();
		source.children.forEach((child, index) => {
			const base = `${child.kind === "heading" ? "h" : "l"}:${child.text.trim().toLowerCase()}`;
			const seen = used.get(base) ?? 0;
			used.set(base, seen + 1);
			const childKey = `${key}/${base}${seen > 0 ? `#${seen}` : ""}`;
			node.children.push(clone(child, `${idPath}.${index}`, childKey, level + 1, node));
		});
		return node;
	};

	outline.forEach((source, index) => {
		// No parent: the projection hangs under the link node on screen, but it
		// is a second tree, and one `parent` chain cannot hold two notes.
		tree.roots.push(clone(source, String(index), `${link.key}${EMBED_ID_MARK}${index}`, 1, null));
	});
	return tree;
}

/**
 * The fold the arrow opens onto: the source note's top level, and everything
 * under it closed.
 *
 * The same shape the rest of the map opens in -- a note is drawn with its first
 * level showing and the rest behind the buttons -- asked of the projection
 * instead of the note. Pressing the arrow and being handed a thousand headings
 * is not a preview of a note, it is the note.
 *
 * A root with nothing under it folds nothing and is left out, or the card would
 * carry a button for an empty branch.
 */
export function embedFoldKeys(tree: EmbedTree): string[] {
	return tree.roots.filter((root) => root.children.length > 0).map((root) => root.key);
}

/** Whether an id names a projected node rather than one of this note's. */
export function isEmbedId(id: string): boolean {
	return id.includes(EMBED_ID_MARK);
}
