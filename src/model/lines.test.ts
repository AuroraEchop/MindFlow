import { test } from "node:test";
import assert from "node:assert/strict";

import { hasMoreThanOneLine } from "./lines.ts";

/**
 * The bar a note-content card clears before the map offers it a fold. It reads
 * a range of the note's lines rather than the text a card was drawn from,
 * because a folded card's text is one line by construction -- so the tests here
 * are about the shapes a body range really takes, blank lines included.
 */
test("a one-line block is not worth folding", () => {
	assert.equal(hasMoreThanOneLine(["只有一行"], 0, 0), false);
});

test("a block of prose is", () => {
	assert.equal(hasMoreThanOneLine(["第一行", "第二行"], 0, 1), true);
});

/**
 * The shape that made this a helper rather than a comparison of two line
 * numbers: a body range under a heading opens with the blank line that
 * separates it from the item above, so `end > start` says yes about a paragraph
 * of one line -- and folding it would show that line anyway.
 */
test("the blank line a range opens with does not count", () => {
	assert.equal(hasMoreThanOneLine(["", "只有一行"], 0, 1), false);
	assert.equal(hasMoreThanOneLine(["", "第一行", "第二行"], 0, 2), true);
});

test("blank lines between paragraphs are not content either", () => {
	assert.equal(hasMoreThanOneLine(["", "第一段", "", "第二段"], 0, 3), true);
	assert.equal(hasMoreThanOneLine(["第一段", "", ""], 0, 2), false);
});

test("a range of nothing but blanks is not a fold", () => {
	assert.equal(hasMoreThanOneLine(["", "  ", "\t"], 0, 2), false);
});

test("only the lines inside the range are read", () => {
	const lines = ["第一行", "第二行", "第三行"];
	assert.equal(hasMoreThanOneLine(lines, 2, 2), false);
	assert.equal(hasMoreThanOneLine(lines, 0, 1), true);
});

/**
 * A remembered fold is checked against a fresh parse, so the range can outrun
 * the document -- the note may have been shortened since. A line that is not
 * there is a line with nothing on it, never a crash.
 */
test("a range that runs past the end of the note is read as far as it goes", () => {
	assert.equal(hasMoreThanOneLine(["第一行", "第二行"], 0, 9), true);
	assert.equal(hasMoreThanOneLine([], 0, 3), false);
});

test("a range below the top of the document is not read backwards", () => {
	assert.equal(hasMoreThanOneLine([], -4, 2), false);
});
