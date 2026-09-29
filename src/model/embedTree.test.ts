import { test } from "node:test";
import assert from "node:assert/strict";

import { EMBED_ID_MARK, embedFoldKeys, isEmbedId, projectOutline } from "./embedTree.ts";
import { parseMarkdown } from "./parse.ts";
import { soleLink } from "./noteName.ts";
import type { MindNode } from "./types.ts";

/** The link node the projection hangs under, as the parser would name it. */
function linkNode(): MindNode {
	const doc = parseMarkdown("# Plan\n\n- [[Guide]]\n", { title: "Plan" });
	for (const node of doc.byId.values()) {
		if (soleLink(node.text) !== null) return node;
	}
	throw new Error("the fixture note should parse to a link node");
}

/**
 * The outline of the note being projected.
 *
 * `root.children` and not the root: a note's own map draws its title as the
 * root card, and the link node is already that card for a projection. What the
 * arrow opens onto is what the note says under its title.
 */
function outline(text: string): MindNode[] {
	return parseMarkdown(text, { title: "Guide" }).root.children;
}

// --- shape -------------------------------------------------------------------

test("a projection carries the source outline, level by level", () => {
	const tree = projectOutline(linkNode(), outline("## Install\n\n### npm\n\n### pnpm\n\n## Use\n"));
	assert.deepEqual(
		tree.roots.map((node) => node.text),
		["Install", "Use"],
	);
	assert.deepEqual(
		tree.roots[0].children.map((node) => node.text),
		["npm", "pnpm"],
	);
	assert.equal(tree.levels, 2);
});

test("list items project the same as headings, nesting included", () => {
	const tree = projectOutline(linkNode(), outline("- a\n  - b\n"));
	assert.equal(tree.roots.length, 1);
	assert.equal(tree.roots[0].kind, "listitem");
	assert.deepEqual(
		tree.roots[0].children.map((node) => node.text),
		["b"],
	);
});

test("a note whose only heading is its H1 projects what is under the H1", () => {
	const tree = projectOutline(linkNode(), outline("# Install\n\n## npm\n\n## pnpm\n"));
	assert.deepEqual(
		tree.roots.map((node) => node.text),
		["npm", "pnpm"],
	);
	assert.equal(tree.levels, 1);
});

// --- the safety story ---------------------------------------------------------

test("every projected node is virtual, so no mutation will find it", () => {
	const tree = projectOutline(linkNode(), outline("## Install\n\n### npm\n"));
	for (const node of tree.byId.values()) assert.equal(node.virtual, true);
});

test("no projected id or key is one the current note could have", () => {
	const link = linkNode();
	const tree = projectOutline(link, outline("## Install\n\n### npm\n"));
	for (const node of tree.byId.values()) {
		assert.equal(isEmbedId(node.id), true);
		assert.ok(node.id.startsWith(`${link.id}${EMBED_ID_MARK}`));
		assert.ok(node.key.startsWith(`${link.key}${EMBED_ID_MARK}`));
	}
	assert.equal(isEmbedId(link.id), false);
});

test("a projection is a detached forest, not a second parent chain", () => {
	const tree = projectOutline(linkNode(), outline("## Install\n\n### npm\n"));
	for (const root of tree.roots) assert.equal(root.parent, null);
	assert.equal(tree.roots[0].children[0].parent, tree.roots[0]);
});

test("projected cards carry no body ranges, so no content card is invented", () => {
	const tree = projectOutline(linkNode(), outline("## Install\n\nsome prose\n\n### npm\n"));
	for (const node of tree.byId.values()) assert.deepEqual(node.bodyRanges, []);
});

test("the source note's own line numbers are kept, and are not this note's", () => {
	const tree = projectOutline(linkNode(), outline("intro\n\n## Install\n"));
	assert.equal(tree.roots[0].lineStart, 2);
});

// --- identity -----------------------------------------------------------------

test("two identical siblings are two keys, the way the parser names them", () => {
	const tree = projectOutline(linkNode(), outline("## Same\n\n## Same\n"));
	assert.notEqual(tree.roots[0].key, tree.roots[1].key);
	assert.equal(tree.byKey.size, 2);
});

test("the same key is built again from the same source note", () => {
	const text = "## Install\n\n### npm\n";
	const first = projectOutline(linkNode(), outline(text));
	const second = projectOutline(linkNode(), outline(text));
	assert.deepEqual([...first.byKey.keys()], [...second.byKey.keys()]);
	assert.deepEqual([...first.byId.keys()], [...second.byId.keys()]);
});

test("two links projecting the same note do not collide", () => {
	const doc = parseMarkdown("- [[Guide]]\n- [[Guide]]\n", { title: "Plan" });
	const links = doc.root.children;
	assert.equal(links.length, 2);
	const tree = projectOutline(links[1], outline("## Install\n"));
	assert.notEqual(tree.roots[0].id, `${links[0].id}${EMBED_ID_MARK}0`);
	assert.equal(tree.roots[0].id, `${links[1].id}${EMBED_ID_MARK}0`);
});

// --- bounds -------------------------------------------------------------------

test("the projection stops at the level cap", () => {
	const deep = "## 1\n\n### 2\n\n#### 3\n\n##### 4\n";
	const tree = projectOutline(linkNode(), outline(deep), 2);
	assert.equal(tree.levels, 2);
	assert.equal(tree.roots[0].children[0].children.length, 0);
});

test("an empty note projects to nothing at all", () => {
	const tree = projectOutline(linkNode(), outline(""));
	assert.deepEqual(tree.roots, []);
	assert.equal(tree.levels, 0);
});

// --- seeding the fold ---------------------------------------------------------

test("the fold opens onto the note's top level, the rest closed", () => {
	const tree = projectOutline(
		linkNode(),
		outline("## Install\n\n### npm\n\n### pnpm\n\n## Leaf\n"),
	);
	// `Install` has something under it and folds; `Leaf` has nothing and is
	// left out, so it gets no button.
	assert.deepEqual(embedFoldKeys(tree), [tree.roots[0].key]);
});

test("a projection with one level seeds no fold, so the arrow opens onto all of it", () => {
	const tree = projectOutline(linkNode(), outline("## One\n\n## Two\n"));
	assert.deepEqual(embedFoldKeys(tree), []);
});
