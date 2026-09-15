import { test } from "node:test";
import assert from "node:assert/strict";

import { anchorFor, edgePath } from "./edges.ts";
import type { EdgeStyle } from "./edges.ts";
import type { LayoutNode } from "../layout/tidyTree.ts";

/**
 * Just enough of a laid-out node to anchor a connector to. The rest of
 * `edges.ts` needs a document; the anchor is arithmetic, and the arithmetic is
 * the part that has to know a card from a node box.
 */
function placed(x: number, y: number, cardHeight: number, annotation: number): LayoutNode {
	return {
		x,
		y,
		cardWidth: 120,
		cardHeight,
		width: 120,
		height: cardHeight + annotation,
	} as LayoutNode;
}

test("a connector meets the middle of the card's face", () => {
	const node = placed(100, 200, 40, 0);
	assert.deepEqual(anchorFor(node, true, 1), [220, 220]);
	assert.deepEqual(anchorFor(node, false, 1), [100, 220]);
});

test("an annotation below the card does not drag the anchor down with it", () => {
	const plain = placed(100, 200, 40, 0);
	const annotated = placed(100, 200, 40, 120);
	for (const outgoing of [true, false]) {
		for (const side of [1, -1]) {
			assert.deepEqual(
				anchorFor(annotated, outgoing, side),
				anchorFor(plain, outgoing, side),
			);
		}
	}
});

test("an outgoing edge leaves the face the branch grows from", () => {
	const node = placed(100, 200, 40, 60);
	// Right-hand branch: out of the right face, in at the left.
	assert.deepEqual(anchorFor(node, true, 1), [220, 220]);
	assert.deepEqual(anchorFor(node, false, 1), [100, 220]);
	// Mirrored on the left of the root.
	assert.deepEqual(anchorFor(node, true, -1), [100, 220]);
	assert.deepEqual(anchorFor(node, false, -1), [220, 220]);
});

// --- the two connector styles --------------------------------------------------

test("the curved connector turns halfway, on both sides of the root", () => {
	assert.equal(
		edgePath([220, 220], [340, 260], "curve"),
		"M 220 220 C 280 220, 280 260, 340 260",
	);
	// A left-hand branch is the same curve with the direction reversed.
	assert.equal(
		edgePath([100, 220], [-20, 260], "curve"),
		"M 100 220 C 40 220, 40 260, -20 260",
	);
});

test("the right-angled connector is an elbow, turning halfway", () => {
	assert.equal(
		edgePath([220, 220], [340, 260], "orthogonal"),
		"M 220 220 L 280 220 L 280 260 L 340 260",
	);
	assert.equal(
		edgePath([100, 220], [-20, 260], "orthogonal"),
		"M 100 220 L 40 220 L 40 260 L -20 260",
	);
});

test("a connector to a card on the same row is a straight line either way", () => {
	assert.equal(edgePath([220, 240], [340, 240], "curve"), "M 220 240 C 280 240, 280 240, 340 240");
	assert.equal(edgePath([220, 240], [340, 240], "orthogonal"), "M 220 240 L 340 240");
});

test("the elbow is not drawn for a run too short to read as a turn", () => {
	// A parent is centred on its children, so a parent and its only child anchor
	// at the same y and the connector is a straight line. That centring is done
	// on measured card heights, and a measurement that lands a few pixels out
	// leaves a run of a few pixels -- an elbow there is a step a few pixels tall,
	// which reads as a kink in a straight line rather than as a turn.
	//
	// The run is absorbed, not connected: a line between the two anchors would
	// be a diagonal, and the right-angled style is the one that never draws one.
	// Each anchor gives up half the run, so the line stays inside the box.
	assert.equal(edgePath([220, 240], [340, 249], "orthogonal"), "M 220 244.5 L 340 244.5");
	assert.equal(edgePath([220, 240], [340, 231], "orthogonal"), "M 220 235.5 L 340 235.5");
	// A run long enough to be the turn it was meant to be keeps its right angle.
	assert.equal(
		edgePath([220, 240], [340, 260], "orthogonal"),
		"M 220 240 L 280 240 L 280 260 L 340 260",
	);
});

test("the right-angled style never draws a diagonal", () => {
	// The whole point of the style: horizontal and vertical, nothing between.
	// Probed over runs on both sides of the threshold, because a diagonal is
	// exactly what the short-run rule would produce if it connected the anchors
	// instead of absorbing the run between them.
	for (const dy of [-40, -12, -11, -1, 0, 1, 11, 12, 40]) {
		const d = edgePath([220, 240], [340, 240 + dy], "orthogonal");
		const numbers = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
		const xs = numbers.filter((_, i) => i % 2 === 0);
		const ys = numbers.filter((_, i) => i % 2 === 1);
		assert.equal(xs.length, ys.length, `dy=${dy}: ${d}`);
		for (let i = 1; i < xs.length; i++) {
			const level = ys[i - 1] === ys[i];
			const upright = xs[i - 1] === xs[i];
			assert.ok(
				level !== upright,
				`dy=${dy}: segment ${i - 1}->${i} of ${d} is neither horizontal nor vertical`,
			);
		}
	}
});

test("a short run on either side of the threshold stays in its anchors' box", () => {
	// The straight form is the elbow with the stub shrunk to nothing, so it
	// cannot leave the box through the two anchors the way a curve with wrong
	// control points would -- but it is the change nearest `edgeInView`, and the
	// cull there is exact only while every style keeps this, so it is asserted.
	for (const dy of [-11, -12, 0, 11, 12]) {
		const d = edgePath([220, 240], [340, 240 + dy], "orthogonal");
		const numbers = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
		const xs = numbers.filter((_, i) => i % 2 === 0);
		const ys = numbers.filter((_, i) => i % 2 === 1);
		assert.ok(Math.min(...xs) >= 220, `dy=${dy} left`);
		assert.ok(Math.max(...xs) <= 340, `dy=${dy} right`);
		assert.ok(Math.min(...ys) >= Math.min(240, 240 + dy), `dy=${dy} above`);
		assert.ok(Math.max(...ys) <= Math.max(240, 240 + dy), `dy=${dy} below`);
	}
});

test("every style stays inside its anchors' box, which is what culling assumes", () => {
	// `edgeInView` culls on the rectangle through the two anchors and is exact
	// only while the path cannot leave it. A style that overshoots would draw a
	// curve that a scroll past the edge had already thrown away.
	const pairs: Array<[[number, number], [number, number]]> = [
		[[220, 220], [340, 260]],
		[[100, 220], [-20, 260]],
		[[220, 240], [340, 240]],
		[[340, 500], [220, 120]],
	];
	const styles: EdgeStyle[] = ["curve", "orthogonal"];

	for (const style of styles) {
		for (const [from, to] of pairs) {
			const numbers = (edgePath(from, to, style).match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
			const xs = numbers.filter((_, i) => i % 2 === 0);
			const ys = numbers.filter((_, i) => i % 2 === 1);
			const label = `${style} ${JSON.stringify([from, to])}`;
			assert.ok(Math.min(...xs) >= Math.min(from[0], to[0]), `${label} left`);
			assert.ok(Math.max(...xs) <= Math.max(from[0], to[0]), `${label} right`);
			assert.ok(Math.min(...ys) >= Math.min(from[1], to[1]), `${label} above`);
			assert.ok(Math.max(...ys) <= Math.max(from[1], to[1]), `${label} below`);
		}
	}
});
