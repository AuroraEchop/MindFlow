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
	 * be testing the selector engine rather than the drag.
	 */
	readonly all: FakeEl[] = [];

	querySelectorAll(selector: string): FakeEl[] {
		return selector === ".mm-node" ? this.all : [];
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
	focus(): void {}
}

/** Everything the module reaches for on `document` / `window` / globals. */
function installDom(): { bodies: FakeEl[]; under: { el: FakeEl | null } } {
	const bodies: FakeEl[] = [];
	const under: { el: FakeEl | null } = { el: null };

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
	return { bodies, under };
}

function harness(): {
	viewport: FakeEl;
	/** The dragged node's row: what the copy is cloned from and sized by. */
	row: FakeEl;
	under: { el: FakeEl | null };
	bodies: FakeEl[];
	calls: string[];
	/** Slots this map refuses, written `"targetId:mode"`. */
	refuses: string[];
	/** Which card each body card belongs to, by body id. */
	bodyOwners: Map<string, string>;
	press: (ev: Record<string, unknown>) => void;
} {
	const dom = installDom();
	const calls: string[] = [];
	const refuses: string[] = [];
	const bodyOwners = new Map<string, string>();

	const viewport = new FakeEl();
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

	const controller = new Proxy(
		{},
		{
			get: (_target, prop: string) => {
				if (prop === "canvas") return { viewport };
				if (prop === "bindings") return () => resolveBindings(undefined);
				if (prop === "isEditing") return () => false;
				if (prop === "selectedId") return () => "n1";
				// A slot this map refuses, written "targetId:mode"; anything else
				// is allowed.
				if (prop === "canDrop") return (_id: string, targetId: string, mode: string) =>
					!refuses.includes(`${targetId}:${mode}`);
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
		under: dom.under,
		bodies: dom.bodies,
		calls,
		refuses,
		bodyOwners,
		press: (ev) => viewport.fire("keydown", ev),
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
): FakeEl {
	const node = new FakeEl();
	node.dataset.id = id;
	node.finds.set(".mm-card", new FakeEl(rect));
	node.finds.set(".mm-row", new FakeEl(rowRect));
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
	assert.deepEqual(h.calls, ["move(n1,n2,after)"]);
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

	assert.deepEqual(h.calls, ["move(n1,n2,child)"]);
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

	assert.deepEqual(h.calls, ["move(n1,n2,after)"]);
});

test("a card that refuses the slot still takes the node inside it", () => {
	// Reordering is refused on a first-level branch, and the card used to go
	// dead along the whole band above and below it: aiming there found nothing
	// at all, and the drag would not stick. The card keeps its place in the
	// running and takes the node inside it instead.
	const h = harness();
	h.viewport.all.push(cardAt("n2", { left: 300, top: 100, width: 120, height: 30 }));
	h.under.el = null;
	// A first-level branch will not take a sibling.
	h.refuses.push("n2:after");

	h.viewport.fire("pointerdown", pointer(10, 10));
	h.viewport.fire("pointermove", pointer(360, 145));
	h.viewport.fire("pointerup", {
		pointerId: 1,
		clientX: 360,
		clientY: 145,
		preventDefault: () => {},
	});

	assert.deepEqual(h.calls, ["move(n1,n2,child)"]);
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

	assert.deepEqual(h.calls, ["move(n1,n2,child)"]);
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

	assert.deepEqual(h.calls, ["move(n1,n2,child)"]);
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

	assert.deepEqual(h.calls, ["move(n1,n3,after)"]);
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

	assert.deepEqual(h.calls, ["move(n1,n2,child)"]);
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

	assert.deepEqual(h.calls, ["move(n1,n2,after)"]);
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

	assert.deepEqual(h.calls, ["move(n1,n2,child)"]);
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
	assert.deepEqual(h.calls, ["move(n1,n2,after)"]);
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
