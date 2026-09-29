/**
 * Marking the words a search found, on the card that shows them.
 *
 * The search says *which* cards matched; this says *what* matched in them. Two
 * things have to be true of the marking, and both of them are why it is done
 * here rather than in the model:
 *
 * **It marks what is drawn.** The offsets are read off the card's own text
 * nodes, not off the note's source, so the marks land on the words the reader
 * is looking at. A card with a picture drawn on it, a formula rendered into
 * MathJax, or a table laid out as a table has no plain-text projection that
 * could be used as a map to it.
 *
 * **It changes no geometry.** Only `background-color` and `color` are touched --
 * and the second of those only where it helps: a word that is already brighter
 * than the mark's background keeps its own colour, which `brightInk` decides.
 * See the `.mm-hit` rule in `styles.css`, which carries the whole argument.
 * Nothing here may insert a character, an element with a box of its own, or
 * anything that takes part in the line box, because the map measures its cards
 * with `offsetWidth` and a card that changed size under a mark would move every
 * card after it.
 */

import { compileQuery } from "../model/search.ts";
import type { HitRange, SearchQuery } from "../model/search.ts";

const HIT_CLASS = "mm-hit";
/** A mark that keeps the word's own colour instead of the theme's ink. */
const KEEP_INK_CLASS = "keeps-ink";

/**
 * How bright a word has to be before the mark stops recolouring it.
 *
 * The theme's ink is chosen to sit on the mark's background, and for almost
 * every card that is an improvement: `#2e3338` on a light theme's yellow is
 * 9.8:1 where the muted `#888888` it replaced was 2.7:1. The exception is type
 * that is already brighter than the background can be -- a root card's
 * `--text-on-accent`, which is white in most themes -- where recolouring it
 * means putting black words inside a coloured pill, and the mark reads as
 * having come from another card.
 *
 * So the test is the word's own brightness rather than the card's kind. For
 * scale: `#fff` is 1.00, a dark theme's `--text-normal` `#dcddde` is 0.72, its
 * muted `#b3b3b3` is 0.45, and a light theme's `#2e3338` is 0.03. Only the top
 * of that range is exempt.
 */
const BRIGHT_INK = 0.85;

/**
 * Whether a computed colour is bright enough to keep.
 *
 * Anything that is not a plain `rgb()`/`rgba()` -- a colour function this does
 * not know, a keyword -- answers "no", which is the safe way round: the theme's
 * ink is the one that was chosen to be read on the mark's background.
 */
export function brightInk(colour: string): boolean {
	const m = /^rgba?\(([^)]+)\)$/.exec(colour.trim());
	if (!m) return false;
	const parts = m[1].split(/[,\s/]+/).filter((part) => part !== "");
	if (parts.length < 3) return false;
	const channels = parts.slice(0, 3).map(Number);
	if (channels.some((value) => !Number.isFinite(value))) return false;
	const linear = (value: number): number => {
		const v = value / 255;
		return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
	};
	const [r, g, b] = channels.map(linear);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b >= BRIGHT_INK;
}

/** A run of a card's text, and where in the card's whole text it sits. */
interface TextSpan {
	node: Text;
	start: number;
	end: number;
}

/**
 * Where each hit falls inside each text node, in that node's own coordinates.
 *
 * Pure, and separate from the marking itself, because this is the half that can
 * be wrong in a way nobody sees: one character of drift and the mark lands on
 * the neighbour of the word that matched. Ranges within one node are in
 * ascending order, which is the order the marking has to undo them in.
 *
 * A matcher hands its ranges over in document order, which is what makes the
 * walk below linear -- but the pointer is allowed to step back, so a caller
 * that hands them over in some other order gets the right answer slowly rather
 * than a mark on the wrong word.
 */
export function localCuts(
	spans: readonly { start: number; end: number }[],
	ranges: readonly HitRange[],
): [number, number][][] {
	const out: [number, number][][] = spans.map(() => []);
	let first = 0;
	for (const range of ranges) {
		while (first < spans.length && spans[first].end <= range.start) first++;
		while (first > 0 && spans[first - 1].end > range.start) first--;
		for (let i = first; i < spans.length && spans[i].start < range.end; i++) {
			const start = Math.max(range.start, spans[i].start) - spans[i].start;
			const end = Math.min(range.end, spans[i].end) - spans[i].start;
			if (end > start) out[i].push([start, end]);
		}
	}
	return out;
}

/**
 * Every piece of text in `root`, in the order it is read, with the offsets.
 *
 * A mark that is already there is skipped rather than descended into: the text
 * inside it has been read once and would be read twice otherwise, which would
 * make the offsets of everything after it wrong.
 */
function textSpans(root: HTMLElement): { text: string; spans: TextSpan[] } {
	const spans: TextSpan[] = [];
	let text = "";
	const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let found = walker.nextNode(); found !== null; found = walker.nextNode()) {
		const node = found as Text;
		if (node.data === "") continue;
		if (node.parentElement?.closest(`mark.${HIT_CLASS}`)) continue;
		spans.push({ node, start: text.length, end: text.length + node.data.length });
		text += node.data;
	}
	return { text, spans };
}

/**
 * Take every mark off a card, leaving the text exactly as it was.
 *
 * Adjacent text nodes are merged back afterwards, so a card that has been
 * marked and unmarked a hundred times is the same DOM as one that never was --
 * which is what keeps this idempotent, and what keeps the next search reading
 * the same string the last one did.
 */
export function clearHits(root: HTMLElement): void {
	const marks = root.querySelectorAll(`mark.${HIT_CLASS}`);
	if (marks.length === 0) return;
	const touched = new Set<Node>();
	for (const mark of Array.from(marks)) {
		const parent = mark.parentNode;
		if (!parent) continue;
		parent.replaceChild(
			root.ownerDocument.createTextNode(mark.textContent ?? ""),
			mark,
		);
		touched.add(parent);
	}
	for (const parent of touched) parent.normalize();
}

/**
 * Wrap every occurrence of the query on this card, and report how many.
 *
 * Every mark is the same mark. Whether the card is the one the bar is sitting
 * on makes no difference to how its hits are drawn -- that is said by the ring
 * around the card and by where the camera is, and two shades of the same yellow
 * inside one card read as two different things. Which cards get marked at all
 * is the caller's decision; see `MindmapView.applySearchState`.
 */
export function markHits(root: HTMLElement, query: SearchQuery): number {
	const matcher = compileQuery(query);
	if (matcher.invalid) return 0;
	const { text, spans } = textSpans(root);
	if (text === "") return 0;
	const ranges = matcher.ranges(text);
	if (ranges.length === 0) return 0;

	const cuts = localCuts(spans, ranges);
	const doc = root.ownerDocument;
	// Asked once for the card rather than once per mark: it is what the marks
	// inside it would inherit, and it is a style read, not a layout one.
	const keepInk = brightInk(root.ownerDocument.defaultView?.getComputedStyle(root).color ?? "");
	let made = 0;
	for (const [index, span] of spans.entries()) {
		const mine = cuts[index];
		if (mine.length === 0) continue;
		// Last first: splitting the node at the end of the last hit leaves
		// every offset before it still meaning what it meant, so the hits
		// before it can be cut in the same walk.
		for (let i = mine.length - 1; i >= 0; i--) {
			const [start, end] = mine[i];
			// The tail is kept in the tree -- only its offsets are behind us.
			span.node.splitText(end);
			const hit = span.node.splitText(start);
			const mark = doc.createElement("mark");
			mark.className = keepInk ? `${HIT_CLASS} ${KEEP_INK_CLASS}` : HIT_CLASS;
			hit.parentNode?.insertBefore(mark, hit);
			mark.appendChild(hit);
			made++;
		}
	}
	return made;
}
