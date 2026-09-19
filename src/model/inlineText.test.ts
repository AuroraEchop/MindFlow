import { test } from "node:test";
import assert from "node:assert/strict";

import { nextInlineToken, plainText } from "./inlineText.ts";

test("every marker is stripped down to what a reader sees", () => {
	assert.equal(plainText("`code`"), "code");
	assert.equal(plainText("**bold** text"), "bold text");
	assert.equal(plainText("__bold__ text"), "bold text");
	assert.equal(plainText("~~gone~~"), "gone");
	assert.equal(plainText("==marked=="), "marked");
	assert.equal(plainText("*em* here"), "em here");
	assert.equal(plainText(""), "");
	assert.equal(plainText("plain title"), "plain title");
});

test("nested markup is unwrapped all the way down", () => {
	assert.equal(plainText("**bold with `code` in it**"), "bold with code in it");
	assert.equal(plainText("==**both**=="), "both");
	// `***a***` is what the renderer draws it as, not what a full markdown
	// parser would: `**a**` matches from index 1, so the odd star stays text.
	assert.equal(plainText("***a***"), "*a*");
});

test("a wikilink is found by its label, never by its target", () => {
	assert.equal(plainText("[[Mindmap Demo|Read the demo]]"), "Read the demo");
	assert.equal(plainText("[[Mindmap Demo]]"), "Mindmap Demo");
	assert.equal(plainText("see [text](https://example.com/page) now"), "see text now");
	assert.equal(plainText("![[diagram.png]]"), "diagram.png");
});

test("an image is found by its alt text, and the `!` is not left on the card", () => {
	assert.equal(plainText("![卡片样式](../assets/card-styles.png)"), "卡片样式");
	// No alt text: the target is all there is to read, so it is what is shown.
	assert.equal(plainText("![](shot.png)"), "shot.png");
	assert.equal(plainText("see ![a](b.png) now"), "see a now");

	// One character before the link it contains, so it wins on position rather
	// than on order -- the same trick the embed rule uses.
	const image = nextInlineToken("![a](b.png)", 0);
	assert.equal(image?.rule.kind, "image");
	assert.deepEqual([image?.start, image?.end], [0, 11]);
});

test("code content is left exactly as written", () => {
	assert.equal(plainText("`**not bold**`"), "**not bold**");
	assert.equal(plainText("`[[not a link]]`"), "[[not a link]]");
});

test("math is not a rule here, so a formula stays its own source", () => {
	// Pins the v1 limitation: `$...$` lives in view/mathSyntax.ts and the
	// renderer composes it in front of these rules, so search sees TeX.
	assert.equal(plainText("$\\lambda$ 学习率"), "$\\lambda$ 学习率");
	assert.equal(plainText("rate $a_b$"), "rate $a_b$");
});

test("CJK and other plain text pass through untouched", () => {
	assert.equal(plainText("第一章 标题"), "第一章 标题");
	assert.equal(plainText("**第一章** 标题"), "第一章 标题");
});

test("an unclosed delimiter is text, not a token", () => {
	assert.equal(plainText("**unclosed"), "**unclosed");
	assert.equal(plainText("a * b * c"), "a  b  c");
	assert.equal(plainText("[label](unclosed"), "[label](unclosed");
	assert.equal(plainText("`tick"), "`tick");
});

test("an exact tie goes to whichever rule is listed first", () => {
	const bold = nextInlineToken("**a**", 0);
	assert.equal(bold?.rule.kind, "strong");
	assert.deepEqual([bold?.start, bold?.end], [0, 5]);

	// `![[x]]` starts one character before the wikilink it contains, so it wins
	// on position rather than on order.
	const embed = nextInlineToken("![[x]]", 0);
	assert.equal(embed?.rule.kind, "embed");
	assert.deepEqual([embed?.start, embed?.end], [0, 6]);
});

test("scanning resumes from an offset without re-reading the first token", () => {
	const text = "`one` and **two**";
	const first = nextInlineToken(text, 0);
	assert.equal(first?.rule.kind, "code");
	const second = nextInlineToken(text, first?.end ?? 0);
	assert.equal(second?.rule.kind, "strong");
	assert.equal(second?.match[1], "two");
	assert.equal(nextInlineToken(text, second?.end ?? 0), null);
});

test("the shared patterns are not left holding state between scans", () => {
	// The rules carry `lastIndex`, and plainText recurses into nested markup
	// while an outer scan is in flight. Both have to come out the same twice.
	const text = "**a `b` c** and [[x|y]] and *d*";
	assert.equal(plainText(text), plainText(text));
	assert.equal(plainText(text), "a b c and y and d");
	assert.deepEqual(nextInlineToken(text, 0), nextInlineToken(text, 0));
});

// --- tags --------------------------------------------------------------------

test("a tag is a token, and the `#` is part of what it says", () => {
	const tag = nextInlineToken("#tag", 0);
	assert.equal(tag?.rule.kind, "tag");
	assert.deepEqual([tag?.start, tag?.end], [0, 4]);
	// Group 1 is the space or bracket the rule had to consume to say the `#`
	// was allowed to be there; group 2 is the tag itself.
	assert.equal(tag?.match[1], "");
	assert.equal(tag?.match[2], "tag");

	// Unlike every other marker, the `#` is drawn -- so the tokenizer finding
	// one changes nothing about what search sees.
	assert.equal(plainText("#tag"), "#tag");
	assert.equal(plainText("see #tag now"), "see #tag now");
	assert.equal(plainText("**bold** and #tag"), "bold and #tag");
});

test("a tag starts the line or follows a space, and nowhere else", () => {
	assert.equal(nextInlineToken("#start", 0)?.rule.kind, "tag");
	assert.equal(nextInlineToken("a #mid", 0)?.rule.kind, "tag");
	assert.equal(nextInlineToken("(#paren)", 0)?.rule.kind, "tag");
	// The bracket is consumed along with the `#`, so the token opens on it.
	assert.equal(nextInlineToken("(#paren)", 0)?.start, 0);

	assert.equal(nextInlineToken("C#", 0), null, "a language is not a tag");
	assert.equal(nextInlineToken("https://x.test/#anchor", 0), null, "a fragment is not a tag");
	assert.equal(nextInlineToken("a#glued", 0), null);
});

test("a `#` in front of a number is a number", () => {
	assert.equal(nextInlineToken("#42", 0), null);
	assert.equal(plainText("closes #42 and #43"), "closes #42 and #43");
	assert.equal(nextInlineToken("#7th", 0), null);
});

test("a tag with a path, a hyphen or letters outside ASCII is still one tag", () => {
	assert.equal(nextInlineToken("#a/b/c", 0)?.match[2], "a/b/c");
	assert.equal(nextInlineToken("#well-known", 0)?.match[2], "well-known");
	assert.equal(nextInlineToken("#中文标签", 0)?.match[2], "中文标签");
});

test("a bare `#` and a tag inside code are both just text", () => {
	assert.equal(nextInlineToken("#", 0), null);
	assert.equal(nextInlineToken("# a heading", 0), null);
	assert.equal(plainText("`#notatag`"), "#notatag");
});

test("the space in front of a tag is drawn, not swallowed by the match", () => {
	// The rule has to consume that space to say the `#` may follow one, so the
	// emitter is what puts it back. Without that, `a #tag` would read `a#tag`.
	const tag = nextInlineToken("a #tag", 0);
	assert.deepEqual([tag?.start, tag?.end], [1, 6]);
	assert.equal(tag?.match[1], " ");
	assert.equal(tag?.match[2], "tag");

	assert.equal(plainText("a #tag"), "a #tag");
	assert.equal(plainText("a  #tag"), "a  #tag");
});
