import { test } from "node:test";
import assert from "node:assert/strict";

import { attachInteractions } from "./interactions.ts";
import type { MapController } from "./interactions.ts";
import { resolveBindings } from "./shortcuts.ts";

/**
 * A DOM small enough to drive and big enough to lie to.
 *
 * The two things in here that cannot be checked by reading -- that a drag puts
 * a copy on screen and settles it onto the drop, and that a press reaches the
 * action it names -- are both wiring, and wiring is what a stub catches. The
 * arithmetic underneath is covered where it lives; this covers the fact that
 * anything calls it at all.
 */

type Handler = (ev: Record<string, unknown>) => void;

/** Enough of a `CSSStyleDeclaration`: the code sets `left`, and sets vars. */
class FakeStyle {
	readonly props: Record<string, string> = {};
	left = "";
	top = "";

	setProperty(name: string, value: string): void {
		this.props[name] = value;
	}
}

class FakeEl {
	readonly classes = new Set<string>();
	readonly children: FakeEl[] = [];
	readonly dataset: Record<string, string> = {};
	readonly attrs: Record<string, string> = {};
	readonly style = new FakeStyle();
	removed = false;

	private readonly listeners = new Map<string, Handler[]>();

	readonly rect: { left: number; top: number; width: number; height: number };

	constructor(rect?: { left: number; top: number; width: number; height: number }) {
		this.rect = rect ?? { left: 0, top: 0, width: 100, height: 30 };
	}

	/**
	 * A DOMRect carries the edges as well as the size, and the drop arithmetic
	 * reads `right` and `bottom` -- so the stub has to answer for them or the
	 * positions come out as NaN.
	 */
	getBoundingClientRect(): {
		left: number;
		top: number;
		right: number;
		bottom: number;
		width: number;
		height: number;
	} {
		const { left, top, width, height } = this.rect;
		return { left, top, right: left + width, bottom: top + height, width, height };
	}

	addEventListener(type: string, handler: Handler): void {
		const list = this.listeners.get(type) ?? [];
		list.push(handler);
		this.listeners.set(type, list);
	}

	/** Fire at this element only; bubbling is not what is under test. */
	fire(type: string, ev: Record<string, unknown>): void {
		for (const handler of this.listeners.get(type) ?? []) handler(ev);
	}

	/** Everything the code under test reaches for on a real element. */
	querySelector(selector: string): FakeEl | null {
		return this.finds.get(selector) ?? null;
	}

	/**
	 * The cards a drag measures when it places its slots.
	 *
	 * All of `all`, with the selector ignored: `.mm-node` is the only thing the
	 * module ever lists, and a stub that reimplemented selector matching would
	 * be testing the selector engine rather than the drag. The band asks for
	 * `.mm-card` and gets the same elements -- their `closest(".mm-node")`
	 * answers themselves, which is all the band reads off them.
	 */
	readonly all: FakeEl[] = [];

	querySelectorAll(selector: string): FakeEl[] {
		return selector === ".mm-node" || selector === ".mm-card" ? this.all : [];
	}

	/** SVG attributes are set, never read back, but the guide needs the door. */
	setAttribute(name: string, value: string): void {
		this.attrs[name] = value;
	}

	readonly finds = new Map<string, FakeEl>();

	/** What `closest` answers, by selector. Anything else is not an ancestor. */
	readonly ancestors = new Map<string, FakeEl>();

	closest(selector: string): FakeEl | null {
		return this.ancestors.get(selector) ?? null;
	}

	createDiv(): FakeEl {
		const el = new FakeEl();
		this.children.push(el);
		return el;
	}

	appendChild(child: FakeEl): void {
		this.children.push(child);
	}

	cloneNode(): FakeEl {
		return new FakeEl(this.rect);
	}

	remove(): void {
		this.removed = true;
	}

	addClass(cls: string): void {
		this.classes.add(cls);
	}

	/**
	 * The read-only half of the class list: the band asks `classList.contains`
	 * of the nodes it sweeps, which is a question about what is on the element
	 * and never a write.
	 */
	get classList(): { contains(name: string): boolean } {
		return { contains: (name: string) => this.classes.has(name) };
	}

	removeClass(cls: string): void {
		this.classes.delete(cls);
	}

	/** Obsidian's plural form, which the drop highlight is cleared with. */
	removeClasses(classes: string[]): void {
		for (const cls of classes) this.classes.delete(cls);
	}

	toggleClass(cls: string, on?: boolean): void {
		if (on === undefined ? !this.classes.has(cls) : on) this.classes.add(cls);
		else this.classes.delete(cls);
	}

	setPointerCapture(): void {}

	/**
	 * The layer above the transformed one, which is where a band draws its box:
	 * the press reads a rect off it and appends the box to it. Null by default,
	 * which is also the case of a viewport that has not been attached yet.
	 */
	parentElement: FakeEl | null = null;

	focus(): void {}
}

/** Everything the module reaches for on `document` / `window` / globals. */
function installDom(): {
	bodies: FakeEl[];
	under: { el: FakeEl | null };
	/** The clock the lift's wait is measured with, as a queue a test drains. */
	timers: { count(): number; fire(): void };
} {
	const bodies: FakeEl[] = [];
	const under: { el: FakeEl | null } = { el: null };
	const pending = new Map<number, () => void>();
	let nextTimer = 1;

	const body = new FakeEl();
	body.createDiv = (options?: { cls?: string | string[] }): FakeEl => {
		const el = new FakeEl();
		const cls = options?.cls;
		for (const name of cls === undefined ? [] : Array.isArray(cls) ? cls : [cls]) {
			el.addClass(name);
		}
		bodies.push(el);
		return el;
	};

	const g = globalThis as unknown as Record<string, unknown>;
	g.document = { body, elementFromPoint: () => under.el };
	g.window = {
		requestAnimationFrame: (cb: () => void) => {
			cb();
			return 1;
		},
		cancelAnimationFrame: () => {},
		// A press that rests on a block is the one gesture here that is waited
		// for rather than fired, and a real second is not a second a test can
		// spend -- so the clock is a queue, and `fire` is the wait ending.
		setTimeout: (cb: () => void): number => {
			const id = nextTimer++;
			pending.set(id, cb);
			return id;
		},
		clearTimeout: (id: number): void => {
			pending.delete(id);
		},
		// Asked for when a lift takes over a press that may have begun a
		// selection. Nothing in these tests is selected, so the answer is only
		// ever asked for.
		getSelection: () => ({ removeAllRanges: () => {} }),
	};
	g.CSS = { escape: (value: string) => value };
	// The drag's guide is built the way `edges.ts` builds the connectors, with
	// Obsidian's `createSvg`. The stub only has to be something attributes can
	// be set on and that can be appended.
	g.createSvg = () => new FakeEl();
	// The module asks `instanceof HTMLElement` to tell a card from a text node,
	// so the stub has to be what it checks against.
	g.HTMLElement = FakeEl;
	g.getComputedStyle = () => ({ getPropertyValue: () => "" });
	return {
		bodies,
		under,
		timers: {
			count: () => pending.size,
			// Emptied before it runs, so a handler that arms another timer
			// cannot make this pass run that one too.
			fire: () => {
				const due = [...pending.values()];
				pending.clear();
				for (const cb of due) cb();
			},
		},
	};
}

function harness(): {
	viewport: FakeEl;
	/** The dragged node's row: what the copy is cloned from and sized by. */
	row: FakeEl;
	/**
	 * The node the map looks up by id, which is where a lift's own marks land:
	 * the wait showing on the card, and the slot it leaves behind. Nobody else
	 * can reach it, because a real node is not handed to these tests either.
	 */
	node: FakeEl;
	/** The camera, as the layer under test drives it -- see the stub below. */
	canvas: { viewport: FakeEl; panKeyHeld: boolean; holdPan(held: boolean): void };
	under: { el: FakeEl | null };
	bodies: FakeEl[];
	/** The lift's clock: what a wait is armed on, and how a test ends it. */
	timers: { count(): number; fire(): void };
	calls: string[];
	/** Slots this map refuses, written `"targetId:mode"`. */
	refuses: string[];
	/** The cards a drag from one of them would carry. Empty is the lone card. */
	carried: Set<string>;
	/** The drag mode: change `on` to put a plain press on the band's side. */
	dragToPan: { on: boolean };
	/** Which card each body card belongs to, by body id. */
	bodyOwners: Map<string, string>;
	/** Whether the map has anything to preview for the click it was handed. */
	previewable: { answer: boolean };
	press: (ev: Record<string, unknown>) => void;
	release: (ev: Record<string, unknown>) => void;
} {
	const dom = installDom();
	const calls: string[] = [];
	const refuses: string[] = [];
	const bodyOwners = new Map<string, string>();
	const previewable = { answer: true };
	/** The cards a test has selected. Empty is the ordinary single selection. */
	const carried = new Set<string>();
	/** The drag mode, as a test changes it. On is how the map used to work. */
	const dragToPan = { on: true };

	const viewport = new FakeEl();
	// The untransformed layer over the viewport, which is where a band's box is
	// drawn: the press measures this element and the box is appended to it, so
	// the box is in screen coordinates rather than in the map's.
	const host = new FakeEl();
	viewport.parentElement = host;
	// The dragged node, its card and its row: the drag looks the node up by id,
	// the card is where a press may land, and the row is what the copy is made
	// of. A row with no annotation is the card's own box, so they share a rect.
	const rect = { left: 0, top: 0, width: 120, height: 30 };
	const card = new FakeEl(rect);
	const row = new FakeEl(rect);
	const node = new FakeEl();
	node.dataset.id = "n1";
	node.finds.set(".mm-card", card);
	node.finds.set(".mm-row", row);
	viewport.querySelector = (selector: string): FakeEl | null => {
		if (selector.includes("n1")) return node;
		// By id, over the dragged node and whatever cards a test has put in the
		// map: the guide looks its parent up the way the drag looks up its
		// source, and both go through here.
		const id = /data-id="([^"]*)"/.exec(selector)?.[1];
		return viewport.all.find((el) => el.dataset.id === id) ?? null;
	};

	/**
	 * The canvas, as the interaction layer uses it: the viewport it drives, and
	 * the pan key it is told about. `panKeyHeld` is what the layer reads back to
	 * decide whether a press belongs to the camera, so the stub has to keep it
	 * the way the real one does -- set by `holdPan`, read by everyone.
	 */
	const canvas = {
		viewport,
		panKeyHeld: false,
		holdPan(held: boolean): void {
			this.panKeyHeld = held;
		},
	};

	const controller = new Proxy(
		{},
		{
			get: (_target, prop: string) => {
				if (prop === "canvas") return canvas;
				if (prop === "bindings") return () => resolveBindings(undefined);
				if (prop === "isEditing") return () => false;
				if (prop === "selectedId") return () => "n1";
				// A slot this map refuses, written "targetId:mode"; anything else
				// is allowed.
				if (prop === "canDrop") return (_id: string, targetId: string, mode: string) =>
					!refuses.includes(`${targetId}:${mode}`);
				// What a drag from a card carries: the card alone, unless the
				// test has put it in a selection -- and a selection the map
				// holds more than one card of is carried whole.
			if (prop === "carriedBy") return (id: string) =>
				carried.has(id) && carried.size > 1 ? [...carried] : [id];
			// Whether this block may be picked up at all: a stubbed yes, which is
			// what the fold button of a body card asks before it starts a drag.
			if (prop === "canDragBody") return () => true;
				// Every card has to fit, which is the rule the real controller
				// states; one refusal is a refusal for the group.
				if (prop === "canDropMany")
					return (ids: string[], targetId: string, mode: string) =>
						ids.length > 0 && ids.every(() => !refuses.includes(`${targetId}:${mode}`));
				// The drag mode. On is how the map worked before the setting
				// existed -- blank canvas is the camera's and the band waits for
				// the modifier -- so that is the stub's default.
				if (prop === "dragToPan") return () => dragToPan.on;
				if (prop === "edgeStyle") return () => "curve";
				// The map's rule for a slot's parent, stubbed: landing inside a
				// card parents to that card, landing beside one parents to the
				// card's own parent -- which the stubs name n0.
				if (prop === "dropParent") return (targetId: string, mode: string) =>
					mode === "child" ? targetId : "n0";
				// Which card a body card belongs to. Empty until a test says
				// otherwise, which is also the case of a body card whose owner
				// the map is not drawing.
				if (prop === "bodyOwner") return (id: string) => bodyOwners.get(id) ?? null;
				// Recorded by name rather than by argument, because the answer
				// is what the routing turns on and an element does not print.
				if (prop === "previewMedia")
					return (el: unknown) => {
						calls.push(el === undefined ? "previewMedia()" : "previewMedia(el)");
						return previewable.answer;
					};
				return (...args: unknown[]) => {
					calls.push(`${String(prop)}(${args.join(",")})`);
				};
			},
		},
	) as unknown as MapController;

	attachInteractions(controller);
	return {
		viewport,
		row,
		node,
		canvas,
		under: dom.under,
		bodies: dom.bodies,
		timers: dom.timers,
		calls,
		refuses,
		carried,
		dragToPan,
		bodyOwners,
		previewable,
		press: (ev) => viewport.fire("keydown", ev),
		release: (ev) => viewport.fire("keyup", ev),
	};
}

const pointer = (x: number, y: number): Record<string, unknown> => ({
	button: 0,
	pointerId: 1,
	clientX: x,
	clientY: y,
	target: dragTarget(),
	preventDefault: () => {},
	stopPropagation: () => {},
});

/**
 * A press on blank canvas: nothing with a card under it, so no card owns the
 * press and the question is only whether the camera or the band does.
 */
const blankPress = (x: number, y: number, shiftKey = false): Record<string, unknown> => ({
	button: 0,
	pointerId: 1,
	clientX: x,
	clientY: y,
	shiftKey,
	target: new FakeEl(),
	preventDefault: () => {},
	stopPropagation: () => {},
});

/**
 * A press that starts on the dragged card: `pointerdown` reads the node id off
 * the card, so the card has to know the node it is drawn in.
 */
function dragTarget(): FakeEl {
	const node = new FakeEl();
	node.dataset.id = "n1";
	const card = new FakeEl();
	// An element is its own closest match, which is how the real thing answers
	// when the press lands on the card itself.
	card.ancestors.set(".mm-card", card);
	card.ancestors.set(".mm-node", node);
	return card;
}

/**
 * A card in the map, as a drag's slot measurement sees it: a node carrying an
 * id, and the boxes inside it.
 *
 * The card is what a slot is measured from; the row is the drawn box around it,
 * which an annotation makes taller. `rowRect` lets a test pull those apart.
 */
function cardAt(
	id: string,
	rect: { left: number; top: number; width: number; height: number },
	rowRect = rect,
	side: "left" | "right" = "right",
): FakeEl {
	const node = new FakeEl();
	node.dataset.id = id;
	// Every card in a real map carries this; a drag reads it to decide which
	// half of the card means "inside it".
	node.dataset.side = side;
	node.finds.set(".mm-card", new FakeEl(rect));
	node.finds.set(".mm-row", new FakeEl(rowRect));
	// The band reads the node back off the card it swept; the stub lists whole
	// nodes, and a node is its own closest ancestor match.
	node.ancestors.set(".mm-node", node);
	return node;
}

/** A note-content card: a real box on the map that a drag may not land on. */
function bodyAt(
	id: string,
	rect: { left: number; top: number; width: number; height: number },
): FakeEl {
	const node = cardAt(id, rect);
	node.dataset.kind = "body";
	return node;
}

// --- the drag copy --------------------------------------------------------------

test("a drag puts a copy on screen and follows the pointer with it", () => {
	const h = harness();
	h.under.el = null;

	h.viewport.fire("pointerdown", pointer(10, 10));
	h.viewport.fire("pointermove", pointer(40, 40));

	assert.equal(h.bodies.length, 1, "a copy was created");
	const ghost = h.bodies[0];
	assert.ok(ghost.classes.has("mm-drag-ghost"));
	// With nothing under the pointer the copy is where the pointer is.
	assert.equal(ghost.style.left, "40px");
	assert.equal(ghost.style.top, "40px");
});

test("the copy follows the pointer, not the predicted landing spot", () => {
	const h = harness();
	// A card off to one side of the pointer, so the drag has somewhere to go
	// and the copy still must not go there.
	h.viewport.all.push(cardAt("n2", { left: 300, top: 200, width: 120, height: 30 }));

	h.viewport.fire("pointerdown", pointer(10, 10));
	h.viewport.fire("pointermove", pointer(340, 215));

	const ghost = h.bodies[0];
	// The copy stays under the cursor, twenty pixels short of the slot it is
	// about to land in. The guide, not the copy, is what says where that is.
	assert.equal(ghost.style.top, "215px");
	assert.equal(ghost.style.left, "340px");
});

test("the copy is drawn in the card style the map is drawn in", () => {
	// The copy is on `document.body`, so it inherits nothing from the map -- not
	// even the class the card style is keyed on. Without it, dragging a flat card
	// carries a boxed copy under the pointer.
	const h = harness();
	h.under.el = null;
	h.row.ancestors.set(".mm-card-minimal", new FakeEl());

	h.viewport.fire("pointerdown", pointer(10, 10));
	h.viewport.fire("pointermove", pointer(40, 40));

	const ghost = h.bodies[0];
	assert.ok(ghost.classes.has("mm-card-minimal"), "the copy lost the card style");
	// And nothing else: the default style takes no class, so a copy is never
	// given one it was not drawn with.
	assert.equal(ghost.classes.has("mm-card-rounded"), false);
});

test("the copy is taken off the screen when the drag ends", () => {
	const h = harness();
	h.under.el = null;
	h.viewport.fire("pointerdown", pointer(10, 10));
	h.viewport.fire("pointermove", pointer(40, 40));
	const ghost = h.bodies[0];

	h.viewport.fire("pointerup", { pointerId: 1, clientX: 40, clientY: 40, preventDefault: () => {} });
	assert.equal(ghost.removed, true);
});

// --- where a drag lands ---------------------------------------------------------

test("a pointer in the gap between two cards lands in the gap", () => {
	// What this replaces wanted the pointer pressed against a card's own border
	// and refused the gap -- which is exactly where a user aiming "between
	// these two" puts it.
	const h = harness();
	h.viewport.all.push(
		cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }),
		cardAt("n3", { left: 300, top: 200, width: 120, height: 30 }),
	);
	h.under.el = null;

	h.viewport.fire("pointerdown", pointer(10, 10));
	h.viewport.fire("pointermove", pointer(360, 160));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 360,
		clientY: 160,
		preventDefault: () => {},
	});

	// The nearest anchors are n2's bottom edge at y=130, thirty away, and n3's
	// top edge at y=200, forty. The gap belongs to the card above it.
	assert.deepEqual(h.calls, ["moveMany(n1,n2,after)"]);
});

test("a pointer out to the side of a card lands inside it", () => {
	const h = harness();
	h.viewport.all.push(cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }));
	h.under.el = null;

	h.viewport.fire("pointerdown", pointer(10, 10));
	h.viewport.fire("pointermove", pointer(500, 115));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 500,
		clientY: 115,
		preventDefault: () => {},
	});

	assert.deepEqual(h.calls, ["moveMany(n1,n2,child)"]);
});

test("a pointer well off to the side of a card still lands on it", () => {
	// The case this is for: the card being moved sits most of a card's width to
	// the right of the row it belongs in, and a little below the card it should
	// follow. Measured to that card's middle it is 340px away and out of reach;
	// measured to its box it is 280, and level with the row it means. Reaching
	// for a point on the card is what made the user bring the card most of the
	// way home before anything happened.
	const h = harness();
	h.viewport.all.push(cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }));
	h.under.el = null;

	h.viewport.fire("pointerdown", pointer(10, 10));
	h.viewport.fire("pointermove", pointer(700, 145));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 700,
		clientY: 145,
		preventDefault: () => {},
	});

	assert.deepEqual(h.calls, ["moveMany(n1,n2,after)"]);
});

test("a card that refuses the slot still takes the node inside it", () => {
	// The root takes no sibling, and a card that refused a slot used to go
	// dead along the whole band above and below it: aiming there found nothing
	// at all, and the drag would not stick. The card keeps its place in the
	// running and takes the node inside it instead.
	const h = harness();
	h.viewport.all.push(cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }));
	h.under.el = null;
	// A card with no siblings to land among.
	h.refuses.push("n2:after");

	h.viewport.fire("pointerdown", pointer(10, 10));
	h.viewport.fire("pointermove", pointer(360, 145));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 360,
		clientY: 145,
		preventDefault: () => {},
	});

	assert.deepEqual(h.calls, ["moveMany(n1,n2,child)"]);
});

test("a card on the left nests on its left, where its children are drawn", () => {
	// A subtree is drawn wholly on one side of its parent, so a card left of
	// the root has its children to its left. Reading the halves the way round a
	// right-hand card reads them put this one's two slots on the wrong sides:
	// aiming at the children nested nothing, and aiming back towards the parent
	// reordered instead.
	const h = harness();
	h.viewport.all.push(
		cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }, undefined, "left"),
	);
	h.under.el = null;

	h.viewport.fire("pointerdown", pointer(10, 10));
	h.viewport.fire("pointermove", pointer(320, 115));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 320,
		clientY: 115,
		preventDefault: () => {},
	});

	// Left of the card's middle, so inward, and level with it.
	assert.deepEqual(h.calls, ["moveMany(n1,n2,child)"]);
});

test("a card on the left reorders on its right, which faces its parent", () => {
	const h = harness();
	h.viewport.all.push(
		cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }, undefined, "left"),
	);
	h.under.el = null;

	h.viewport.fire("pointerdown", pointer(10, 10));
	h.viewport.fire("pointermove", pointer(440, 115));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 440,
		clientY: 115,
		preventDefault: () => {},
	});

	// Right of the card's middle, on the row's own side, level with the card:
	// the row is the slot, and the height says which way along it.
	assert.deepEqual(h.calls, ["moveMany(n1,n2,after)"]);
});

test("a body card is never itself the target", () => {
	// Body cards stand for lines the note owns, and there is no node behind one
	// to move anything to. Its area is handed to its owner instead -- see the
	// next test -- and with no owner to hand it to, it is not a candidate.
	const h = harness();
	h.viewport.all.push(
		cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }),
		// Right under the pointer, and not a place anything can go.
		bodyAt("nb", { left: 500, top: 100, width: 200, height: 40 }),
	);
	h.under.el = null;

	h.viewport.fire("pointerdown", pointer(10, 10));
	h.viewport.fire("pointermove", pointer(600, 120));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 600,
		clientY: 120,
		preventDefault: () => {},
	});

	assert.deepEqual(h.calls, ["moveMany(n1,n2,child)"]);
});

test("a body card hands its area to the card that owns it", () => {
	// A note's prose is the biggest thing on a map that has any, and nothing can
	// be moved to it -- so with body cards simply skipped, the whole area they
	// cover became somewhere a drag found nothing at all, and a card could not be
	// dropped anywhere near the prose. The area belongs to the card the prose
	// hangs under, and a drop over it means what a drop on that card means:
	// inside it.
	const h = harness();
	h.viewport.all.push(
		// The card the prose belongs to, well above it.
		cardAt("n2", { left: 300, top: 20, width: 120, height: 30 }),
		// Three hundred pixels of prose under it.
		bodyAt("n2::0", { left: 300, top: 100, width: 120, height: 200 }),
	);
	h.bodyOwners.set("n2::0", "n2");
	h.under.el = null;

	h.viewport.fire("pointerdown", pointer(10, 10));
	// Deep inside the prose, and nowhere near the card itself.
	h.viewport.fire("pointermove", pointer(360, 250));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 360,
		clientY: 250,
		preventDefault: () => {},
	});

	assert.deepEqual(h.calls, ["moveMany(n1,n2,child)"]);
});

test("the row the pointer is level with beats a card nearer to its side", () => {
	// Cards are wide and short, so an unweighed distance is dominated by the
	// horizontal gap -- and a card well up the page, whose right edge happens to
	// be close, wins against the card the pointer is level with. That is how a
	// drag ends up sticking to a card somewhere above it.
	const h = harness();
	h.viewport.all.push(
		// High above the pointer, but with its right edge close to it.
		cardAt("n2", { left: 600, top: 20, width: 200, height: 30 }),
		// Level with the pointer, but with its right edge further away.
		cardAt("n3", { left: 580, top: 95, width: 120, height: 30 }),
	);
	h.under.el = null;

	h.viewport.fire("pointerdown", pointer(10, 10));
	h.viewport.fire("pointermove", pointer(850, 135));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 850,
		clientY: 135,
		preventDefault: () => {},
	});

	assert.deepEqual(h.calls, ["moveMany(n1,n3,after)"]);
});

test("level with a card and past its middle takes the node inside it", () => {
	// The split down the middle is what separates "beside it" from "inside it".
	// A card's children are drawn to its right, so that is the half that means
	// the card should open up and take the node.
	const h = harness();
	h.viewport.all.push(cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }));
	h.under.el = null;

	h.viewport.fire("pointerdown", pointer(10, 10));
	// Level with the card, just past its middle at x=360.
	h.viewport.fire("pointermove", pointer(380, 115));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 380,
		clientY: 115,
		preventDefault: () => {},
	});

	assert.deepEqual(h.calls, ["moveMany(n1,n2,child)"]);
});

test("level with a card but short of its middle means that card's row", () => {
	// The left half is the card's own column, shared with its siblings, so a
	// pointer there chooses a place in the row rather than inside the card --
	// and the height then says before or after.
	const h = harness();
	h.viewport.all.push(cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }));
	h.under.el = null;

	h.viewport.fire("pointerdown", pointer(10, 10));
	// Level with the card, just short of its middle.
	h.viewport.fire("pointermove", pointer(340, 120));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 340,
		clientY: 120,
		preventDefault: () => {},
	});

	assert.deepEqual(h.calls, ["moveMany(n1,n2,after)"]);
});

test("a drag that ends nowhere near a slot moves nothing", () => {
	const h = harness();
	h.viewport.all.push(cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }));
	h.under.el = null;

	h.viewport.fire("pointerdown", pointer(10, 10));
	h.viewport.fire("pointermove", pointer(2000, 2000));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 2000,
		clientY: 2000,
		preventDefault: () => {},
	});

	assert.deepEqual(h.calls, []);
});

test("the card lands on the slot the last frame drew, not where the pointer was let go", () => {
	const h = harness();
	h.viewport.all.push(
		cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }),
		cardAt("n3", { left: 300, top: 400, width: 120, height: 30 }),
	);
	h.under.el = null;

	h.viewport.fire("pointerdown", pointer(10, 10));
	// One frame over n2's middle, so the guide points at n2 ...
	h.viewport.fire("pointermove", pointer(360, 115));
	// ... and a release over n3. Resolving again here would land the card on a
	// card the guide never pointed at, which is the one thing the guide promises
	// cannot happen.
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 360,
		clientY: 415,
		preventDefault: () => {},
	});

	assert.deepEqual(h.calls, ["moveMany(n1,n2,child)"]);
});

test("a drag draws a guide to the slot, and takes it away when the drag ends", () => {
	const h = harness();
	h.viewport.all.push(cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }));
	h.under.el = null;

	h.viewport.fire("pointerdown", pointer(10, 10));
	h.viewport.fire("pointermove", pointer(360, 115));

	const guide = h.viewport.children.find((el) => el.classes.has("mm-drag-guide"));
	assert.ok(guide, "no guide was drawn");
	const line = guide.children[0];
	assert.ok(line.classes.has("mm-drag-guide-line"), "the guide has no line in it");
	assert.match(line.attrs.d ?? "", /^M /, "the line was left without a path");

	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 360,
		clientY: 160,
		preventDefault: () => {},
	});
	assert.equal(guide.removed, true, "the guide outlived the drag");
});

test("a slot is measured off the card, not off the row an annotation widens", () => {
	// `.mm-row` is the drawn box and an annotation hangs inside it, so on an
	// annotated card the row's centre is not the card's. Measuring the row
	// would put "above" and "below" in the wrong places -- the judgement has to
	// come off the card the user is pointing at.
	const h = harness();
	// A card sitting at the top of a row three times its height.
	h.viewport.all.push(
		cardAt(
			"n2",
			{ left: 300, top: 100, width: 120, height: 30 },
			{ left: 300, top: 100, width: 120, height: 90 },
		),
	);
	h.under.el = null;

	h.viewport.fire("pointerdown", pointer(10, 10));
	// Just under the card's bottom edge, and well above the row's middle.
	h.viewport.fire("pointermove", pointer(360, 135));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 360,
		clientY: 135,
		preventDefault: () => {},
	});

	// Off the card, the nearest anchor is its bottom edge at y=130, five away:
	// "after it". Off the row it would be the row's centre at y=145, ten away,
	// and the card would land inside instead.
	assert.deepEqual(h.calls, ["moveMany(n1,n2,after)"]);
});

test("the guide draws the connector the move would make", () => {
	// Not a pointer at a place on the canvas: a line from the face of the card
	// that would become the parent to the face of the card being carried, in
	// the map's own line style. That is what says where the card is about to
	// hang, before the user lets go.
	const h = harness();
	h.viewport.all.push(cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }));
	h.under.el = null;

	h.viewport.fire("pointerdown", pointer(10, 10));
	// Over n2's middle, so the slot is "inside it" and n2 becomes the parent.
	h.viewport.fire("pointermove", pointer(360, 115));

	const guide = h.viewport.children.find((el) => el.classes.has("mm-drag-guide"));
	assert.ok(guide, "no guide was drawn");
	const d = guide.children[0].attrs.d ?? "";
	// The carried card is a 120-wide box centred on the pointer at (360, 115),
	// and the parent faces it from its right: the line runs between the two
	// faces, at x=420 and x=300, both at the pointer's height. The stub viewport
	// sits at the origin, so screen and overlay coordinates coincide.
	assert.match(d, /^M 420 115/, `the line did not leave the parent's face: ${d}`);
	assert.match(d, /300 115$/, `the line did not reach the carried card's face: ${d}`);
});

test("landing beside a card draws the line from that card's parent, not from the card", () => {
	// "Beside" means among its siblings, so the connector the move creates is
	// the one to the parent they share. Drawing it from the card next door
	// would promise a line that is never drawn.
	const h = harness();
	h.viewport.all.push(
		cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }),
		// n2's parent, whose card is somewhere else entirely.
		cardAt("n0", { left: 300, top: 400, width: 120, height: 30 }),
	);
	h.under.el = null;

	h.viewport.fire("pointerdown", pointer(10, 10));
	// Below n2, so the slot is "after it" and the parent is n0.
	h.viewport.fire("pointermove", pointer(360, 160));

	const guide = h.viewport.children.find((el) => el.classes.has("mm-drag-guide"));
	assert.ok(guide, "no guide was drawn");
	const d = guide.children[0].attrs.d ?? "";
	// y=415 is n0's middle; n2's is y=115. The line has to come from n0.
	assert.match(d, /^M 420 415/, `the line did not leave the parent's face: ${d}`);
});

test("a slot whose parent the map is not drawing gets no line", () => {
	const h = harness();
	// n2 is in the map, but n0 -- the parent a "beside" slot would connect to --
	// is not.
	h.viewport.all.push(cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }));
	h.under.el = null;

	h.viewport.fire("pointerdown", pointer(10, 10));
	h.viewport.fire("pointermove", pointer(360, 160));

	const guide = h.viewport.children.find((el) => el.classes.has("mm-drag-guide"));
	assert.ok(guide, "no guide was drawn");
	assert.equal(guide.children[0].attrs.d, "", "a line was drawn to nothing");
});

// --- the keyboard -----------------------------------------------------------------

test("Shift+Enter reaches the text block action", () => {
	const h = harness();
	h.press({
		key: "Enter",
		ctrlKey: false,
		metaKey: false,
		shiftKey: true,
		altKey: false,
		preventDefault: () => {},
		stopPropagation: () => {},
	});
	assert.deepEqual(h.calls, ["addBlock(n1)"]);
});

/** A key event as `comboFromEvent` reads one: the key, and the four flags. */
function keyEvent(key: string): Record<string, unknown> {
	return {
		key,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		altKey: false,
		preventDefault: () => {},
		stopPropagation: () => {},
	};
}

test("Space folds on the release, not on the way down", () => {
	const h = harness();
	// Nothing yet: the press may still turn out to be the start of a pan, and a
	// fold that fired here could not be taken back.
	h.press(keyEvent(" "));
	assert.deepEqual(h.calls, []);

	h.release(keyEvent(" "));
	assert.deepEqual(h.calls, ["toggleFold(n1)"]);
});

test("Space held with the button down never folds", () => {
	const h = harness();
	h.press(keyEvent(" "));
	// The button lands on a card, which under the pan key is canvas.
	h.viewport.fire("pointerdown", pointer(10, 10));
	assert.equal(h.canvas.panKeyHeld, true, "the map was not put in pan mode");

	h.viewport.fire("pointermove", pointer(300, 300));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 300,
		clientY: 300,
		preventDefault: () => {},
	});
	h.release(keyEvent(" "));

	assert.deepEqual(h.calls, [], "a held key folded the card anyway");
	assert.equal(h.canvas.panKeyHeld, false, "the map was left in pan mode");
	// The card the press landed on stayed where it was: the canvas had the
	// gesture, so nothing was carried and no guide was drawn.
	assert.equal(
		h.viewport.children.some((el) => el.classes.has("mm-drag-guide")),
		false,
		"a card drag started under the pan key",
	);
});

test("a click while the pan key is held belongs to the camera", () => {
	const h = harness();
	h.press(keyEvent(" "));
	h.viewport.fire("click", {
		target: dragTarget(),
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		preventDefault: () => {},
		stopPropagation: () => {},
	});
	assert.deepEqual(h.calls, [], "a pan that went nowhere selected a card");
});

test("losing the focus mid-hold ends the pan, and its release folds nothing", () => {
	const h = harness();
	h.press(keyEvent(" "));
	assert.equal(h.canvas.panKeyHeld, true);

	// The release goes to whatever took the focus, so the map never hears it.
	h.viewport.fire("blur", {});
	assert.equal(h.canvas.panKeyHeld, false, "the map was left in pan mode");

	h.release(keyEvent(" "));
	assert.deepEqual(h.calls, [], "a fold fired for a hold that had already ended");
});

// --- the one button on the branch side of a card ---------------------------------

/**
 * A click on `.mm-add`, as the viewport sees it: the button is its own closest
 * match for `.mm-add`, and it points at the card it belongs to.
 */
function addButton(id: string): FakeEl {
	const node = new FakeEl();
	node.dataset.id = id;
	const button = new FakeEl();
	button.ancestors.set(".mm-add", button);
	button.ancestors.set(".mm-node", node);
	return button;
}

test("the branch button presses through to the action its icon is showing", () => {
	const h = harness();
	const button = addButton("n1");

	h.viewport.fire("click", {
		target: button,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		preventDefault: () => {},
		stopPropagation: () => {},
	});

	// The button's icon comes from the same question the press asks
	// (`branchButton.ts`): the minus that is showing folds the branch, the plus
	// grows a child. The press reads the state out of the view again rather
	// than out of the DOM, so the icon and the press cannot disagree even when
	// the selection has moved since the card was painted.
	assert.deepEqual(h.calls, ["toggleBranch(n1)"]);
});

/**
 * A click on `.mm-toggle`, the number a folded branch shows.
 *
 * The badge is not the button, and it is not the line either: it sits in
 * `.mm-tools`, on the row but outside the title, which is what leaves it a
 * gesture of its own. Pressing the number is what opens what is under it --
 * the count is the only thing on a folded card that says anything is there.
 */
function countBadge(id: string): FakeEl {
	const node = new FakeEl();
	node.dataset.id = id;
	const badge = new FakeEl();
	badge.ancestors.set(".mm-toggle", badge);
	badge.ancestors.set(".mm-node", node);
	return badge;
}

test("the count on a folded branch opens it, and does nothing else", () => {
	const h = harness();
	clickOn(h, countBadge("n1"), false);
	// One call: not a selection, and not a preview. A badge press that answered
	// with anything else would be two answers to one press.
	assert.deepEqual(h.calls, ["toggleFold(n1)"]);
});

test("the same count on a card out of another note is read the same way", () => {
	const h = harness();
	// A projected card's id and its key both carry the link's, and the routing
	// does not care either way -- the id travels whole. What the fold then does
	// with a card this note's parse has never heard of is `MindmapView`'s
	// business; this is the half that lives here.
	const badge = countBadge("n1$embed0");
	badge.ancestors.set(".mm-node.is-projected", badge.ancestors.get(".mm-node") as FakeEl);
	clickOn(h, badge, false);
	assert.deepEqual(h.calls, ["toggleFold(n1$embed0)"]);
});

// --- pictures and videos ----------------------------------------------------------
/**
 * Where in a card a link or a picture is read as itself rather than as a title.
 *
 * One string, because the module asks with one: a note-content card, an
 * annotation strip, and a link card's preview, which is another note's words
 * drawn on this card and answers a press the same way.
 */
const CONTENT = '.mm-node[data-kind="body"], .mm-annotation, .mm-preview';

/**
 * A click on a picture in a content card, as the viewport sees it.
 *
 * The wrapper is its own closest match for the media selector and hangs under a
 * content box -- the two questions the routing asks before it decides that this
 * click belongs to the preview and not to the link.
 */
function mediaCard(href?: string): FakeEl {
	const body = new FakeEl();
	const wrap = new FakeEl();
	if (href !== undefined) wrap.dataset.href = href;
	wrap.ancestors.set(".mm-media[data-href]", wrap);
	// The same element again under the selector the link branch looks it up
	// with -- the media one is asked first, and this is what it falls through
	// to when the answer is no.
	wrap.ancestors.set(
		".mm-link[data-href], .mm-embed[data-href], .mm-media[data-href]",
		wrap,
	);
	wrap.ancestors.set(CONTENT, body);
	return wrap;
}

/** A link written inside a note-content card, and the card it sits on. */
function linkInCard(id: string, href = "Guide"): FakeEl {
	const body = new FakeEl();
	const node = new FakeEl();
	node.dataset.id = id;
	const link = new FakeEl();
	link.dataset.href = href;
	link.ancestors.set(
		".mm-link[data-href], .mm-embed[data-href], .mm-media[data-href]",
		link,
	);
	link.ancestors.set(CONTENT, body);
	link.ancestors.set(".mm-node", node);
	return link;
}

function clickOn(
	h: ReturnType<typeof harness>,
	target: FakeEl,
	mod: boolean,
	detail = 1,
): void {	h.viewport.fire("click", {
		target,
		ctrlKey: mod,
		metaKey: false,
		shiftKey: false,
		// Which press of a run this is. The card's own open-and-close reads it,
		// because the second press of a double-click is the rename's.
		detail,
		preventDefault: () => {},
		stopPropagation: () => {},
	});
}

test("a picture is previewed rather than followed", () => {
	const h = harness();
	clickOn(h, mediaCard("hero.png"), false);
	// And nothing else: the click that opens the preview must not also hand the
	// file to the workspace, which is the tab the preview exists to avoid.
	assert.deepEqual(h.calls, ["previewMedia(el)"]);
});

test("a picture the map cannot preview is still a link", () => {
	const h = harness();
	h.previewable.answer = false;
	clickOn(h, mediaCard("hero.png"), false);

	// The file may have left the vault since the card was drawn, and a wrapper
	// that no longer resolves is still a chip, which is still a link.
	assert.equal(h.calls[0], "previewMedia(el)");
	assert.match(h.calls[1], /^openLink\(hero\.png,/);
});

test("Ctrl/Cmd+click still reaches the file itself", () => {
	const h = harness();
	clickOn(h, mediaCard("hero.png"), true);

	// The modifier is the only way left to the file from a picture, now that
	// the plain click belongs to the preview.
	assert.equal(h.calls.length, 1);
	assert.match(h.calls[0], /^openLink\(hero\.png,/);
});

test("a picture in a preview is previewed like any other", () => {
	// A preview is another note's words drawn on this card, pictures and all --
	// and a picture the reader can see is a picture the reader will press. The
	// node around it is a topic card rather than a content card, which is the
	// whole of what changed here.
	const h = harness();
	const node = new FakeEl();
	const wrap = new FakeEl();
	wrap.dataset.href = "hero.png";
	wrap.ancestors.set(".mm-media[data-href]", wrap);
	wrap.ancestors.set(
		".mm-link[data-href], .mm-embed[data-href], .mm-media[data-href]",
		wrap,
	);
	wrap.ancestors.set(CONTENT, new FakeEl());
	wrap.ancestors.set(".mm-node", node);

	clickOn(h, wrap, false);
	assert.deepEqual(h.calls, ["previewMedia(el)"]);
});

test("a picture outside note content is not previewed", () => {
	const h = harness();
	const wrap = new FakeEl();
	wrap.dataset.href = "hero.png";
	wrap.ancestors.set(".mm-media[data-href]", wrap);

	// Nothing above it: a title is not a place a picture is drawn, and the
	// routing asks where it is before it answers.
	clickOn(h, wrap, false);
	assert.ok(!h.calls.some((call) => call.startsWith("previewMedia(")));
});

test("a press on a link inside a card carries the card it was written on", () => {
	// The map shows what the link says on the card the link is written on, and
	// without the card there is nowhere to put it. Prose is where links are
	// written, and a note-content card is not a node the map can look up later.
	const h = harness();
	clickOn(h, linkInCard("nb"), false);
	assert.equal(h.calls.length, 1, h.calls.join("; "));
	assert.match(h.calls[0], /^openLink\(Guide,/);
	assert.match(h.calls[0], /,nb\)$/);
});

// --- carrying a whole selection -----------------------------------------------

test("a card picked up out of a selection carries the whole selection", () => {
	// The rings on the other cards say they are in this too, so the drag has to
	// take them: one card moving out of a selection is the bug this replaces.
	const h = harness();
	h.carried.add("n1");
	h.carried.add("n5");
	h.carried.add("n6");
	h.viewport.all.push(cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }));
	h.under.el = null;

	h.viewport.fire("pointerdown", pointer(10, 10));
	h.viewport.fire("pointermove", pointer(340, 120));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 340,
		clientY: 120,
		preventDefault: () => {},
	});

	assert.deepEqual(h.calls, ["moveMany(n1,n5,n6,n2,after)"]);
});

test("a card outside the selection is dragged on its own", () => {
	const h = harness();
	h.carried.add("n5");
	h.carried.add("n6");
	h.viewport.all.push(cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }));
	h.under.el = null;

	h.viewport.fire("pointerdown", pointer(10, 10));
	h.viewport.fire("pointermove", pointer(340, 120));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 340,
		clientY: 120,
		preventDefault: () => {},
	});

	assert.deepEqual(h.calls, ["moveMany(n1,n2,after)"]);
});

test("a slot the whole group cannot take is not the slot that is offered", () => {
	// "Beside it" is refused for this card, so the group is not offered it --
	// and the drag falls back to the one slot that does take all of them rather
	// than splitting the run across two placements.
	const h = harness();
	h.carried.add("n1");
	h.carried.add("n5");
	h.refuses.push("n2:after");
	h.viewport.all.push(cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }));
	h.under.el = null;

	h.viewport.fire("pointerdown", pointer(10, 10));
	h.viewport.fire("pointermove", pointer(340, 120));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 340,
		clientY: 120,
		preventDefault: () => {},
	});

	assert.deepEqual(h.calls, ["moveMany(n1,n5,n2,child)"]);
});

test("every card being carried goes flat, not just the one under the pointer", () => {
	const h = harness();
	h.carried.add("n1");
	h.carried.add("n5");
	const other = cardAt("n5", { left: 100, top: 400, width: 120, height: 30 });
	h.viewport.all.push(cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }), other);
	h.under.el = null;

	h.viewport.fire("pointerdown", pointer(10, 10));
	h.viewport.fire("pointermove", pointer(340, 120));

	assert.equal(other.classes.has("is-dragging"), true);
});

// --- which press owns blank canvas --------------------------------------------

test("with the drag mode off, a plain press on blank canvas draws the band", () => {
	// The whole of what the setting changes here: off, blank canvas belongs to
	// the band and the map waits for the pan key.
	const h = harness();
	h.dragToPan.on = false;

	h.viewport.fire("pointerdown", blankPress(10, 10));
	h.viewport.fire("pointermove", blankPress(200, 200));
	h.viewport.fire("pointerup", blankPress(200, 200));

	assert.deepEqual(h.calls, ["selectMany()"]);
});

test("with the drag mode on, a plain press on blank canvas is left to the camera", () => {
	const h = harness();
	h.dragToPan.on = true;

	h.viewport.fire("pointerdown", blankPress(10, 10));
	h.viewport.fire("pointermove", blankPress(200, 200));
	h.viewport.fire("pointerup", blankPress(200, 200));

	assert.deepEqual(h.calls, []);
});

test("with the drag mode on, the band waits for the modifier", () => {
	const h = harness();
	h.dragToPan.on = true;

	h.viewport.fire("pointerdown", blankPress(10, 10, true));
	h.viewport.fire("pointermove", blankPress(200, 200, true));
	h.viewport.fire("pointerup", blankPress(200, 200, true));

	assert.deepEqual(h.calls, ["selectMany()"]);
});

test("the band is skipped while the pan key is held, in either mode", () => {
	// The press belongs to the camera the moment the key goes down, whatever
	// else lands on it afterwards.
	for (const on of [true, false]) {
		const h = harness();
		h.dragToPan.on = on;
		h.canvas.holdPan(true);

		h.viewport.fire("pointerdown", blankPress(10, 10));
		h.viewport.fire("pointermove", blankPress(200, 200));
		h.viewport.fire("pointerup", blankPress(200, 200));

		assert.deepEqual(h.calls, [], on ? "with the drag mode on" : "with it off");
	}
});

test("with the drag mode off, shift and plain drags band alike", () => {
	// Off, blank canvas belongs to the band outright -- the modifier is not
	// part of the question, so a user reaching for Shift out of habit (the
	// gesture the box used to need) gets the same box rather than nothing.
	const h = harness();
	h.dragToPan.on = false;

	h.viewport.fire("pointerdown", blankPress(10, 10, true));
	h.viewport.fire("pointermove", blankPress(200, 200, true));
	h.viewport.fire("pointerup", blankPress(200, 200, true));

	assert.deepEqual(h.calls, ["selectMany()"]);
});

test("the click that follows a band does not undo what the band selected", () => {
	// The pointer was captured for the band, so the release's click retargets
	// to the viewport -- a press on nothing, which a plain click turns into
	// "clear the selection". Left unsuppressed it erased the box's work the
	// moment the box closed, which is why a band seemed to select nothing.
	const h = harness();
	h.dragToPan.on = false;

	h.viewport.fire("pointerdown", blankPress(10, 10));
	h.viewport.fire("pointermove", blankPress(200, 200));
	h.viewport.fire("pointerup", blankPress(200, 200));
	h.viewport.fire("click", {
		target: new FakeEl(),
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		preventDefault: () => {},
		stopPropagation: () => {},
	});

	assert.deepEqual(h.calls, ["selectMany()"]);
});

test("the band takes topic cards only: a swept code block does not join in", () => {
	// A body card in the selection would make every drop impossible -- the
	// group moves as nodes, and a block is not one -- so banding a card and
	// its code block together would have left the whole carry stuck. The band
	// records the topic and leaves the block out; the block follows its owner.
	const h = harness();
	h.dragToPan.on = false;
	h.viewport.all.push(
		cardAt("n2", { left: 100, top: 100, width: 120, height: 30 }),
		bodyAt("n2::0", { left: 100, top: 140, width: 120, height: 60 }),
	);

	h.viewport.fire("pointerdown", blankPress(10, 10));
	h.viewport.fire("pointermove", blankPress(300, 300));
	h.viewport.fire("pointerup", blankPress(300, 300));

	assert.deepEqual(h.calls, ["selectMany(n2)"]);
});

// --- dragging a block by its fold button ----------------------------------------

/**
 * A press on the fold button of a note-content card, as the viewport sees it:
 * the button is its own closest match for `.mm-add`, and the node it hangs
 * from is the block the press would pick up.
 */
function bodyButton(
	id: string,
	rect = { left: 300, top: 100, width: 120, height: 60 },
): { target: FakeEl; node: FakeEl } {
	const node = new FakeEl();
	node.dataset.id = id;
	node.dataset.kind = "body";
	node.dataset.side = "right";
	node.finds.set(".mm-card", new FakeEl(rect));
	node.finds.set(".mm-row", new FakeEl(rect));
	const button = new FakeEl();
	button.ancestors.set(".mm-add", button);
	// Both spellings, because the stub answers `closest` by the exact selector
	// string: the press reads the node by the plain one and the body question
	// by the qualified one.
	button.ancestors.set(".mm-node", node);
	button.ancestors.set('.mm-node[data-kind="body"]', node);
	return { target: button, node };
}

test("holding a block's fold button picks the block up", () => {
	const h = harness();
	const press = bodyButton("nb");
	h.viewport.all.push(press.node, cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }));
	h.under.el = null;

	h.viewport.fire("pointerdown", {
		button: 0,
		pointerId: 1,
		clientX: 290,
		clientY: 110,
		target: press.target,
		preventDefault: () => {},
		stopPropagation: () => {},
	});
	h.viewport.fire("pointermove", pointer(340, 120));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 340,
		clientY: 120,
		preventDefault: () => {},
	});

	// The block lands where the guide said; which slot is the drop
	// arithmetic's business. What this pins is that the button starts a body
	// drag and the release settles it as a move of the block.
	assert.equal(h.calls.length, 1, `one move, got ${h.calls.join("; ")}`);
	assert.ok(h.calls[0].startsWith("moveMany(nb,"), h.calls[0]);
});

test("a block's card surface is not a handle: only its button picks it up", () => {
	// Surface dragging read the block's shape, which is why some blocks
	// dragged and some did not; now none do, and the button is the one way.
	// A topic card sits under the release point so a drag that did start
	// would have somewhere to land -- and a call to show for it.
	const h = harness();
	const node = bodyAt("nb", { left: 300, top: 100, width: 120, height: 60 });
	const card = new FakeEl();
	card.ancestors.set(".mm-card", card);
	card.ancestors.set(".mm-node", node);
	card.ancestors.set('.mm-node[data-kind="body"]', node);
	// The box a lift reads as well, so that what this press is not -- a drag --
	// is told apart from what it is: a wait, which the movement above ends. See
	// the resting-press tests at the foot of this file.
	card.ancestors.set(".mm-card, .mm-preview, .mm-annotation", card);
	h.viewport.all.push(node, cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }));
	h.under.el = null;

	h.viewport.fire("pointerdown", {
		button: 0,
		pointerId: 1,
		clientX: 340,
		clientY: 120,
		target: card,
		preventDefault: () => {},
		stopPropagation: () => {},
	});
	h.viewport.fire("pointermove", pointer(500, 300));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 500,
		clientY: 300,
		preventDefault: () => {},
	});

	assert.deepEqual(h.calls, []);
});

test("a topic card's fold button folds, it never drags", () => {
	const h = harness();
	const button = addButton("n1");

	h.viewport.fire("pointerdown", {
		button: 0,
		pointerId: 1,
		clientX: 10,
		clientY: 10,
		target: button,
		preventDefault: () => {},
		stopPropagation: () => {},
	});
	h.viewport.fire("pointermove", pointer(200, 200));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 200,
		clientY: 200,
		preventDefault: () => {},
	});

	assert.deepEqual(h.calls, []);
});

// --- the card that points at another note -------------------------------------

/** One part of a link card, with the node around it as the map draws it. */
function linkPart(part: string, id = "n1"): FakeEl {
	const node = new FakeEl();
	node.dataset.id = id;
	const el = new FakeEl();
	el.ancestors.set(part, el);
	el.ancestors.set(".mm-node", node);
	return el;
}

test("the arrow opens the other note's outline, and nothing else", () => {
	const h = harness();
	clickOn(h, linkPart(".mm-link-arrow"), false);
	// One call, and it is the arrow's. A press that also picked the card would
	// leave the keyboard aimed at something the press did not ask for.
	assert.deepEqual(h.calls, ["toggleEmbed(n1)"]);
});

test("the footer's sentence follows the link", () => {
	const h = harness();
	clickOn(h, linkPart(".mm-link-open"), false);
	assert.deepEqual(h.calls, ["openLinkedNote(n1)"]);
});

test("the title line of a card that carries a preview is the switch", () => {
	const h = harness();
	// `.mm-opens-preview` is what the builder puts on the line, and it is what
	// says there is a block under it to open.
	clickOn(h, linkPart(".mm-card.mm-opens-preview"), false);
	// Both, and in this order: the block first, because a press that opened it
	// and then handed the keyboard somewhere else would leave the card picked
	// but the press unexplained. Picking is what a press on a card means
	// everywhere else in this map, and the block leaves the line as the only
	// place left to do it.
	assert.deepEqual(h.calls, ["toggleCardPreview(n1)", "select(n1,false)"]);
});

test("the line is the switch whether the block is open or shut", () => {
	// The same selector and the same call in both states: a line that stopped
	// being the switch once it had been pressed would be a card that opens and
	// never closes.
	const h = harness();
	clickOn(h, linkPart(".mm-card.mm-opens-preview"), false);
	clickOn(h, linkPart(".mm-card.mm-opens-preview"), false);
	assert.deepEqual(h.calls, [
		"toggleCardPreview(n1)",
		"select(n1,false)",
		"toggleCardPreview(n1)",
		"select(n1,false)",
	]);
});

/**
 * A press on the words of a card's own title line.
 *
 * The words of a link are a `span` with its target in `data-href`, and where
 * they sit is what decides what a press on them means. On the line of a card
 * that *is* one link they are that link, written on the line that switches it --
 * so the two gestures land on the same pixels, and the words win: pressing a
 * label is asking for what it names. On a card of the note's own prose they are
 * that card's links, one of three perhaps, and pressing one is asking for that
 * one.
 *
 * `one` says which kind of card this is, and `body` whether it is a
 * note-content card -- the one place the prose rule applies at all, since a
 * title is a node's own line.
 */
function titleLink(one: boolean, body = false): FakeEl {
	const el = new FakeEl();
	el.dataset.href = "外部链接";
	const line = new FakeEl();
	line.classes.add("mm-card");
	line.classes.add("mm-opens-preview");
	if (one) line.classes.add("mm-one-link");
	const node = new FakeEl();
	node.dataset.id = "n1";

	el.ancestors.set(".mm-link[data-href], .mm-embed[data-href], .mm-media[data-href]", el);
	el.ancestors.set(".mm-card.mm-opens-preview", line);
	el.ancestors.set(".mm-node", node);
	// The line is where the card under the press is read off, so it carries
	// the node as its ancestor too: two lookups, one element each. A link card
	// answers to both selectors, because both classes are on the one element.
	if (one) el.ancestors.set(".mm-card.mm-one-link", line);
	line.ancestors.set(".mm-node", node);
	// An element is its own ancestor in a real `closest`, and the line is what
	// the switch rule reads off, so it has to answer for itself.
	line.ancestors.set(".mm-card.mm-opens-preview", line);
	if (one) line.ancestors.set(".mm-card.mm-one-link", line);
	if (body) el.ancestors.set('.mm-node[data-kind="body"], .mm-annotation, .mm-preview', node);
	return el;
}

test("the words on a card that is one link are the line's switch, not a link to follow", () => {
	const h = harness();
	clickOn(h, titleLink(true), false);
	// Both, and not `openLink`: the link on that line is the card, so showing
	// it is showing what the card already shows, and a press that answered
	// with the same note would be a press that folded nothing away.
	assert.deepEqual(h.calls, ["toggleCardPreview(n1)", "select(n1,false)"]);
});

test("a note-content card is no different: the same press on its one link is the switch", () => {
	const h = harness();
	// A body card whose whole text is a link draws the same line, and the rule
	// for links in prose would otherwise take the press first -- which is
	// exactly what left the block on screen and the card's own words unable to
	// put it away.
	clickOn(h, titleLink(true, true), false);
	assert.deepEqual(h.calls, ["toggleCardPreview(n1)", "select(n1,false)"]);
});

test("the rest of that line is still the switch", () => {
	const h = harness();
	// No `LINK_TARGET` under the press: the gap between the words and the arrow,
	// and the card's own padding, which is where a reader aims to put the block
	// away -- and the reason the block needs no other way out.
	const el = titleLink(true);
	const line = el.ancestors.get(".mm-card.mm-opens-preview");
	assert.ok(line);
	clickOn(h, line, false);
	assert.deepEqual(h.calls, ["toggleCardPreview(n1)", "select(n1,false)"]);
});

test("Ctrl/Cmd on those same words still leaves the map for the note", () => {
	const h = harness();
	// The way to the note itself, and it is not the switch: `openLink` is what
	// reads the modifier, and it opens the target rather than showing it.
	clickOn(h, titleLink(true, true), true);
	assert.equal(h.calls.length, 1);
	assert.match(h.calls[0], /^openLink\(外部链接,/);
	// On a link *node* the same press is the map's own "show me where this is
	// written", because a title there is that node's line and the press is on
	// the card: unchanged, and covered with the rest of that rule.
});

test("the words on a card of prose keep their own meaning", () => {
	const h = harness();
	clickOn(h, titleLink(false, true), false);
	// Three links on one line have no single thing a press there could switch,
	// so the line's press is the line's and a link's press is the link's. A
	// press on one of them shows that one.
	assert.equal(h.calls.length, 1);
	assert.match(h.calls[0], /^openLink\(外部链接,/);
});

/**
 * A tag on a card. `onLinkCard` puts it on a title line that also opens a
 * preview, which is the case the routing has to get right: the tag has to win
 * over the line, or a press on it would filter the map *and* shut the block.
 */
function tagBadge(tag: string, onLinkCard = false): FakeEl {
	const el = new FakeEl();
	el.dataset.tag = tag;
	el.ancestors.set(".mm-tag", el);
	if (onLinkCard) {
		const line = new FakeEl();
		line.classes.add("mm-card");
		line.classes.add("mm-opens-preview");
		line.classes.add("mm-one-link");
		const node = new FakeEl();
		node.dataset.id = "n1";
		el.ancestors.set(".mm-card.mm-opens-preview", line);
		line.ancestors.set(".mm-node", node);
		el.ancestors.set(".mm-node", node);
	}
	return el;
}

test("a tag is a filter, not a piece of text to select", () => {
	const h = harness();
	clickOn(h, tagBadge("工作"), false);
	assert.deepEqual(h.calls, ["toggleTagFilter(工作,false)"]);
});

test("Ctrl/Cmd on a tag narrows the filter rather than replacing it", () => {
	const h = harness();
	clickOn(h, tagBadge("urgent"), true);
	// The one press on a card that means "add to what I am looking at": two
	// tags keep every card carrying either, which is what narrowing means.
	assert.deepEqual(h.calls, ["toggleTagFilter(urgent,true)"]);
});

test("a tag on a link card's title line is the tag's, not the line's", () => {
	const h = harness();
	clickOn(h, tagBadge("工作", true), false);
	// Neither `toggleCardPreview` nor `select`: the line is a switch and the
	// tag is not it, exactly as the arrow beside it is not.
	assert.deepEqual(h.calls, ["toggleTagFilter(工作,false)"]);
});

test("Escape puts a filter away when there is no search to close", () => {
	const h = harness();
	// The proxy's `closeSearch` is a recorded call returning undefined, which
	// reads as false: the branch has to fall through to the filter rather than
	// swallow the key.
	h.press(keyEvent("Escape"));
	assert.deepEqual(h.calls, ["closeSearch()", "clearFilter()"]);
});

test("a press inside the block below does not shut it", () => {
	const h = harness();
	clickOn(h, linkPart(".mm-preview"), false);
	// The block is another note's words: a press in there is a press on text,
	// and the way out of the block is the line above it.
	assert.deepEqual(h.calls, ["select(n1,false)"]);
});

test("the button on the line is still its own, and not the line's too", () => {
	const h = harness();
	const arrow = linkPart(".mm-link-arrow");
	arrow.ancestors.set(".mm-card.mm-opens-preview", arrow);
	clickOn(h, arrow, false);
	// One call. A press on the arrow that also opened and closed the block
	// would be two gestures for one press.
	assert.deepEqual(h.calls, ["toggleEmbed(n1)"]);
});

test("a plain press on a card picks it and opens nothing", () => {
	const h = harness();
	clickOn(h, linkPart(".mm-card"), false);
	// The card used to be the switch as well, so picking one up to move it -- or
	// the first press of the double-click that renames it -- shut whatever it
	// was showing. Picking a card has to mean one thing here, because it means
	// that on every other card in the map.
	assert.deepEqual(h.calls, ["select(n1,false)"]);
});

test("the first press of the double-click that renames a card closes nothing", () => {
	const h = harness();
	clickOn(h, linkPart(".mm-card"), false, 1);
	clickOn(h, linkPart(".mm-card"), false, 2);
	// Both presses only pick. Renaming a card is not a reason for the note it
	// points at to shut, and the press that opens the field is the first one.
	assert.deepEqual(h.calls, ["select(n1,false)", "select(n1,false)"]);
});

test("a modified press picks the card without opening either block", () => {
	const h = harness();
	clickOn(h, linkPart(".mm-card"), true);
	// Ctrl/Cmd is already spoken for on a card -- it is the note-to-map round
	// trip -- so the card's own open is not offered to that press.
	assert.ok(!h.calls.some((call) => call.startsWith("toggleCardPreview(")), h.calls.join("; "));
	assert.ok(!h.calls.some((call) => call.startsWith("toggleEmbed(")));
});

test("the arrow is a control, not a handle", () => {
	const h = harness();
	const arrow = linkPart(".mm-link-arrow");
	h.viewport.all.push(cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }));
	h.under.el = null;

	h.viewport.fire("pointerdown", {
		button: 0,
		pointerId: 1,
		clientX: 10,
		clientY: 10,
		target: arrow,
		preventDefault: () => {},
		stopPropagation: () => {},
	});
	h.viewport.fire("pointermove", pointer(340, 110));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 340,
		clientY: 110,
		preventDefault: () => {},
	});

	// A press that drifted a few pixels is a press on the arrow, not the start
	// of a drag that would carry the card away instead.
	assert.deepEqual(h.calls, []);
});

test("the link card's button is a control, not a handle", () => {
	const h = harness();
	// The selector is the one the module asks, so it has to be in the test for
	// the test to mean anything.
	const button = linkPart(".mm-link-tools");
	h.viewport.all.push(cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }));
	h.under.el = null;

	h.viewport.fire("pointerdown", {
		button: 0,
		pointerId: 1,
		clientX: 10,
		clientY: 10,
		target: button,
		preventDefault: () => {},
		stopPropagation: () => {},
	});
	h.viewport.fire("pointermove", pointer(340, 110));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 340,
		clientY: 110,
		preventDefault: () => {},
	});

	// A press that drifted a few pixels is a press on the switch, not the start
	// of a drag -- and the collapse in particular sits on the body of a card
	// that is mostly preview, which is where a drag would be aimed.
	assert.deepEqual(h.calls, []);
});

test("a projected card does not lift, because nothing can be moved to it", () => {
	const h = harness();
	const node = new FakeEl();
	const card = new FakeEl();
	card.ancestors.set(".mm-card", card);
	card.ancestors.set(".mm-node", node);
	card.ancestors.set(".mm-node.is-projected", node);
	h.viewport.all.push(cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }));
	h.under.el = null;

	h.viewport.fire("pointerdown", {
		button: 0,
		pointerId: 1,
		clientX: 10,
		clientY: 10,
		target: card,
		preventDefault: () => {},
		stopPropagation: () => {},
	});
	h.viewport.fire("pointermove", pointer(340, 110));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 340,
		clientY: 110,
		preventDefault: () => {},
	});

	// It is another note's card. Every slot would refuse it, so it stays put
	// rather than lifting and then disagreeing with the guide.
	assert.deepEqual(h.calls, []);
});

// --- the press that rests on a block ------------------------------------------

/**
 * A press on a note-content card's own surface, at one of the boxes a lift may
 * be aimed at: the title's card, the preview of another note drawn under it, or
 * the annotation strip.
 *
 * All of them answer every selector at once on purpose -- the box the lift
 * reads, the card the drag reads, and the node the map looks up by id -- because
 * in the map they are one element, and a stub that answered only one of them
 * would let the two readings of a press disagree about what the press landed on.
 *
 * The id is the harness's own, so `nodeElement` finds the node the copy is
 * cloned from: a copy is made out of the card, and a test that could not reach
 * the card could not see the copy either.
 */
function bodySurface(id = "n1"): FakeEl {
	const node = new FakeEl();
	node.dataset.id = id;
	const box = new FakeEl();
	// The three boxes in one entry, because that is how the module asks for
	// them: `.mm-card, .mm-preview, .mm-annotation` is the one selector a lift
	// reads a surface through, and a stub that answered them one at a time
	// would be answering a question the module never puts.
	box.ancestors.set(".mm-card, .mm-preview, .mm-annotation", box);
	box.ancestors.set(".mm-node", node);
	box.ancestors.set('.mm-node[data-kind="body"]', node);
	return box;
}

/** A press on one element, held down until the test says otherwise. */
function liftPress(target: FakeEl, x = 40, y = 40): Record<string, unknown> {
	return {
		button: 0,
		pointerId: 1,
		clientX: x,
		clientY: y,
		target,
		preventDefault: () => {},
		stopPropagation: () => {},
	};
}

/** The release that ends a press, at the point it stopped. */
function liftRelease(x: number, y: number): Record<string, unknown> {
	return {
		pointerId: 1,
		clientX: x,
		clientY: y,
		preventDefault: () => {},
		stopPropagation: () => {},
	};
}

test("a press that rests on a block lifts the block itself", () => {
	const h = harness();
	h.viewport.all.push(cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }));
	h.under.el = null;

	h.viewport.fire("pointerdown", liftPress(bodySurface()));
	// The wait is shown on the card it is on, and nothing has moved: what the
	// card is saying is that this press is still being read.
	assert.equal(h.node.classes.has("is-lifting"), true);
	assert.equal(h.timers.count(), 1);
	assert.deepEqual(h.calls, []);

	h.timers.fire();
	// The state the drag has always produced, entered without the pointer
	// having gone anywhere: the card it came from goes flat, and a copy of it
	// is in the pointer's hand.
	assert.equal(h.node.classes.has("is-lifting"), false, "the wait's outline goes with the wait");
	assert.equal(h.node.classes.has("is-dragging"), true);

	const ghost = h.bodies[0];
	assert.ok(ghost?.classes.has("mm-drag-ghost"), "no copy was built");
	assert.equal(ghost.style.left, "40px", "the copy is at the pointer before it has moved");
	assert.equal(ghost.style.top, "40px");
});

test("a lifted block lands where it is dropped", () => {
	const h = harness();
	h.viewport.all.push(cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }));
	h.under.el = null;

	h.viewport.fire("pointerdown", liftPress(bodySurface()));
	h.timers.fire();
	// The pointer goes somewhere a card is, and the block lands on it: the same
	// arithmetic, and the same call, a branch drag makes.
	h.viewport.fire("pointermove", liftPress(h.row, 320, 110));
	h.viewport.fire("pointerup", liftRelease(320, 110));

	assert.equal(h.calls.length, 1, `one move, got ${h.calls.join("; ")}`);
	assert.ok(h.calls[0].startsWith("moveMany(n1,"), h.calls[0]);
});

test("a press that moves on a block's surface is not a lift", () => {
	const h = harness();
	h.viewport.all.push(cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }));
	h.under.el = null;

	h.viewport.fire("pointerdown", liftPress(bodySurface()));
	// Away it goes before the second is up: the movement is the user's answer
	// to what the press meant, and it is not "pick this up".
	h.viewport.fire("pointermove", pointer(340, 110));
	h.timers.fire();
	h.viewport.fire("pointerup", liftRelease(340, 110));

	assert.equal(h.node.classes.has("is-lifting"), false, "the wait was taken off the card");
	assert.equal(h.node.classes.has("is-dragging"), false);
	assert.deepEqual(h.calls, [], "and nothing was moved");
	assert.deepEqual(h.bodies, [], "nor was a copy built");
});

test("the release that ends a lift is not also a click", () => {
	const h = harness();
	h.viewport.fire("pointerdown", liftPress(bodySurface()));
	h.timers.fire();
	h.viewport.fire("pointerup", liftRelease(40, 40));

	// The press already meant something. Selecting the card as well would be a
	// second answer to the one press, and the card is not where the user is
	// looking -- the copy under their pointer is.
	h.viewport.fire("click", {
		target: bodySurface(),
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		preventDefault: () => {},
		stopPropagation: () => {},
	});
	assert.deepEqual(h.calls, []);
});

test("a topic card's title is the drag's handle, not the lift's", () => {
	const h = harness();
	// A press on the title of a card that is not note content is the ordinary
	// press-and-move drag, so no second reading of it is armed -- and there is
	// nothing for a lift to carry either.
	const card = new FakeEl();
	card.ancestors.set(".mm-card, .mm-preview, .mm-annotation", card);
	h.viewport.fire("pointerdown", liftPress(card));

	assert.equal(h.timers.count(), 0);
});

test("a body card's controls are not the lift's press", () => {
	const h = harness();
	// The three selectors the module asks, in the order it asks them: the fold
	// button and the checkbox on the branch side, a picture's own two circles
	// and a sample's copy button, and a video, which is a player once it plays.
	const controls = [
		".mm-tools, .mm-checkbox, .mm-link-tools",
		".mm-media-button, .mm-code-copy",
		".mm-media-video.is-playing",
	];
	for (const control of controls) {
		const target = new FakeEl();
		target.ancestors.set(control, target);
		h.viewport.fire("pointerdown", liftPress(target));
	}

	assert.equal(h.timers.count(), 0, "no wait was armed on any of them");
});
