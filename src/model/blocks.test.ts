import { test } from "node:test";
import assert from "node:assert/strict";

import { holdsTable, parseBlocks } from "./blocks.ts";
import type { Block, TableBlock } from "./blocks.ts";

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
	assert.equal(holdsTable(blocks), false);
	assert.deepEqual(blocks, [{ kind: "paragraph", text: "| a | b |\n| --- |" }]);
});

test("a pipe with no delimiter row under it is prose", () => {
	const blocks = parseBlocks("a | b\nnot a table");
	assert.equal(holdsTable(blocks), false);
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
	assert.equal(holdsTable(parseBlocks("")), false);
});

test("carriage returns never reach a cell or a sample", () => {
	const blocks = parseBlocks("| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n");
	assert.deepEqual(onlyTable(blocks).rows, [["1", "2"]]);
});

test("holdsTable is what the view asks before it draws a card as blocks", () => {
	assert.equal(holdsTable(parseBlocks("| a |\n| --- |\n| 1 |")), true);
	assert.equal(holdsTable(parseBlocks("| a |\n| --- |")), true);
	assert.equal(holdsTable(parseBlocks("just prose")), false);
	assert.equal(holdsTable(parseBlocks("```\ncode\n```")), false);
});
