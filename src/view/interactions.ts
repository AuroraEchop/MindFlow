import type { Canvas } from "./canvas.ts";
import { CARD_STYLE_CLASSES } from "./cardStyle.ts";
import { edgePath } from "./edges.ts";
import type { EdgeStyle } from "./edges.ts";
import { comboFromEvent, resolveAction } from "./shortcuts.ts";
import type { ShortcutBindings } from "./shortcuts.ts";

export type Direction = "up" | "down" | "left" | "right";

/**
 * Where a dragged node lands relative to the card it was dropped on: inside it
 * as a child, or beside it as a sibling above or below.
 */
export type DropMode = "child" | "before" | "after";

/**
 * A place the dragged card could land.
 *
 * A place in the tree, never a pixel: where the card comes to rest is the
 * layout's business, worked out from the tree once the move is applied, and the
 * map stays regularly spaced whatever the pointer did.
 */
interface DropSlot {
	targetId: string;
	mode: DropMode;
}

/** A card's box in screen space, as a drag measures it. */
interface CardBox {
	id: string;
	left: number;
	right: number;
	top: number;
	bottom: number;
}

/**
 * The area a note-content card covers, and the card that owns it.
 *
 * Not a `CardBox`, because it is never a target in its own right: it is the area
 * of some other card, kept apart so that a pointer landing on prose can be
 * handed to the card the prose belongs to.
 */
interface BodyArea {
	owner: string;
	left: number;
	right: number;
	top: number;
	bottom: number;
}

/** Everything the interaction layer needs from the view. */
export interface MapController {
	canvas: Canvas;
	isEditing(): boolean;
	selectedId(): string | null;
	select(id: string | null): void;
	beginEdit(id: string): void;
	editAnnotation(id: string): void;
	/** Take the user to the line this card is written on. */
	revealInNote(id: string): void;

	addChildTo(id: string): void;
	addSiblingTo(id: string): void;
	/** Write an indented text block under the node, and open it to be written. */
	addBlock(id: string): void;
	removeNode(id: string): void;
	indent(id: string): void;
	outdent(id: string): void;
	/** Swap the node with the sibling above / below it. */
	moveUp(id: string): void;
	moveDown(id: string): void;
	toggleFold(id: string): void;
	toggleCheck(id: string): void;
	/** Open a note-content block whole, rendered, in its own dialog. */
	expandBody(id: string): void;
	/** Follow a link written in a note-content card. */
	openLink(href: string, ev: MouseEvent): void;
	/** The node's own menu, at the pointer. */
	showMenu(id: string, ev: MouseEvent): void;
	navigate(direction: Direction): void;

	openSearch(): void;
	/** False when there was no search bar to close, so Escape stays free. */
	closeSearch(): boolean;

	canDrop(id: string, targetId: string, mode: DropMode): boolean;
	move(id: string, targetId: string, mode: DropMode): void;
	/** How the map draws its connectors now, so a drag's guide can match them. */
	edgeStyle(): EdgeStyle;
	/**
	 * The card a slot would make the parent of the dragged node.
	 *
	 * Landing inside a card makes that card the parent. Landing beside one makes
	 * the parent the card's own parent, because beside means among its siblings
	 * -- and the parent is the card the new connector would actually be drawn
	 * from. Null when the slot has no parent at all, which is the root's level.
	 */
	dropParent(targetId: string, mode: DropMode): string | null;
	/**
	 * The card a note-content card belongs to, given a body node's id.
	 *
	 * A body card is the note's own prose drawn as a card. There is no node
	 * behind one, so nothing can be moved *to* it -- but it covers a large part
	 * of any map with prose in it, and a drag over that area is aiming at the
	 * card the prose hangs under. Null for an id that is not a body card's.
	 */
	bodyOwner(id: string): string | null;

	undo(): void;
	redo(): void;
	fit(): void;
	centreOnSelection(): void;

	/** The keys the map answers to: the defaults with the user's changes on top. */
	bindings(): ShortcutBindings;
}

const DRAG_THRESHOLD = 5;

/**
 * How far the pointer may sit from the nearest card and still land on it.
 *
 * Measured to the card's box rather than to a point on it -- see `boxDistance`
 * -- and wide on purpose. A map's cards are stacked vertically and are much
 * wider than they are tall, so the pointer is routinely most of a card's width
 * to the side of the card it means; a radius tight enough to call that a miss
 * is the radius that makes the target hard to hit. Past this the drag has no
 * target at all, so a card carried well clear of the map lands nowhere rather
 * than being claimed by whichever card happens to be least far away.
 */
const DROP_RADIUS = 320;

/**
 * How much a pixel of vertical gap counts against a pixel of horizontal gap
 * when a drag picks the card it is aiming at.
 *
 * Cards are wide and short and their siblings are stacked vertically, so a map
 * has far more horizontal room than vertical. Weighed flat, a card two hundred
 * pixels above the pointer but only a hundred to its left beats the card the
 * pointer is level with -- and that is the wrong answer, because the row a
 * pointer means is the row it is level with. Weighing the vertical gap heavier
 * restores the reading a user has of their own gesture.
 */
const VERTICAL_PRIORITY = 3;

/** The four navigation actions, as the direction each one steps in. */
const DIRECTIONS: Record<
	"navigate-up" | "navigate-down" | "navigate-left" | "navigate-right",
	Direction
> = {
	"navigate-up": "up",
	"navigate-down": "down",
	"navigate-left": "left",
	"navigate-right": "right",
};

/** Reached only by an action no `case` claimed, which is a compile error. */
function assertHandled(_action: never): void {}

function nodeIdFrom(target: EventTarget | null): string | null {
	if (!(target instanceof HTMLElement)) return null;
	const el = target.closest<HTMLElement>(".mm-node");
	return el?.dataset.id ?? null;
}

export function attachInteractions(controller: MapController): () => void {
	const { canvas } = controller;
	const viewport = canvas.viewport;
	const cleanups: Array<() => void> = [];

	const on = <K extends keyof HTMLElementEventMap>(
		el: HTMLElement,
		type: K,
		handler: (ev: HTMLElementEventMap[K]) => void,
		options?: AddEventListenerOptions,
	): void => {
		el.addEventListener(type, handler as EventListener, options);
		cleanups.push(() => el.removeEventListener(type, handler as EventListener));
	};

	// A completed drag re-renders the map, so the click that follows pointerup
	// would resolve a stale element to whatever now holds that id.
	let suppressClick = false;

	// --- clicking ------------------------------------------------------------
	on(viewport, "click", (ev) => {
		if (suppressClick) {
			suppressClick = false;
			ev.stopPropagation();
			return;
		}
		const target = ev.target as HTMLElement;

		// Links, but only in note content: a title is something you select and
		// drag, and a link filling one would leave no way to grab the node.
		const link = target.closest<HTMLElement>(".mm-link[data-href], .mm-embed[data-href]");
		if (link?.closest('.mm-node[data-kind="body"], .mm-annotation')) {
			const href = link.dataset.href;
			if (href) controller.openLink(href, ev);
			ev.preventDefault();
			ev.stopPropagation();
			return;
		}

		// Ctrl/Cmd+click on a card is "show me where this is written", which is
		// the map's half of a round trip the note's own caret can start back.
		// Deliberately after the link check: the same gesture on a link inside a
		// content card is already the link's, and has been for longer.
		if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey) {
			const id = nodeIdFrom(target);
			if (id) {
				ev.preventDefault();
				controller.revealInNote(id);
				return;
			}
		}

		const add = target.closest<HTMLElement>(".mm-add");
		if (add) {
			const id = nodeIdFrom(add);
			if (id) controller.addChildTo(id);
			ev.stopPropagation();
			return;
		}
		// The fold toggle and the checkbox are plain divs, so pressing one moves
		// the focus to the body and the map's keyboard stops answering -- a
		// click on a card does not, because the fallback below takes the focus
		// back. Neither of these opens anything that wants the focus itself, so
		// it is put back where the keyboard lives.
		//
		// The add button and the expand button are deliberately not in this
		// group: both hand the focus on to something they open.
		const toggle = target.closest<HTMLElement>(".mm-toggle");
		if (toggle) {
			const id = nodeIdFrom(toggle);
			if (id) controller.toggleFold(id);
			ev.stopPropagation();
			viewport.focus({ preventScroll: true });
			return;
		}
		const checkbox = target.closest<HTMLElement>(".mm-checkbox");
		if (checkbox) {
			const id = nodeIdFrom(checkbox);
			if (id) controller.toggleCheck(id);
			ev.stopPropagation();
			viewport.focus({ preventScroll: true });
			return;
		}
		const id = nodeIdFrom(target);
		controller.select(id);
		if (!controller.isEditing()) viewport.focus({ preventScroll: true });
	});

	on(viewport, "dblclick", (ev) => {
		const target = ev.target as HTMLElement;
		const id = nodeIdFrom(target);
		if (!id) return;
		ev.preventDefault();
		if (target.closest(".mm-annotation")) {
			controller.editAnnotation(id);
			return;
		}
		controller.beginEdit(id);
	});

	// --- dragging to reparent or reorder ---------------------------------------
	let dragId: string | null = null;
	let dragPointer = -1;
	let origin = { x: 0, y: 0 };
	let dragging = false;
	let hovered: HTMLElement | null = null;
	const DROP_CLASSES = ["is-drop-target", "is-drop-before", "is-drop-after"];

	const clearHover = (): void => {
		hovered?.removeClasses(DROP_CLASSES);
		hovered = null;
	};

	/** The element a node id is drawn in, or null once it has left the map. */
	const nodeElement = (id: string): HTMLElement | null =>
		viewport.querySelector<HTMLElement>(`.mm-node[data-id="${CSS.escape(id)}"]`);

	// Every card in the map, the areas its note content covers, and the slot the
	// last frame settled on. All of it is read once, when the drag starts.
	let cards: CardBox[] = [];
	let bodies: BodyArea[] = [];
	let activeSlot: DropSlot | null = null;

	/**
	 * Measure every card the dragged node could land beside or inside.
	 *
	 * Once per drag, not once per frame. Taking a rect off every card forces a
	 * layout, and a card in the air moves nothing: the camera is still and the
	 * tree is unchanged, so the only thing that differs between two frames is
	 * where the pointer is. Measuring up front also pins the cards to the moment
	 * one was picked up, so a target cannot drift under the pointer mid-drag.
	 *
	 * Boxes and not slot points, because the pointer's distance to the *card* is
	 * what decides the target -- see `boxDistance`. Which of the card's three
	 * slots it means is settled afterwards, from the pointer's height.
	 */
	const measureCards = (): void => {
		cards = [];
		bodies = [];
		for (const node of viewport.querySelectorAll<HTMLElement>(".mm-node")) {
			const id = node.dataset.id;
			if (!id || id === dragId) continue;
			// The card, not the row. `.mm-row` is the drawn box the annotation
			// sits inside, so a title narrower or shorter than its annotation
			// would put the row's box somewhere the card's is not. `.mm-card` is
			// the box the layout measures and every anchor in the map is taken
			// from, so it is the one that answers "where is this card".
			const card = node.querySelector<HTMLElement>(".mm-card") ?? node;
			const rect = card.getBoundingClientRect();
			// A body card holds the note's own prose. Nothing can be moved to one
			// -- there is no node behind it -- but it is the largest thing on a
			// map that has prose in it, and refusing it outright left the whole
			// area it covers as a place a drag found nothing at all. So the area
			// is handed to the card that owns the prose: a pointer over it is a
			// pointer over that card.
			if (node.dataset.kind === "body") {
				const owner = controller.bodyOwner(id);
				if (owner) {
					bodies.push({
						owner,
						left: rect.left,
						right: rect.right,
						top: rect.top,
						bottom: rect.bottom,
					});
				}
				continue;
			}
			cards.push({
				id,
				left: rect.left,
				right: rect.right,
				top: rect.top,
				bottom: rect.bottom,
			});
		}
	};

	/**
	 * How far the pointer is from a card, measured to its box.
	 *
	 * To the box and not to a point on it, because of the shape a map has: cards
	 * are much wider than they are tall and their siblings are stacked
	 * vertically, so the gap between the pointer and the card it means is mostly
	 * horizontal. Measured to the card's middle that gap reads as enormous -- the
	 * pointer has to be brought most of the way home before anything lights up,
	 * which was the complaint. Measured to the box, pointing anywhere level with
	 * a card is pointing at that card, however far along it.
	 */
	const boxDistance = (card: CardBox, x: number, y: number): number => {
		const dx = Math.max(card.left - x, 0, x - card.right);
		const dy = Math.max(card.top - y, 0, y - card.bottom);
		return Math.hypot(dx, dy * VERTICAL_PRIORITY);
	};

	/**
	 * Which of a card's slots the pointer means.
	 *
	 * The card is cut in two down its middle, and which half the pointer is in
	 * decides between "beside it" and "inside it".
	 *
	 * The right half is where a card's own children are drawn, so a pointer
	 * level with the card and past its middle is asking the card to open up and
	 * take the node. The left half is the card's own column, shared with the
	 * rest of its row, so a pointer there means the row -- and then the height
	 * says which way along it: above the middle is before the card, below it is
	 * after.
	 *
	 * Cut horizontally, because a map runs left to right. The vertical position
	 * cannot separate "inside" from "beside" for the same reason: a card's
	 * children are drawn level with it, not below it.
	 */
	const modeFor = (card: CardBox, x: number, y: number): DropMode => {
		const midX = card.left + (card.right - card.left) / 2;
		const midY = card.top + (card.bottom - card.top) / 2;
		if (y >= card.top && y <= card.bottom && x >= midX) return "child";
		return y < midY ? "before" : "after";
	};

	/**
	 * The slot the pointer is over, or null when no card is within reach.
	 *
	 * The card picks the target and the pointer's height picks the slot.
	 *
	 * A card that refuses the slot keeps its place in the running, taken as
	 * "inside it" instead. That fallback is what stops a card growing a dead
	 * band along its edges: reordering is refused on a first-level branch -- the
	 * layout splits those between the root's two sides by weight, so their order
	 * is not the user's to set -- and without the fallback, aiming just below
	 * one of those cards found nothing at all and the card would not stick.
	 *
	 * `canDrop` is asked before the distance is compared rather than after: a
	 * slot that would be refused must not win the comparison and leave the guide
	 * pointing somewhere the node cannot go.
	 */
	const nearestSlot = (x: number, y: number): DropSlot | null => {
		const id = dragId;
		if (id === null) return null;

		// Over a note's prose the answer is the card the prose belongs to, and
		// the only thing a drop there can mean is "inside it".
		for (const body of bodies) {
			if (x < body.left || x > body.right || y < body.top || y > body.bottom) continue;
			if (controller.canDrop(id, body.owner, "child")) {
				return { targetId: body.owner, mode: "child" };
			}
		}

		let best: DropSlot | null = null;
		let nearest = DROP_RADIUS;
		for (const card of cards) {
			const mode = modeFor(card, x, y);
			const usable = controller.canDrop(id, card.id, mode)
				? mode
				: controller.canDrop(id, card.id, "child")
					? "child"
					: null;
			if (usable === null) continue;
			const distance = boxDistance(card, x, y);
			if (distance >= nearest) continue;
			best = { targetId: card.id, mode: usable };
			nearest = distance;
		}
		return best;
	};

	/**
	 * The line a drag draws: the connector the move would make.
	 *
	 * One end is on the card being carried, the other on the card that would
	 * become its parent -- so what is drawn is the connection itself, in the
	 * map's own terms, rather than a pointer at a spot on the canvas. Both ends
	 * sit on the middle of a left or right face, which is where `edges.ts`
	 * anchors every other connector in the map, and the path comes from the same
	 * `edgePath` in the user's chosen style.
	 *
	 * On the viewport and not in the map: the endpoints are screen points, and
	 * the viewport is the one element outside the camera's transform. The map's
	 * own connector layer is rewritten whole on every redraw, so a path added
	 * there would survive precisely one frame.
	 */
	let guide: SVGSVGElement | null = null;
	let guideLine: SVGPathElement | null = null;
	let guideOrigin = { x: 0, y: 0 };

	/**
	 * The card being carried, as a box around the pointer the copy is centred on.
	 *
	 * The copy is a clone of `.mm-row` and the card inside it can be smaller --
	 * an annotation widens the row without widening the card -- so the card's
	 * offset from the pointer is kept here. Measured once, when the drag starts:
	 * the copy hangs on `document.body`, and reading it back every frame would
	 * cost a layout for a box that only ever moves with the pointer.
	 */
	let carried = { width: 0, height: 0, dx: 0, dy: 0 };

	const startGuide = (): void => {
		const box = viewport.getBoundingClientRect();
		guideOrigin = { x: box.left, y: box.top };
		guide = createSvg("svg");
		guide.addClass("mm-drag-guide");
		guide.setAttribute("width", String(box.width));
		guide.setAttribute("height", String(box.height));
		guideLine = createSvg("path");
		guideLine.addClass("mm-drag-guide-line");
		guideLine.setAttribute("fill", "none");
		guide.appendChild(guideLine);
		viewport.appendChild(guide);
	};

	/** Draw the connector the slot under the pointer would create, if any. */
	const drawGuide = (slot: DropSlot | null): void => {
		if (!guideLine) return;

		const parentId = slot ? controller.dropParent(slot.targetId, slot.mode) : null;
		const parentCard = parentId
			? nodeElement(parentId)?.querySelector<HTMLElement>(".mm-card")
			: null;
		if (!parentCard) {
			// Nothing to connect to: either the drag has no slot, or the slot's
			// parent is a card the map is not drawing. A line here would be a
			// claim about a connector that is not going to exist.
			guideLine.setAttribute("d", "");
			return;
		}

		const parent = parentCard.getBoundingClientRect();
		// Which face each end leaves from is read off where the two cards are,
		// not off the slot: a child is drawn on one side of its parent, and the
		// two faces turn to meet across that gap.
		const childOnRight = dropAt.x + carried.dx >= parent.left + parent.width / 2;
		const half = carried.width / 2;
		const from: [number, number] = [
			(childOnRight ? parent.right : parent.left) - guideOrigin.x,
			parent.top + parent.height / 2 - guideOrigin.y,
		];
		const to: [number, number] = [
			dropAt.x + carried.dx + (childOnRight ? -half : half) - guideOrigin.x,
			dropAt.y + carried.dy - guideOrigin.y,
		];
		guideLine.setAttribute("d", edgePath(from, to, controller.edgeStyle()));
	};

	const endGuide = (): void => {
		guide?.remove();
		guide = null;
		guideLine = null;
	};

	// Where the pointer was when this frame was asked for, and the handle that
	// asked. A pointermove arrives far more often than the screen is painted,
	// and resolving the drop zone means `elementFromPoint` plus a rect off
	// whatever it finds -- two forced layouts for a highlight that can only be
	// seen once a frame.
	let dropFrame = 0;
	let dropAt = { x: 0, y: 0 };

	const cancelDropFrame = (): void => {
		if (dropFrame === 0) return;
		window.cancelAnimationFrame(dropFrame);
		dropFrame = 0;
	};

	/**
	 * Resolve the slot under the pointer, and draw the whole frame from it.
	 *
	 * The copy, the guide and the highlight are all decided here, from one
	 * reading of one pointer position. Three answers to the same question must
	 * not be able to disagree about it -- which is also why the copy is not
	 * moved by the pointermove handler that asked for this frame.
	 */
	const resolveDrop = (): void => {
		if (dragId === null || !dragging) return;

		activeSlot = nearestSlot(dropAt.x, dropAt.y);
		moveGhost(dropAt.x, dropAt.y);
		drawGuide(activeSlot);

		// The slot can change without the card under it changing, so the
		// highlight is compared by card and the branch below re-runs only when
		// there is a different one to draw.
		const targetEl = activeSlot ? nodeElement(activeSlot.targetId) : null;
		if (targetEl === hovered) return;
		clearHover();
		if (!targetEl || !activeSlot) return;

		hovered = targetEl;
		if (activeSlot.mode === "child") targetEl.addClass("is-drop-target");
		else targetEl.addClass(activeSlot.mode === "before" ? "is-drop-before" : "is-drop-after");
	};

	/**
	 * A copy of the card that follows the pointer while it is being dragged.
	 *
	 * Built once per drag from the card's own box, so what the pointer carries
	 * is the thing the user picked up rather than a rectangle standing in for
	 * it. On `document.body` rather than in the view: the ghost is in screen
	 * space, where the pointer lives, and the viewport it came from is inside a
	 * transform that would drag the ghost along with the pan.
	 *
	 * `pointer-events: none` is load-bearing. `resolveDrop` hit-tests with
	 * `elementFromPoint`, and a ghost that could be hit would be the only thing
	 * ever found under the pointer.
	 */
	let ghost: HTMLElement | null = null;

	/** Put the copy's centre at a point in screen space. */
	const moveGhost = (x: number, y: number): void => {
		if (!ghost) return;
		ghost.style.left = `${x}px`;
		ghost.style.top = `${y}px`;
	};

	const startGhost = (node: HTMLElement, ev: PointerEvent): void => {
		const row = node.querySelector<HTMLElement>(".mm-row");
		if (!row) return;
		const rect = row.getBoundingClientRect();

		// Where the card sits inside the row the copy is made of. They are the
		// same box on a plain card and part company as soon as there is an
		// annotation, and the guide has to end on the card's face -- not the
		// row's, which is not the thing the user picked up.
		const cardEl = node.querySelector<HTMLElement>(".mm-card");
		const card = cardEl ? cardEl.getBoundingClientRect() : rect;
		carried = {
			width: card.width,
			height: card.height,
			dx: card.left + card.width / 2 - (rect.left + rect.width / 2),
			dy: card.top + card.height / 2 - (rect.top + rect.height / 2),
		};

		ghost = document.body.createDiv({ cls: "mm-drag-ghost" });
		ghost.style.width = `${rect.width}px`;
		ghost.style.height = `${rect.height}px`;
		// The branch colour is set by a rule on the node the copy has left
		// behind, so it is read off the original and carried over by hand.
		const branch = getComputedStyle(row).getPropertyValue("--mm-branch");
		if (branch.trim() !== "") ghost.style.setProperty("--mm-branch", branch.trim());
		// A card style is a class on the map, and the copy is on `document.body`
		// -- outside it. The class is what carries the fill, the border and the
		// shadow to the copy; without it the copy of a flat card would arrive as
		// a boxed one.
		for (const cls of CARD_STYLE_CLASSES) {
			if (row.closest(`.${cls}`)) ghost.addClass(cls);
		}
		ghost.appendChild(row.cloneNode(true));
		moveGhost(ev.clientX, ev.clientY);
	};

	const endGhost = (): void => {
		ghost?.remove();
		ghost = null;
	};

	const endDrag = (): void => {
		cancelDropFrame();
		endGhost();
		endGuide();
		if (dragId) nodeElement(dragId)?.removeClass("is-dragging");
		viewport.removeClass("is-dragging-node");
		clearHover();
		dragId = null;
		dragPointer = -1;
		dragging = false;
		cards = [];
		bodies = [];
		activeSlot = null;
	};

	on(viewport, "pointerdown", (ev) => {
		if (ev.button !== 0 || controller.isEditing()) return;
		const target = ev.target as HTMLElement;
		if (target.closest(".mm-tools, .mm-checkbox")) return;
		const card = target.closest<HTMLElement>(".mm-card");
		// A body card stands for lines the note owns, not a node that can be
		// reparented, so it never starts a drag.
		if (!card || card.closest('.mm-node[data-kind="body"]')) return;
		const id = nodeIdFrom(card);
		if (!id) return;

		dragId = id;
		dragPointer = ev.pointerId;
		origin = { x: ev.clientX, y: ev.clientY };
		dragging = false;
	});

	on(viewport, "pointermove", (ev) => {
		if (dragId === null || ev.pointerId !== dragPointer) return;

		if (!dragging) {
			const moved = Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y);
			if (moved < DRAG_THRESHOLD) return;
			dragging = true;
			viewport.addClass("is-dragging-node");
			const node = viewport.querySelector<HTMLElement>(
				`.mm-node[data-id="${CSS.escape(dragId)}"]`,
			);
			node?.addClass("is-dragging");
			// The card the drag left behind becomes an empty slot, and a copy of
			// it goes with the pointer -- which is what says the card is being
			// carried rather than the map being panned.
			if (node) {
				startGhost(node, ev);
				// Every card it could land on, measured once, before the pointer
				// has gone anywhere.
				measureCards();
				startGuide();
			}
			viewport.setPointerCapture(ev.pointerId);
		}

		// The copy is not moved here. `resolveDrop` places it, on the same frame
		// the guide and the highlight are decided on, so the three cannot
		// disagree about where the drop would land.

		dropAt = { x: ev.clientX, y: ev.clientY };
		if (dropFrame !== 0) return;
		dropFrame = window.requestAnimationFrame(() => {
			dropFrame = 0;
			resolveDrop();
		});
	});

	const finishDrag = (ev: PointerEvent): void => {
		if (dragId === null || ev.pointerId !== dragPointer) return;
		if (dragging) {
			suppressClick = true;
			// The slot the last frame drew, never a fresh reading of the pointer:
			// the card has to land where the guide said it would, and a second
			// guess would let the two differ by whatever the pointer did between
			// that frame and the release.
			const slot = activeSlot;
			if (slot) {
				const source = dragId;
				endDrag();
				controller.move(source, slot.targetId, slot.mode);
				return;
			}
		}
		endDrag();
	};
	on(viewport, "pointerup", finishDrag);
	on(viewport, "pointercancel", () => endDrag());

	// --- the node menu ---------------------------------------------------------
	on(viewport, "contextmenu", (ev) => {
		// A node being edited is a text field, and it keeps the platform's own
		// menu -- cut, copy, paste, spelling.
		if (controller.isEditing()) return;
		const id = nodeIdFrom(ev.target);
		// Blank canvas keeps the platform menu too; a card gets the map's own.
		if (!id) return;
		ev.preventDefault();
		endDrag();
		controller.showMenu(id, ev);
	});

	// --- keyboard -------------------------------------------------------------
	on(viewport, "keydown", (ev) => {
		if (controller.isEditing()) return;

		// Every key the map answers goes through the one table, so what the
		// settings tab shows and what happens here cannot drift. A press with a
		// modifier the binding does not name is not that binding: Alt+Enter is
		// not Enter.
		const combo = comboFromEvent(ev);
		const action = resolveAction(controller.bindings(), combo);
		if (!action) return;
		const id = controller.selectedId();

		switch (action) {
			case "undo":
				ev.preventDefault();
				controller.undo();
				return;
			case "redo":
				ev.preventDefault();
				controller.redo();
				return;
			case "fit":
				ev.preventDefault();
				controller.fit();
				return;
			case "zoom-in":
				ev.preventDefault();
				canvas.zoomBy(1.2);
				return;
			case "zoom-out":
				ev.preventDefault();
				canvas.zoomBy(1 / 1.2);
				return;
			case "centre-selection":
				ev.preventDefault();
				controller.centreOnSelection();
				return;
			// The map's own Ctrl/Cmd+F. The view's keymap scope is what normally
			// claims it -- this handler needs the viewport to hold the DOM focus,
			// which it only does once a card has been clicked -- so this is the
			// belt to that pair of braces. `openSearch` is idempotent, so the two
			// paths overlapping costs nothing.
			case "search":
				ev.preventDefault();
				controller.openSearch();
				return;
			case "close-search":
				// Only ours while a search is open; otherwise Escape keeps
				// whatever meaning Obsidian gives it. The view's scope registers
				// the same key on the same terms; whichever sees it first, the
				// second call finds no bar left to close.
				if (!controller.closeSearch()) return;
				ev.preventDefault();
				return;
			case "navigate-up":
			case "navigate-down":
			case "navigate-left":
			case "navigate-right":
				// No selection is not a reason to stand still: `navigate` takes
				// the root when there is nothing selected yet.
				ev.preventDefault();
				controller.navigate(DIRECTIONS[action]);
				return;
			// Deliberately handled here and not in the view's keymap scope: a
			// move is not idempotent the way `openSearch` is, and a key both
			// paths saw would move the node two places instead of one. The same
			// reasoning is why this one stops the event rather than only
			// preventing the default -- Obsidian's keymap sits on the document,
			// so a hotkey a user has bound to the same combination would
			// otherwise fire on top of this.
			case "move-up":
				if (!id) return;
				ev.preventDefault();
				ev.stopPropagation();
				controller.moveUp(id);
				return;
			case "move-down":
				if (!id) return;
				ev.preventDefault();
				ev.stopPropagation();
				controller.moveDown(id);
				return;
			case "add-child":
				if (!id) return;
				ev.preventDefault();
				controller.addChildTo(id);
				return;
			case "add-sibling":
				if (!id) return;
				ev.preventDefault();
				controller.addSiblingTo(id);
				return;
			case "edit-title":
				if (!id) return;
				ev.preventDefault();
				controller.beginEdit(id);
				return;
			case "edit-annotation":
				if (!id) return;
				ev.preventDefault();
				controller.editAnnotation(id);
				return;
			case "insert-block":
				if (!id) return;
				ev.preventDefault();
				controller.addBlock(id);
				return;
			case "delete-node":
				if (!id) return;
				ev.preventDefault();
				controller.removeNode(id);
				return;
			case "toggle-check":
				if (!id) return;
				ev.preventDefault();
				controller.toggleCheck(id);
				return;
			case "toggle-fold":
				if (!id) return;
				ev.preventDefault();
				controller.toggleFold(id);
				return;
			case "indent":
				if (!id) return;
				ev.preventDefault();
				controller.indent(id);
				return;
			case "outdent":
				if (!id) return;
				ev.preventDefault();
				controller.outdent(id);
				return;
			case "expand-body":
				if (!id) return;
				ev.preventDefault();
				controller.expandBody(id);
				return;
			default:
				// An action with no case here is a compile error, which is the
				// point: the table cannot grow a row nothing performs.
				assertHandled(action);
				return;
		}
	});

	return () => {
		cancelDropFrame();
		for (const off of cleanups) off();
		cleanups.length = 0;
	};
}
