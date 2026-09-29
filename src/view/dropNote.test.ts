import { test } from "node:test";
import assert from "node:assert/strict";

import { lineOfState, linksFromDrop, linkTextFromDrop } from "./dropNote.ts";

test("a link the platform wrote is kept exactly as it is", () => {
	// An alias is the note's own words for itself, and a link that went through
	// this file has no business rewriting them.
	assert.equal(linkTextFromDrop("[[外部链接]]"), "[[外部链接]]");
	assert.equal(linkTextFromDrop("[[note|Label]]"), "[[note|Label]]");
	assert.equal(linkTextFromDrop("  [[9.24 Day9]]  "), "[[9.24 Day9]]");
	assert.equal(linkTextFromDrop("[label](Note.md)"), "[label](Note.md)");
});

test("a path or a file name becomes the wikilink the note would have written", () => {
	assert.equal(linkTextFromDrop("9.24 Day9.md"), "[[9.24 Day9]]");
	assert.equal(linkTextFromDrop("daily/9.24 Day9.md"), "[[9.24 Day9]]");
	assert.equal(linkTextFromDrop("daily\\9.24 Day9.md"), "[[9.24 Day9]]");
	assert.equal(linkTextFromDrop("D:\\Fontend\\Fontend\\daily\\9.24 Day9.md"), "[[9.24 Day9]]");
	// Case is the file system's business, not the link's.
	assert.equal(linkTextFromDrop("diary/Note.MD"), "[[Note]]");
});

test("what is not a note is refused rather than turned into a dead link", () => {
	// A picture, a document and a web address are all things a link card cannot
	// open, so none of them may become one.
	assert.equal(linkTextFromDrop("hero.png"), null);
	assert.equal(linkTextFromDrop("assets/图 1.jpeg"), null);
	assert.equal(linkTextFromDrop("paper.pdf"), null);
	assert.equal(linkTextFromDrop("https://obsidian.md"), null);
	assert.equal(linkTextFromDrop("https://example.com/notes/a.md"), null);
	assert.equal(linkTextFromDrop("obsidian://open?vault=v&file=note"), null);
	assert.equal(linkTextFromDrop("mailto:someone@example.com"), null);
	// A drive letter is not a scheme, and the path behind it is still a path.
	assert.equal(linkTextFromDrop("D:/notes/9.24 Day9.md"), "[[9.24 Day9]]");
	assert.equal(linkTextFromDrop("record.mp3"), null);
	// Plain prose is not a file name either -- and this is the case that must
	// not be guessed at, because any selected text can be dropped.
	assert.equal(linkTextFromDrop("这是一句被拖进来的话"), null);
	assert.equal(linkTextFromDrop("Day 9：网络协议与 HTTP"), null);
	assert.equal(linkTextFromDrop(""), null);
	assert.equal(linkTextFromDrop("   "), null);
	assert.equal(linkTextFromDrop(".md"), null);
});

test("a payload is one note per line, without repeats", () => {
	assert.deepEqual(linksFromDrop("a.md\nb.md\n"), ["[[a]]", "[[b]]"]);
	assert.deepEqual(linksFromDrop("daily/a.md\r\ndaily/a.md"), ["[[a]]"]);
	assert.deepEqual(linksFromDrop("[[a]]\na.md\n\nhero.png\n"), ["[[a]]"]);
	assert.deepEqual(linksFromDrop("hero.png\nhttps://x.dev"), []);
});

test("an ephemeral state is only a request when it carries a line", () => {
	assert.equal(lineOfState({ line: 12 }), 12);
	assert.equal(lineOfState({ line: 0 }), 0);
	// Obsidian sends other things down this channel too, and none of them names
	// a card. Refusing them is what keeps a map from jumping to its first card.
	assert.equal(lineOfState({}), null);
	assert.equal(lineOfState(null), null);
	assert.equal(lineOfState(undefined), null);
	assert.equal(lineOfState("9"), null);
	assert.equal(lineOfState({ line: "9" }), null);
	assert.equal(lineOfState({ line: NaN }), null);
	// A line is a line: a fraction of one is rounded down rather than refused.
	assert.equal(lineOfState({ line: 12.7 }), 12);
	assert.equal(lineOfState({ line: -3 }), 0);
});
