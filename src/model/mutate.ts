import { isBlank, replaceLine, spliceLines, toText } from "./lines.ts";
import type { LineDoc } from "./lines.ts";
import { isAncestor, renderNodeLine } from "./types.ts";
import type { CheckboxState, MindNode, ParsedDoc } from "./types.ts";
import {
	bodyColumn,
	childSpecFor,
	isHeadingLike,
	relevelBlock,
	shiftIndent,
	specOf,
} from "./releveling.ts";
import type { NodeSpec } from "./releveling.ts";
import { annotationText } from "./annotations.ts";

export interface Mutation {
	/** Full document text after the edit. */
	text: string;
	/** Line to re-focus once the new text is parsed, or -1. */
	focusLine: number;
	/** False when the operation was rejected; `text` is then unchanged. */
	ok: boolean;
}

function unchanged(parsed: ParsedDoc): Mutation {
	return { text: toText(parsed.doc), focusLine: -1, ok: false };
}

function done(doc: LineDoc, focusLine: number): Mutation {
	return { text: toText(doc), focusLine, ok: true };
}

function renderNew(spec: NodeSpec, text: string): string {
	return spec.indent + spec.marker + " " + text;
}

function nextOrderedMarker(marker: string): string {
	const m = /^(\d{1,9})([.)])$/.exec(marker);
	return m ? String(Number(m[1]) + 1) + m[2] : marker;
}

/**
 * Headings need a blank line around them to stay headings. List items must not
 * get one, or a tight list turns loose.
 *
 * The two sides are asked separately because a run of blocks being written in
 * one go has a heading at one end and something else at the other -- what
 * matters is the shape of the edge that meets the surrounding text, not the
 * shape of the whole run.
 */
function padBlock(
	lines: string[],
	insertAt: number,
	block: string[],
	padStart: boolean,
	padEnd: boolean,
): { block: string[]; offset: number } {
	if (block.length === 0) return { block, offset: 0 };
	const out = block.slice();
	let offset = 0;
	if (padStart && insertAt > 0 && !isBlank(lines[insertAt - 1])) {
		out.unshift("");
		offset = 1;
	}
	if (
		padEnd &&
		insertAt < lines.length &&
		!isBlank(lines[insertAt]) &&
		!isBlank(out[out.length - 1])
	) {
		out.push("");
	}
	return { block: out, offset };
}

interface Collapse {
	doc: LineDoc;
	/** Index the removal started at, for callers still holding later indices. */
	at: number;
	count: number;
}

/** Tidy the blank-line run left behind at a deletion seam. */
function collapseBlanks(doc: LineDoc, at: number, bodyStart: number): Collapse {
	let start = at;
	while (start > bodyStart && isBlank(doc.lines[start - 1])) start--;
	let end = at;
	while (end < doc.lines.length && isBlank(doc.lines[end])) end++;

	const run = end - start;
	if (run === 0) return { doc, at: start, count: 0 };
	const keep = end >= doc.lines.length ? 0 : Math.min(run, 1);
	if (run === keep) return { doc, at: start, count: 0 };
	return { doc: spliceLines(doc, start, run - keep, []), at: start, count: run - keep };
}

export function canRename(node: MindNode): boolean {
	return !node.virtual;
}

export function renameNode(
	parsed: ParsedDoc,
	node: MindNode,
	text: string,
): Mutation {
	if (!canRename(node) || node.lineStart < 0) return unchanged(parsed);
	const clean = text.replace(/[\r\n]+/g, " ").trim();
	if (clean === node.text) return unchanged(parsed);
	const doc = replaceLine(parsed.doc, node.lineStart, renderNodeLine(node, clean));
	return done(doc, node.lineStart);
}

/** Replace only annotation lines; all unrelated source stays byte-identical. */
export function setAnnotation(parsed: ParsedDoc, node: MindNode, text: string): Mutation {
	if (node.virtual || parsed.byId.get(node.id) !== node) return unchanged(parsed);
	const clean = text.replace(/\r\n|\r/g, "\n");
	if (clean === annotationText(parsed, node) && !(clean === "" && node.annotationIndices.length)) {
		return unchanged(parsed);
	}
	const ranges = node.annotationIndices.map((index) => node.bodyRanges[index]);
	const first = ranges[0];
	const indent = first
		? (/^[ \t]*/.exec(parsed.doc.lines[first[0]])?.[0] ?? "")
		: node.kind === "listitem"
			? node.indent + " ".repeat(node.marker.length) + node.spacing
			: "";
	const replacement = clean === "" ? [] : clean.split("\n").map((line) =>
		indent + (line === "" ? ":" : ": " + line));
	let doc = parsed.doc;
	// Consolidate separate annotation blocks at the first block's location.
	for (let i = ranges.length - 1; i >= 0; i--) {
		const [s, e] = ranges[i];
		doc = spliceLines(doc, s, e - s + 1, i === 0 ? replacement : []);
	}
	if (!first && replacement.length > 0) {
		doc = spliceLines(doc, node.lineStart + 1, 0, replacement);
	}
	if (parsed.doc.eols.at(-1) === "" && doc !== parsed.doc) {
		doc.eols[doc.eols.length - 1] = "";
	}
	return done(doc, node.lineStart);
}

/**
 * Add an indented text block under a node.
 *
 * The block is a child in everything that matters -- it belongs to the node, it
 * is written under it, and it folds and moves with it -- but it is written as
 * plain indented text rather than as a list item, so what lands in the note is
 * the prose itself rather than a bullet in front of it. A long explanation or a
 * snippet does not want a marker.
 *
 * The blank line is what makes it a block instead of more of the node's own
 * sentence. A paragraph on the very next line is a lazy continuation of the
 * item above it and would be read as part of the title, which is the one
 * outcome that would silently eat what the user typed.
 */
export function addBlock(parsed: ParsedDoc, node: MindNode, text: string): Mutation {
	if (node.virtual || node.lineStart < 0 || parsed.byId.get(node.id) !== node) {
		return unchanged(parsed);
	}
	// A list item's continuation is indented to its content column; a heading
	// owns what follows it at the margin. Four spaces under a heading would be a
	// code block, which is a different thing entirely.
	const indent =
		node.kind === "listitem" ? node.indent + " ".repeat(node.marker.length) + node.spacing : "";
	const insert = text.split("\n").map((line) => (line === "" ? "" : indent + line));
	const doc = spliceLines(parsed.doc, node.lineStart + 1, 0, insert);
	if (parsed.doc.eols.at(-1) === "" && doc !== parsed.doc) {
		doc.eols[doc.eols.length - 1] = "";
	}
	return done(doc, node.lineStart + 1);
}

export function addChild(	parsed: ParsedDoc,
	parent: MindNode,
	text = "",
): Mutation {
	const spec = childSpecFor(parent, parsed.indentUnit);
	const insertAt = Math.max(parent.blockEnd + 1, parsed.bodyStart);
	const { block, offset } = padBlock(
		parsed.doc.lines,
		insertAt,
		[renderNew(spec, text)],
		spec.kind === "heading",
		spec.kind === "heading",
	);
	const doc = spliceLines(parsed.doc, insertAt, 0, block);
	return done(doc, insertAt + offset);
}

export function addSibling(
	parsed: ParsedDoc,
	node: MindNode,
	text = "",
): Mutation {
	if (!node.parent || node.lineStart < 0) return unchanged(parsed);
	const spec = specOf(node);
	if (spec.kind === "listitem") spec.marker = nextOrderedMarker(spec.marker);

	const insertAt = Math.max(node.blockEnd + 1, parsed.bodyStart);
	const { block, offset } = padBlock(
		parsed.doc.lines,
		insertAt,
		[renderNew(spec, text)],
		spec.kind === "heading",
		spec.kind === "heading",
	);
	const doc = spliceLines(parsed.doc, insertAt, 0, block);
	return done(doc, insertAt + offset);
}

/**
 * A sibling directly above `node`, rather than below it.
 *
 * The marker is taken as-is: `nextOrderedMarker` is for appending after a
 * numbered item, and inserting above one wants that item's own number.
 */
export function addSiblingBefore(
	parsed: ParsedDoc,
	node: MindNode,
	text = "",
): Mutation {
	if (!node.parent || node.lineStart < 0) return unchanged(parsed);
	const spec = specOf(node);

	const insertAt = Math.max(node.lineStart, parsed.bodyStart);
	const { block, offset } = padBlock(
		parsed.doc.lines,
		insertAt,
		[renderNew(spec, text)],
		spec.kind === "heading",
		spec.kind === "heading",
	);
	const doc = spliceLines(parsed.doc, insertAt, 0, block);
	return done(doc, insertAt + offset);
}

export function deleteNode(parsed: ParsedDoc, node: MindNode): Mutation {
	if (!node.parent || node.lineStart < 0) return unchanged(parsed);
	const count = node.blockEnd - node.lineStart + 1;
	const removed = spliceLines(parsed.doc, node.lineStart, count, []);
	const { doc } = collapseBlanks(removed, node.lineStart, parsed.bodyStart);
	return done(doc, Math.max(node.parent.lineStart, -1));
}

/**
 * Delete several subtrees as one edit.
 *
 * One edit rather than one per node, so a batch comes back as a single undo
 * step. A node that sits inside another selected node's block is dropped from
 * the list: its lines are already going with its ancestor's, and splicing them
 * a second time would remove whatever moved up to take their place.
 *
 * The seams are tidied from the bottom up, which is also the order the splices
 * have to happen in -- every index below the one being removed is still the
 * index it was, so nothing has to be re-mapped between them.
 */
export function deleteNodes(parsed: ParsedDoc, nodes: readonly MindNode[]): Mutation {
	const blocks = nodes
		.filter((node) => node.parent !== null && node.lineStart >= 0)
		.map((node) => ({ node, start: node.lineStart, end: node.blockEnd }))
		.sort((a, b) => a.start - b.start);

	const kept: Array<{ node: MindNode; start: number; end: number }> = [];
	for (const block of blocks) {
		const last = kept[kept.length - 1];
		if (last && block.start <= last.end) continue;
		kept.push(block);
	}
	if (kept.length === 0) return unchanged(parsed);

	let doc = parsed.doc;
	for (let i = kept.length - 1; i >= 0; i--) {
		const block = kept[i];
		const removed = spliceLines(doc, block.start, block.end - block.start + 1, []);
		doc = collapseBlanks(removed, block.start, parsed.bodyStart).doc;
	}
	const parent = kept[0].node.parent;
	return done(doc, Math.max(parent ? parent.lineStart : -1, -1));
}

/**
 * Write a checkbox state onto a list item, or take the checkbox away with
 * `null`. Only the item's own marker line is rewritten; the spacing around the
 * box is the file's own, so a state change is the three characters inside the
 * brackets and nothing else.
 */
export function setCheckbox(
	parsed: ParsedDoc,
	node: MindNode,
	next: CheckboxState,
): Mutation {
	if (isHeadingLike(node) || node.virtual || node.lineStart < 0) {
		return unchanged(parsed);
	}
	if (next === node.checkbox) return unchanged(parsed);
	const spacing = node.spacing || " ";
	const check = next === null ? "" : `[${next}]${node.checkboxSpacing || " "}`;
	const line = node.indent + node.marker + spacing + check + node.text + node.suffix;
	return done(replaceLine(parsed.doc, node.lineStart, line), node.lineStart);
}

/**
 * Tick a list item off, or clear it again. An item with no checkbox gets an
 * empty one.
 *
 * Unchecking returns `[x]` to `[ ]` and never removes the box: the card draws
 * its checkbox only for an item that has one, so a removal here would take the
 * control away under the pointer that just pressed it, and leave a plain bullet
 * where the user asked for an unticked task. `removeCheckbox` is the way a
 * checkbox goes.
 */
export function toggleCheckbox(parsed: ParsedDoc, node: MindNode): Mutation {
	return setCheckbox(parsed, node, node.checkbox === " " ? "x" : " ");
}

/** Back to a plain list item, whatever the box said. */
export function removeCheckbox(parsed: ParsedDoc, node: MindNode): Mutation {
	return setCheckbox(parsed, node, null);
}

export function canMove(node: MindNode, newParent: MindNode): boolean {
	if (!node.parent || node.lineStart < 0) return false;
	if (node === newParent) return false;
	if (isAncestor(node, newParent)) return false;
	return true;
}

/**
 * Move a subtree under `newParent`, landing directly after line `anchorLine`.
 *
 * Callers differ in which line they anchor to -- the parent's last line (append
 * as the last child), a sibling's last line (drop below it), the line above a
 * sibling (drop above it) -- and in `kind`, the shape the block takes when it
 * lands.
 */
function moveWithAnchor(
	parsed: ParsedDoc,
	node: MindNode,
	newParent: MindNode,
	anchorLine: number,
	kind: "heading" | "listitem",
): Mutation {
	if (!canMove(node, newParent)) return unchanged(parsed);

	const rootSpec = childSpecFor(newParent, parsed.indentUnit, kind);
	const block = relevelBlock(parsed, node, rootSpec, parsed.indentUnit);

	const removeStart = node.lineStart;
	const removeCount = node.blockEnd - node.lineStart + 1;

	// If the anchor sits inside the block we are lifting out (it does when the
	// target is our own ancestor and we are its last content), fall back to the
	// hole we just made.
	let anchor = anchorLine;
	if (anchor >= removeStart && anchor <= node.blockEnd) anchor = removeStart - 1;

	const removed = spliceLines(parsed.doc, removeStart, removeCount, []);
	const tidy = collapseBlanks(removed, removeStart, parsed.bodyStart);
	let doc = tidy.doc;

	let insertAt = anchor + 1;
	if (anchor >= removeStart) insertAt -= removeCount;
	if (insertAt > tidy.at) insertAt -= Math.min(tidy.count, insertAt - tidy.at);
	insertAt = Math.max(parsed.bodyStart, Math.min(insertAt, doc.lines.length));

	const { block: padded, offset } = padBlock(
		doc.lines,
		insertAt,
		block,
		rootSpec.kind === "heading",
		rootSpec.kind === "heading",
	);
	doc = spliceLines(doc, insertAt, 0, padded);
	return done(doc, insertAt + offset);
}

/**
 * Move a subtree under `newParent`, rewriting its markers for the new depth.
 *
 * `after` places the block directly following that node instead of appending it
 * as the last child, which is what outdenting needs.
 */
export function moveNode(
	parsed: ParsedDoc,
	node: MindNode,
	newParent: MindNode,
	after?: MindNode,
): Mutation {
	if (!canMove(node, newParent)) return unchanged(parsed);
	return moveWithAnchor(
		parsed,
		node,
		newParent,
		(after ?? newParent).blockEnd,
		isHeadingLike(node) ? "heading" : "listitem",
	);
}

/**
 * Whether `node` may be dropped beside `target` as one of its siblings.
 *
 * True at every level, the root's own children included. A first-level branch
 * used to be excluded here, on the reasoning that the layout decides their
 * order: it splits them between the two sides of the root by weight. But the
 * split is a *prefix* of the order the note is written in -- the earlier
 * branches go down the right of the root, the rest down the left -- so the
 * order is not the layout's, it is the note's, and the layout merely reads it.
 * Refusing the drop did not protect that order; it only left the card with the
 * one slot that was still legal, so aiming above or below a first-level branch
 * quietly turned the gesture into "become its child".
 *
 * Landing past the halfway point does move a branch to the other side of the
 * root, and that is the point: where it sits in the reading order is what the
 * user set, and the side follows from it. See `partition` in `tidyTree.ts`.
 *
 * Still false for the root, which has no siblings to land among, and for a
 * target the note does not actually write.
 */
/**
 * Whether `target` is a card anything can be written beside at all.
 *
 * The target's own half of `canReorder`, which a whole run of nodes has to
 * agree about -- so it is asked once, of the target, rather than restated per
 * node. False for the root, which has no siblings to land among, and for a node
 * the note does not actually write.
 */
function canLandBeside(target: MindNode): target is MindNode & { parent: MindNode } {
	return target.parent !== null && !target.virtual && target.lineStart >= 0;
}

export function canReorder(node: MindNode, target: MindNode): boolean {
	// No parent: the root, which has nothing to be a sibling of.
	if (!canLandBeside(target)) return false;
	if (node === target) return false;
	return canMove(node, target.parent);
}

/**
 * The shape a node has to take to be read as `target`'s sibling.
 *
 * It is the *target's* kind, not the moved node's: a list item written after a
 * heading is that heading's content, not its sibling, and a heading written
 * among list items swallows the ones below it. Landing beside something means
 * being written the way it is written.
 */
function siblingKind(target: MindNode): "heading" | "listitem" {
	return isHeadingLike(target) ? "heading" : "listitem";
}

/** Drop `node` in as `target`'s sibling, directly above it. */
export function moveBefore(
	parsed: ParsedDoc,
	node: MindNode,
	target: MindNode,
): Mutation {
	if (!canReorder(node, target) || !target.parent) return unchanged(parsed);
	return moveWithAnchor(
		parsed,
		node,
		target.parent,
		target.lineStart - 1,
		siblingKind(target),
	);
}

/** Drop `node` in as `target`'s sibling, after the whole of `target`'s subtree. */
export function moveAfter(
	parsed: ParsedDoc,
	node: MindNode,
	target: MindNode,
): Mutation {
	if (!canReorder(node, target) || !target.parent) return unchanged(parsed);
	return moveWithAnchor(parsed, node, target.parent, target.blockEnd, siblingKind(target));
}

/**
 * Move several subtrees under `newParent` as one edit, landing in one run after
 * `anchorLine`, in the order the note writes them.
 *
 * One edit rather than one per node, for the same reason `deleteNodes` is one:
 * a whole selection dragged somewhere is one thing the user did, so it has to
 * come back as a single undo step.
 *
 * The run lands together and in written order. Dropping a selection onto a card
 * makes all of it that card's children; dropping it beside one writes the whole
 * run above or below that card, with the nodes in the order they had before --
 * which is the order the reader had them in, and the map merely reads.
 *
 * A node inside another selected node's block is dropped from the list: moving
 * the ancestor carries it along, and lifting it a second time would take it
 * back out of the parent it just arrived under. The same rule `deleteNodes`
 * applies, for the same reason.
 *
 * Past that, **all of it or none of it.** A node the note does not write -- the
 * root, a virtual node -- is dropped the way `deleteNodes` drops it, but a node
 * that cannot make this particular trip refuses the whole group rather than
 * being quietly left behind: a drag that half happened is worse than one that
 * did not.
 */
function moveGroup(
	parsed: ParsedDoc,
	nodes: readonly MindNode[],
	newParent: MindNode,
	anchorLine: number,
	kindOf: (node: MindNode) => "heading" | "listitem",
): Mutation {
	const spans = nodes
		.filter((node) => node.parent !== null && node.lineStart >= 0)
		.map((node) => ({ node, start: node.lineStart, end: node.blockEnd }))
		.sort((a, b) => a.start - b.start);

	const kept: typeof spans = [];
	for (const span of spans) {
		if (!canMove(span.node, newParent)) return unchanged(parsed);
		const last = kept[kept.length - 1];
		if (last && span.start <= last.end) continue;
		kept.push(span);
	}
	if (kept.length === 0) return unchanged(parsed);
	// One node is the ordinary case, and it has an implementation that predates
	// this one and is pinned by its own tests. Delegate rather than restate it.
	if (kept.length === 1) {
		return moveWithAnchor(
			parsed,
			kept[0].node,
			newParent,
			anchorLine,
			kindOf(kept[0].node),
		);
	}

	// Where the run goes: directly after `anchorLine`. An anchor sitting inside
	// a block being lifted -- it is when the target is an ancestor of ours and
	// we are its last content -- falls back to the seam that block leaves, which
	// is the same fallback `moveWithAnchor` takes.
	let anchor = anchorLine;
	for (const span of kept) {
		if (anchor >= span.start && anchor <= span.end) anchor = span.start - 1;
	}

	// Every block, releveled for its new parent, worked out before one line
	// moves: `relevelBlock` reads the tree the nodes came from, and that tree is
	// about to stop being the one on screen.
	const blocks = kept.map((span) =>
		relevelBlock(
			parsed,
			span.node,
			childSpecFor(newParent, parsed.indentUnit, kindOf(span.node)),
			parsed.indentUnit,
		),
	);

	// Lift them out from the bottom up, so every index below a seam is still the
	// index it was -- the order `deleteNodes` splices in, and for the same
	// reason. `at` is the anchor's line as the document stands, which only moves
	// when a block comes out from above it; nothing below the anchor moves it,
	// and everything already lifted was below the block being lifted next.
	let doc = parsed.doc;
	let at = anchor;
	for (let i = kept.length - 1; i >= 0; i--) {
		const span = kept[i];
		const count = span.end - span.start + 1;
		const removed = spliceLines(doc, span.start, count, []);
		const tidy = collapseBlanks(removed, span.start, parsed.bodyStart);
		doc = tidy.doc;
		if (span.end >= at) continue;
		at -= count;
		if (at > tidy.at) at -= Math.min(tidy.count, at - tidy.at);
	}

	let insertAt = at + 1;
	insertAt = Math.max(parsed.bodyStart, Math.min(insertAt, doc.lines.length));

	// The run pads by its own two edges -- a heading written against the
	// surrounding text needs a blank line, a list item must not have one -- and
	// between two of its own blocks for the same reason: the note is read back
	// heading by heading, and `### A` directly under a paragraph of `A` is the
	// one seam a reader notices.
	const run: string[] = [];
	for (const [index, block] of blocks.entries()) {
		if (index > 0 && isHeadingLike(kept[index].node) && !isBlank(run[run.length - 1])) {
			run.push("");
		}
		run.push(...block);
	}
	const { block: padded, offset } = padBlock(
		doc.lines,
		insertAt,
		run,
		isHeadingLike(kept[0].node),
		isHeadingLike(kept[kept.length - 1].node),
	);
	doc = spliceLines(doc, insertAt, 0, padded);
	return done(doc, insertAt + offset);
}

/**
 * Move several subtrees in under `newParent`, as its last children.
 *
 * The drag's version of `moveNode` with no `after`: what a drop on a card
 * means for everything the pointer was carrying.
 */
export function moveNodesInto(
	parsed: ParsedDoc,
	nodes: readonly MindNode[],
	newParent: MindNode,
): Mutation {
	return moveGroup(parsed, nodes, newParent, newParent.blockEnd, (node) =>
		isHeadingLike(node) ? "heading" : "listitem",
	);
}

/** Drop several subtrees in as `target`'s siblings, directly above it. */
export function moveNodesBefore(
	parsed: ParsedDoc,
	nodes: readonly MindNode[],
	target: MindNode,
): Mutation {
	if (!canLandBeside(target)) return unchanged(parsed);
	return moveGroup(
		parsed,
		nodes,
		target.parent,
		target.lineStart - 1,
		() => siblingKind(target),
	);
}

/** Drop several subtrees in as `target`'s siblings, below its whole subtree. */
export function moveNodesAfter(
	parsed: ParsedDoc,
	nodes: readonly MindNode[],
	target: MindNode,
): Mutation {
	if (!canLandBeside(target)) return unchanged(parsed);
	return moveGroup(
		parsed,
		nodes,
		target.parent,
		target.blockEnd,
		() => siblingKind(target),
	);
}

/** The sibling `offset` places along from `node`, or null past either end. */
function siblingAt(node: MindNode, offset: number): MindNode | null {
	const siblings = node.parent?.children;
	if (!siblings) return null;
	const index = siblings.indexOf(node);
	if (index < 0) return null;
	return siblings[index + offset] ?? null;
}

/**
 * Whether `node` can swap places with the sibling above / below it.
 *
 * False at either end of a run, and false for the root, which has no run to be
 * in. A first-level branch has one like anything else -- the keyboard and the
 * pointer reach the same places.
 */
export function canReorderUp(node: MindNode): boolean {
	const previous = siblingAt(node, -1);
	return previous !== null && canReorder(node, previous);
}

export function canReorderDown(node: MindNode): boolean {
	const next = siblingAt(node, 1);
	return next !== null && canReorder(node, next);
}

/**
 * Swap `node` with the sibling above it.
 *
 * This is the drop that dragging the card onto that sibling's top edge already
 * performs -- `siblingKind` included, so a node landing among list items is
 * written as one -- reached with the keyboard instead of the pointer.
 */
export function reorderUp(parsed: ParsedDoc, node: MindNode): Mutation {
	const previous = siblingAt(node, -1);
	if (!previous) return unchanged(parsed);
	return moveBefore(parsed, node, previous);
}

/** Swap `node` with the sibling below it, clearing that sibling's whole subtree. */
export function reorderDown(parsed: ParsedDoc, node: MindNode): Mutation {
	const next = siblingAt(node, 1);
	if (!next) return unchanged(parsed);
	return moveAfter(parsed, node, next);
}

export function indentNode(parsed: ParsedDoc, node: MindNode): Mutation {
	const siblings = node.parent?.children ?? [];
	const index = siblings.indexOf(node);
	if (index <= 0) return unchanged(parsed);
	return moveNode(parsed, node, siblings[index - 1]);
}

export function outdentNode(parsed: ParsedDoc, node: MindNode): Mutation {
	const parent = node.parent;
	if (!parent || !parent.parent) return unchanged(parsed);
	return moveNode(parsed, node, parent.parent, parent);
}

/** Replace one body range's text, used by the node's body popover. */
export function replaceBodyRange(
	parsed: ParsedDoc,
	node: MindNode,
	rangeIndex: number,
	text: string,
): Mutation {
	const range = node.bodyRanges[rangeIndex];
	if (!range) return unchanged(parsed);
	const [start, end] = range;
	const replacement = text.split(/\r\n|\n|\r/);
	const doc = spliceLines(parsed.doc, start, end - start + 1, replacement);
	return done(doc, node.lineStart);
}

/** Text of one body range, for display and editing. */
export function bodyRangeText(parsed: ParsedDoc, range: [number, number]): string {
	return parsed.doc.lines.slice(range[0], range[1] + 1).join("\n");
}

/**
 * Whether a note-content block can be lifted out of `owner` and put down under
 * `target`, landing above the line `before` -- or, when `before` is null, as the
 * last thing the target holds.
 *
 * A block is a range of the note's lines rather than a node, so the rules are
 * about lines: it cannot be put down between its own lines, because that is
 * putting it inside itself, and landing in the owner it already has is only a
 * move when a line is named -- with none, the block goes back exactly where it
 * came from and the drop would say nothing.
 */
export function canMoveBodyBlock(
	owner: MindNode,
	index: number,
	target: MindNode,
	before: number | null,
): boolean {
	const range = owner.bodyRanges[index];
	if (!range) return false;
	if (target === owner) return before !== null;
	return !(target.lineStart >= range[0] && target.lineStart <= range[1]);
}

/**
 * Move one body range to another node, or to another place in the same one.
 *
 * The block keeps its own lines and its own internal indentation; only the
 * leading whitespace that attaches it to an owner changes, by the difference
 * between the two nodes' body columns. That is the same shift `relevelBlock`
 * applies to a moved subtree, and it is why a fenced sample survives the trip
 * with its code intact -- the lines inside the fence are never touched.
 *
 * `before` names a line of the document as it is now. The block is lifted out
 * first, so a line below it is one block too high afterwards; the subtraction
 * below is that correction, and it is the same one `moveWithAnchor` makes.
 */
export function moveBodyBlock(
	parsed: ParsedDoc,
	owner: MindNode,
	index: number,
	target: MindNode,
	before: number | null,
): Mutation {
	const range = owner.bodyRanges[index];
	if (!range || !canMoveBodyBlock(owner, index, target, before)) return unchanged(parsed);

	const delta = bodyColumn(target) - bodyColumn(owner);
	const block = parsed.doc.lines
		.slice(range[0], range[1] + 1)
		.map((line) => shiftIndent(line, delta, parsed.indentUnit));

	const count = range[1] - range[0] + 1;
	const lifted = spliceLines(parsed.doc, range[0], count, []);

	// Where it lands, counted in the document the block is no longer in.
	let at = before === null ? target.blockEnd + 1 : before;
	if (at > range[1]) at -= count;
	at = Math.max(0, Math.min(at, lifted.lines.length));

	return done(spliceLines(lifted, at, 0, block), at);
}
