import { test } from "node:test";
import assert from "node:assert/strict";

import {
	MAX_NOTE_NAME,
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
