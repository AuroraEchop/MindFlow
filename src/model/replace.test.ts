import { test } from "node:test";
import assert from "node:assert/strict";

import { parseMarkdown } from "./parse.ts";
import { planReplace, replaceInTree } from "./replace.ts";
import { walk } from "./types.ts";
import type { MindNode, ParsedDoc } from "./types.ts";

const NOTE = `# Focus Note

## Section

- alpha one
- **alpha** two
- [ ] alpha three
- beta

## Deeper

- one
	- alpha four
`;

const doc = parseMarkdown(NOTE, { title: "Untitled" });

function nodeNamed(parsed: ParsedDoc, text: string): MindNode {
	const hits: MindNode[] = [];
	walk(parsed.root, (node) => {
		if (node.text === text) hits.push(node);
	});
	assert.equal(hits.length, 1, `expected exactly one node named ${text}`);
	return hits[0];
}

function plan(text: string, replacement: string, regex = false) {
	return planReplace(doc.root, { text, replacement, regex });
}

test("every title holding the phrase is planned, in document order", () => {
	const found = plan("alpha", "omega");
	assert.equal(found.count, 4);
	assert.deepEqual(
		found.edits.map((edit) => edit.before),
		["alpha one", "**alpha** two", "alpha three", "alpha four"],
	);
	assert.deepEqual(
		found.edits.map((edit) => edit.after),
		["omega one", "**omega** two", "omega three", "omega four"],
	);
});

test("markup around the phrase is left exactly where the note put it", () => {
	// The phrase inside `**...**` is replaced; the markers are not the phrase
	// and are not touched. This is the whole reason replace reads the source
	// rather than the rendered text.
	const found = plan("alpha", "omega");
	const bold = found.edits.find((edit) => edit.before === "**alpha** two");
	assert.equal(bold?.after, "**omega** two");
});

test("a title with two occurrences counts as two and changes both", () => {
	const one = planReplace(parseMarkdown("- alpha alpha alpha\n", { title: "t" }).root, {
		text: "alpha",
		replacement: "x",
		regex: false,
	});
	assert.equal(one.count, 3);
	assert.equal(one.edits.length, 1);
	assert.equal(one.edits[0].after, "x x x");
});

test("matching ignores case, and the replacement is written as typed", () => {
	const found = planReplace(
		parseMarkdown("- Alpha\n- ALPHA\n", { title: "t" }).root,
		{ text: "alpha", replacement: "Omega", regex: false },
	);
	assert.equal(found.count, 2);
	assert.deepEqual(
		found.edits.map((edit) => edit.after),
		["Omega", "Omega"],
	);
});

test("a literal replacement keeps its dollars", () => {
	// There are no capture groups in the literal mode, so `$1` is two
	// characters the user typed rather than a backreference to nothing.
	const found = planReplace(
		parseMarkdown("- cost\n", { title: "t" }).root,
		{ text: "cost", replacement: "$1 (cheap)", regex: false },
	);
	assert.equal(found.edits[0].after, "$1 (cheap)");
});

test("a regex replacement gets its backreferences", () => {
	const found = planReplace(
		parseMarkdown("- item 12\n- item 34\n", { title: "t" }).root,
		{ text: "item (\\d+)", replacement: "number $1", regex: true },
	);
	assert.deepEqual(
		found.edits.map((edit) => edit.after),
		["number 12", "number 34"],
	);
	assert.equal(found.count, 2);
});

test("an incomplete pattern changes nothing and says so", () => {
	const found = plan("(", "x", true);
	assert.equal(found.invalid, true);
	assert.deepEqual(found.edits, []);
});

test("an empty query is not a query", () => {
	const found = plan("", "x");
	assert.equal(found.count, 0);
	assert.deepEqual(found.edits, []);
});

test("the markers, the checkbox and the indent survive the write", () => {
	const parsed = parseMarkdown("## Head\n\n- [ ] alpha task\n\t- alpha nested\n", {
		title: "t",
	});
	const result = replaceInTree(parsed, { text: "alpha", replacement: "omega", regex: false });
	assert.equal(result.ok, true);
	assert.equal(result.count, 2);
	assert.equal(
		result.text,
		"## Head\n\n- [ ] omega task\n\t- omega nested\n",
	);
});

test("the whole note comes back byte-identical apart from the replaced words", () => {
	const parsed = parseMarkdown("- alpha\n\nsome body text\n\n# Heading\n\n- beta\n", {
		title: "t",
	});
	const result = replaceInTree(parsed, { text: "alpha", replacement: "gamma", regex: false });
	assert.equal(result.text, "- gamma\n\nsome body text\n\n# Heading\n\n- beta\n");
});

test("prose the node owns is not replaced, because find never showed it", () => {
	// A text block and an annotation are lines the node owns, not lines it is.
	// Find skips them, so replace does too -- otherwise a replacement would
	// change text the user was never told about.
	const parsed = parseMarkdown("# T\n\n- alpha\n\talpha in a body block\n", { title: "t" });
	const result = replaceInTree(parsed, { text: "alpha", replacement: "x", regex: false });
	assert.equal(result.count, 1);
	assert.equal(result.text, "# T\n\n- x\n\talpha in a body block\n");
});

test("replacing in one node leaves its siblings alone", () => {
	const parsed = parseMarkdown("- alpha one\n- alpha two\n", { title: "t" });
	const target = nodeNamed(parsed, "alpha two");
	const result = replaceInTree(parsed, { text: "alpha", replacement: "omega", regex: false }, target);
	assert.equal(result.count, 1);
	assert.equal(result.text, "- alpha one\n- omega two\n");
});

test("a targeted replace that misses reports nothing done", () => {
	const parsed = parseMarkdown("- alpha\n- beta\n", { title: "t" });
	const target = nodeNamed(parsed, "beta");
	const result = replaceInTree(parsed, { text: "alpha", replacement: "x", regex: false }, target);
	assert.equal(result.ok, false);
	assert.equal(result.count, 0);
	assert.equal(result.text, "- alpha\n- beta\n");
});

test("a replace that changes nothing reports nothing done", () => {
	const parsed = parseMarkdown("- alpha\n", { title: "t" });
	const result = replaceInTree(parsed, { text: "zzz", replacement: "x", regex: false });
	assert.equal(result.ok, false);
	assert.equal(result.text, "- alpha\n");
});

test("the virtual root's filename is not a title and is never replaced", () => {
	const parsed = parseMarkdown("- one\n", { title: "Focus Note" });
	const result = replaceInTree(parsed, { text: "Focus", replacement: "x", regex: false });
	assert.equal(result.ok, false);
	assert.equal(result.text, "- one\n");
});

test("a zero-length pattern does not spin", () => {
	const found = planReplace(parseMarkdown("- ab\n", { title: "t" }).root, {
		text: "(?:)",
		replacement: "-",
		regex: true,
	});
	// One per character boundary -- before the `a`, between, and after the
	// `b` -- which is what the pattern asked for. The point is that it ends.
	assert.equal(found.count, 3);
});

test("a shared global pattern is re-aimed, so the second call sees everything", () => {
	// The pattern lives for one call to `planReplace`; this pins down that
	// nothing it leaves in `lastIndex` reaches the next title it visits.
	const parsed = parseMarkdown("- alpha\n- alpha\n- alpha\n", { title: "t" });
	const query = { text: "alpha", replacement: "x", regex: true };
	assert.equal(planReplace(parsed.root, query).count, 3);
	assert.equal(planReplace(parsed.root, query).count, 3);
});
