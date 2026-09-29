import { test } from "node:test";
import assert from "node:assert/strict";

import {
	MAX_NOTE_NAME,
	cardIsAbout,
	cardLink,
	isExternalTarget,
	linkMarkup,
	noteNameFrom,
	soleLink,
	unlinkedText,
} from "./noteName.ts";

// --- reading a link back ------------------------------------------------------

test("a string that is one link reads as its two halves", () => {
	assert.deepEqual(soleLink("[[Note]]"), { target: "Note", label: null });
	assert.deepEqual(soleLink("[[Notes/deep/Note]]"), { target: "Notes/deep/Note", label: null });
	assert.deepEqual(soleLink("[[Note|Called this]]"), { target: "Note", label: "Called this" });
	assert.deepEqual(soleLink("[[Note#Part]]"), { target: "Note#Part", label: null });
	assert.deepEqual(soleLink("[[Note^block]]"), { target: "Note^block", label: null });
});

test("the ends are trimmed, so a stray space does not stop it being a link", () => {
	assert.deepEqual(soleLink("  [[Note]]  "), { target: "Note", label: null });
	assert.deepEqual(soleLink("[[ Note ]]"), { target: "Note", label: null });
});

test("a sentence that mentions a note is a sentence, not a link", () => {
	assert.equal(soleLink("see [[Note]]"), null);
	assert.equal(soleLink("[[Note]] and more"), null);
	assert.equal(soleLink("[[a]] [[b]]"), null);
	assert.equal(soleLink("Note"), null);
	assert.equal(soleLink(""), null);
	assert.equal(soleLink("[[]]"), null);
});

// --- the link a card is about -------------------------------------------------

test("a card that is one wikilink is about it, and is nothing else", () => {
	assert.deepEqual(cardLink("[[Note]]"), {
		target: "Note",
		label: null,
		sole: true,
		external: false,
	});
	assert.deepEqual(cardLink("  [[Note|Called this]]  "), {
		target: "Note",
		label: "Called this",
		sole: true,
		external: false,
	});
});

test("a markdown-spelled link reads the same as a wikilink", () => {
	// Nothing on the card tells a reader which spelling the note used, so
	// nothing here may care either.
	assert.deepEqual(cardLink("[Note](Note)"), {
		target: "Note",
		label: "Note",
		sole: true,
		external: false,
	});
	assert.equal(cardLink("[called this](Notes/Guide)")?.target, "Notes/Guide");
	assert.equal(cardLink("[called this](Notes/Guide)")?.label, "called this");
});

test("punctuation beside a link is not a reason to stop being a link", () => {
	// The card is drawn as a link and a reader will press it. Doing nothing
	// because a bracket was written first is the map looking broken.
	for (const text of ["() [[Note]]", "[[Note]]。", "- [[Note]] --", "[[Note]]?", "(()[[Note]])"]) {
		assert.equal(cardLink(text)?.target, "Note", text);
		assert.equal(cardLink(text)?.sole, false, text);
	}
});

test("words beside a link still make it a sentence", () => {
	// The other half of the rule, and the one that keeps the map from guessing:
	// a sentence has no single target to open.
	assert.equal(cardLink("see [[Note]]"), null);
	assert.equal(cardLink("[[Note]] and more"), null);
	assert.equal(cardLink("[as I said](Note) here"), null);
});

test("two links are not one link, whatever is around them", () => {
	assert.equal(cardLink("[[a]] [[b]]"), null);
	assert.equal(cardLink("[[a]]、[[b]]"), null);
	assert.equal(cardLink("[[a]] [b](b)"), null);
});

test("a markdown link keeps its title out of the target", () => {
	assert.deepEqual(cardLink('[docs](https://a.example/b "The title")'), {
		target: "https://a.example/b",
		label: "docs",
		sole: true,
		external: true,
	});
});

test("an address is a link, and is marked as being outside the vault", () => {
	assert.deepEqual(cardLink("[obsidian](https://obsidian.md)"), {
		target: "https://obsidian.md",
		label: "obsidian",
		sole: true,
		external: true,
	});
	assert.deepEqual(cardLink("https://example.com/one"), {
		target: "https://example.com/one",
		label: null,
		sole: true,
		external: true,
	});
	assert.equal(isExternalTarget("mailto:a@b.c"), true);
	assert.equal(isExternalTarget("Notes/Guide#Part"), false);
});

test("a card that is one link and nothing else is the only thing that is `sole`", () => {
	// The narrow answer is what a rename or an unlink may act on, so it has to
	// stay narrower than the wide one.
	assert.equal(cardLink("[[Note]]")?.sole, true);
	assert.equal(cardLink("() [[Note]]")?.sole, false);
	assert.equal(soleLink("() [[Note]]"), null);
});

test("a card with no link at all is about nothing", () => {
	assert.equal(cardLink("plain words"), null);
	assert.equal(cardLink(""), null);
	assert.equal(cardLink("[[]]"), null);
});

// --- whether a card is still that card ----------------------------------------

test("a card that is one link is about that link, whatever else is asked", () => {
	// Both readings agree here: the card *is* the link, so a press on it, an
	// outline under it and a preview on it are all about the same target.
	assert.equal(cardIsAbout("[外部链接](填坑)", "填坑", true), true);
	assert.equal(cardIsAbout("[外部链接](填坑)", "填坑", false), true);
	assert.equal(cardIsAbout("() [[填坑]]", "填坑", true), true);
});

test("a card of prose is about a link it writes, and only the loose way", () => {
	assert.equal(cardIsAbout("看这个 [[填坑]] 吧", "填坑", false), true);
	assert.equal(cardIsAbout("看这个 [填坑](填坑) 吧", "填坑", false), true);
	// Nothing but a card that names a single note can carry that note's
	// outline, so the narrow question says no to prose.
	assert.equal(cardIsAbout("看这个 [[填坑]] 吧", "填坑", true), false);
});

test("a card that has stopped writing a link is not about it any more", () => {
	// The regression this answers: a card's key is the note's *place* for it,
	// and a place can change hands. A block that moves out of a link card's
	// place used to hand everything that card had open to the block that took
	// the place over -- here, a note-content card drawn as a code block.
	const codeBlock = "> - [ ] **复盘**：把当天面试/做题的盲区记进《前端秋招面试题库》";
	assert.equal(cardIsAbout(codeBlock, "填坑", false), false);
	assert.equal(cardIsAbout(codeBlock, "填坑", true), false);
	assert.equal(cardIsAbout("另一件事 [[别的]]", "填坑", false), false);
	assert.equal(cardIsAbout("", "填坑", false), false);
});

// --- writing one back ---------------------------------------------------------

test("a link is written without a label when the label would repeat it", () => {
	assert.equal(linkMarkup("Note"), "[[Note]]");
	assert.equal(linkMarkup("Note", null), "[[Note]]");
	assert.equal(linkMarkup("Note", ""), "[[Note]]");
	assert.equal(linkMarkup("Note", "   "), "[[Note]]");
	assert.equal(linkMarkup("Note", "Note"), "[[Note]]");
	assert.equal(linkMarkup("Note", "Called this"), "[[Note|Called this]]");
});

test("unlinking leaves the label, or the target with its reference taken off", () => {
	assert.equal(unlinkedText({ target: "Note", label: "Called this" }), "Called this");
	assert.equal(unlinkedText({ target: "Note", label: null }), "Note");
	assert.equal(unlinkedText({ target: "Notes/a#Part", label: null }), "Notes/a");
	assert.equal(unlinkedText({ target: "Notes/a^block", label: null }), "Notes/a");
	// A label of "" is what `[[Note|]]` leaves, and it is not a name to keep.
	assert.equal(unlinkedText({ target: "Note", label: "" }), "Note");
});

// --- making a name out of a node ---------------------------------------------

test("characters a file name may not carry become spaces", () => {
	assert.equal(noteNameFrom("a/b"), "a b");
	assert.equal(noteNameFrom('why? because: this <that> "other" | pipe'), "why because this that other pipe");
	assert.equal(noteNameFrom("tag#1 ^2 [3]"), "tag 1 2 3");
	assert.equal(noteNameFrom("back\\slash"), "back slash");
});

test("runs of whitespace collapse and the ends are trimmed", () => {
	assert.equal(noteNameFrom("  a   b  "), "a b");
	assert.equal(noteNameFrom("a\n\tb"), "a b");
});

test("a node that is already a link is named by its target, or by its label", () => {
	assert.equal(noteNameFrom("[[Note]]"), "Note");
	assert.equal(noteNameFrom("[[Notes/deep/Note]]"), "Notes deep Note");
	assert.equal(noteNameFrom("[[Note|Called this]]"), "Called this");
	assert.equal(noteNameFrom("see [[Note]] here"), "see Note here");
});

test("paired emphasis goes, and an underscore that is part of a name stays", () => {
	assert.equal(noteNameFrom("**bold**"), "bold");
	assert.equal(noteNameFrom("a **b** c"), "a b c");
	assert.equal(noteNameFrom("`code`"), "code");
	assert.equal(noteNameFrom("~~gone~~"), "gone");
	assert.equal(noteNameFrom("snake_case"), "snake_case");
});

test("a leading or trailing dot goes, because Windows refuses one", () => {
	assert.equal(noteNameFrom("..."), "");
	assert.equal(noteNameFrom(".hidden"), "hidden");
	assert.equal(noteNameFrom("trailing."), "trailing");
});

test("a name is cut to its bound", () => {
	const long = "x".repeat(MAX_NOTE_NAME * 2);
	assert.equal(noteNameFrom(long).length, MAX_NOTE_NAME);
});

test("nothing usable left over means no name at all", () => {
	assert.equal(noteNameFrom(""), "");
	assert.equal(noteNameFrom("   "), "");
	assert.equal(noteNameFrom("///"), "");
});

test("letters outside ASCII survive, because a name is not a slug", () => {
	assert.equal(noteNameFrom("思维导图"), "思维导图");
	assert.equal(noteNameFrom("café — ünïcode"), "café — ünïcode");
	assert.equal(noteNameFrom("日本語のノート"), "日本語のノート");
});
