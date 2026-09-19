import { test } from "node:test";
import assert from "node:assert/strict";

import { needsBlocks, parseBlocks } from "./blocks.ts";
import type { Block, CalloutBlock, TableBlock } from "./blocks.ts";

/** The one table in `blocks`, so a test can read past the union. */
function onlyTable(blocks: Block[]): TableBlock {
	const table = blocks.find((block): block is TableBlock => block.kind === "table");
	assert.ok(table, "expected a table");
	return table;
}

test("a two-column table becomes a header and its rows", () => {
	const blocks = parseBlocks(["| 设置项 | 说明 |", "| --- | --- |", "| 布局 | 均衡或单侧。 |"].join("\n"));
	assert.equal(blocks.length, 1);
	const table = onlyTable(blocks);
	assert.deepEqual(table.header, ["设置项", "说明"]);
	assert.deepEqual(table.align, [null, null]);
	assert.deepEqual(table.rows, [["布局", "均衡或单侧。"]]);
});

test("the outer pipes are optional on every row", () => {
	const table = onlyTable(parseBlocks("a | b\n--- | ---\n1 | 2"));
	assert.deepEqual(table.header, ["a", "b"]);
	assert.deepEqual(table.rows, [["1", "2"]]);
});

test("a delimiter row names each column's alignment", () => {
	const table = onlyTable(parseBlocks("| l | c | r | n |\n| :-- | :-: | --: | --- |\n| 1 | 2 | 3 | 4 |"));
	assert.deepEqual(table.align, ["left", "center", "right", null]);
});

test("a pipe written as `\\|` is a character, not a column edge", () => {
	const table = onlyTable(parseBlocks("| a | b |\n| --- | --- |\n| x \\| y | z |"));
	assert.deepEqual(table.rows, [["x | y", "z"]]);
	// The escape is consumed, so the cell reaches the renderer as the text it
	// stands for rather than as its own source.
	assert.equal(table.rows[0][0].includes("\\"), false);
});

test("rows are padded and clipped to the header's column count", () => {
	const table = onlyTable(
		parseBlocks("| a | b | c |\n| --- | --- | --- |\n| 1 |\n| 1 | 2 | 3 | 4 |"),
	);
	assert.deepEqual(table.rows, [
		["1", "", ""],
		["1", "2", "3"],
	]);
});

test("cells are trimmed", () => {
	const table = onlyTable(parseBlocks("|   a   |  b |\n| --- | --- |\n|  x  |   y   |"));
	assert.deepEqual(table.header, ["a", "b"]);
	assert.deepEqual(table.rows, [["x", "y"]]);
});

test("a delimiter row that disagrees with the header is not a table", () => {
	const blocks = parseBlocks("| a | b |\n| --- |\n");
	assert.equal(needsBlocks(blocks), false);
	assert.deepEqual(blocks, [{ kind: "paragraph", text: "| a | b |\n| --- |" }]);
});

test("a pipe with no delimiter row under it is prose", () => {
	const blocks = parseBlocks("a | b\nnot a table");
	assert.equal(needsBlocks(blocks), false);
	assert.deepEqual(blocks, [{ kind: "paragraph", text: "a | b\nnot a table" }]);
});

test("a table in the middle of a block is found, and what surrounds it is prose", () => {
	const blocks = parseBlocks(
		[
			"**三种卡片样式：**",
			"",
			"| 样式 | 效果 |",
			"| --- | --- |",
			"| 边框 | 经典外观。 |",
			"",
			"![卡片样式](../assets/card-styles.png)",
		].join("\n"),
	);
	assert.deepEqual(
		blocks.map((block) => block.kind),
		["paragraph", "table", "paragraph"],
	);
	assert.equal(blocks[0].kind === "paragraph" ? blocks[0].text : "", "**三种卡片样式：**");
	assert.equal(
		blocks[2].kind === "paragraph" ? blocks[2].text : "",
		"![卡片样式](../assets/card-styles.png)",
	);
});

test("a run of lines with no blank line between them is one paragraph", () => {
	const blocks = parseBlocks("first line\nsecond line\n\nnext");
	assert.deepEqual(blocks, [
		{ kind: "paragraph", text: "first line\nsecond line" },
		{ kind: "paragraph", text: "next" },
	]);
});

test("a fenced block keeps its own shape, blank lines and all", () => {
	const blocks = parseBlocks(["```ts", "const a = 1;", "", "const b = 2;", "```"].join("\n"));
	assert.deepEqual(blocks, [
		{ kind: "code", lang: "ts", text: "const a = 1;\n\nconst b = 2;" },
	]);
});

test("a fence inside a block does not swallow what follows it", () => {
	const blocks = parseBlocks(["~~~", "raw", "~~~", "", "after"].join("\n"));
	assert.deepEqual(blocks.map((block) => block.kind), ["code", "paragraph"]);
	assert.deepEqual(blocks[1], { kind: "paragraph", text: "after" });
});

test("an unterminated fence runs to the end of the block", () => {
	const blocks = parseBlocks("```\nstill code");
	assert.deepEqual(blocks, [{ kind: "code", lang: "", text: "still code" }]);
});

test("a backtick fence whose info string has a backtick never opens one", () => {
	// Same rule `parseMarkdown` applies, so a line like this is prose on the map
	// exactly where it is prose in the note.
	const blocks = parseBlocks("```a`b\nx");
	assert.deepEqual(blocks, [{ kind: "paragraph", text: "```a`b\nx" }]);
});

test("the indentation the note nests by is removed, and the sample's own is kept", () => {
	const blocks = parseBlocks(["  | a | b |", "  | --- | --- |", "  | 1 | 2 |"].join("\n"));
	const table = onlyTable(blocks);
	assert.deepEqual(table.header, ["a", "b"]);
	assert.deepEqual(table.rows, [["1", "2"]]);

	// Four spaces of nesting around a sample that indents by two of its own.
	const code = parseBlocks(["    ```", "    if (a) {", "      b();", "    }", "    ```"].join("\n"));
	assert.deepEqual(code, [{ kind: "code", lang: "", text: "if (a) {\n  b();\n}" }]);
});

test("blank lines separate blocks and produce none of their own", () => {
	const blocks = parseBlocks("\n\nalpha\n\n\nbeta\n\n");
	assert.deepEqual(blocks, [
		{ kind: "paragraph", text: "alpha" },
		{ kind: "paragraph", text: "beta" },
	]);
});

test("an empty block is no blocks", () => {
	assert.deepEqual(parseBlocks(""), []);
	assert.deepEqual(parseBlocks("\n \n\t\n"), []);
	assert.equal(needsBlocks(parseBlocks("")), false);
});

test("carriage returns never reach a cell or a sample", () => {
	const blocks = parseBlocks("| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n");
	assert.deepEqual(onlyTable(blocks).rows, [["1", "2"]]);
});

test("needsBlocks is what the view asks before it draws a card as blocks", () => {
	assert.equal(needsBlocks(parseBlocks("| a |\n| --- |\n| 1 |")), true);
	assert.equal(needsBlocks(parseBlocks("| a |\n| --- |")), true);
	assert.equal(needsBlocks(parseBlocks("just prose")), false);
	// A fenced sample is the third construct that has to be drawn rather than
	// read: its fences are scaffolding, and a card showing them is a card
	// showing the note's source instead of its content.
	assert.equal(needsBlocks(parseBlocks("```\ncode\n```")), true);
	assert.equal(needsBlocks(parseBlocks("> [!note]\n> hi")), true);
});

/** The one callout in `blocks`, so a test can read past the union. */
function onlyCallout(blocks: Block[]): CalloutBlock {
	const callout = blocks.find((block): block is CalloutBlock => block.kind === "callout");
	assert.ok(callout, "expected a callout");
	return callout;
}

test("a quoted `[!type]` becomes a callout holding what it quoted", () => {
	const callout = onlyCallout(parseBlocks("> [!note] Read this\n> first\n> second"));
	assert.equal(callout.type, "note");
	assert.equal(callout.title, "Read this");
	assert.equal(callout.fold, null);
	assert.deepEqual(callout.blocks, [{ kind: "paragraph", text: "first\nsecond" }]);
});

test("a callout with no title keeps the empty string, not a made-up one", () => {
	// The title a reader sees for one of these is a translated word, which is
	// the renderer's business; the model reports only what the note wrote.
	const callout = onlyCallout(parseBlocks("> [!WARNING]\n> care"));
	assert.equal(callout.type, "warning");
	assert.equal(callout.title, "");
});

test("the type is lowercased so `[!NOTE]` and `[!note]` are one thing", () => {
	assert.equal(onlyCallout(parseBlocks("> [!NOTE]")).type, "note");
});

test("`-` folds the callout and `+` pins it open", () => {
	assert.equal(onlyCallout(parseBlocks("> [!tip]-\n> hidden")).fold, "closed");
	assert.equal(onlyCallout(parseBlocks("> [!tip]+ Rest")).fold, "open");
	assert.equal(onlyCallout(parseBlocks("> [!tip]+ Rest")).title, "Rest");
});

test("a dash right after the type is the fold marker, title or no title", () => {
	// Obsidian reads it the same way, and there is no way to write it
	// otherwise: the marker has no separator of its own, so the dash is taken.
	const callout = onlyCallout(parseBlocks("> [!note] - folded"));
	assert.equal(callout.fold, "closed");
	assert.equal(callout.title, "folded");
});

test("the quoted lines lose their `>` and are read as blocks in their own right", () => {
	const callout = onlyCallout(
		parseBlocks(
			[
				"> [!info] Table",
				">",
				"> | a | b |",
				"> | --- | --- |",
				"> | 1 | 2 |",
			].join("\n"),
		),
	);
	assert.deepEqual(onlyTable(callout.blocks).rows, [["1", "2"]]);
});

test("a callout inside a callout is a callout", () => {
	const outer = onlyCallout(parseBlocks("> [!note] Outer\n> > [!tip] Inner\n> > deep"));
	assert.equal(outer.title, "Outer");
	// One `>` comes off per level, so the inner box is a box in its own right
	// rather than a paragraph that starts with `>`.
	const inner = onlyCallout(outer.blocks);
	assert.equal(inner.title, "Inner");
	assert.deepEqual(inner.blocks, [{ kind: "paragraph", text: "deep" }]);
});

test("an unquoted line ends the callout, blank or not", () => {
	const blocks = parseBlocks("> [!note]\n> inside\n\nafter");
	assert.equal(onlyCallout(blocks).blocks.length, 1);
	assert.deepEqual(blocks[1], { kind: "paragraph", text: "after" });
});

test("a callout is a block of its own, so it does not swallow the prose above it", () => {
	const blocks = parseBlocks("prose first\n> [!note]\n> boxed");
	assert.deepEqual(blocks[0], { kind: "paragraph", text: "prose first" });
	assert.equal(onlyCallout(blocks).type, "note");
});

test("a `>` that names no type is still a paragraph", () => {
	// Only the `[!type]` form is a callout. A plain quote has no box to draw,
	// and inventing one would put a colour on text the note never labelled.
	assert.deepEqual(parseBlocks("> just quoted"), [
		{ kind: "paragraph", text: "> just quoted" },
	]);
});

test("a callout under an indented block is found through its indent", () => {
	const blocks = parseBlocks(["  > [!note] Indented", "  > body"].join("\n"));
	assert.equal(onlyCallout(blocks).title, "Indented");
	assert.deepEqual(onlyCallout(blocks).blocks, [{ kind: "paragraph", text: "body" }]);
});

test("a callout with nothing quoted under it holds no blocks", () => {
	const callout = onlyCallout(parseBlocks("> [!quote]"));
	assert.deepEqual(callout.blocks, []);
});

test("trailing quoted blanks are spacing, not an empty paragraph", () => {
	const callout = onlyCallout(parseBlocks("> [!note] T\n> body\n>\n>"));
	assert.deepEqual(callout.blocks, [{ kind: "paragraph", text: "body" }]);
});

