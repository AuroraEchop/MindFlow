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
	// The elbow's turn collapses onto the row: same two L commands, zero length.
	assert.equal(
		edgePath([220, 240], [340, 240], "orthogonal"),
		"M 220 240 L 280 240 L 280 240 L 340 240",
	);
});

test("the right-angled style never draws a diagonal", () => {
	// The whole point of the style: horizontal and vertical, nothing between.
	// The anchors are never nudged to make a segment level -- if the two faces
	// are off-row, the turn is the honest answer, and the layout is what owes
	// the alignment. `tidyTree.test.ts` holds it to that.
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
				level || upright,
				`dy=${dy}: segment ${i - 1}->${i} of ${d} is neither horizontal nor vertical`,
			);
		}
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
