import { test } from "node:test";
import assert from "node:assert/strict";

import { needsBlocks, parseBlocks } from "./blocks.ts";
import type { Block, CalloutBlock, ListBlock, QuoteBlock, TableBlock } from "./blocks.ts";

/** The one table in `blocks`, so a test can read past the union. */
function onlyTable(blocks: Block[]): TableBlock {
	const table = blocks.find((block): block is TableBlock => block.kind === "table");
	assert.ok(table, "expected a table");
	return table;
}

/** The one list in `blocks`, so a test can read past the union. */
function onlyList(blocks: Block[]): ListBlock {
	const list = blocks.find((block): block is ListBlock => block.kind === "list");
	assert.ok(list, "expected a list");
	return list;
}

/** The one quote in `blocks`, so a test can read past the union. */
function onlyQuote(blocks: Block[]): QuoteBlock {
	const quote = blocks.find((block): block is QuoteBlock => block.kind === "quote");
	assert.ok(quote, "expected a quote");
	return quote;
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

test("a `>` that names no type is a quote, not a callout and not a paragraph", () => {
	// Only the `[!type]` form is a callout, and inventing a colour for a quote
	// would put a label on text the note never labelled. It is still a box: the
	// `>` is the note saying these are somebody else's words, and a paragraph
	// that kept the marker would be showing the scaffolding where the note
	// drew a bar.
	assert.deepEqual(parseBlocks("> just quoted"), [
		{ kind: "quote", blocks: [{ kind: "paragraph", text: "just quoted" }] },
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

// --- lists --------------------------------------------------------------------

test("a run of bullets is a list, and keeps the markers the note wrote", () => {
	const list = onlyList(parseBlocks("- one\n* two\n+ three"));
	assert.equal(list.ordered, false);
	assert.deepEqual(list.items, [
		{ marker: "-", depth: 0, text: "one" },
		{ marker: "*", depth: 0, text: "two" },
		{ marker: "+", depth: 0, text: "three" },
	]);
});

test("numbers make it an ordered list, and it starts where the note started it", () => {
	const list = onlyList(parseBlocks("1. 跨域通信\n2. 离线存储"));
	assert.equal(list.ordered, true);
	assert.equal(list.start, 1);
	assert.deepEqual(
		list.items.map((item) => item.text),
		["跨域通信", "离线存储"],
	);
	// A list that begins at three is a list that begins at three: the numbers
	// are the note's, and renumbering them would be the card correcting it.
	assert.equal(onlyList(parseBlocks("3) three\n4) four")).start, 3);
});

test("an indented item is one level deeper, and coming back out closes the level", () => {
	const list = onlyList(parseBlocks("- one\n    - deep\n- two"));
	assert.deepEqual(
		list.items.map((item) => item.depth),
		[0, 1, 0],
	);
	assert.deepEqual(
		list.items.map((item) => item.text),
		["one", "deep", "two"],
	);
});

test("a line indented under an item is that item still talking", () => {
	// The wrapped half of a long item. It has no marker, so it is not an item
	// of its own -- and a list that dropped it would drop half a sentence.
	const list = onlyList(parseBlocks("- one\n  wrapped\n- two"));
	assert.deepEqual(list.items, [
		{ marker: "-", depth: 0, text: "one\nwrapped" },
		{ marker: "-", depth: 0, text: "two" },
	]);
});

test("the other kind of marker starts a second list rather than joining the first", () => {
	// How markdown reads it, and how the note draws it: two lists, one bulleted
	// and one numbered, with no blank line between them.
	const blocks = parseBlocks("- one\n1. two");
	assert.equal(blocks.length, 2);
	assert.equal(onlyList(blocks).ordered, false);
	assert.equal((blocks[1] as ListBlock).ordered, true);
});

test("a task box comes off the item's words", () => {
	// Where the line is a node the box is the card's checkbox; a block has no
	// checkbox at all, so `- [ ] buy milk` is an item that says buy milk.
	assert.deepEqual(onlyList(parseBlocks("- [ ] buy milk")).items, [
		{ marker: "-", depth: 0, text: "buy milk" },
	]);
	assert.equal(onlyList(parseBlocks("- [x] done")).items[0].text, "done");
});

test("emphasis and arithmetic are not lists", () => {
	// The space after the marker is what decides, and it is the whole reason
	// the rule asks for one: `*one*` is a word and `1.5 kg` is a weight.
	assert.deepEqual(parseBlocks("*one* and 1.5 kg"), [
		{ kind: "paragraph", text: "*one* and 1.5 kg" },
	]);
});

test("a list ends the paragraph above it", () => {
	const blocks = parseBlocks("prose first\n- item");
	assert.deepEqual(blocks[0], { kind: "paragraph", text: "prose first" });
	assert.equal(onlyList(blocks).items[0].text, "item");
});

test("a list quoted inside a callout is a list", () => {
	const callout = onlyCallout(parseBlocks("> [!note] Steps\n> 1. first\n> 2. second"));
	assert.deepEqual(
		onlyList(callout.blocks).items.map((item) => item.text),
		["first", "second"],
	);
});

test("a list never forces the structured path, because the map has already drawn it", () => {
	// A note's list items are nodes -- cards of their own -- so a body card
	// holding a list run is not a shape a note produces. The answer is still
	// answered rather than skipped: a card drawn as blocks for another reason
	// draws its list as a list.
	assert.equal(needsBlocks(parseBlocks("- one\n- two")), false);
	assert.equal(needsBlocks(parseBlocks("- one\n\n| a |\n| --- |\n| 1 |")), true);
});

// --- quotes ----------------------------------------------------------------

test("a quote is a box, and the `>` is not part of what it says", () => {
	// The same loss a callout suffers: `>` read as characters is a character,
	// where the note drew a bar down the edge of somebody else's words.
	const quote = onlyQuote(parseBlocks("> 别人的话\n> 第二行"));
	assert.deepEqual(quote.blocks, [{ kind: "paragraph", text: "别人的话\n第二行" }]);
});

test("what a quote holds is read as blocks, as a callout's is", () => {
	const list = onlyList(onlyQuote(parseBlocks("> - one\n> - two")).blocks);
	assert.deepEqual(
		list.items.map((item) => item.text),
		["one", "two"],
	);
	// A table inside a quote is a table.
	const quote = onlyQuote(parseBlocks("> | a | b |\n> | --- | --- |\n> | 1 | 2 |"));
	assert.equal(quote.blocks[0].kind, "table");
});

test("a quote inside a quote is one step in", () => {
	// One `>` comes off per level, exactly as Obsidian reads it, so what is
	// left of `>> deep` inside the outer quote is `> deep` -- a quote.
	const outer = onlyQuote(parseBlocks("> out\n> > deep"));
	assert.deepEqual(onlyQuote(outer.blocks).blocks, [{ kind: "paragraph", text: "deep" }]);
});

test("a line that is not quoted ends the quote, blank or not", () => {
	// What Obsidian does, and why the `>` has to be repeated on an empty line
	// to keep a quote open.
	const blocks = parseBlocks("> quoted\nnot quoted");
	assert.deepEqual(onlyQuote(blocks).blocks, [{ kind: "paragraph", text: "quoted" }]);
	assert.deepEqual(blocks[1], { kind: "paragraph", text: "not quoted" });
});

test("a quote ends the paragraph above it, and a `>` mid-line does not start one", () => {
	const blocks = parseBlocks("prose first\n> quoted");
	assert.deepEqual(blocks[0], { kind: "paragraph", text: "prose first" });
	assert.equal(blocks[1].kind, "quote");
	// `5 > 3` is arithmetic and `a > b` is a comparison: the marker only opens
	// a box at the start of a line.
	assert.deepEqual(parseBlocks("5 > 3"), [{ kind: "paragraph", text: "5 > 3" }]);
});

test("a quote forces the structured path, as a callout does", () => {
	// The `>` is the note's scaffolding, and a card that answered with the
	// character would be answering with the scaffolding.
	assert.equal(needsBlocks(parseBlocks("> quoted")), true);
});

test("a rule is a rule and not three hyphens", () => {
	// The line that used to arrive on the card as `---`: the block model had
	// nowhere to put it, so it fell through to the paragraph that swallows
	// everything and was drawn as the characters the note typed.
	assert.deepEqual(parseBlocks("before\n\n---\n\nafter"), [
		{ kind: "paragraph", text: "before" },
		{ kind: "rule" },
		{ kind: "paragraph", text: "after" },
	]);
});

test("a rule is any of the three marks, three or more, spaces allowed", () => {
	// `* * *` is the same line as `***`, and the marks may not be mixed.
	for (const line of ["---", "----", "***", "___", "- - -", "* * *", "  ---"]) {
		assert.deepEqual(parseBlocks(line), [{ kind: "rule" }], line);
	}
	// Two is not a rule, and neither is a mixture: `--` is a dash someone
	// typed and `-*-` is nothing at all.
	for (const line of ["--", "-*-", "**", "__"]) {
		assert.deepEqual(parseBlocks(line), [{ kind: "paragraph", text: line }], line);
	}
});

test("a `---` under a paragraph is that paragraph's line, not a rule", () => {
	// Setext: `before\n---` is an h2 in markdown, and the map does not read
	// setext headings -- but it is certainly not a rule, and drawing one
	// there would be drawing a line the note never asked for. A `---` is only
	// a rule where a block opens, which is to say after a blank line.
	assert.deepEqual(parseBlocks("before\n---"), [{ kind: "paragraph", text: "before\n---" }]);
});

test("a rule wins over the list it could also be", () => {
	// `- - -` answers both rules: an item whose text is `- -`, or a rule.
	// Markdown reads it as a rule, and an item of `- -` is not a thing a note
	// writes, so the rule is asked first.
	assert.deepEqual(parseBlocks("- - -"), [{ kind: "rule" }]);
});

test("a rule inside a quote is a rule", () => {
	// The `>` comes off first and what is left is parsed as the note's own
	// content, so `> ---` is a rule inside a quote.
	const quote = onlyQuote(parseBlocks("> ---"));
	assert.deepEqual(quote.blocks, [{ kind: "rule" }]);
});

test("a rule does not force the structured path on its own", () => {
	// A card that is one rule and nothing else is a card nobody writes; read
	// as characters it is three hyphens, which is at least honest. A card
	// drawn as blocks for another reason still draws its rule as a rule.
	assert.equal(needsBlocks(parseBlocks("---")), false);
	assert.equal(needsBlocks(parseBlocks("---\n\n| a |\n| --- |\n| 1 |")), true);
});
