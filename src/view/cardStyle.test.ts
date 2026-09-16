import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CARD_STYLES, CARD_STYLE_CLASSES, cardStyleClass } from "./cardStyle.ts";

/**
 * A card style is a class on the map and a set of rules keyed on it, and the
 * only way it can be wrong without anything looking wrong is for those rules to
 * lose the cascade. That is what happened once: `cardStyle` was drawn with
 * `.mm-card-minimal .mm-card`, which scores two classes, and every rule that
 * actually draws a card scores three or five -- so the setting changed the DOM
 * and nothing else, and no amount of reloading showed it.
 *
 * The cascade is the part of that a test can reach, so this file holds the three
 * things each style block rests on: the style out-ranks the rules it answers, it
 * leaves the states alone, and the fill it needs reaches the card by variable
 * rather than by a rule that would beat those states. Everything else about a
 * style is a matter of looking at it.
 */
const CSS = readFileSync(
	fileURLToPath(new URL("../../styles.css", import.meta.url)),
	"utf8",
);

/** Every rule in the sheet, as written, with the comments taken out. */
function rules(css: string): Array<{ selector: string; body: string }> {
	assert.equal(/@/.test(css), false, "this reader does not understand at-rules");
	const out: Array<{ selector: string; body: string }> = [];
	const flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
	let start = 0;
	for (;;) {
		const open = flat.indexOf("{", start);
		if (open === -1) break;
		const close = flat.indexOf("}", open);
		out.push({
			selector: flat.slice(start, open).trim(),
			body: flat.slice(open + 1, close),
		});
		start = close + 1;
	}
	return out;
}

const RULES = rules(CSS);

/** The whole file's declarations, comments stripped, for a plain word search. */
const SHEET = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): { selector: string; body: string } {
	const found = RULES.find((entry) => entry.selector === selector);
	assert.notEqual(found, undefined, `${selector} is not in styles.css any more`);
	return found!;
}

/**
 * The one rule of a style whose selector list names `.<style> <bare>`.
 *
 * Found by listing rather than by string equality because these rules are
 * written as one group of four selectors, and the group is the thing under test.
 */
function block(style: string, bare: string): { selector: string; body: string } {
	const found = RULES.find((entry) =>
		entry.selector
			.split(",")
			.map((part) => part.trim())
			.includes(`.${style} ${bare}`),
	);
	assert.notEqual(found, undefined, `.${style} has no rule for ${bare}`);
	return found!;
}

/** `[ids, classes, elements]`, which is all a cascade tie is decided by. */
// `:not()` is deliberately not counted as a pseudo-class -- it never scores on
// its own, and the selector inside it is counted here like any other.
function specificity(selector: string): [number, number, number] {
	const ids = selector.match(/#[\w-]+/g)?.length ?? 0;
	const classes =
		(selector.match(/\.[\w-]+/g)?.length ?? 0) +
		(selector.match(/\[[^\]]*\]/g)?.length ?? 0) +
		(selector.match(/:(?!not\b)[\w-]+/g)?.length ?? 0);
	const elements = selector.match(/(?:^|[\s>+~])[a-z]+/g)?.length ?? 0;
	return [ids, classes, elements];
}

/** Positive when `a` out-ranks `b`. */
function outranks(a: string, b: string): number {
	const left = specificity(a);
	const right = specificity(b);
	for (let i = 0; i < 3; i++) {
		if (left[i] !== right[i]) return left[i] - right[i];
	}
	return 0;
}

function properties(body: string): Set<string> {
	const out = new Set<string>();
	for (const line of body.split(";")) {
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		out.add(line.slice(0, colon).trim());
	}
	return out;
}

/** The value one declaration was given, as written. */
function value(body: string, property: string): string {
	for (const line of body.split(";")) {
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		if (line.slice(0, colon).trim() === property) return line.slice(colon + 1).trim();
	}
	return "";
}

/** The rules that draw a card at each depth, as a style has to answer them. */
const DEPTH_RULES = [
	'.mm-node[data-depth="0"] .mm-row',
	'.mm-node[data-depth="1"] .mm-row',
	'.mm-node:not([data-depth="0"]):not([data-depth="1"]):not([data-kind="body"]) .mm-row',
];

/** The bare box, which is what the copy a drag carries is cloned as. */
const BARE_BOX = ".mm-row";

/** The two styles that are drawn by a class; `bordered` is the absence of one. */
const DRAWN = CARD_STYLES.map(cardStyleClass).filter((cls) => cls !== "");

test("every style the setting can offer is one the stylesheet draws", () => {
	assert.deepEqual(DRAWN, CARD_STYLE_CLASSES);
	for (const cls of CARD_STYLE_CLASSES) {
		assert.ok(SHEET.includes(`.${cls} `), `${cls} is offered as a style and drawn by nothing`);
	}
	// `bordered` is what the stylesheet draws with no style class at all, so a
	// rule for it would be a second drawing of the same thing.
	assert.equal(SHEET.includes(".mm-card-bordered"), false);
});

test("the box each style draws is written where the depth rules can see it", () => {
	for (const style of DRAWN) {
		const box = block(style, BARE_BOX)
			.selector.split(",")
			.map((part) => part.trim());
		for (const depth of DEPTH_RULES) {
			assert.ok(box.includes(`.${style} ${depth}`), `nothing answers ${depth} in ${style}`);
		}
		assert.ok(
			box.includes(`.${style} ${BARE_BOX}`),
			`a drag copy cloned as ${BARE_BOX} is not drawn in ${style}`,
		);
	}
});

test("each style out-ranks the depth rules rather than tying with them", () => {
	// Pinned, because a wrong reader here would report a comfortable win for
	// anything, and this whole file would pass while the setting did nothing.
	assert.deepEqual(specificity(DEPTH_RULES[0]), [0, 3, 0]);
	assert.deepEqual(specificity(DEPTH_RULES[2]), [0, 5, 0]);

	for (const style of DRAWN) {
		for (const depth of DEPTH_RULES) {
			const answer = `.${style} ${depth}`;
			assert.ok(
				outranks(answer, depth) > 0,
				`${answer} (${specificity(answer).join(",")}) does not out-rank ` +
					`${depth} (${specificity(depth).join(",")})`,
			);
			// And the premise the next test rests on, stated where it is used.
			assert.ok(outranks(answer, ".mm-node.is-selected .mm-row") > 0);
		}
	}
});

test("no style block declares a property a state rule owns", () => {
	// These selectors win against more than the depth rules -- see the assertion
	// above -- so anything written into a style block also beats the ring that
	// marks a card as picked and the tint that says where a drop would land. The
	// fill, the border and the rule under the text therefore reach the card by
	// variable, and these two may not appear in a style block at all.
	for (const style of DRAWN) {
		for (const bare of [BARE_BOX, DEPTH_RULES[2]]) {
			for (const reserved of ["background", "box-shadow"]) {
				assert.equal(
					properties(block(style, bare).body).has(reserved),
					false,
					`${reserved} in ${style} would beat the state rules that own it`,
				);
			}
		}
	}
});

test("the fill, the border and the rule under the text arrive by variable", () => {
	// The depth rules read the variables rather than naming a value, and a rule
	// that named one would take a style's only lever away.
	const reads: Array<[string, string]> = [
		[DEPTH_RULES[0], "--mm-card-bg"],
		[DEPTH_RULES[0], "--mm-card-border"],
		[DEPTH_RULES[0], "--mm-card-shadow"],
		[DEPTH_RULES[1], "--mm-card-bg"],
		[DEPTH_RULES[1], "--mm-card-border"],
		[DEPTH_RULES[2], "--mm-card-bg"],
		[DEPTH_RULES[2], "--mm-card-border"],
		[DEPTH_RULES[2], "--mm-card-rule"],
	];
	for (const [depth, variable] of reads) {
		assert.ok(rule(depth).body.includes(`var(${variable},`), `${depth} does not read ${variable}`);
	}
	// And a style that cannot restate one of them has no way to be drawn: the
	// rule above it would use its own value, whatever the class says.
	const needed = [
		"--mm-card-bg",
		"--mm-card-border",
		"--mm-card-rule",
		"--mm-card-shadow",
		// The card's padding rides with them: a style that restates the shape but
		// not the box the text sits in is a slab with the old padding on it.
		"--mm-card-pad-y",
		"--mm-card-pad-x",
	];
	for (const style of DRAWN) {
		for (const variable of needed) {
			assert.ok(variables(style).has(variable), `${style} has no way to set ${variable}`);
		}
	}
});

test("the field a card is edited in draws no frame, and is filled like the card", () => {
	// Asked for by name: a card being edited is a card that has been picked --
	// the view selects it on the way in -- so the frame around it is already
	// there, and a second one drawn inside it is a box within a box. Which field
	// is open is what the caret is for. `border-radius` and `background` are the
	// exceptions, and both are about the field covering the card rather than
	// outlining itself: the fill is what keeps the text from being read through
	// the cards behind it, and it takes the card's own colour so that a card
	// being edited looks like the card that was picked.
	for (const entry of RULES) {
		if (!entry.selector.includes("is-editing")) continue;
		for (const property of properties(entry.body)) {
			const drawsAFrame =
				property === "box-shadow" ||
				(property.startsWith("border") && property !== "border-radius");
			assert.equal(
				drawsAFrame,
				false,
				`${entry.selector} draws a frame with ${property}`,
			);
		}
	}

	const field = value(rule(".mm-text.is-editing").body, "background");
	assert.ok(
		field.includes("var(--mm-card-bg,"),
		`the field is filled with ${field} rather than with the card's own fill`,
	);
});

test("the field a card is edited in is widened by that card's own padding", () => {
	// The field is pushed out to the card's edges by a negative margin of exactly
	// the card's padding, so that a click on the padding lands in the field. When
	// both were written out by hand they drifted -- the card's padding differs per
	// depth, the field's did not -- and the field ended up over the card's border
	// and over the ring that says the card is picked, in the default style, on
	// every card past the second level.
	const card = rule(".mm-card").body;
	const widened = rule(".mm-card .mm-text.is-editing").body;
	for (const variable of ["--mm-card-pad-y", "--mm-card-pad-x"]) {
		assert.ok(
			value(card, "padding").includes(`var(${variable},`),
			`the card's padding does not read ${variable}`,
		);
		assert.ok(
			value(widened, "padding").includes(`var(${variable},`),
			`the field's padding does not read ${variable}`,
		);
		assert.ok(
			value(widened, "margin").includes(`var(${variable},`),
			`the field's margin does not read ${variable}`,
		);
	}
});

test("the card being written in is lifted above every other card", () => {
	// Nodes are stacked in the order they were drawn, so a card at any depth can
	// be covered by a neighbour -- and the annotation under its title is the
	// first thing to go behind one, which is the line being read while it is
	// typed. Nothing else may out-rank it, or the card being written in is the
	// one that ends up behind.
	const raised = Number(value(rule(".mm-node.is-editing").body, "z-index"));
	assert.ok(raised > 0, `an editing card is stacked at ${raised || "auto"}`);

	for (const entry of RULES) {
		if (!entry.selector.includes(".mm-node")) continue;
		if (entry.selector.includes("is-editing")) continue;
		const z = value(entry.body, "z-index");
		if (z === "") continue;
		assert.ok(
			Number(z) < raised,
			`${entry.selector} is stacked at ${z}, at or above the card being edited`,
		);
	}
});

/** The variables a style declares, in every rule it keys. */
function variables(style: string): Set<string> {
	const out = new Set<string>();
	for (const entry of RULES) {
		if (!entry.selector.startsWith(`.${style}`)) continue;
		for (const property of properties(entry.body)) {
			if (property.startsWith("--")) out.add(property);
		}
	}
	return out;
}

test("a hovered card is pointed out with the picked ring at a fraction of the ink", () => {
	// Hover and picked are the same ring, so how much ink is in it is the whole
	// difference between them -- and it is a difference the cascade can swallow
	// without anything looking broken. A hover that drew its ring with
	// `box-shadow` would be overwritten by the picked card's ring and by the
	// drop under the root card, which already own that property, and the map
	// would simply stop answering the pointer.
	const rest = rule(".mm-row").body;
	const hovered = rule(".mm-row:hover").body;
	const picked = rule(".mm-node.is-selected .mm-row").body;

	// The ring is drawn at rest and only coloured on hover. `outline` is a
	// shorthand: naming it on hover would reset the width and the style that
	// rule leaves out -- and a colour with no style behind it paints nothing --
	// which is also why the transition has to include it for the ring to fade.
	assert.match(value(rest, "outline"), /^\d+px solid transparent$/);
	assert.ok(
		value(rest, "transition").includes("outline-color"),
		"the hover ring arrives with no transition",
	);
	assert.equal(
		properties(hovered).has("outline"),
		false,
		"hover redraws the ring rather than colouring the one that is there",
	);
	assert.equal(
		properties(hovered).has("box-shadow"),
		false,
		"a hover ring drawn as a box-shadow would lose to the picked ring and the root's drop",
	);

	// And it is a fraction of the accent, where the picked ring names it whole.
	const ink = Number(value(hovered, "outline-color").match(/([\d.]+)%/)?.[1]);
	assert.ok(ink > 0 && ink < 50, `the hover ring carries ${ink}% of the accent`);
	assert.equal(
		value(picked, "box-shadow").includes("color-mix"),
		false,
		"the picked ring is no longer at full strength",
	);
});

test("the picked frame in the minimal style is turned on rather than out-specified", () => {
	// `minimal` draws nothing at rest and one frame around a picked card. The
	// frame cannot be a rule of its own -- a rule that beat the style block would
	// have to name every depth -- so the block sets the two variables on the node
	// and the picked state flips them there, one class further up the same
	// element rather than one selector further into the sheet.
	const rest = properties(rule(".mm-card-minimal .mm-node").body);
	const picked = properties(rule(".mm-card-minimal .mm-node.is-selected").body);
	assert.ok(rest.has("--mm-card-bg"), "the minimal style draws a frame at rest");
	assert.ok(picked.has("--mm-card-bg"), "a picked card is not filled");
	assert.ok(picked.has("--mm-card-border"), "a picked card is not framed");
	// And no hover frame either: the style is text until something is picked, so
	// the tint the deeper cards get on hover is turned off rather than inherited.
	assert.ok(rest.has("--mm-card-bg-hover"), "the minimal style leaves the hover tint on");
});

test("the minimal root and first level keep their colour, picked or not", () => {
	// `minimal` flattens everything to text, but the root and the first level are
	// the two anchors the hierarchy hangs on: the centre is an accent pill and
	// each branch is a block in its own colour. They are drawn at rest, and they
	// stay drawn when picked -- the picked rule that turns a card white is for the
	// deeper cards, whose only frame it is.
	const rootRest = properties(rule(".mm-card-minimal .mm-node[data-depth=\"0\"]").body);
	const rootPicked = rule(".mm-card-minimal .mm-node.is-selected[data-depth=\"0\"]").body;
	assert.ok(rootRest.has("--mm-card-bg"), "the minimal root is not drawn at rest");
	assert.equal(
		value(rootPicked, "--mm-card-bg"),
		"var(--interactive-accent)",
		"a picked root turns into a white box",
	);
	assert.equal(
		value(rootPicked, "--mm-card-border"),
		"none",
		"a picked root gains a border the pill does not have",
	);

	const levelRest = properties(rule(".mm-card-minimal .mm-node[data-depth=\"1\"]").body);
	const levelPicked = rule(".mm-card-minimal .mm-node.is-selected[data-depth=\"1\"]").body;
	assert.ok(levelRest.has("--mm-card-bg"), "the minimal first level is not drawn at rest");
	assert.equal(
		value(levelPicked, "--mm-card-bg"),
		"color-mix(in srgb, var(--mm-branch) 12%, var(--background-primary))",
		"a picked first-level card loses its branch colour",
	);
	assert.equal(
		value(levelPicked, "--mm-card-border"),
		"1.5px solid var(--mm-branch)",
		"a picked first-level card loses its branch border",
	);

	// The deeper cards are the ones the picked rule turns white.
	assert.equal(
		value(rule(".mm-card-minimal .mm-node.is-selected").body, "--mm-card-bg"),
		"var(--background-primary)",
		"a picked deeper card is not filled",
	);
});

