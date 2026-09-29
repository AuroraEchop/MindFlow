import { test } from "node:test";
import assert from "node:assert/strict";

import { attachLiftPress, LIFT_HOLD, LIFT_SLOP } from "./liftPress.ts";
import type { Lift } from "./liftPress.ts";

/**
 * The gesture, with time under the test's hand.
 *
 * Nothing here is about cards or maps: the module is handed a viewport, a way
 * to tell which presses it may take, and three things to say. So the stub is a
 * listener list and a clock, and every test is one press told four ways -- it
 * waited, it moved, it came up, or it was never the gesture's to begin with.
 */

type Handler = (ev: Record<string, unknown>) => void;

/** Enough of an element for a listener and a target. */
class FakeEl {
	private readonly listeners = new Map<string, Handler[]>();

	addEventListener(type: string, handler: Handler): void {
		const list = this.listeners.get(type) ?? [];
		list.push(handler);
		this.listeners.set(type, list);
	}

	removeEventListener(type: string, handler: Handler): void {
		const list = this.listeners.get(type);
		if (list === undefined) return;
		const at = list.indexOf(handler);
		if (at >= 0) list.splice(at, 1);
	}

	fire(type: string, ev: Record<string, unknown>): void {
		// Copied, because a handler is allowed to take itself off -- the
		// detach below does exactly that.
		for (const handler of [...(this.listeners.get(type) ?? [])]) handler(ev);
	}
}

/**
 * The clock, as a queue the test drains.
 *
 * `fire` empties the queue before it runs anything, so a handler that arms
 * another timer cannot make the same pass run it too -- which is what a real
 * clock would not do either.
 */
function installClock(): { count(): number; fire(): void } {
	const pending = new Map<number, () => void>();
	let next = 1;
	const g = globalThis as unknown as Record<string, unknown>;
	g.window = {
		setTimeout: (cb: () => void): number => {
			const id = next++;
			pending.set(id, cb);
			return id;
		},
		clearTimeout: (id: number): void => {
			pending.delete(id);
		},
	};
	return {
		count: () => pending.size,
		fire: () => {
			const due = [...pending.values()];
			pending.clear();
			for (const cb of due) cb();
		},
	};
}

function harness(): {
	viewport: FakeEl;
	card: FakeEl;
	/** What the handlers were told, in order. */
	lines: string[];
	lifts: Lift[];
	/** What `liftable` answers -- null is "this press is not mine". */
	answer: { id: string | null };
	clock: { count(): number; fire(): void };
	detach: () => void;
	down: (x: number, y: number, pointer?: number) => void;
	move: (x: number, y: number, pointer?: number) => void;
	up: (pointer?: number) => void;
} {
	const clock = installClock();
	const g = globalThis as unknown as Record<string, unknown>;
	// The module tells a card from a text node with `instanceof HTMLElement`.
	g.HTMLElement = FakeEl;

	const viewport = new FakeEl();
	const card = new FakeEl();
	const lines: string[] = [];
	const lifts: Lift[] = [];
	const answer: { id: string | null } = { id: "n1" };

	const detach = attachLiftPress(viewport as unknown as HTMLElement, {
		liftable: (target) => ((target as unknown) === card ? answer.id : null),
		waiting: (id) => lines.push(`waiting ${id}`),
		released: (id) => lines.push(`released ${id}`),
		lifted: (lift) => {
			lines.push(`lifted ${lift.id} ${lift.x},${lift.y} p${lift.pointer}`);
			lifts.push(lift);
		},
	});

	const at = (x: number, y: number, pointer: number): Record<string, unknown> => ({
		button: 0,
		clientX: x,
		clientY: y,
		pointerId: pointer,
		target: card,
	});

	return {
		viewport,
		card,
		lines,
		lifts,
		answer,
		clock,
		detach,
		down: (x, y, pointer = 1) => viewport.fire("pointerdown", at(x, y, pointer)),
		move: (x, y, pointer = 1) => viewport.fire("pointermove", at(x, y, pointer)),
		up: (pointer = 1) => viewport.fire("pointerup", at(0, 0, pointer)),
	};
}

test("a press that rests comes up where it was pressed", () => {
	const h = harness();
	h.down(40, 30);

	assert.deepEqual(h.lines, ["waiting n1"], "the wait is shown at once");
	assert.equal(h.clock.count(), 1, "and one clock is all it takes");

	h.clock.fire();
	assert.deepEqual(h.lines, ["waiting n1", "lifted n1 40,30 p1"]);
	assert.equal(h.lifts.length, 1);
	// The pointer goes with it: the drag has to capture the one that is down.
	assert.equal(h.lifts[0].pointer, 1);
});

test("a tremor is still a resting press", () => {
	const h = harness();
	h.down(40, 30);
	h.move(40 + LIFT_SLOP - 1, 30);

	assert.deepEqual(h.lines, ["waiting n1"], "the wait survives it");

	h.clock.fire();
	assert.equal(h.lifts.length, 1);
});

test("a press that moves is over before it lifts", () => {
	const h = harness();
	h.down(40, 30);
	h.move(40 + LIFT_SLOP + 10, 30);

	assert.deepEqual(h.lines, ["waiting n1", "released n1"]);
	assert.equal(h.clock.count(), 0, "and the clock is not left running");

	// The timer that would have lifted it is gone, so nothing arrives late.
	h.clock.fire();
	assert.equal(h.lifts.length, 0);
});

test("a press that comes up is a click, not a lift", () => {
	const h = harness();
	h.down(40, 30);
	h.up();

	assert.deepEqual(h.lines, ["waiting n1", "released n1"]);

	h.clock.fire();
	assert.equal(h.lifts.length, 0);
});

test("a press the map will not move is never waited on", () => {
	const h = harness();
	h.answer.id = null;
	h.down(40, 30);

	assert.deepEqual(h.lines, [], "nothing is shown for a press that is not the gesture's");
	assert.equal(h.clock.count(), 0);

	h.clock.fire();
	assert.equal(h.lifts.length, 0);
});

test("a second press while one rests does not arm a second wait", () => {
	const h = harness();
	h.down(40, 30);
	h.down(40, 30);

	assert.deepEqual(h.lines, ["waiting n1"], "the card is already waiting");
	assert.equal(h.clock.count(), 1);

	h.clock.fire();
	assert.equal(h.lifts.length, 1, "and it comes up once");
});

test("a press from another pointer is not this press", () => {
	const h = harness();
	h.down(40, 30, 1);
	h.move(400, 300, 2);
	h.up(2);

	assert.deepEqual(h.lines, ["waiting n1"], "a second finger is not a movement");

	h.clock.fire();
	assert.equal(h.lifts.length, 1, "and the first press still lifts");
});

test("the hold is the half second the module promises", () => {
	// Read off the exported constant rather than written down twice: the
	// stylesheet's countdown is the one place this number is duplicated.
	assert.equal(LIFT_HOLD, 500);
});

test("detaching drops the listeners and the wait with them", () => {
	const h = harness();
	h.down(40, 30);
	h.detach();

	assert.deepEqual(h.lines, ["waiting n1", "released n1"], "the wait is answered for");

	h.down(40, 30);
	h.clock.fire();
	assert.equal(h.lifts.length, 0, "and nothing listens any more");
});
