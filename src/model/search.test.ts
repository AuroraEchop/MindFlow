import { test } from "node:test";
import assert from "node:assert/strict";

import { parseMarkdown } from "./parse.ts";
import {
	foldedToFirstLevel,
	hiddenAncestorKeys,
	matchRanges,
	refoldKeys,
	searchTree,
} from "./search.ts";
import type { SearchQuery } from "./search.ts";
import { BODY_ID_MARK, walk } from "./types.ts";
import type { MindNode, ParsedDoc } from "./types.ts";

const NOTE = `# Focus Note

Intro paragraph mentioning paragraphonly.

## **bold** text

- [[Mindmap Demo|Read the demo]]
- 第一章 标题
- [ ] focus item
- \`code focus\`

## Deep

- one
	- two
		- three
			- deep focus target
`;

const doc = parseMarkdown(NOTE, { title: "Untitled" });

/** What every query in this file leaves at its default. */
const PLAIN: Pick<SearchQuery, "caseSensitive" | "titlesOnly"> = {
	caseSensitive: false,
	titlesOnly: false,
};

/** Every match's text, which is also its document order. */
function found(parsed: ParsedDoc, text: string, regex = false): string[] {
	return searchTree(parsed, { text, regex, ...PLAIN }).matches.map((m) => m.text);
}

/** The same, with the narrowing switch set the way the caller asks. */
function foundWith(
	parsed: ParsedDoc,
	text: string,
	opts: Partial<SearchQuery>,
): string[] {
	return searchTree(parsed, { text, regex: false, ...PLAIN, ...opts }).matches.map(
		(m) => m.text,
	);
}

/** Every match's key, which is what the view looks a card up by. */
function keys(parsed: ParsedDoc, opts: Partial<SearchQuery>): string[] {
	return searchTree(parsed, { text: "o", regex: false, ...PLAIN, ...opts }).matches.map(
		(m) => m.key,
	);
}

function nodeNamed(parsed: ParsedDoc, text: string): MindNode {
	const hits: MindNode[] = [];
	walk(parsed.root, (node) => {
		if (node.text === text) hits.push(node);
	});
	assert.equal(hits.length, 1, `expected exactly one node named ${text}`);
	return hits[0];
}

test("matches come back in document order", () => {
	assert.deepEqual(found(doc, "focus"), [
		"Focus Note",
		"focus item",
		"code focus",
		"deep focus target",
	]);
});

test("a substring query is case-insensitive", () => {
	assert.deepEqual(found(doc, "FOCUS ITEM"), ["focus item"]);
	assert.deepEqual(found(doc, "dEeP fOcUs"), ["deep focus target"]);
});

test("an empty query finds nothing rather than everything", () => {
	const result = searchTree(doc, { text: "", regex: false, ...PLAIN });
	assert.deepEqual(result.matches, []);
	assert.equal(result.invalid, false);
	assert.deepEqual(searchTree(doc, { text: "", regex: true, ...PLAIN }).matches, []);
});

test("case only matters when the search says it does", () => {
	// The default reading: `FOCUS` and `focus` are one word, which is what a
	// map of notes needs -- `API` on one card and `api` on another are the
	// same thing said twice.
	assert.deepEqual(foundWith(doc, "FOCUS ITEM", { caseSensitive: false }), ["focus item"]);
	// Asked to care, the same query finds nothing, and the query that spells
	// it the way the card does is the one that lands.
	assert.deepEqual(foundWith(doc, "FOCUS ITEM", { caseSensitive: true }), []);
	assert.deepEqual(foundWith(doc, "focus item", { caseSensitive: true }), ["focus item"]);
	assert.deepEqual(foundWith(doc, "Focus Note", { caseSensitive: true }), ["Focus Note"]);
	assert.deepEqual(foundWith(doc, "focus note", { caseSensitive: true }), []);
});

test("case is kept in regex mode too, where the flag is the pattern's own", () => {
	const q = (text: string, caseSensitive: boolean) =>
		searchTree(doc, { text, regex: true, ...PLAIN, caseSensitive });
	assert.deepEqual(q("^Focus", true).matches.map((m) => m.text), ["Focus Note"]);
	assert.deepEqual(q("^focus", true).matches.map((m) => m.text), ["focus item"]);
	// Without the switch both spellings reach both cards.
	assert.equal(q("^focus", false).matches.length, 2);
});

test("a regex is anchored, alternated and case-insensitive as written", () => {
	assert.deepEqual(found(doc, "^第", true), ["第一章 标题"]);
	assert.deepEqual(found(doc, "^(one|two)$", true), ["one", "two"]);
	assert.deepEqual(found(doc, "focus note", true), ["Focus Note"]);
});

test("a pattern that will not compile reports itself instead of throwing", () => {
	const result = searchTree(doc, { text: "(", regex: true, ...PLAIN });
	assert.deepEqual(result.matches, []);
	assert.equal(result.invalid, true);
	// Only regex mode compiles anything; the same text is a plain substring.
	assert.equal(searchTree(doc, { text: "(", regex: false, ...PLAIN }).invalid, false);
});

test("a regex does not carry lastIndex from one node to the next", () => {
	// With a `g` flag the second sibling would resume mid-string and the third
	// would miss outright.
	const repeated = parseMarkdown("- aa\n- aa\n- aa\n", { title: "Untitled" });
	assert.equal(found(repeated, "a", true).length, 3);
	assert.equal(found(repeated, "a").length, 3);
});

test("a node deep in the tree is found; folding is not the model's business", () => {
	const target = nodeNamed(doc, "deep focus target");
	assert.equal(target.level, 4);
	assert.deepEqual(found(doc, "deep focus target"), ["deep focus target"]);
});

test("a virtual root is skipped, a promoted h1 root is not", () => {
	const virtual = parseMarkdown("- alpha\n- beta\n", { title: "Untitled" });
	assert.equal(virtual.root.virtual, true);
	assert.deepEqual(found(virtual, "untitled"), []);

	assert.equal(doc.root.virtual, false);
	assert.deepEqual(found(doc, "Focus Note"), ["Focus Note"]);
});

test("CJK text is matched as written", () => {
	assert.deepEqual(found(doc, "第一章"), ["第一章 标题"]);
	assert.deepEqual(found(doc, "标题"), ["第一章 标题"]);
});

test("matching is done on what the card shows, not on the markup", () => {
	// Markers are stripped, so a query may span them.
	assert.deepEqual(found(doc, "bold text"), ["bold text"]);
	// A wikilink is its label; the target it points at is not on the card.
	assert.deepEqual(found(doc, "Read the demo"), ["Read the demo"]);
	assert.deepEqual(found(doc, "Mindmap Demo"), []);
	// Code shows its content, so the backticks are not part of the text.
	assert.deepEqual(found(doc, "code focus"), ["code focus"]);
});

test("the whole note is searched by default, and `¶` is what narrows it", () => {
	// Whole by default: the paragraph under the h1 is a card like any other,
	// because the word being looked for is as likely to be in prose as in a
	// heading -- which is the whole point of searching the map rather than the
	// outline.
	assert.ok(doc.root.bodyRanges.length > 0);
	assert.deepEqual(found(doc, "paragraphonly"), [
		"Intro paragraph mentioning paragraphonly.",
	]);
	// Narrowed, the walk stops at each card's own line, so the paragraph that
	// mentions the word is no longer somewhere the word is found.
	assert.deepEqual(foundWith(doc, "paragraphonly", { titlesOnly: true }), []);
});

test("a note-content match is named the way the card that draws it is", () => {
	// The view synthesises one card per body range and gives it the owner's key
	// with a mark and an index; a search that named it anything else would hand
	// the view a key no card answers to.
	const whole = keys(doc, { titlesOnly: false });
	const titles = keys(doc, { titlesOnly: true });
	const added = whole.filter((key) => !titles.includes(key));
	assert.ok(added.length > 0, "expected at least one body match");
	for (const key of added) {
		assert.ok(key.includes(BODY_ID_MARK), `${key} is not a body key`);
		const owner = doc.byKey.get(key.slice(0, key.indexOf(BODY_ID_MARK)));
		assert.ok(owner, `no owner for ${key}`);
	}
	// The title matches are untouched by the narrowing: it can only take
	// somewhere away, never add one.
	assert.deepEqual(titles, whole.filter((key) => titles.includes(key)));
});

test("a checkbox is not part of the text it precedes", () => {
	assert.deepEqual(found(doc, "[ ] focus"), []);
	assert.equal(nodeNamed(doc, "focus item").checkbox, " ");
});

test("every title match resolves back to the same node by key and by id", () => {
	// A note-content card is deliberately absent from both indexes -- the view
	// synthesises it and the parser never does -- so this is asked of titles
	// and of nothing else.
	const titles = { text: "o", regex: false, ...PLAIN, titlesOnly: true };
	for (const match of searchTree(doc, titles).matches) {
		const byKey = doc.byKey.get(match.key);
		const byId = doc.byId.get(match.id);
		assert.ok(byKey, `key ${match.key} is not in byKey`);
		assert.equal(byKey, byId);
	}
});

/** The text one query would mark up, which is what a reader gets to see. */
function marked(text: string, query: string, opts: Partial<SearchQuery> = {}): string[] {
	return matchRanges(text, { text: query, regex: false, ...PLAIN, ...opts }).map((range) =>
		text.slice(range.start, range.end),
	);
}

test("a hit comes back as the offsets it occupies, not just as an answer", () => {
	// The marks are cut by these offsets, so a slice has to give the word back
	// exactly as it is written -- the card's own spelling, not the query's.
	assert.deepEqual(marked("the Focus Note here", "focus"), ["Focus"]);
	assert.deepEqual(marked("浏览器把跨域请求分开", "跨域"), ["跨域"]);
});

test("every occurrence is reported, in order, with none of them overlapping", () => {
	const text = "aa bb aa bb aa";
	const ranges = matchRanges(text, { text: "aa", regex: false, ...PLAIN });
	assert.deepEqual(
		ranges.map((r) => [r.start, r.end]),
		[
			[0, 2],
			[6, 8],
			[12, 14],
		],
	);
	// Offsets into the string, so the caller can slice without being told how.
	for (const range of ranges) assert.equal(text.slice(range.start, range.end), "aa");
});

test("a plain query is a substring, so its punctuation is not syntax", () => {
	// `a.b` is three characters, and the search that treats the dot as "any
	// character" would mark `axb` -- a word the user never typed.
	assert.deepEqual(marked("a.b and axb", "a.b"), ["a.b"]);
	assert.deepEqual(marked("costs $5 (maybe)", "$5 ("), ["$5 ("]);
	assert.deepEqual(marked("a*b", "a*b"), ["a*b"]);
});

test("a regex reports the offsets of the whole match, case flag and all", () => {
	const text = "Focus Note and focus item";
	const ranges = matchRanges(text, { text: "^\\w+", regex: true, ...PLAIN });
	assert.deepEqual(ranges.map((r) => text.slice(r.start, r.end)), ["Focus"]);
	// The `i` flag is the query's `caseSensitive`, and it reaches the offsets.
	const both = matchRanges(text, { text: "focus", regex: true, ...PLAIN });
	assert.deepEqual(both.map((r) => text.slice(r.start, r.end)), ["Focus", "focus"]);
	assert.deepEqual(marked(text, "focus", { caseSensitive: true }), ["focus"]);
});

test("a pattern that matches nothing marks nothing, rather than an empty span", () => {
	// `a*` matches the empty string at every position; a mark of no characters
	// is not somewhere a highlight can go, and a card would collect a hundred
	// of them.
	for (const query of ["a*", "^", "b?"]) {
		const ranges = matchRanges("aaa", { text: query, regex: true, ...PLAIN });
		for (const range of ranges) assert.ok(range.end > range.start, `${query} gave an empty span`);
	}
	// A pattern that cannot compile is the other empty answer.
	assert.deepEqual(matchRanges("aaa", { text: "(", regex: true, ...PLAIN }), []);
	assert.deepEqual(matchRanges("", { text: "a", regex: false, ...PLAIN }), []);
});

test("a card that matched is a card with somewhere to put a mark", () => {
	// The two halves answer different questions -- which card, and what in it --
	// so they are asked of one query and have to agree about the text.
	for (const query of ["focus", "跨域", "one"]) {
		for (const match of searchTree(doc, { text: query, regex: false, ...PLAIN }).matches) {
			assert.ok(
				matchRanges(match.text, { text: query, regex: false, ...PLAIN }).length > 0,
				`${match.key} matched ${query} but has nowhere to mark it`,
			);
		}
	}
});

test("hiddenAncestorKeys names only the ancestors actually in the way", () => {
	const target = nodeNamed(doc, "deep focus target");
	const one = nodeNamed(doc, "one");
	const three = nodeNamed(doc, "three");

	assert.deepEqual(hiddenAncestorKeys(target, new Set()), []);
	// Outermost first, and only the collapsed ones.
	assert.deepEqual(hiddenAncestorKeys(target, new Set([three.key, one.key])), [
		one.key,
		three.key,
	]);
	// A node collapsed in its own right is not hiding itself.
	assert.deepEqual(hiddenAncestorKeys(target, new Set([target.key])), []);
});

test("refoldKeys hands back every branch except the one holding the match", () => {
	const deep = nodeNamed(doc, "Deep");
	const one = nodeNamed(doc, "one");
	const two = nodeNamed(doc, "two");
	const three = nodeNamed(doc, "three");
	const target = nodeNamed(doc, "deep focus target");
	const elsewhere = nodeNamed(doc, "**bold** text");

	const revealed = new Set([deep.key, one.key, two.key, three.key, elsewhere.key]);

	// Nothing left to keep: everything the search opened goes back.
	assert.deepEqual(new Set(refoldKeys(revealed, null)), revealed);

	// The chain that keeps the match on the map survives whole, the branch four
	// levels up included; the unrelated branch does not.
	assert.deepEqual(refoldKeys(revealed, target), [elsewhere.key]);

	// A node is not its own ancestor, and neither is anything below it: keeping
	// `two` keeps only what is above `two`.
	assert.deepEqual(new Set(refoldKeys(revealed, two)), new Set([two.key, three.key, elsewhere.key]));

	// A match nothing was opened for still costs nothing.
	assert.deepEqual(refoldKeys(new Set(), target), []);
});

// --- the fold shape, as a question a control can ask -----------------------------

/** `foldedToFirstLevel` with the child test the view hands it. */
function folded(parsed: ParsedDoc, collapsed: MindNode[]): boolean {
	return foldedToFirstLevel(
		parsed.root,
		new Set(collapsed.map((node) => node.key)),
		(node) => node.children.length > 0,
	);
}

test("the fold shape says whether anything below the first level is open", () => {
	const heading = nodeNamed(doc, "**bold** text");
	const deep = nodeNamed(doc, "Deep");

	// Nothing folded: both first-level sections are showing what is under them.
	assert.equal(folded(doc, []), false);

	// What `collapseAll` leaves behind: the first level itself, folded.
	assert.equal(folded(doc, [heading, deep]), true);

	// One of them open is enough to have something to collapse again.
	assert.equal(folded(doc, [heading]), false);

	// A fold deeper down does not answer the question: the first level is what
	// decides whether the second level is on screen, and it is open.
	assert.equal(folded(doc, [nodeNamed(doc, "two")]), false);

	// A root folded by hand hides everything below it, first level included.
	assert.equal(folded(doc, [doc.root]), true);
});

test("a first-level section with nothing to hide is not an open one", () => {
	// `hasChildren` is why this is a parameter: a section whose only content is a
	// paragraph has no second level to show, and counting it as open would leave
	// a folded map offering "collapse all" for ever.
	const parsed = parseMarkdown("# R\n\n## Empty\n\n## Full\n\n- under it\n", {
		title: "Untitled",
	});
	assert.equal(folded(parsed, [nodeNamed(parsed, "Full")]), true);
	assert.equal(folded(parsed, []), false);

	// And a note with no second level anywhere is folded as far as it goes.
	const flat = parseMarkdown("# R\n\njust a paragraph\n", { title: "Untitled" });
	assert.equal(folded(flat, []), true);
});
