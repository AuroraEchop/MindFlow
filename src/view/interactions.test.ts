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
	// The module asks `instanceof HTMLElement` to tell a card from a text node,
	// so the stub has to be what it checks against.
	g.HTMLElement = FakeEl;
	g.getComputedStyle = () => ({ getPropertyValue: () => "" });
	return { bodies, under };
}

function harness(): {
	viewport: FakeEl;
	under: { el: FakeEl | null };
	bodies: FakeEl[];
	calls: string[];
	press: (ev: Record<string, unknown>) => void;
} {
	const dom = installDom();
	const calls: string[] = [];

	const viewport = new FakeEl();
	// The dragged node and its card, which the drag looks up by id.
	const card = new FakeEl({ left: 0, top: 0, width: 120, height: 30 });
	const node = new FakeEl();
	node.dataset.id = "n1";
	node.finds.set(".mm-card", card);
	viewport.querySelector = (selector: string) =>
		selector.includes("n1") ? node : null;

	const controller = new Proxy(
		{},
		{
			get: (_target, prop: string) => {
				if (prop === "canvas") return { viewport };
				if (prop === "bindings") return () => resolveBindings(undefined);
				if (prop === "isEditing") return () => false;
				if (prop === "selectedId") return () => "n1";
				if (prop === "canDrop") return () => true;
				return (...args: unknown[]) => {
					calls.push(`${String(prop)}(${args.join(",")})`);
				};
			},
		},
	) as unknown as MapController;

	attachInteractions(controller);
	return {
		viewport,
		under: dom.under,
		bodies: dom.bodies,
		calls,
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
	assert.equal(ghost.classes.has("is-snapped"), false);
});

test("the copy settles onto the card it is over, and says so", () => {
	const h = harness();
	const target = new FakeEl({ left: 300, top: 200, width: 120, height: 30 });
	target.dataset.id = "n2";
	// `resolveDrop` finds the node by asking what the point is inside of.
	target.ancestors.set(".mm-node", target);
	target.finds.set(".mm-card", new FakeEl({ left: 300, top: 200, width: 120, height: 30 }));
	h.under.el = target;

	h.viewport.fire("pointerdown", pointer(10, 10));
	h.viewport.fire("pointermove", pointer(340, 215));

	const ghost = h.bodies[0];
	assert.ok(
		ghost.classes.has("is-snapped"),
		`settled onto a drop the map accepts; classes: ${[...ghost.classes].join("|")}`,
	);
	// Centre of the target's card, which is what a `child` drop lands beside.
	assert.equal(ghost.style.top, "215px");
	assert.ok(Number.parseFloat(ghost.style.left) > 420);
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

// --- the keyboard -----------------------------------------------------------------

test("Ctrl+Enter reaches the text block action", () => {
	const h = harness();
	h.press({
		key: "Enter",
		ctrlKey: true,
		metaKey: false,
		shiftKey: false,
		altKey: false,
		preventDefault: () => {},
		stopPropagation: () => {},
	});
	assert.deepEqual(h.calls, ["addBlock(n1)"]);
});
