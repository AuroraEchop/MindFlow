/**
 * The press that becomes a lift: hold still on a card, and half a second later
 * it comes up off the map and follows the pointer.
 *
 * A note-content card is the one card in this map with no handle of its own.
 * Its text belongs to the note, so a press there is selection and a double
 * press is editing -- which is why the block's only way of moving has always
 * been the small button on the card's edge. That button is exactly the handle a
 * large card, the card most worth moving, makes hardest to find: a listing
 * forty lines long is mostly surface, and the surface is spoken for.
 *
 * What is left is time. A press that nothing else has claimed -- one the
 * pointer neither uses to select text nor to turn into a drag of its own -- can
 * mean "pick this up", and the half second it takes to say so is the whole of
 * the gesture. Long enough that no click is ever mistaken for one, short enough
 * that a press meant as a drag is not a wait first.
 *
 * This module owns the reading of the press and nothing else. What a lift *is*
 * -- the copy that follows the pointer, the dashed slot left in the tree, the
 * drop that settles it -- belongs to the drag, and lives with the drag in
 * `interactions.ts`. Here there are only the three ways a press can end: it
 * waited, it moved, or it came up.
 *
 * The wait is measured with `window.setTimeout` and dropped with
 * `window.clearTimeout`, so a host that drives time -- the tests do -- can end
 * it without waiting for it.
 */

/**
 * How long the pointer must rest before the press is read as a lift, in ms.
 *
 * Half a second, and `styles.css` has the number too: the outline a waiting
 * card wears fills over exactly this long, so the two have to agree.
 */
export const LIFT_HOLD = 500;

/**
 * How far the pointer may drift and still be the same resting press.
 *
 * Not zero, because a hand on a mouse button is never perfectly still, and a
 * wait that a tremor cancels is a wait that never finishes. Small, because the
 * thing being told apart from a lift is a text selection, and that begins with
 * the first deliberate movement.
 */
export const LIFT_SLOP = 5;

/** A press that has waited: which card, which pointer, and where on screen. */
export interface Lift {
	id: string;
	pointer: number;
	x: number;
	y: number;
}

/**
 * What the map has to answer for while a press is resting on a card.
 *
 * `liftable` is the whole of the policy: which presses the gesture may take at
 * all. Everything else is either a fact about time -- `waiting`, `released`,
 * `lifted` -- or the caller's own business. A control, a card that cannot move,
 * a map in the middle of an edit: all of them say so by answering null, and the
 * module then treats the press as though it had never seen it.
 */
export interface LiftHandlers {
	/** The card this press may lift, or null to leave the press alone. */
	liftable(target: HTMLElement): string | null;
	/** The wait has begun on this card: show that something is coming. */
	waiting(id: string): void;
	/** The wait ended with the pointer still down: bring the card up. */
	lifted(lift: Lift): void;
	/** The press moved on or came up before the wait was over. */
	released(id: string): void;
}

/**
 * Watch `viewport` for presses that rest long enough to be a lift.
 *
 * Returns the function that takes the listeners off again, which is what the
 * view calls when it unloads -- the same shape `attachInteractions` has, and
 * for the same reason.
 */
export function attachLiftPress(viewport: HTMLElement, handlers: LiftHandlers): () => void {
	/**
	 * The one press being watched, or null.
	 *
	 * One at a time, deliberately. A second press arriving while the first is
	 * still resting is not a second lift -- it is the same card under the same
	 * hand -- and two timers would bring the same card up twice.
	 */
	let armed: { id: string; pointer: number; x: number; y: number; timer: number } | null = null;

	/** End the wait and answer which card it was on, if there was one. */
	const disarm = (): string | null => {
		if (armed === null) return null;
		const id = armed.id;
		window.clearTimeout(armed.timer);
		armed = null;
		return id;
	};

	const onDown = (ev: PointerEvent): void => {
		if (ev.button !== 0 || armed !== null) return;
		const target = ev.target;
		if (!(target instanceof HTMLElement)) return;
		const id = handlers.liftable(target);
		if (id === null) return;

		const x = ev.clientX;
		const y = ev.clientY;
		const timer = window.setTimeout(() => {
			// Whatever the timer was armed for is what it lifts: a press that
			// has already been disarmed has been answered for by `released`,
			// and the timeout that arrives afterwards is the one that was
			// cleared a moment too late.
			if (armed === null || armed.timer !== timer) return;
			armed = null;
			handlers.lifted({ id, pointer: ev.pointerId, x, y });
		}, LIFT_HOLD);

		armed = { id, pointer: ev.pointerId, x, y, timer };
		handlers.waiting(id);
	};

	const onMove = (ev: PointerEvent): void => {
		if (armed === null || ev.pointerId !== armed.pointer) return;
		if (Math.hypot(ev.clientX - armed.x, ev.clientY - armed.y) < LIFT_SLOP) return;
		const id = disarm();
		if (id !== null) handlers.released(id);
	};

	const onEnd = (ev: PointerEvent): void => {
		if (armed === null || ev.pointerId !== armed.pointer) return;
		const id = disarm();
		if (id !== null) handlers.released(id);
	};

	viewport.addEventListener("pointerdown", onDown);
	viewport.addEventListener("pointermove", onMove);
	viewport.addEventListener("pointerup", onEnd);
	viewport.addEventListener("pointercancel", onEnd);

	return () => {
		// A wait still running when the view unloads is answered for like any
		// other that ends without a lift: whatever was showing the wait has to
		// be told, or the card keeps the look of a press that is over.
		const id = disarm();
		if (id !== null) handlers.released(id);
		viewport.removeEventListener("pointerdown", onDown);
		viewport.removeEventListener("pointermove", onMove);
		viewport.removeEventListener("pointerup", onEnd);
		viewport.removeEventListener("pointercancel", onEnd);
	};
}
