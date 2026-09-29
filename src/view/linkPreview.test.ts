import { test } from "node:test";
import assert from "node:assert/strict";

import {
	LinkReadCache,
	PREVIEW_CACHE_LINES,
	clipPreview,
	isLinkNode,
	noteTitleOf,
	prepareLinkFile,
	previewBlocks,
	previewOfNote,
	siteOf,
} from "./linkPreview.ts";
import { parseMarkdown } from "../model/parse.ts";

// --- what the card shows ------------------------------------------------------

test("a preview is the first lines of the note, in order, as the note wrote them", () => {
	const preview = previewOfNote("# Install\n\nrun npm install\n", 6);
	// Markers and all. The slice is what `previewBlocks` reads, and markdown
	// read from a slice whose scaffolding has already been taken off is prose
	// that happens to contain pipes and backticks.
	assert.deepEqual(preview.lines, ["# Install", "", "run npm install"]);
	assert.equal(preview.more, 0);
});

test("the markers come off the paragraphs, and only the paragraphs", () => {
	const preview = previewOfNote("## Steps\n\n### Then\n", 8);
	assert.deepEqual(preview.lines, ["## Steps", "", "### Then"]);
	// The heading loses what says it is one: in a paragraph that scaffolding is
	// all it is, and `## Steps` read as characters says the note's syntax where
	// the note says a line of its own.
	assert.deepEqual(previewBlocks(preview), [
		{ kind: "paragraph", text: "Steps" },
		{ kind: "paragraph", text: "Then" },
	]);
});

test("a quote keeps its `>`: the card draws the box, not the marker", () => {
	// The same rule a callout answers to. A quote is not prose that happens to
	// begin with a character; it is somebody else's words, and the bar down its
	// edge is what says so.
	const preview = previewOfNote("> 别人的话\n> 第二行\n", 8);
	assert.deepEqual(previewBlocks(preview), [
		{ kind: "quote", blocks: [{ kind: "paragraph", text: "别人的话\n第二行" }] },
	]);
});

test("a callout keeps its box: the preview draws what the note drew", () => {
	const preview = previewOfNote("> [!warning] 当心\n> 会烫\n", 8);
	assert.deepEqual(previewBlocks(preview), [
		{
			kind: "callout",
			type: "warning",
			title: "当心",
			fold: null,
			blocks: [{ kind: "paragraph", text: "会烫" }],
		},
	]);
});

test("a list keeps its markers: it is a list, not a run of lines", () => {
	const preview = previewOfNote("1. 跨域通信\n2. 离线存储\n- 附注\n", 8);
	assert.deepEqual(preview.lines, ["1. 跨域通信", "2. 离线存储", "- 附注"]);
	// Two lists, because the note wrote two kinds -- and each keeps what makes
	// it the kind it is. This is the difference the preview is for: an item
	// drawn without its number is a line the note never wrote.
	assert.deepEqual(previewBlocks(preview), [
		{
			kind: "list",
			ordered: true,
			start: 1,
			items: [
				{ marker: "1.", depth: 0, text: "跨域通信" },
				{ marker: "2.", depth: 0, text: "离线存储" },
			],
		},
		{
			kind: "list",
			ordered: false,
			start: 1,
			items: [{ marker: "-", depth: 0, text: "附注" }],
		},
	]);
});

test("a fence comes along, so the lines under it are still a sample", () => {
	const preview = previewOfNote("```js\nconst a = 1\n```\n", 6);
	assert.deepEqual(preview.lines, ["```js", "const a = 1", "```"]);
	assert.deepEqual(previewBlocks(preview), [{ kind: "code", lang: "js", text: "const a = 1" }]);
});

test("a table comes along, so its pipes are read as columns", () => {
	const preview = previewOfNote("| a | b |\n| --- | --- |\n| 1 | 2 |\n", 6);
	assert.deepEqual(previewBlocks(preview), [
		{ kind: "table", align: [null, null], header: ["a", "b"], rows: [["1", "2"]] },
	]);
});

test("blank lines cost nothing, and are kept where they fall", () => {
	const preview = previewOfNote("one\n\n\n\ntwo\n", 2);
	// Two content lines spent the whole budget, and the blanks between them
	// came along: they are what tells the block parser where one paragraph
	// ended, and charging the budget for them would buy fewer paragraphs than
	// the setting says.
	assert.deepEqual(preview.lines, ["one", "", "", "", "two"]);
	assert.equal(preview.more, 0);
});

test("frontmatter is not content", () => {
	const preview = previewOfNote("---\ntags: [a]\n---\nfirst line\n", 6);
	assert.deepEqual(preview.lines, ["first line"]);
});

test("an unterminated fence of dashes is not frontmatter, so nothing is eaten", () => {
	const preview = previewOfNote("---\nfirst line\n", 6);
	assert.deepEqual(preview.lines, ["---", "first line"]);
});

test("a paragraph line longer than the card is cut, and says so", () => {
	const preview = previewOfNote(`x${"y".repeat(400)}`, 6);
	const [paragraph] = previewBlocks(preview);
	assert.equal(paragraph.kind, "paragraph");
	assert.ok(paragraph.kind === "paragraph" && paragraph.text.endsWith("…"));
	assert.ok(paragraph.kind === "paragraph" && paragraph.text.length <= 121);
});

test("a sample is never cut: its own lines are the sample", () => {
	// The button on a sample copies it. A sample cut to fit would be a program
	// that no longer runs, offered with a button that copies it that way.
	const long = `x${"y".repeat(400)}`;
	const preview = previewOfNote(`\`\`\`\n${long}\n\`\`\`\n`, 6);
	assert.deepEqual(previewBlocks(preview), [{ kind: "code", lang: "", text: long }]);
});

test("what the card leaves out is counted, not guessed", () => {
	const preview = previewOfNote("a\nb\nc\nd\ne\n", 2);
	assert.deepEqual(preview.lines, ["a", "b"]);
	assert.equal(preview.more, 3);
});

test("a note with nothing in it has nothing to show and nothing left over", () => {
	const preview = previewOfNote("---\ntags: [a]\n---\n\n", 6);
	assert.deepEqual(preview.lines, []);
	assert.deepEqual(previewBlocks(preview), []);
	assert.equal(preview.more, 0);
});

// --- the setting is a slice, not a second read --------------------------------

test("lowering the line count moves lines from the card into the count", () => {
	const prepared = previewOfNote("a\nb\nc\nd\n", PREVIEW_CACHE_LINES);
	const clipped = clipPreview(prepared, 2);
	assert.deepEqual(clipped.lines, ["a", "b"]);
	assert.equal(clipped.more, 2);
});

test("asking for more than was prepared shows everything there is", () => {
	const prepared = previewOfNote("a\nb\n", PREVIEW_CACHE_LINES);
	assert.equal(clipPreview(prepared, 40), prepared);
});

test("the count never goes negative on a note shorter than the setting", () => {
	assert.equal(clipPreview(previewOfNote("a\n", 40), 6).more, 0);
});

// --- naming -------------------------------------------------------------------

test("a heading or block reference belongs to the link, not the name", () => {
	assert.equal(noteTitleOf("Notes/Guide#Part"), "Guide");
	assert.equal(noteTitleOf("Notes/Guide^abc123"), "Guide");
	assert.equal(noteTitleOf("Guide"), "Guide");
});

test("only a card that is about one link is a link card", () => {
	const doc = parseMarkdown(
		"- [[Guide]]\n- see [[Guide]]\n- () [[Guide]]\n- [Guide](Guide)\n- plain\n",
		{ title: "Plan" },
	);
	const [whole, mention, punctuation, markdown, plain] = doc.root.children;
	assert.equal(isLinkNode(whole), true);
	// A sentence that mentions a note is a sentence: there is no single target
	// in it to open, and picking one would be the map guessing.
	assert.equal(isLinkNode(mention), false);
	// The three a reader cannot tell apart from the first one on the card.
	assert.equal(isLinkNode(punctuation), true);
	assert.equal(isLinkNode(markdown), true);
	assert.equal(isLinkNode(plain), false);
});

test("an address is split into the site and the rest of the address", () => {
	assert.deepEqual(siteOf("https://obsidian.md/plugins?id=1"), {
		host: "obsidian.md",
		path: "/plugins?id=1",
	});
	assert.deepEqual(siteOf("https://example.com"), { host: "example.com", path: "/" });
});

test("an address with no site in it names itself", () => {
	// `mailto:` parses with no host, and there is no site to lead with.
	assert.deepEqual(siteOf("mailto:someone@example.com"), {
		host: "mailto:someone@example.com",
		path: "",
	});
	// And a target the browser refuses outright is still what there is to show.
	assert.deepEqual(siteOf("not a url"), { host: "not a url", path: "" });
});

// --- the cache ----------------------------------------------------------------

test("a read is remembered until the stamp moves", () => {
	const cache = new LinkReadCache();
	const file = prepareLinkFile("## A\n", 100);
	cache.put("Guide.md", file);
	assert.equal(cache.get("Guide.md", 100), file);
	assert.equal(cache.get("Guide.md", 101), null);
	assert.equal(cache.get("Other.md", 100), null);
});

test("forgetting a note drops it, which is what a delete or a rename needs", () => {
	const cache = new LinkReadCache();
	cache.put("Guide.md", prepareLinkFile("## A\n", 100));
	cache.forget("Guide.md");
	assert.equal(cache.get("Guide.md", 100), null);
});

// --- what the cache prepares --------------------------------------------------

test("one read prepares both the outline and the preview", () => {
	const file = prepareLinkFile("# Guide\n\n## Install\n\nrun npm install\n", 7);
	assert.deepEqual(
		file.outline.map((node) => node.text),
		["Install"],
	);
	assert.deepEqual(file.preview.lines, ["# Guide", "", "## Install", "", "run npm install"]);
	// And the two agree, which is the reason they are prepared together: what
	// the card reads is the note the arrow is about to pull an outline out of.
	assert.deepEqual(previewBlocks(file.preview), [
		{ kind: "paragraph", text: "Guide" },
		{ kind: "paragraph", text: "Install" },
		{ kind: "paragraph", text: "run npm install" },
	]);
});

test("the outline the cache prepares is the one the projection wants", () => {
	// The whole point of sharing one read: `projectOutline` takes exactly this.
	const file = prepareLinkFile("## A\n\n### B\n", 0);
	assert.equal(file.outline.length, 1);
	assert.equal(file.outline[0].children.length, 1);
});
