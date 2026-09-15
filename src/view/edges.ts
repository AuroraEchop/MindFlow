import type { LayoutNode } from "../layout/tidyTree.ts";
import { edgeInView } from "./culling.ts";
import type { ViewBox } from "./culling.ts";

/**
 * A little more than the widest stroke, so culling never drops a curve that its
 * own line width, round cap included, would still have put on screen.
 */
const STROKE_PAD = 4;

/**
 * Where a connector meets a node: the middle of the card's face.
 *
 * The card, never the node box. An annotation hangs below the card without
 * being part of it, so a `height/2` here would slide the connector down the
 * side of an annotated card and leave it pointing at nothing.
 */
export function anchorFor(n: LayoutNode, outgoing: boolean, side: number): [number, number] {
	const y = n.y + n.cardHeight / 2;
	// Outgoing edges leave the face pointing at the children; incoming edges
	// arrive on the opposite face.
	const rightFace = outgoing ? side === 1 : side !== 1;
	return [rightFace ? n.x + n.cardWidth : n.x, y];
}

function strokeWidth(depth: number): number {
	if (depth <= 1) return 3;
	if (depth === 2) return 2;
	return 1.4;
}

/**
 * How a connector is drawn between a parent's face and a child's.
 *
 * `curve` is the organic S-curve the map has always drawn; `orthogonal` is the
 * right-angled elbow of an org chart. Neither is more correct -- the first
 * reads as a mind map, the second as a hierarchy somebody is meant to audit.
 */
export type EdgeStyle = "curve" | "orthogonal";

/**
 * How far apart two faces may sit vertically before the elbow earns its elbow.
 *
 * The right angle is there to make a column of children read as one bus: out of
 * the parent's face, a single shared turn, and in to each child's. That reading
 * only survives while the turn is a visible length of line. A parent and its
 * only child are centred on each other, so the vertical run between them is
 * normally exactly zero -- but the layout centres on measured card heights, and
 * a measurement that lands a pixel or two off (a card re-measured a frame after
 * the one it was laid out in, a line-height that rounds) leaves a run of a few
 * pixels. Drawn as an elbow that is not a bus, it is a step: two horizontal
 * segments joined by a stub shorter than the stroke is wide, which reads as a
 * kink in an otherwise straight connector.
 *
 * Below this, the two ends are close enough to the same row that the run reads
 * as noise rather than as a turn, so the connector is one horizontal line
 * through the middle of it. Not a straight line *between* the anchors -- the
 * style is right-angled, and a line between two points of different heights is
 * a diagonal, which is exactly what this style is not for. Above the threshold,
 * the run is long enough to be the turn it was meant to be.
 */
const ELBOW_MIN_RUN = 12;

/**
 * The `d` attribute for one connector.
 *
 * Both styles stay inside the bounding box of their two anchors -- the curve
 * because its control points share their x range with the anchors and their y
 * with one or the other, the elbow because it turns at a point between them.
 * That is what lets `edgeInView` cull on that box and be exact rather than
 * approximate, so a new style has to keep the property or the culling lies.
 */
export function edgePath(
	from: [number, number],
	to: [number, number],
	style: EdgeStyle,
): string {
	const [px, py] = from;
	const [cx, cy] = to;

	if (style === "orthogonal") {
		// A run too short to read as a turn is noise from a measurement a pixel
		// or two out, so the two ends are drawn as one horizontal line through
		// the middle of it -- each anchor gives up half the run, which stays
		// inside the box, and nothing bends. See ELBOW_MIN_RUN.
		if (Math.abs(cy - py) < ELBOW_MIN_RUN) {
			const my = (py + cy) / 2;
			return `M ${px} ${my} L ${cx} ${my}`;
		}
		// Out of the parent's face, across, up or down, and in to the child's.
		// The turn sits halfway between the two faces, which is what makes a
		// column of children read as one bus rather than as a fan.
		const mx = (px + cx) / 2;
		return `M ${px} ${py} L ${mx} ${py} L ${mx} ${cy} L ${cx} ${cy}`;
	}

	const dx = (cx - px) * 0.5;
	return `M ${px} ${py} C ${px + dx} ${py}, ${cx - dx} ${cy}, ${cx} ${cy}`;
}

/**
 * Draw the connector layer.
 *
 * The organic S-curve is what reads as "mind map" rather than "org chart":
 * a cubic bezier whose control points sit halfway between the two anchors.
 *
 * `view` is the part of the map worth drawing; pass null for all of it. Both
 * styles keep to the anchors' bounding box, which is what makes a cheap
 * rectangle test exact rather than approximate -- see `edgePath`.
 *
 * Returns how many paths it drew, which is what a redraw costs.
 */
export function renderEdges(
	svg: SVGSVGElement,
	nodes: LayoutNode[],
	width: number,
	height: number,
	branchColors: boolean,
	style: EdgeStyle,
	view: ViewBox | null = null,
): number {
	svg.replaceChildren();
	svg.setAttribute("width", String(width));
	svg.setAttribute("height", String(height));
	svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

	// Built off-tree and attached once: appending a few hundred paths straight
	// into a live SVG invalidates the layer that many times over.
	const frag = createFragment();
	let drawn = 0;

	for (const child of nodes) {
		const parent = child.parent;
		if (!parent) continue;

		const [px, py] = anchorFor(parent, true, child.side);
		const [cx, cy] = anchorFor(child, false, child.side);
		if (view && !edgeInView(px, py, cx, cy, STROKE_PAD, view)) continue;

		const path = createSvg("path");
		path.setAttribute("d", edgePath([px, py], [cx, cy], style));
		path.setAttribute("fill", "none");
		path.setAttribute("stroke-width", String(strokeWidth(child.depth)));
		path.setAttribute("stroke-linecap", "round");
		path.addClass("mm-edge");
		if (branchColors && child.branch >= 0) {
			path.dataset.branch = String(child.branch % 10);
		}
		frag.appendChild(path);
		drawn++;
	}

	svg.appendChild(frag);
	return drawn;
}

/** Detached: the caller attaches the finished layer along with the cards. */
export function createEdgeLayer(): SVGSVGElement {
	const svg = createSvg("svg");
	svg.addClass("mm-edges");
	return svg;
}
