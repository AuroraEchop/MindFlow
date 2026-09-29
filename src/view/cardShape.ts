/**
 * Whether the card the map is about to draw is the card it measured.
 *
 * A paint reuses the size it remembers for a card it is not going to measure,
 * and that trade only holds if the card draws the same thing it drew last time.
 * The question used to be asked of four fields -- the text, the checkbox, the
 * kind and the depth -- which is the whole of what a topic card is made of and
 * only part of what a card can be. A link card draws a preview block the note's
 * own text says nothing about; a card with an annotation draws a strip; a body
 * card draws prose the parser handed it as blocks. Every one of those can change
 * while the card is off screen -- a read landing, a line rewritten further down
 * the note, a fold from the toolbar -- and the remembered size is then smaller
 * than the card, which puts the card on top of the ones around it. That is not a
 * blemish on one card: the layout spaces every sibling by a size that is wrong,
 * so a whole region of the map comes apart at once.
 *
 * So the question is made the whole question, and the answer is a string: two
 * cards whose strings are equal draw the same box. The input is the very object
 * `buildNodeElement` is handed, so the two cannot be about different cards --
 * whatever the builder is told to draw is what the shape is asked about.
 *
 * Nothing here reads the DOM or measures anything. A card the camera can see is
 * measured whatever its shape says; this exists for the ones it cannot.
 *
 * The separator is a control character no note can hold, and equality is all
 * that is asked of the result: a piece of text that somehow carried one would
 * merge two fields, which at worst says "unchanged" about a card that changed.
 * The characters that can appear in a note are many, so this is the one hole in
 * the scheme and it is spelled out rather than left to be discovered.
 */

import type { CheckboxState, NodeKind } from "../model/types.ts";
import type { NodeElementOptions } from "./nodes.ts";

/** Between the pieces of one shape. Never in a note, and never in a link. */
const SEP = "\u0001";
/** Stands in for a piece that is absent, so an empty one is not a missing one. */
const NONE = "\u0002";

/**
 * Everything about a card that decides what it draws: what the builder is
 * handed, plus the four things about the node that are not in the options.
 */
export interface CardShape extends NodeElementOptions {
	text: string;
	checkbox: CheckboxState;
	kind: NodeKind;
	/** The stylesheet sizes a card by depth, so a moved card is a new shape. */
	depth: number;
}

/** Two cards are the same card when these are the same, and not before. */
export function cardShape(shape: CardShape): string {
	return [
		shape.kind,
		shape.depth,
		shape.checkbox ?? NONE,
		shape.text,
		shape.annotation ?? NONE,
		// Three ways to draw the same text, and the box is different for each: a
		// sample keeps its line breaks, blocks bring their own spacing.
		// The kinds rather than a count: a table and a sample are the same
		// number of blocks and two very different boxes.
		shape.blocks === null
			? shape.preformatted
				? "pre"
				: "text"
			: `blocks${SEP}${shape.blocks.map((block) => block.kind).join(SEP)}`,
		// The licence to draw a picture, and the caps it is drawn under. Both
		// caps, because one of them is a setting: a map that has had its
		// maximum media height moved is a map whose pictures are other sizes,
		// and the cards holding them are off screen more often than not.
		shape.media === null
			? NONE
			: `media${SEP}${shape.media.maxWidth}${SEP}${shape.media.maxHeight}`,
		shape.collapsible ? "foldable" : NONE,
		shape.collapsed ? "folded" : NONE,
		shape.projected ? "projected" : NONE,
		// Both caps, on their own: a title under an annotation wraps at a width
		// of its own, and an opened preview moves both.
		shape.maxWidth.node,
		shape.maxWidth.text ?? NONE,
		// The three that decide whether the branch button is drawn at all and
		// what it says, which is what the title line is as wide as.
		shape.addable ? "addable" : NONE,
		shape.hasChildren ? "children" : NONE,
		shape.hiddenCount,
		linkShape(shape.link),
	].join(SEP);
}

/**
 * What a link card is showing, in one piece.
 *
 * The preview's own lines go in, not just how many of them there are: the read
 * lands after the paint that asked for it, and the card that arrives with three
 * lines of a note in it is a taller card than the one drawn while the note was
 * still being read. A card that is only a site has no lines at all, which is
 * what the address stands in for.
 */
function linkShape(link: CardShape["link"]): string {
	if (link === null) return NONE;
	const preview = link.preview;
	return [
		link.oneLink ? "one" : "prose",
		link.arrow ? "arrow" : NONE,
		link.subtreeOpen ? "outline" : NONE,
		link.read ?? NONE,
		link.site === null ? NONE : `site${SEP}${link.site.host}${SEP}${link.site.path}`,
		link.footer,
		preview === null
			? "closed"
			: `preview${SEP}${preview.lines.join(SEP)}${SEP}${preview.more}`,
	].join(SEP);
}
