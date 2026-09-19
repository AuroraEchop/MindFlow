import { test } from "node:test";
import assert from "node:assert/strict";

import { parseMarkdown, serialize } from "./parse.ts";
import { bodyCardCount } from "./annotations.ts";
import { walk } from "./types.ts";
import type { MindNode, ParsedDoc } from "./types.ts";
import {
	addBlock,
	addChild,
	addSibling,
	addSiblingBefore,
	bodyRangeText,
	canMove,
	canMoveBodyBlock,
	canReorder,
	canReorderDown,
	canReorderUp,
	deleteNode,
	deleteNodes,
	indentNode,
	moveAfter,
	moveBefore,
	moveBodyBlock,
	moveNode,
	moveNodesAfter,
	moveNodesBefore,
	moveNodesInto,
	outdentNode,
	removeCheckbox,
	renameNode,
	reorderDown,
	reorderUp,
	replaceBodyRange,
	setCheckbox,
	toggleCheckbox,
} from "./mutate.ts";
import type { Mutation } from "./mutate.ts";

const F = "```";
const FRONTMATTER = ["---", "title: Fixture", "tags: [x]", "---"].join("\n");
const CODE_LINE = 'const keep = "  # untouched  ";';

const FIXTURE = [
	FRONTMATTER,
	"",
	"# Root",
	"",
	"Intro paragraph.",
	"",
	"## Alpha",
	"",
	"- one",
	"  - one-a",
	"  - [ ] task",
	"- two",
	"",
	"## Beta",
	"",
	`${F}js`,
	"// # not a heading",
	CODE_LINE,
	F,
	"",
	"### Gamma",
	"",
	"Tail.",
	"",
].join("\n");

function parse(text = FIXTURE): ParsedDoc {
	return parseMarkdown(text, { title: "Fixture" });
}

function find(parsed: ParsedDoc, text: string): MindNode {
	let hit: MindNode | null = null;
	walk(parsed.root, (n) => {
		if (n.text === text && !hit) hit = n;
	});
	if (!hit) throw new Error(`no node with text "${text}"`);
	return hit;
}

function lines(text: string): string[] {
	return text.split("\n");
}

// --- targeted behaviour ------------------------------------------------------

test("rename keeps indent, marker, checkbox and trailing suffix", () => {
	const p = parse("# R\n\n-   [x]   done   \n\n## H ##\n");
	const item = find(p, "done");
	const renamed = renameNode(p, item, "finished");
	assert.ok(renamed.ok);
	assert.ok(lines(renamed.text).includes("-   [x]   finished   "));

	const p2 = parse(renamed.text);
	const heading = find(p2, "H");
	const r2 = renameNode(p2, heading, "Header");
	assert.ok(lines(r2.text).includes("## Header ##"));
});

test("rename is rejected on a virtual root", () => {
	const p = parse("- a\n- b\n");
	assert.equal(p.root.virtual, true);
	assert.equal(renameNode(p, p.root, "nope").ok, false);
});

test("rename flattens newlines rather than corrupting the line", () => {
	const source = "# R\n\n- a\n";
	const p = parse(source);
	const out = renameNode(p, find(p, "a"), "line one\nline two");
	assert.ok(lines(out.text).includes("- line one line two"));
	// Pasting a multi-line value must not split the node into two lines.
	assert.equal(parse(out.text).doc.lines.length, p.doc.lines.length);
});

test("addChild mimics existing children", () => {
	const p = parse();
	// Alpha's children are list items, so a new child is a list item too.
	const out = addChild(p, find(p, "Alpha"), "three");
	assert.ok(lines(out.text).includes("- three"));
	// It lands after the last existing child's subtree.
	const ls = lines(out.text);
	assert.equal(ls[ls.indexOf("- two") + 1], "- three");
});

test("addChild under a childless heading makes a deeper heading", () => {
	const p = parse();
	const out = addChild(p, find(p, "Gamma"), "Delta");
	assert.ok(lines(out.text).includes("#### Delta"));
	// Headings get blank-line padding.
	const ls = lines(out.text);
	const i = ls.indexOf("#### Delta");
	assert.equal(ls[i - 1], "");
});

test("addChild under an H6 falls back to a list item", () => {
	const p = parse("# R\n\n###### Deep\n");
	const out = addChild(p, find(p, "Deep"), "item");
	assert.ok(lines(out.text).includes("- item"));
});

test("addChild under a list item nests with the detected indent unit", () => {
	const tabs = parse("# R\n\n- a\n\t- b\n");
	assert.equal(tabs.indentUnit, "\t");
	const out = addChild(tabs, find(tabs, "b"), "c");
	assert.ok(lines(out.text).includes("\t\t- c"));

	const spaces = parse("# R\n\n- a\n  - b\n");
	const out2 = addChild(spaces, find(spaces, "b"), "c");
	assert.ok(lines(out2.text).includes("    - c"));
});

test("addChild on an empty note creates an outline, not a competing H1", () => {
	const p = parse("");
	const out = addChild(p, p.root, "first");
	assert.ok(lines(out.text).includes("- first"));
	assert.equal(parse(out.text).root.virtual, true);
});

test("addSibling copies the prefix and advances ordered markers", () => {
	const p = parse("# R\n\n1. first\n2. second\n");
	const out = addSibling(p, find(p, "first"), "inserted");
	// Inserted straight after "first", numbered one higher.
	const ls = lines(out.text);
	assert.equal(ls[ls.indexOf("1. first") + 1], "2. inserted");

	const bullets = parse("# R\n\n* a\n");
	const out2 = addSibling(bullets, find(bullets, "a"), "b");
	assert.ok(lines(out2.text).includes("* b"));
});

test("addSibling is rejected on the root", () => {
	const p = parse();
	assert.equal(addSibling(p, p.root, "x").ok, false);
});

test("addSiblingBefore lands above the node and keeps its marker", () => {
	const p = parse("# R\n\n1. first\n2. second\n");
	const out = addSiblingBefore(p, find(p, "second"), "inserted");
	const ls = lines(out.text);
	// The marker is copied rather than advanced: this item takes second's place.
	assert.equal(ls[ls.indexOf("2. second") - 1], "2. inserted");
});

test("addSiblingBefore pads a heading with its blank line", () => {
	const p = parse();
	const out = addSiblingBefore(p, find(p, "Beta"), "Mid");
	const ls = lines(out.text);
	const i = ls.indexOf("## Mid");
	assert.ok(i > 0);
	assert.equal(ls[i + 1], "");
	assert.equal(ls[i + 2], "## Beta");
});

test("addSiblingBefore is rejected on the root", () => {
	const p = parse();
	assert.equal(addSiblingBefore(p, p.root, "x").ok, false);
});

test("delete removes the whole subtree and tidies the seam", () => {
	const p = parse();
	const out = deleteNode(p, find(p, "Alpha"));
	const ls = lines(out.text);
	assert.ok(!ls.includes("## Alpha"));
	assert.ok(!ls.includes("- one"));
	assert.ok(!ls.includes("  - [ ] task"));
	assert.ok(!ls.includes("- two"));
	// Beta and everything after it survive.
	assert.ok(ls.includes("## Beta"));
	assert.ok(ls.includes(CODE_LINE));
	// No run of two blank lines is left behind.
	assert.ok(!out.text.includes("\n\n\n"));
});

test("delete is rejected on the root", () => {
	const p = parse();
	assert.equal(deleteNode(p, p.root).ok, false);
});

// --- the indented text block ---------------------------------------------------

/** Every line of the block a node owns, as written. */
function bodyLines(parsed: ParsedDoc, node: MindNode): string[] {
	const lines = serialize(parsed).split("\n");
	return node.bodyRanges.flatMap(([from, to]) => lines.slice(from, to + 1));
}

test("a block lands under its node, indented, with no marker in front of it", () => {
	const p = parse("# R\n\n- Parent\n- Other\n");
	const out = addBlock(p, find(p, "Parent"), "A long explanation.").text;
	const after = parseMarkdown(out, { title: "Fixture" });
	const parent = find(after, "Parent");

	// The block's range reaches back over the blank line that separates it from
	// the title, which is how this parser files every paragraph after a node.
	assert.deepEqual(
		bodyLines(after, parent).filter((line) => line !== ""),
		["  A long explanation."],
	);

	// **Not an annotation.** An annotation is the node's own note about itself,
	// and the map gives it its own editor and no card -- so a paragraph filed as
	// one would be invisible on the map and would have nothing to open.
	assert.deepEqual(parent.annotationIndices, []);
	assert.equal(bodyCardCount(parent), 1);

	// Not a node of its own: the block belongs to the item above it.
	assert.throws(() => find(after, "A long explanation."));
	// And the item after it is untouched.
	assert.equal(find(after, "Other").text, "Other");
});

test("the block sits directly under the title, no blank line", () => {
	// The blank line that used to separate the block from the title was for
	// CommonMark compatibility in other tools. The user asked for it gone;
	// this parser is lenient enough to tell a block from a lazy continuation
	// without it, and Obsidian's own reader handles the rest.
	const p = parse("# R\n\n- Parent\n- Other\n");
	const out = addBlock(p, find(p, "Parent"), "Explanation.").text;
	assert.ok(out.includes("- Parent\n  Explanation."));
	assert.ok(!out.includes("- Parent\n\n  Explanation."));
});

test("the block folds and deletes with the node it belongs to", () => {
	const p = parse("# R\n\n- Parent\n- Other\n");
	const out = addBlock(p, find(p, "Parent"), "Explanation.").text;
	const after = parseMarkdown(out, { title: "Fixture" });
	const parent = find(after, "Parent");
	// The node's block now reaches past its own line, which is what a delete or
	// a fold walks.
	assert.ok(parent.blockEnd > parent.lineStart);
	const removed = deleteNode(after, parent).text;
	assert.ok(!removed.includes("Explanation."));
});

test("a block under a heading is prose, not a code block", () => {
	// Four spaces under a heading is an indented code block, which is a
	// different thing entirely.
	const p = parse("# R\n\n## Section\n");
	const out = addBlock(p, find(p, "Section"), "Prose.").text;
	const after = parseMarkdown(out, { title: "Fixture" });
	assert.deepEqual(
		bodyLines(after, find(after, "Section")).filter((line) => line !== ""),
		["Prose."],
	);
});

/** Toggle `title` on a freshly parsed copy of `text`, the way the view does. */
function toggled(text: string, title: string): string {
	const p = parse(text);
	return toggleCheckbox(p, find(p, title)).text;
}

test("toggleCheckbox adds a box to a plain item, then only checks and unchecks", () => {
	let text = "# R\n\n- plain\n";
	text = toggled(text, "plain");
	assert.ok(lines(text).includes("- [ ] plain"));

	text = toggled(text, "plain");
	assert.ok(lines(text).includes("- [x] plain"));

	// The third press is an uncheck, not a removal: the card's checkbox is drawn
	// only for an item that has one, so losing it here is losing the control.
	text = toggled(text, "plain");
	assert.ok(lines(text).includes("- [ ] plain"));
});

test("unchecking a task is byte-identical to the file it came from", () => {
	const start = "# R\n\n- [ ] text\n";
	const checked = toggled(start, "text");
	assert.equal(checked, "# R\n\n- [x] text\n");
	assert.equal(toggled(checked, "text"), start);
});

test("uncheck and re-check keep marker, indent, spacing and the lines around", () => {
	const cases: Array<[string, string, string]> = [
		["* [x] a\n", "* [ ] a\n", "a"],
		["1. [x] a\n", "1. [ ] a\n", "a"],
		["-   [x]   done   \n", "-   [ ]   done   \n", "done"],
		["- p\n\t- [x] a\n", "- p\n\t- [ ] a\n", "a"],
		["# R\r\n\r\n- [x] a\r\n", "# R\r\n\r\n- [ ] a\r\n", "a"],
		["# R\n\n- [x] a\n  : note\n  body\n\n- b\n", "# R\n\n- [ ] a\n  : note\n  body\n\n- b\n", "a"],
	];
	for (const [checked, unchecked, title] of cases) {
		assert.equal(toggled(checked, title), unchecked, checked);
		assert.equal(toggled(unchecked, title), checked, unchecked);
	}
});

test("an uppercase [X] unchecks", () => {
	assert.equal(toggled("- [X] a\n", "a"), "- [ ] a\n");
});

test("toggleCheckbox twice on one parse is the same edit, not the next state", () => {
	const p = parse("# R\n\n- [ ] text\n");
	const node = find(p, "text");
	const once = toggleCheckbox(p, node).text;
	assert.equal(once, "# R\n\n- [x] text\n");
	assert.equal(toggleCheckbox(p, node).text, once);
});

test("removeCheckbox is how a checkbox goes, and setCheckbox refuses a no-op", () => {
	const p = parse("# R\n\n- [x] text\n");
	assert.equal(removeCheckbox(p, find(p, "text")).text, "# R\n\n- text\n");

	const plain = parse("# R\n\n- text\n");
	assert.equal(removeCheckbox(plain, find(plain, "text")).ok, false);
	assert.equal(setCheckbox(plain, find(plain, "text"), null).ok, false);
	assert.equal(setCheckbox(p, find(p, "text"), "x").ok, false);
});

test("toggleCheckbox is rejected on headings", () => {
	const p = parse();
	assert.equal(toggleCheckbox(p, find(p, "Alpha")).ok, false);
});

// --- moving ------------------------------------------------------------------

test("moving a heading under a heading re-levels the whole subtree", () => {
	const p = parse("# R\n\n## A\n\n### A1\n\n## B\n");
	const out = moveNode(p, find(p, "A"), find(p, "B"));
	assert.equal(
		out.text,
		"# R\n\n## B\n\n### A\n\n#### A1\n",
	);
});

test("moving a heading under a list item converts the subtree to list items", () => {
	// "host" must sit under B, not under A, or the move would be into a descendant.
	const p = parse("# R\n\n## A\n\n### A1\n\n## B\n\n- host\n");
	const out = moveNode(p, find(p, "A"), find(p, "host"));
	assert.ok(out.ok);
	const ls = lines(out.text);
	assert.ok(ls.includes("- host"));
	assert.ok(ls.includes("  - A"));
	assert.ok(ls.includes("    - A1"));
	assert.ok(!ls.some((l) => l.startsWith("#") && l.includes("A1")));
	assert.equal(serialize(parse(out.text)), out.text);
});

test("moving a list item under a heading lifts it to a top-level list", () => {
	const p = parse("# R\n\n## A\n\n- x\n  - y\n\n## B\n");
	const out = moveNode(p, find(p, "y"), find(p, "B"));
	const ls = lines(out.text);
	assert.ok(ls.includes("- y"));
	// It is no longer nested under x.
	assert.ok(!ls.includes("  - y"));
	assert.ok(ls.indexOf("- y") > ls.indexOf("## B"));
});

test("a checkbox survives a round trip through heading form", () => {
	const p = parse("# R\n\n## H\n\n- [x] task\n");
	const up = moveNode(p, find(p, "task"), p.root);
	// Under the root heading it stays a list item, so the checkbox is intact.
	assert.ok(lines(up.text).includes("- [x] task"));

	// Force the conversion by making it a child of a heading-level node.
	const p2 = parse("# R\n\n## H\n\n### Deep\n");
	const p3 = parse(addChild(p2, find(p2, "Deep"), "leaf").text);
	assert.ok(lines(serialize(p3)).includes("#### leaf"));
});

test("moving onto a descendant or onto itself is refused", () => {
	const p = parse();
	const alpha = find(p, "Alpha");
	const one = find(p, "one");
	const oneA = find(p, "one-a");

	assert.equal(canMove(alpha, oneA), false);
	assert.equal(canMove(one, one), false);
	assert.equal(moveNode(p, alpha, oneA).ok, false);
	assert.equal(moveNode(p, one, one).ok, false);
	assert.equal(canMove(one, alpha), true);
});

test("moving into an ancestor whose block ends with the moved node works", () => {
	const p = parse("# R\n\n## A\n\n- x\n  - y\n");
	const out = moveNode(p, find(p, "y"), find(p, "A"));
	assert.ok(out.ok);
	const ls = lines(out.text);
	assert.ok(ls.includes("- x"));
	assert.ok(ls.includes("- y"));
	assert.ok(!ls.includes("  - y"));
	assert.equal(serialize(parse(out.text)), out.text);
});

// --- reordering among siblings ------------------------------------------------

const ORDERED = "# R\n\n## H\n\n- a\n  - a1\n- b\n- c\n";

test("moveBefore drops the node directly above its new sibling", () => {
	const p = parse(ORDERED);
	const out = moveBefore(p, find(p, "c"), find(p, "a"));
	assert.equal(out.text, "# R\n\n## H\n\n- c\n- a\n  - a1\n- b\n");
});

test("moveAfter clears the target's whole subtree, not just its line", () => {
	const p = parse(ORDERED);
	const out = moveAfter(p, find(p, "c"), find(p, "a"));
	// Below a1, which belongs to a -- landing between a and a1 would adopt it.
	assert.equal(out.text, "# R\n\n## H\n\n- a\n  - a1\n- c\n- b\n");
});

test("reordering headings keeps their blank-line padding", () => {
	const source = "# R\n\n## H\n\n### A\n\ntext A\n\n### B\n\ntext B\n";
	const p = parse(source);
	const out = moveBefore(p, find(p, "B"), find(p, "A"));
	assert.equal(out.text, "# R\n\n## H\n\n### B\n\ntext B\n\n### A\n\ntext A\n");
});

test("first-level branches reorder among themselves", () => {
	const p = parse();
	const alpha = find(p, "Alpha");
	const beta = find(p, "Beta");
	const two = find(p, "two");

	// Alpha and Beta hang off the root, and the order they are written in is
	// the order the map reads them in -- so a drop beside one of them is an
	// order the user is entitled to set.
	assert.equal(canReorder(beta, alpha), true);
	// Beside a first-level branch is also how a subtree is promoted to that
	// level, so the drop has to be allowed from any depth.
	assert.equal(canReorder(two, alpha), true);

	const moved = moveBefore(p, beta, alpha);
	assert.ok(moved.ok);
	assert.ok(moved.text.indexOf("## Beta") < moved.text.indexOf("## Alpha"));
	// Beta carries its whole subtree, fenced sample and all.
	assert.ok(moved.text.includes(CODE_LINE));
	assert.equal(parseMarkdown(moved.text, { title: "Fixture" }).root.children.length, 2);
	assert.equal(moveAfter(p, beta, alpha).ok, true);

	// The root has no siblings at all.
	assert.equal(canReorder(alpha, p.root), false);
	// Reparenting a first-level branch is still allowed.
	assert.equal(canMove(beta, alpha), true);
});

test("reordering is allowed from the second level down", () => {
	const p = parse();
	assert.equal(canReorder(find(p, "two"), find(p, "one")), true);
	assert.equal(canReorder(find(p, "one-a"), find(p, "task")), true);
	assert.equal(canReorder(find(p, "Gamma"), find(p, "task")), true);
	// Beside your own descendant means "under yourself", which is refused.
	assert.equal(canReorder(find(p, "one"), find(p, "one-a")), false);
	assert.equal(canReorder(find(p, "task"), find(p, "task")), false);
});

// --- reordering with the keyboard --------------------------------------------

const SECTIONS = [
	"# R",
	"",
	"## H",
	"",
	"### A",
	"",
	`${F}js`,
	CODE_LINE,
	F,
	"",
	"### B",
	"",
	"text B",
	"",
].join("\n");

test("moving up swaps a node with the sibling above it", () => {
	const p = parse(ORDERED);
	const out = reorderUp(p, find(p, "c"));
	assert.equal(out.text, "# R\n\n## H\n\n- a\n  - a1\n- c\n- b\n");
});

test("moving down clears the next sibling's whole subtree", () => {
	const p = parse(ORDERED);
	// Landing between a and a1 would adopt a1, so "down" is past the end of it.
	const out = reorderDown(p, find(p, "a"));
	assert.equal(out.text, "# R\n\n## H\n\n- b\n- a\n  - a1\n- c\n");
});

test("the ends of a run write nothing at all", () => {
	const p = parse(ORDERED);
	const first = find(p, "a");
	const last = find(p, "c");

	assert.equal(canReorderUp(first), false);
	assert.equal(canReorderDown(last), false);
	assert.equal(reorderUp(p, first).ok, false);
	assert.equal(reorderDown(p, last).ok, false);
	// Rejected means the text is the file exactly as it stands.
	assert.equal(reorderUp(p, first).text, ORDERED);
	assert.equal(reorderDown(p, last).text, ORDERED);
});

test("moving a section carries its fenced code and its blank lines", () => {
	const p = parse(SECTIONS);
	const out = reorderDown(p, find(p, "A"));
	assert.equal(
		out.text,
		`# R\n\n## H\n\n### B\n\ntext B\n\n### A\n\n${F}js\n${CODE_LINE}\n${F}\n`,
	);
});

test("a move and its opposite leave a CRLF file byte for byte as it was", () => {
	for (const source of [ORDERED, SECTIONS]) {
		const crlf = source.replace(/\n/g, "\r\n");
		const p = parse(crlf);
		const label = source === ORDERED ? "list" : "headings";

		const moved = reorderDown(p, find(p, source === ORDERED ? "a" : "A"));
		assert.ok(moved.ok, `${label}: nothing moved`);
		// Inserted lines take the file's own terminator, not the platform's.
		assert.ok(!/[^\r]\n/.test(moved.text), `${label}: a bare LF crept in`);

		const p2 = parse(moved.text);
		const back = reorderUp(p2, find(p2, source === ORDERED ? "a" : "A"));
		assert.equal(back.text, crlf, `${label}: the round trip changed the file`);
	}
});

test("first-level branches move up and down like anything else", () => {
	const p = parse();
	// The keyboard reaches the same places the pointer does.
	assert.equal(canReorderUp(find(p, "Beta")), true);
	assert.equal(canReorderDown(find(p, "Alpha")), true);

	const up = reorderUp(p, find(p, "Beta"));
	assert.ok(up.ok);
	assert.ok(up.text.indexOf("## Beta") < up.text.indexOf("## Alpha"));
	assert.equal(reorderDown(p, find(p, "Alpha")).ok, true);

	// The root is still not in anyone's run.
	assert.equal(canReorderUp(p.root), false);
	assert.equal(canReorderDown(p.root), false);
	assert.equal(reorderDown(p, p.root).ok, false);
});

test("a node moved beside list items is written as one", () => {
	// The same rule the drag path follows: beside X means written the way X is.
	const p = parse("# R\n\n## H\n\n- a\n- b\n\n### C\n\ntext C\n");
	const out = reorderUp(p, find(p, "C"));
	assert.equal(out.text, "# R\n\n## H\n\n- a\n- C\n\n  text C\n- b\n");
	assert.equal(serialize(parse(out.text)), out.text);
});

test("focusLine lands on the node that moved, not on its neighbour", () => {
	for (const [name, op] of [
		["up", reorderUp],
		["down", reorderDown],
	] as Array<[string, typeof reorderUp]>) {
		const p = parse(ORDERED);
		const out = op(p, find(p, name === "up" ? "c" : "a"));
		assert.ok(out.ok);
		const reparsed = parseMarkdown(out.text, { title: "Fixture" });
		const focused = everyNode(reparsed).find((n) => n.lineStart === out.focusLine);
		assert.equal(focused?.text, name === "up" ? "c" : "a", `move ${name}`);
	}
});

test("indent nests under the previous sibling; the first child is refused", () => {
	const p = parse("# R\n\n- a\n- b\n");
	assert.equal(indentNode(p, find(p, "a")).ok, false);
	const out = indentNode(p, find(p, "b"));
	assert.equal(out.text, "# R\n\n- a\n  - b\n");
});

test("outdent lifts a node to sit after its old parent", () => {
	const p = parse("# R\n\n- a\n  - b\n  - c\n");
	const out = outdentNode(p, find(p, "b"));
	assert.equal(out.text, "# R\n\n- a\n  - c\n- b\n");
});

test("outdent is refused for a direct child of the root", () => {
	const p = parse("# R\n\n- a\n");
	assert.equal(outdentNode(p, find(p, "a")).ok, false);
});

// --- body ranges -------------------------------------------------------------

test("replaceBodyRange rewrites only that block", () => {
	const p = parse();
	const beta = find(p, "Beta");
	assert.ok(beta.bodyRanges.length > 0);
	const out = replaceBodyRange(p, beta, 0, "replaced body");
	assert.ok(out.text.includes("replaced body"));
	assert.ok(!out.text.includes(CODE_LINE));
	// Neighbours are untouched.
	assert.ok(out.text.startsWith(FRONTMATTER));
	assert.ok(out.text.includes("### Gamma"));
	assert.ok(out.text.includes("- one"));
});

// --- invariants across every operation ---------------------------------------

type Op = [string, (p: ParsedDoc, n: MindNode) => Mutation];

const OPS: Op[] = [
	["rename", (p, n) => renameNode(p, n, "renamed text")],
	["addChild", (p, n) => addChild(p, n, "new child")],
	["addSibling", (p, n) => addSibling(p, n, "new sibling")],
	["addSiblingBefore", (p, n) => addSiblingBefore(p, n, "new sibling")],
	["toggleCheckbox", (p, n) => toggleCheckbox(p, n)],
	["indent", (p, n) => indentNode(p, n)],
	["outdent", (p, n) => outdentNode(p, n)],
	["reorderUp", (p, n) => reorderUp(p, n)],
	["reorderDown", (p, n) => reorderDown(p, n)],
];

function everyNode(p: ParsedDoc): MindNode[] {
	const all: MindNode[] = [];
	walk(p.root, (n) => all.push(n));
	return all;
}

test("no operation ever touches frontmatter", () => {
	for (const [name, op] of [...OPS, ["delete", deleteNode] as Op]) {
		const p = parse();
		for (const node of everyNode(p)) {
			const out = op(p, node);
			if (!out.ok) continue;
			assert.ok(
				out.text.startsWith(FRONTMATTER + "\n"),
				`${name} on "${node.text}" disturbed frontmatter`,
			);
		}
	}
});

test("every mutation re-parses and round-trips exactly", () => {
	for (const [name, op] of [...OPS, ["delete", deleteNode] as Op]) {
		const p = parse();
		for (const node of everyNode(p)) {
			const out = op(p, node);
			if (!out.ok) continue;
			const reparsed = parseMarkdown(out.text, { title: "Fixture" });
			assert.equal(
				serialize(reparsed),
				out.text,
				`${name} on "${node.text}" produced text that does not round-trip`,
			);
		}
	}
});

test("non-destructive operations preserve fenced code verbatim", () => {
	for (const [name, op] of OPS) {
		const p = parse();
		for (const node of everyNode(p)) {
			const out = op(p, node);
			if (!out.ok) continue;
			assert.ok(
				out.text.includes(CODE_LINE),
				`${name} on "${node.text}" damaged the code block`,
			);
			assert.ok(
				out.text.includes("// # not a heading"),
				`${name} on "${node.text}" damaged the code block`,
			);
		}
	}
});

test("every legal move round-trips and keeps code content intact", () => {
	const p = parse();
	const nodes = everyNode(p);
	let performed = 0;

	for (const node of nodes) {
		for (const target of nodes) {
			if (!canMove(node, target)) continue;
			const out = moveNode(p, node, target);
			if (!out.ok) continue;
			performed++;

			const reparsed = parseMarkdown(out.text, { title: "Fixture" });
			assert.equal(
				serialize(reparsed),
				out.text,
				`move "${node.text}" -> "${target.text}" did not round-trip`,
			);
			assert.ok(
				out.text.startsWith(FRONTMATTER + "\n"),
				`move "${node.text}" -> "${target.text}" disturbed frontmatter`,
			);
			// The code line may gain indentation, but its content is untouched.
			assert.ok(
				out.text.includes(CODE_LINE),
				`move "${node.text}" -> "${target.text}" damaged code content`,
			);
			// Nothing is ever lost or duplicated.
			assert.equal(
				out.text.split("- two").length - 1,
				1,
				`move "${node.text}" -> "${target.text}" duplicated a node`,
			);
		}
	}
	assert.ok(performed > 20, `expected a broad sweep of moves, ran ${performed}`);
});

test("every legal reorder round-trips and keeps code content intact", () => {
	const p = parse();
	const nodes = everyNode(p);
	let performed = 0;

	for (const node of nodes) {
		for (const target of nodes) {
			if (!canReorder(node, target)) continue;
			for (const [name, drop] of [
				["before", moveBefore],
				["after", moveAfter],
			] as Array<[string, typeof moveBefore]>) {
				const out = drop(p, node, target);
				assert.ok(out.ok, `${name} "${node.text}" -> "${target.text}" was refused`);
				performed++;

				const label = `${name} "${node.text}" -> "${target.text}"`;
				const reparsed = parseMarkdown(out.text, { title: "Fixture" });
				assert.equal(serialize(reparsed), out.text, `${label} did not round-trip`);
				assert.ok(out.text.startsWith(FRONTMATTER + "\n"), `${label} disturbed frontmatter`);
				assert.ok(out.text.includes(CODE_LINE), `${label} damaged code content`);

				// Exactly one copy survives, and it hangs off the target's parent.
				// A list item that became a heading carries its checkbox along as
				// literal text, so match on the tail rather than the whole title.
				const moved = everyNode(reparsed).filter(
					(n) => n.text === node.text || n.text.endsWith(`] ${node.text}`),
				);
				assert.equal(moved.length, 1, `${label} lost or duplicated the node`);
				assert.equal(
					moved[0].parent?.text,
					target.parent?.text,
					`${label} did not land beside the target`,
				);
			}
		}
	}
	assert.ok(performed > 20, `expected a broad sweep of reorders, ran ${performed}`);
});

test("focusLine resolves to a real node after re-parsing", () => {
	for (const [name, op] of OPS) {
		const p = parse();
		for (const node of everyNode(p)) {
			const out = op(p, node);
			if (!out.ok || out.focusLine < 0) continue;
			const reparsed = parseMarkdown(out.text, { title: "Fixture" });
			let found = false;
			walk(reparsed.root, (n) => {
				if (n.lineStart === out.focusLine) found = true;
			});
			assert.ok(found, `${name} on "${node.text}" left a dangling focusLine`);
		}
	}
});

// --- moving a note-content block ------------------------------------------
//
// A block is a range of the note's lines rather than a node, so none of the
// node machinery above applies to it. What the two share is the indentation
// rule: only the leading whitespace that attaches a block to an owner moves,
// and the lines inside it are never touched.

const BLOCK_SOURCE = ["# Root", "", `${F}js`, CODE_LINE, F, "", "- item", ""].join("\n");

/**
 * Index of the code block among a node's body ranges.
 *
 * Searched across the whole range rather than read off its first line: a range
 * carries the blank line that separates it from what came before, so the fence
 * is the second line of the block rather than the first.
 */
function codeIndex(parsed: ParsedDoc, node: MindNode): number {
	return node.bodyRanges.findIndex(([start, end]) =>
		parsed.doc.lines.slice(start, end + 1).some((line) => line.includes(F)),
	);
}

test("a code block moved under a list item becomes that item's body", () => {
	const p = parse(BLOCK_SOURCE);
	const owner = find(p, "Root");
	const index = codeIndex(p, owner);
	assert.ok(index >= 0, "the fixture has a code block under the heading");
	const item = find(p, "item");

	const out = moveBodyBlock(p, owner, index, item, null);
	assert.equal(out.ok, true);

	const after = parseMarkdown(out.text, { title: "Fixture" });
	const itemAfter = find(after, "item");
	assert.equal(itemAfter.bodyRanges.length, 1);
	assert.equal(find(after, "Root").bodyRanges.length, 0);
	// The item's body column is two past the margin, so the fence and the line
	// under it both start there.
	assert.match(bodyRangeText(after, itemAfter.bodyRanges[0]), /^ {2}```js$/m);
	assert.match(bodyRangeText(after, itemAfter.bodyRanges[0]), new RegExp(`^ {2}${F}$`, "m"));
});

test("the sample's own indentation moves with it, and only by the shift", () => {
	const source = ["# Root", "", `${F}js`, "if (x) {", "  keep();", "}", F, "", "- item", ""].join("\n");
	const p = parse(source);
	const owner = find(p, "Root");
	const out = moveBodyBlock(p, owner, codeIndex(p, owner), find(p, "item"), null);

	assert.equal(out.ok, true);
	// Two columns further in, because that is where the item's body sits.
	assert.ok(out.text.includes("  if (x) {"), "the first code line took the shift");
	assert.ok(out.text.includes("    keep();"), "the code's own indent survived the trip");
});

test("a block can be dropped above what the target already holds", () => {
	// An owner usually has a single body range -- the parser runs a node's whole
	// prose together -- so "reorder among an owner's blocks" is a rare case and
	// the one worth pinning is a named landing line, which is what dropping onto
	// a particular card's edge asks for.
	const source = ["# Root", "", `${F}js`, CODE_LINE, F, "", "## A", "", "A's own prose.", ""].join("\n");
	const p = parse(source);
	const owner = find(p, "Root");
	const a = find(p, "A");
	const first = a.bodyRanges[0]?.[0];
	assert.ok(first !== undefined, "the fixture gives A a body");

	const out = moveBodyBlock(p, owner, codeIndex(p, owner), a, first);
	assert.equal(out.ok, true);
	assert.ok(
		out.text.indexOf(`${F}js`) < out.text.indexOf("A's own prose."),
		"the sample landed above the prose the target already had",
	);

	const after = parseMarkdown(out.text, { title: "Fixture" });
	assert.equal(find(after, "Root").bodyRanges.length, 0, "the block left its old owner");
	assert.equal(find(after, "A").bodyRanges.length, 1);
});

test("a same-owner drop needs a line, and a block cannot land inside itself", () => {
	const p = parse(BLOCK_SOURCE);
	const owner = find(p, "Root");
	const index = codeIndex(p, owner);
	const range = owner.bodyRanges[index];

	// With no line named the block would go back exactly where it came from.
	assert.equal(canMoveBodyBlock(owner, index, owner, null), false);
	assert.equal(canMoveBodyBlock(owner, index, owner, range[0]), true);
	// Landing on the owner itself is fine when a line is named, because that is
	// a reorder rather than a reparent.
	assert.equal(canMoveBodyBlock(owner, index, find(p, "item"), null), true);
	assert.equal(moveBodyBlock(p, owner, index, owner, null).ok, false);
});

test("a body range index that is not there is refused, not thrown", () => {
	const p = parse(BLOCK_SOURCE);
	const owner = find(p, "Root");
	assert.equal(canMoveBodyBlock(owner, 99, find(p, "item"), null), false);
	assert.equal(moveBodyBlock(p, owner, 99, find(p, "item"), null).ok, false);
});

// --- deleting a selection -----------------------------------------------------

const TREE = `# Root

- alpha
	- alpha one
	- alpha two
- beta

	beta body

- gamma
`;

test("several subtrees go as one edit, and nothing else moves", () => {
	const p = parse(TREE);
	const out = deleteNodes(p, [find(p, "alpha"), find(p, "gamma")]);
	assert.equal(out.ok, true);
	assert.equal(out.text, "# Root\n\n- beta\n\n\tbeta body\n");
});

test("a node inside another selected node is not spliced twice", () => {
	// `alpha one` is already going with `alpha`'s block. Removing it a second
	// time would take whatever moved up to take its place.
	const p = parse(TREE);
	const out = deleteNodes(p, [find(p, "alpha one"), find(p, "alpha")]);
	assert.equal(out.ok, true);
	assert.equal(out.text, "# Root\n\n- beta\n\n\tbeta body\n\n- gamma\n");
});

test("the order the nodes arrive in does not matter", () => {
	const p = parse(TREE);
	const forwards = deleteNodes(p, [find(p, "alpha"), find(p, "gamma")]);
	const backwards = deleteNodes(p, [find(p, "gamma"), find(p, "alpha")]);
	assert.equal(forwards.text, backwards.text);
});

test("the selection lands on the parent of the first node that went", () => {
	const p = parse(TREE);
	const out = deleteNodes(p, [find(p, "alpha two"), find(p, "beta")]);
	assert.equal(out.ok, true);
	assert.equal(out.focusLine, find(p, "alpha").lineStart);
});

test("deleting nothing is not an edit", () => {
	const p = parse(TREE);
	const out = deleteNodes(p, []);
	assert.equal(out.ok, false);
	assert.equal(out.text, serialize(p));
});

test("the root has no line to delete and is dropped from the batch", () => {
	const p = parse(TREE);
	const out = deleteNodes(p, [p.root, find(p, "gamma")]);
	assert.equal(out.ok, true);
	assert.equal(out.text, "# Root\n\n- alpha\n\t- alpha one\n\t- alpha two\n- beta\n\n\tbeta body\n");
});

// --- moving a whole selection -------------------------------------------------

const GROUP = `# Root

- alpha
	- alpha one
- beta

	beta body

- gamma
- delta
`;

const HEADINGS = `# Root

## Alpha

alpha text

## Beta

beta text

## Gamma
`;

test("a whole selection lands under a card, together and in written order", () => {
	const p = parse(GROUP);
	const out = moveNodesInto(p, [find(p, "alpha"), find(p, "gamma")], find(p, "beta"));
	assert.equal(out.ok, true);
	assert.equal(
		out.text,
		"# Root\n\n- beta\n\n\tbeta body\n\t- alpha\n\t\t- alpha one\n\t- gamma\n\n- delta\n",
	);
	// And the note reads back as the tree that just described: both cards are
	// beta's children, and alpha still has the child it arrived with.
	const after = parse(out.text);
	assert.deepEqual(
		find(after, "beta").children.map((n) => n.text),
		["alpha", "gamma"],
	);
	assert.deepEqual(
		find(after, "alpha").children.map((n) => n.text),
		["alpha one"],
	);
});

test("the order the nodes arrive in does not matter", () => {
	const p = parse(GROUP);
	const forwards = moveNodesInto(p, [find(p, "alpha"), find(p, "gamma")], find(p, "beta"));
	const backwards = moveNodesInto(p, [find(p, "gamma"), find(p, "alpha")], find(p, "beta"));
	assert.equal(forwards.text, backwards.text);
});

test("a node inside another selected node travels once, not twice", () => {
	// `alpha one` is already inside alpha's block. Lifting it a second time
	// would take it back out of the parent it had just arrived under.
	const p = parse(GROUP);
	const out = moveNodesInto(p, [find(p, "alpha"), find(p, "alpha one")], find(p, "gamma"));
	assert.equal(out.ok, true);
	const after = parse(out.text);
	assert.deepEqual(
		find(after, "gamma").children.map((n) => n.text),
		["alpha"],
	);
	assert.deepEqual(
		find(after, "alpha").children.map((n) => n.text),
		["alpha one"],
	);
});

test("a drop that cannot take the whole selection is not an edit at all", () => {
	// Half a drag is worse than none: the target is one of the cards being
	// carried, so the whole run is refused rather than the rest going without.
	const p = parse(GROUP);
	const out = moveNodesInto(p, [find(p, "alpha"), find(p, "gamma")], find(p, "alpha"));
	assert.equal(out.ok, false);
	assert.equal(out.text, serialize(p));
});

test("a node the note does not write is dropped, as deleting one drops it", () => {
	const p = parse(GROUP);
	const out = moveNodesInto(p, [p.root, find(p, "gamma")], find(p, "beta"));
	assert.equal(out.ok, true);
	// The blank line the note had between beta's body and delta is the note's
	// own and stays where it was; only the cards moved.
	assert.equal(
		out.text,
		"# Root\n\n- alpha\n\t- alpha one\n- beta\n\n\tbeta body\n\t- gamma\n\n- delta\n",
	);
});

test("the run lands above the card it was dropped beside", () => {
	const p = parse(GROUP);
	const out = moveNodesBefore(p, [find(p, "gamma"), find(p, "delta")], find(p, "alpha"));
	assert.equal(out.ok, true);
	assert.equal(
		out.text,
		"# Root\n\n- gamma\n- delta\n- alpha\n\t- alpha one\n- beta\n\n\tbeta body\n",
	);
});

test("the run lands below the whole subtree of the card it was dropped beside", () => {
	const p = parse(GROUP);
	const out = moveNodesAfter(p, [find(p, "alpha"), find(p, "gamma")], find(p, "delta"));
	assert.equal(out.ok, true);
	assert.equal(
		out.text,
		"# Root\n\n- beta\n\n\tbeta body\n\n- delta\n- alpha\n\t- alpha one\n- gamma\n",
	);
});

test("headings in the run keep a blank line between them", () => {
	// The seam a reader notices: `### A` written straight under the last line
	// of `A`'s own content.
	const p = parse(HEADINGS);
	const out = moveNodesInto(p, [find(p, "Alpha"), find(p, "Gamma")], find(p, "Beta"));
	assert.equal(out.ok, true);
	assert.equal(
		out.text,
		"# Root\n\n## Beta\n\nbeta text\n\n### Alpha\n\nalpha text\n\n### Gamma\n",
	);
});

test("the selection lands on the first line of the run", () => {
	const p = parse(GROUP);
	const out = moveNodesInto(p, [find(p, "alpha"), find(p, "gamma")], find(p, "beta"));
	assert.equal(out.focusLine, 5);
	assert.equal(out.text.split("\n")[out.focusLine], "\t- alpha");
});

test("one node takes the single-node path, byte for byte", () => {
	// The group path is the new one, and it has to agree with the move that was
	// there before it for the case that was always the common one.
	const p = parse(GROUP);
	const alone = moveNodesInto(p, [find(p, "alpha")], find(p, "beta"));
	const ordinary = moveNode(p, find(p, "alpha"), find(p, "beta"));
	assert.equal(alone.text, ordinary.text);
	assert.equal(alone.focusLine, ordinary.focusLine);
});

test("moving nothing is not an edit", () => {
	const p = parse(GROUP);
	const out = moveNodesInto(p, [], find(p, "beta"));
	assert.equal(out.ok, false);
	assert.equal(out.text, serialize(p));
});
