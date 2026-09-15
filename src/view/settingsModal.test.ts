import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Where the settings window scrolls, and what it must not.
 *
 * The window is a fixed-height box holding two things that are meant to behave
 * differently: a rail of group names that stays put, and a page of rows beside
 * it that scrolls. That difference rests on four declarations that have to
 * agree, and disagreeing does not look broken enough to notice:
 *
 * Obsidian's own `.modal` is `overflow: auto` and its `.modal-content` is a
 * flex item with an automatic minimum size. So a page taller than the window
 * does not break the layout, it just scrolls the *window*: the rail travels up
 * with the rows, a second scrollbar appears beside the page's own, and the rule
 * down the side of the rail stops wherever the last group happened to end.
 * Three complaints, one missing pair of declarations -- which is why the shape
 * is pinned here rather than left to whoever edits the block next. What it looks
 * like is a matter of looking at it; this is the part that is not.
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

function rule(selector: string): { selector: string; body: string } {
	const found = RULES.find((entry) => entry.selector === selector);
	assert.notEqual(found, undefined, `${selector} is not in styles.css any more`);
	return found!;
}

/** A rule's declarations, by property. */
function properties(body: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const line of body.split(";")) {
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		out.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
	}
	return out;
}

const WINDOW = ".mm-settings-dialog";
const CONTENT = ".mm-settings-dialog .modal-content";
const BODY = ".mm-settings";
const RAIL = ".mm-settings-nav";
const PAGE = ".mm-settings-pane";

test("the window clips, and the page beside the rail is the thing that scrolls", () => {
	const window_ = properties(rule(WINDOW).body);
	assert.equal(
		window_.get("overflow"),
		"hidden",
		"an open window scrolls -- head, rail and caption included",
	);

	// A column, so the pair inside can be told to fill the height the window
	// fixed; `overflow: hidden` is also what allows it to shrink to that height
	// at all, an automatic minimum size not applying to a scroll container.
	const content = properties(rule(CONTENT).body);
	assert.equal(content.get("display"), "flex", "the page pair cannot be told to fill");
	assert.equal(content.get("flex-direction"), "column", "the page pair cannot be told to fill");
	assert.equal(
		content.get("overflow"),
		"hidden",
		"the page pushes the window open instead of scrolling inside it",
	);

	const settings = properties(rule(BODY).body);
	assert.ok(settings.has("flex"), "the pair sizes to its content rather than to the window");
	assert.equal(
		settings.get("min-height"),
		"0",
		"the pair cannot shrink below its content, so the window grows instead",
	);

	assert.equal(
		properties(rule(PAGE).body).get("overflow-y"),
		"auto",
		"the page does not scroll, so the window has to",
	);
});

test("one scrollbar in the window, and it belongs to the page", () => {
	const scrollers = RULES.filter(
		(entry) =>
			entry.selector.includes(".mm-settings") &&
			/overflow(-[xy])?\s*:\s*(auto|scroll)/.test(entry.body),
	).map((entry) => entry.selector);
	assert.deepEqual(
		scrollers,
		[PAGE],
		`a second scrollbar appears beside the page's own: ${scrollers.join(", ")}`,
	);
});

test("the rail has no height of its own to stop the rule short", () => {
	// Stretched by the flex line, the rail is as tall as the window and its rule
	// runs the whole way down. Any of these would end it at the last group.
	const rail = properties(rule(RAIL).body);
	for (const own of ["height", "max-height", "align-self"]) {
		assert.equal(rail.has(own), false, `the rail carries a ${own} of its own`);
	}
	assert.equal(
		rail.get("border-right"),
		"1px solid var(--background-modifier-border)",
		"the rule down the rail is what is being kept straight here",
	);
});

test("the scrollbar sits flush against the window's own edge", () => {
	// Out where the hand expects a scrollbar, and away from the rows: a margin
	// on the pane's right would drag the bar inward, over the settings.
	const pane = properties(rule(PAGE).body);
	const right = pane.get("margin-right");
	assert.ok(
		right === undefined || right === "0",
		`the pane keeps the scrollbar off the edge (margin-right: ${right})`,
	);
	// And the window's own padding must not sit between the bar and the edge --
	// Obsidian's `.modal` insets its whole content by default, which is the gap
	// that had the bar riding one step inside the window rather than at it.
	assert.equal(
		properties(rule(WINDOW).body).get("padding-right"),
		"0",
		"the window's own inset keeps the scrollbar off the edge",
	);
});
