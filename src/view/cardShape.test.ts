import { test } from "node:test";
import assert from "node:assert/strict";

import { cardShape } from "./cardShape.ts";
import type { CardShape } from "./cardShape.ts";

/**
 * The card every case starts from: a topic card, no annotation, no preview.
 *
 * Only the fields the case is about are named, so a new field appearing in the
 * options cannot quietly make two cards different that this file says are the
 * same -- nor make two the same that it says are different.
 */
function shape(over: Partial<CardShape> = {}): CardShape {
	return {
		text: "Install",
		checkbox: null,
		kind: "listitem",
		depth: 1,
		annotation: null,
		maxWidth: { node: 260, text: null },
		branchColors: true,
		blocks: null,
		media: null,
		preformatted: false,
		addable: true,
		collapsible: false,
		collapsed: false,
		hasChildren: false,
		hiddenCount: 0,
		selected: false,
		projected: false,
		link: null,
		...over,
	};
}

const different = (a: CardShape, b: CardShape, what: string): void => {
	assert.notEqual(cardShape(a), cardShape(b), `${what} must change the shape`);
};

// --- the question the shape is asked -----------------------------------------

test("two cards drawn from the same thing are the same shape", () => {
	assert.equal(cardShape(shape()), cardShape(shape()));
});

test("a card that says something else is not", () => {
	different(shape(), shape({ text: "Uninstall" }), "the text");
});

test("nor is one moved to another depth, which the stylesheet sizes by", () => {
	different(shape(), shape({ depth: 3 }), "the depth");
});

test("nor is one wearing a different checkbox", () => {
	different(shape(), shape({ checkbox: "x" }), "the checkbox");
});

test("nor is one with a cap of another width", () => {
	different(shape(), shape({ maxWidth: { node: 180, text: null } }), "the node cap");
	different(shape(), shape({ maxWidth: { node: 260, text: 200 } }), "the text cap");
});

test("nor is one drawing a strip under it", () => {
	different(shape(), shape({ annotation: "needs sudo" }), "the annotation");
	// An empty strip is a strip, and it is not the absence of one.
	different(shape(), shape({ annotation: "" }), "a blank annotation");
});

test("nor is one drawing prose as blocks, or as a sample", () => {
	different(shape(), shape({ preformatted: true }), "a sample");
	different(shape(), shape({ blocks: [] }), "blocks");
	// Not even an empty run of them: the box a block brings is not the box a
	// line brings, and the parser hands over the one it found.
	different(
		shape({ blocks: [] }),
		shape({ blocks: [{ kind: "paragraph", text: "run npm install" }] }),
		"a block more",
	);
	// And not merely how many there are: a table and a sample are one block
	// each, and a card is not the same height for the two.
	different(
		shape({ blocks: [{ kind: "code", lang: "", text: "a" }] }),
		shape({ blocks: [{ kind: "table", align: [null], header: ["a"], rows: [["b"]] }] }),
		"the kind of block",
	);
	// A sample is only a sample while there are no blocks to draw instead: the
	// builder reaches for `preformatted` on the way past `blocks`, and never
	// once it has them.
	assert.equal(
		cardShape(shape({ blocks: [], preformatted: false })),
		cardShape(shape({ blocks: [], preformatted: true })),
	);
});

test("nor is one licensed to draw pictures", () => {
	const media = {} as CardShape["media"];
	different(shape(), shape({ media }), "media");
});

test("nor is one whose button says something else", () => {
	different(shape({ hasChildren: true }), shape({ hasChildren: true, collapsed: true }), "the fold");
	different(
		shape({ hasChildren: true, collapsed: true }),
		shape({ hasChildren: true, collapsed: true, hiddenCount: 4 }),
		"the count",
	);
	different(shape(), shape({ addable: false }), "the button's absence");
});

// --- the ones that were the bug ----------------------------------------------

test("a link card that opened its preview is not the card that had not", () => {
	const closed = shape({
		link: {
			oneLink: true,
			arrow: false,
			subtreeOpen: false,
			preview: null,
			read: null,
			site: null,
			footer: "note",
		},
	});
	const open = shape({
		link: {
			oneLink: true,
			arrow: false,
			subtreeOpen: false,
			preview: { lines: ["# Install", "", "run npm install"], more: 2 },
			read: "ready",
			site: null,
			footer: "note",
		},
	});
	different(closed, open, "the preview opening");
});

test("the preview's own words are part of the shape, not just that there is one", () => {
	// The read lands after the paint that asked for it, so the card drawn while
	// the note is still being read is a shorter card than the one that arrives.
	const loading = shape({
		link: {
			oneLink: true,
			arrow: false,
			subtreeOpen: false,
			preview: { lines: [], more: 0 },
			read: "loading",
			site: null,
			footer: "note",
		},
	});
	const landed = shape({
		link: {
			oneLink: true,
			arrow: false,
			subtreeOpen: false,
			preview: { lines: ["# Install"], more: 0 },
			read: "ready",
			site: null,
			footer: "note",
		},
	});
	different(loading, landed, "the read landing");
});

test("a card leading out of the vault is not one leading to a note in it", () => {
	const note = shape({
		link: {
			oneLink: true,
			arrow: false,
			subtreeOpen: false,
			preview: { lines: [], more: 0 },
			read: "ready",
			site: null,
			footer: "note",
		},
	});
	const site = shape({
		link: {
			oneLink: true,
			arrow: false,
			subtreeOpen: false,
			preview: { lines: [], more: 0 },
			read: "ready",
			site: { host: "example.com", path: "/docs/install" },
			footer: "site",
		},
	});
	different(note, site, "the site");
});

test("an outline open under the card is a card with more on it", () => {
	const shut = shape({
		link: {
			oneLink: true,
			arrow: true,
			subtreeOpen: false,
			preview: null,
			read: null,
			site: null,
			footer: "note",
		},
	});
	different(
		shut,
		{ ...shut, link: { ...shut.link!, subtreeOpen: true } },
		"the outline opening",
	);
});
