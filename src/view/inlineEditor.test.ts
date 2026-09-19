import { test } from "node:test";
import assert from "node:assert/strict";

import { inlineIntent } from "./inlineEditor.ts";
import type { InlineIntent, InlineKeyEvent, InlineKeyShape } from "./inlineEditor.ts";

/** A key press with everything spelled out, so each test names only what it means. */
function press(key: string, overrides: Partial<InlineKeyEvent> = {}): InlineKeyEvent {
	return { key, shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, ...overrides };
}

/** A node title: one line, so Enter saves it, and the find bar may be reached. */
const TITLE: InlineKeyShape = { multiline: false, code: false, search: true };
/** An annotation strip: prose that may hold several lines, no find bar. */
const ANNOTATION: InlineKeyShape = { multiline: true, code: false, search: false };
/** A content card holding a paragraph or a table. */
const PARAGRAPH: InlineKeyShape = { multiline: true, code: false, search: false };
/** A content card holding a fenced code block. */
const CODE: InlineKeyShape = { multiline: true, code: true, search: false };

/** The shape each case is run against, so a row reads as one sentence. */
function intentOf(
	ev: InlineKeyEvent,
	shape: InlineKeyShape,
	mapAction: "undo" | "redo" | null = null,
): InlineIntent {
	return inlineIntent(ev, shape, mapAction);
}

// --- the input method owns its own Enter ------------------------------------

test("a composing press means nothing, whatever it is", () => {
	const composing = { isComposing: true };
	assert.equal(intentOf(press("Enter", composing), TITLE), "none");
	assert.equal(intentOf(press("Enter", composing), CODE), "none");
	assert.equal(intentOf(press("Enter", { ...composing, shiftKey: true }), CODE), "none");
	assert.equal(intentOf(press("Escape", composing), TITLE), "none");
	assert.equal(intentOf(press("a", composing), TITLE), "none");
});

test("a composing press is not read as undo either, however undo is bound", () => {
	// The composition guard comes first, so a rebind that put undo on Enter
	// cannot take the key the input method is using to confirm a candidate.
	assert.equal(intentOf(press("Enter", { isComposing: true }), TITLE, "undo"), "none");
});

// --- the map's own undo, let out by name ------------------------------------

test("undo and redo pass through while nothing has been typed", () => {
	assert.equal(intentOf(press("z", { ctrlKey: true }), TITLE, "undo"), "undo");
	assert.equal(intentOf(press("z", { ctrlKey: true }), ANNOTATION, "redo"), "redo");
});

test("the map's answer wins over the key's own meaning", () => {
	// `survivesEditing` only ever lets undo and redo through, so this is the
	// whole of what the map can say from inside a field -- but it has to be
	// asked before Enter, or a field would save over it.
	assert.equal(intentOf(press("Enter"), TITLE, "undo"), "undo");
	assert.equal(intentOf(press("Escape"), TITLE, "redo"), "redo");
	assert.equal(intentOf(press("Tab"), TITLE, "undo"), "undo");
});

// --- Escape, Tab and a plain character --------------------------------------

test("Escape cancels and Tab saves, in every field", () => {
	for (const shape of [TITLE, ANNOTATION, PARAGRAPH, CODE]) {
		assert.equal(intentOf(press("Escape"), shape), "cancel");
		assert.equal(intentOf(press("Tab"), shape), "save");
	}
});

test("Tab saves rather than reaching the platform's focus move", () => {
	assert.equal(intentOf(press("Tab", { shiftKey: true }), TITLE), "save");
});

test("an ordinary character is left to the field", () => {
	assert.equal(intentOf(press("a"), TITLE), "none");
	assert.equal(intentOf(press("a", { ctrlKey: true }), TITLE), "none");
	assert.equal(intentOf(press("Backspace"), ANNOTATION), "none");
});

// --- Enter, which is the one key the three fields disagree about ------------

test("Enter saves a node title, which is one line", () => {
	assert.equal(intentOf(press("Enter"), TITLE), "save");
	assert.equal(intentOf(press("Enter", { shiftKey: true }), TITLE), "save");
	assert.equal(intentOf(press("Enter", { ctrlKey: true }), TITLE), "save");
});

test("Enter writes a line in an annotation, and Ctrl/Cmd+Enter saves it", () => {
	assert.equal(intentOf(press("Enter"), ANNOTATION), "newline");
	assert.equal(intentOf(press("Enter", { shiftKey: true }), ANNOTATION), "newline");
	assert.equal(intentOf(press("Enter", { ctrlKey: true }), ANNOTATION), "save");
	assert.equal(intentOf(press("Enter", { metaKey: true }), ANNOTATION), "save");
});

test("a paragraph card behaves like an annotation", () => {
	assert.equal(intentOf(press("Enter"), PARAGRAPH), "newline");
	assert.equal(intentOf(press("Enter", { metaKey: true }), PARAGRAPH), "save");
});

test("Shift+Enter writes a line in a code block, and plain Enter saves it", () => {
	// A sample without its line breaks is not the sample, so this is the one
	// field where the line break is the modified spelling and not the plain one.
	assert.equal(intentOf(press("Enter", { shiftKey: true }), CODE), "newline");
	assert.equal(intentOf(press("Enter"), CODE), "save");
	assert.equal(intentOf(press("Enter", { ctrlKey: true }), CODE), "save");
});

// --- the find bar, let out by name ------------------------------------------

test("Ctrl/Cmd+F reaches the find bar only from a field that allows it", () => {
	assert.equal(intentOf(press("f", { ctrlKey: true }), TITLE), "search");
	assert.equal(intentOf(press("F", { metaKey: true }), TITLE), "search");
	assert.equal(intentOf(press("f", { ctrlKey: true }), ANNOTATION), "none");
	assert.equal(intentOf(press("f", { ctrlKey: true }), CODE), "none");
});

test("a bare f is a character like any other", () => {
	assert.equal(intentOf(press("f"), TITLE), "none");
});
