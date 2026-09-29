import { test } from "node:test";
import assert from "node:assert/strict";

import { brightInk, localCuts } from "./hits.ts";

/**
 * The pieces of a card's text, as `textSpans` would measure them: three runs
 * of DOM text, one after another, with the offsets they occupy in the whole.
 */
const SPANS = [
	{ start: 0, end: 5 }, // "hello"
	{ start: 5, end: 11 }, // " world"
	{ start: 11, end: 15 }, // " — a"
];

/** What a cut list says, as the text it would wrap: easier to read than pairs. */
const TEXT = "hello world — a";
const cut = (cuts: [number, number][][]): string[] =>
	cuts.flatMap((mine, i) =>
		mine.map(([start, end]) => TEXT.slice(SPANS[i].start + start, SPANS[i].start + end)),
	);

test("a hit inside one run is cut in that run's own coordinates", () => {
	const cuts = localCuts(SPANS, [{ start: 6, end: 11 }]);
	assert.deepEqual(cuts[0], []);
	assert.deepEqual(cuts[1], [[1, 6]]);
	assert.deepEqual(cuts[2], []);
	assert.deepEqual(cut(cuts), ["world"]);
});

test("a hit that crosses a run is cut on both sides of the seam", () => {
	// "lo wor" -- the tail of the first run and the head of the second.
	const cuts = localCuts(SPANS, [{ start: 3, end: 8 }]);
	assert.deepEqual(cuts[0], [[3, 5]]);
	assert.deepEqual(cuts[1], [[0, 3]]);
	assert.deepEqual(cut(cuts), ["lo", " wo"]);
});

test("a hit that swallows a whole run cuts it end to end", () => {
	const cuts = localCuts(SPANS, [{ start: 4, end: 13 }]);
	assert.deepEqual(cuts[0], [[4, 5]]);
	assert.deepEqual(cuts[1], [[0, 6]]);
	assert.deepEqual(cuts[2], [[0, 2]]);
	assert.deepEqual(cut(cuts), ["o", " world", " —"]);
});

test("several hits come back in ascending order, whatever order they arrive in", () => {
	// The marking undoes them last-first, so ascending is the contract -- and a
	// caller that hands them over the other way round still gets it, because a
	// range placed against the wrong run would mark the wrong word.
	const inOrder = localCuts(SPANS, [
		{ start: 0, end: 2 },
		{ start: 13, end: 15 },
	]);
	const reversed = localCuts(SPANS, [
		{ start: 13, end: 15 },
		{ start: 0, end: 2 },
	]);
	assert.deepEqual(inOrder[0], [[0, 2]]);
	assert.deepEqual(inOrder[2], [[2, 4]]);
	assert.deepEqual(cut(inOrder), ["he", " a"]);
	// The cuts are indexed by run, so the order they arrive in is not part of
	// the answer -- the same hits are the same cuts either way.
	assert.deepEqual(reversed, inOrder);
});

test("nothing is cut when nothing matched, and nothing is cut twice", () => {
	assert.deepEqual(localCuts(SPANS, []), [[], [], []]);
	// Two hits that touch but do not overlap stay two cuts, not one merged run:
	// they are two words to a reader even when they are adjacent characters.
	const cuts = localCuts(SPANS, [
		{ start: 0, end: 2 },
		{ start: 2, end: 5 },
	]);
	assert.deepEqual(cuts[0], [
		[0, 2],
		[2, 5],
	]);
});

test("a run no hit touches is left alone", () => {
	const cuts = localCuts(SPANS, [{ start: 0, end: 1 }]);
	assert.deepEqual(cuts[0], [[0, 1]]);
	assert.deepEqual(cuts[1], []);
	assert.deepEqual(cuts[2], []);
});

test("only type at the very top of the brightness range keeps its own colour", () => {
	// The three colours this exists for, and the one it must not catch.
	assert.equal(brightInk("rgb(255, 255, 255)"), true, "a root card's white");
	assert.equal(brightInk("rgb(240, 240, 240)"), true, "near-white reads the same");
	// A dark theme's two text colours: bright enough to need the dark ink, not
	// bright enough to be left alone. Both are darker than the mark's amber.
	assert.equal(brightInk("rgb(220, 221, 222)"), false, "--text-normal, 0.72");
	assert.equal(brightInk("rgb(179, 179, 179)"), false, "--text-muted, 0.45");
	// A light theme's ink, and the muted grey the light ink is there to rescue.
	assert.equal(brightInk("rgb(46, 51, 56)"), false, "#2e3338");
	assert.equal(brightInk("rgb(136, 136, 136)"), false, "#888888");
});

test("the brightness test is the colour's, not the notation's", () => {
	// Computed colours arrive as `rgb(r, g, b)` and `rgba(r, g, b, a)`, and
	// that is what `getComputedStyle` hands over; anything else answers "no",
	// which leaves the theme's ink in place rather than guessing.
	assert.equal(brightInk("rgba(255, 255, 255, 1)"), true);
	assert.equal(brightInk("  rgb(255,255,255)  "), true);
	assert.equal(brightInk("rgb(255 255 255 / 1)"), true);
	assert.equal(brightInk("color(srgb 1 1 1)"), false);
	assert.equal(brightInk("white"), false);
	assert.equal(brightInk("rgb(255, 255)"), false);
	assert.equal(brightInk("rgb(nope, 0, 0)"), false);
});
