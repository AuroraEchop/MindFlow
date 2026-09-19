import type { Canvas } from "./canvas.ts";
import { CARD_STYLE_CLASSES } from "./cardStyle.ts";
import { edgePath } from "./edges.ts";
import type { EdgeStyle } from "./edges.ts";
import { comboFromEvent, resolveAction } from "./shortcuts.ts";
import type { KeyCombo, ShortcutBindings } from "./shortcuts.ts";

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
	/**
	 * Which side of the root the card is drawn on: 1 right, -1 left.
	 *
	 * Read off the element rather than worked out from the tree, because the
	 * question is only ever "which way does this card's own half face", and the
	 * map has already answered it when it drew the card.
	 */
	side: 1 | -1;
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
	/**
	 * `additive` adds the card to the selection instead of replacing it, which
	 * is what Shift and Ctrl/Cmd ask for on a card.
	 */
	select(id: string | null, additive?: boolean): void;
	/** Replace the selection with every card a band swept over. */
	selectMany(ids: readonly string[]): void;
	/** How many cards the next delete or fold would act on. */
	selectionSize(): number;
	beginEdit(id: string): void;
	editAnnotation(id: string): void;
	/** Take the user to the line this card is written on. */
	revealInNote(id: string): Promise<void>;

	addChildTo(id: string): void;
	addSiblingTo(id: string): void;
	/**
	 * What the branch button's press does for this card right now: fold it if
	 * the button is showing a minus, grow it a child if a plus. The button's
	 * own icon comes from the same question (`branchButton.ts`), so the press
	 * cannot mean something the icon is not saying.
	 */
	toggleBranch(id: string): void;
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
	/**
	 * Enlarge a picture or a video over the map.
	 *
	 * False when there was nothing to show, which puts the click back on the
	 * path it would have taken -- a file that has since left the vault still
	 * resolves to a chip, and a chip is still a link.
	 */
	previewMedia(el: HTMLElement): boolean;
	/** The node's own menu, at the pointer. */
	showMenu(id: string, ev: MouseEvent): void;
	navigate(direction: Direction): void;

	openSearch(): void;
	/** The same bar, with the replace row already showing. */
	openReplace(): void;
	/** False when there was no search bar to close, so Escape stays free. */
	closeSearch(): boolean;

	canDrop(id: string, targetId: string, mode: DropMode): boolean;
	move(id: string, targetId: string, mode: DropMode): void;
	/**
	 * What a drag that starts on this card carries.
	 *
	 * The card alone, or the whole selection when the card is part of one.
	 * Asked once, when the drag starts, and everything after that is about the
	 * list rather than about the card under the pointer.
	 */
	carriedBy(id: string): readonly string[];
	/** Whether every card being carried could land in this slot -- all or none. */
	canDropMany(ids: readonly string[], targetId: string, mode: DropMode): boolean;
	moveMany(ids: readonly string[], targetId: string, mode: DropMode): void;
	/**
	 * Whether a plain drag on blank canvas moves the map rather than banding it.
	 *
	 * The one answer the camera and the band are both given: with it off the
	 * press is the band's and the pan key is what moves the map, with it on the
	 * press is the camera's and the band waits for the modifier.
	 */
	dragToPan(): boolean;
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
	/**
	 * Whether this note-content card is a block the user may pick up and move.
	 *
	 * Most note content is prose the note owns and the map only draws, and a
	 * press on it stays a press on the card above it. A code sample is the one
	 * block worth carrying somewhere else, so the map says which cards those
	 * are rather than the interaction layer guessing from the DOM.
	 */
	canDragBody(id: string): boolean;

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

/**
 * Whether this is the map's pan key, held on its own.
 *
 * Bare `Space`, which is exactly how the fold binding spells it. Nothing else
 * about it is configurable: a pan key is a modifier, the same kind of key as
 * Shift, and the map does not offer "rebind the modifier" -- so it answers to
 * the physical key rather than to whatever the fold has since been moved to.
 *
 * Shift and Space together are left to the band, and Space as one half of a
 * combination belongs to whatever else is bound to it.
 */
function isPanKey(combo: KeyCombo): boolean {
	return combo.key === "Space" && !combo.mod && !combo.shift && !combo.alt;
}

function nodeIdFrom(target: EventTarget | null): string | null {
	if (!(target instanceof HTMLElement)) return null;
	const el = target.closest<HTMLElement>(".mm-node");
	return el?.dataset.id ?? null;
}

export function attachInteractions(controller: MapController): () => void {
	const { canvas } = controller;
	const viewport = canvas.viewport;
	const cleanups: Array<() => void> = [];

	/**
	 * Whether a press has landed since the pan key went down.
	 *
	 * The pan key is a hold rather than a tap, and which of the two the user
	 * meant is knowable at one moment only: the release. A press that came with
	 * the hold says they were reaching for the canvas, and the fold the key is
	 * also bound to must not fire when the release finally arrives.
	 */
	let panKeyPressed = false;

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
		// While the pan key is held the pointer belongs to the camera, and the
		// click that ends a pan must not select whatever the pan happened to
		// stop over. The capture the pan took is released before this fires, so
		// the target really is the card under the pointer.
		if (canvas.panKeyHeld) {
			ev.stopPropagation();
			return;
		}
		const target = ev.target as HTMLElement;

		// Links, but only in note content: a title is something you select and
		// drag, and a link filling one would leave no way to grab the node.
		// A picture or a video is the one target in there whose plain click is
		// not the link's -- it is a preview, and `Ctrl`/`Cmd`+click is what
		// still reaches the file. Spoken for here rather than by a listener on
		// the element, of which there is none.
		const media = target.closest<HTMLElement>(".mm-media[data-href]");
		if (
			media?.closest('.mm-node[data-kind="body"], .mm-annotation') &&
			!(ev.ctrlKey || ev.metaKey) &&
			controller.previewMedia(media)
		) {
			ev.preventDefault();
			ev.stopPropagation();
			return;
		}

		const link = target.closest<HTMLElement>(
			".mm-link[data-href], .mm-embed[data-href], .mm-media[data-href]",
		);
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
				// Nothing here waits on it: the gesture is over the moment the
				// view swaps, and `void` is how a deliberate non-await is said
				// rather than left looking like an oversight.
				void controller.revealInNote(id);
				return;
			}
		}

		const add = target.closest<HTMLElement>(".mm-add");
		if (add) {
			const id = nodeIdFrom(add);
			if (id) controller.toggleBranch(id);
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
		// Shift and Ctrl/Cmd both add, because both are what a list uses for
		// this and neither is spoken for here. Shift is the one the band below
		// asks for too, so a shift-drag that ends on a card behaves like the
		// shift-click it looks like.
		controller.select(id, ev.shiftKey || ev.ctrlKey || ev.metaKey);
		if (!controller.isEditing()) viewport.focus({ preventScroll: true });
	});

	on(viewport, "dblclick", (ev) => {
		// The same as the click above: with the pan key down, a double press of
		// the button is two pans that went nowhere, not "edit this card".
		if (canvas.panKeyHeld) return;
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

	// --- banding a selection ---------------------------------------------------
	//
	// A drag that starts on blank canvas draws a box and takes every card it
	// swept over. Which press that is depends on the drag mode, and the gate
	// below is both halves of it: with the mode on, blank canvas belongs to the
	// camera and the band waits for the modifier; with it off, the plain press
	// is the band's and the map is moved with the pan key. `canPan` is asked the
	// same question, so the two cannot both claim a press.
	//
	// The box is drawn in the untransformed layer above the viewport, so the
	// rectangle the pointer describes is the rectangle on screen -- inside the
	// viewport it would be in map coordinates, and the band would drift away
	// from the pointer as soon as the map was zoomed.
	let band: { pointer: number; x: number; y: number; left: number; top: number } | null = null;
	let bandEl: HTMLElement | null = null;

	const paintBand = (ev: PointerEvent): void => {
		if (!band || !bandEl) return;
		bandEl.style.left = `${Math.min(band.x, ev.clientX) - band.left}px`;
		bandEl.style.top = `${Math.min(band.y, ev.clientY) - band.top}px`;
		bandEl.style.width = `${Math.abs(ev.clientX - band.x)}px`;
		bandEl.style.height = `${Math.abs(ev.clientY - band.y)}px`;
	};

	const endBand = (commit: boolean): void => {
		if (!band || !bandEl) return;
		const rect = bandEl.getBoundingClientRect();
		bandEl.remove();
		bandEl = null;
		band = null;
		// The click that follows the release is the band's to suppress, not to
		// obey: the pointer was captured, so the click retargets to the
		// viewport -- which reads as a press on nothing, the exact gesture a
		// plain click turns into "clear the selection". Left alone it would
		// undo the band the moment the box closed.
		suppressClick = true;
		if (!commit) return;

		const ids: string[] = [];
		for (const card of Array.from(viewport.querySelectorAll<HTMLElement>(".mm-card"))) {
			const node = card.closest<HTMLElement>(".mm-node");
			const id = node?.dataset.id;
			// A culled card has no box to compare against, and it is not on
			// screen for the band to have swept over.
			if (!id || node?.classList.contains("is-offscreen")) continue;
			// Only topic cards join a band selection. Note-content blocks
			// cannot move as nodes -- one mixed into the selection would make
			// `canDropMany` reject the whole drop, so banding a card and its
			// code block together would leave nothing draggable. The root and
			// the virtual placeholders are not carriers either.
			const kind = node?.dataset.kind;
			if (kind === "body" || kind === "root") continue;
			if (node?.classList.contains("is-virtual")) continue;
			const box = card.getBoundingClientRect();
			if (box.right < rect.left || box.left > rect.right) continue;
			if (box.bottom < rect.top || box.top > rect.bottom) continue;
			ids.push(id);
		}
		// A band that caught nothing clears the selection, which is what
		// dragging a box over empty space means.
		controller.selectMany(ids);
	};

	on(viewport, "pointerdown", (ev) => {
		// With the pan key held the press is already the camera's, even if Shift
		// has since joined the gesture: there is no blank canvas left to sweep
		// once the whole map is canvas.
		if (canvas.panKeyHeld) return;
		if (ev.button !== 0 || controller.isEditing()) return;
		if (controller.dragToPan() && !ev.shiftKey) return;
		if ((ev.target as HTMLElement).closest(".mm-node")) return;
		const host = viewport.parentElement;
		if (!host) return;
		// The host is the layer above the transformed one, so the box is
		// written in screen coordinates and stays under the pointer however
		// the map is zoomed or panned while the drag runs.
		const box = host.getBoundingClientRect();
		band = {
			pointer: ev.pointerId,
			x: ev.clientX,
			y: ev.clientY,
			left: box.left,
			top: box.top,
		};
		bandEl = host.createDiv({ cls: "mm-band" });
		paintBand(ev);
		viewport.setPointerCapture(ev.pointerId);
		ev.preventDefault();
	});

	on(viewport, "pointermove", (ev) => {
		if (!band || ev.pointerId !== band.pointer) return;
		paintBand(ev);
	});

	on(viewport, "pointerup", (ev) => {
		if (!band || ev.pointerId !== band.pointer) return;
		paintBand(ev);
		endBand(true);
	});

	on(viewport, "pointercancel", () => endBand(false));

	// --- dragging to reparent or reorder ---------------------------------------
	let dragId: string | null = null;
	let dragPointer = -1;
	/**
	 * Whether what is being carried is a note-content block rather than a node.
	 *
	 * The two are dragged with the same gesture and land in the same places, but
	 * a block reads a slot differently -- see `MapController.canDrop` -- and the
	 * cards it may land on are measured differently too.
	 */
	let carryingBody = false;
	/**
	 * Every card this drag is carrying: the one that was picked up, plus the
	 * rest of the selection when it was part of one.
	 *
	 * A set rather than the list it arrives as, because the question it answers
	 * -- "is this card coming with me" -- is asked once per card per frame while
	 * the pointer moves, and the answer is what decides whether a card is a
	 * place to land or part of what is looking for one.
	 */
	let carryingIds = new Set<string>();
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
	 *
	 * `dragId` rather than the whole of what is being carried: a card is not a
	 * place to land on itself, and the other cards coming along are not places
	 * to land either.
	 */
	const measureCards = (): void => {
		cards = [];
		bodies = [];
		for (const node of viewport.querySelectorAll<HTMLElement>(".mm-node")) {
			const id = node.dataset.id;
			if (!id || carryingIds.has(id)) continue;
			// Which way this card's own half faces -- see `modeFor`.
			const side: 1 | -1 = node.dataset.side === "left" ? -1 : 1;
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
				// Unless what is being carried is another block, which is looking
				// for a block to land beside rather than for an owner -- so a
				// card of its own kind is a target in its own right.
				if (carryingBody) {
					cards.push({
						id,
						side,
						left: rect.left,
						right: rect.right,
						top: rect.top,
						bottom: rect.bottom,
					});
					continue;
				}
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
				side,
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
	 * The half that faces the card's own children is where a pointer means
	 * "inside it": level with the card and over that half is asking it to open
	 * up and take the node. The other half is the column the card shares with
	 * its parent and the rest of its row, so a pointer there means the row --
	 * and then the height says which way along it: above the middle is before
	 * the card, below it is after.
	 *
	 * Which half that is depends on the side of the root the card is on, so the
	 * cut is mirrored rather than always taken on the right. `tidyTree` keeps a
	 * whole subtree on one side of its parent: a card to the right of the root
	 * has its children to its right, and the right half is the inward one; a
	 * card on the left has them to its left, and it is the left half. Reading
	 * both the same way round put the two slots of every left-side card on the
	 * wrong halves -- the outward half nested and the inward half reordered,
	 * exactly backwards -- and the deeper the branch, the more of the map that
	 * was.
	 *
	 * Cut horizontally, because a map runs left to right. The vertical position
	 * cannot separate "inside" from "beside" for the same reason: a card's
	 * children are drawn level with it, not below it.
	 */
	const modeFor = (card: CardBox, x: number, y: number): DropMode => {
		const midX = card.left + (card.right - card.left) / 2;
		const midY = card.top + (card.bottom - card.top) / 2;
		const inward = card.side === 1 ? x >= midX : x <= midX;
		if (y >= card.top && y <= card.bottom && inward) return "child";
		return y < midY ? "before" : "after";
	};

	/**
	 * The slot the pointer is over, or null when no card is within reach.
	 *
	 * The card picks the target and the pointer's height picks the slot.
	 *
	 * A card that refuses the slot keeps its place in the running, taken as
	 * "inside it" instead. That fallback is what stops a card growing a dead
	 * band along its edges: the root takes no sibling, because it has none, and
	 * without the fallback aiming just above or below it found nothing at all
	 * and the card would not stick.
	 *
	 * `canDropMany` is asked before the distance is compared rather than after: a
	 * slot that would be refused must not win the comparison and leave the guide
	 * pointing somewhere the node cannot go. It is asked of everything being
	 * carried, because a slot that would leave part of the group behind is not a
	 * slot at all.
	 */
	const nearestSlot = (x: number, y: number): DropSlot | null => {
		if (carryingIds.size === 0) return null;
		const carried = [...carryingIds];

		// Over a note's prose the answer is the card the prose belongs to, and
		// the only thing a drop there can mean is "inside it".
		for (const body of bodies) {
			if (x < body.left || x > body.right || y < body.top || y > body.bottom) continue;
			if (controller.canDropMany(carried, body.owner, "child")) {
				return { targetId: body.owner, mode: "child" };
			}
		}

		let best: DropSlot | null = null;
		let nearest = DROP_RADIUS;
		for (const card of cards) {
			const mode = modeFor(card, x, y);
			const usable = controller.canDropMany(carried, card.id, mode)
				? mode
				: controller.canDropMany(carried, card.id, "child")
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

	/**
	 * The rest of what the drag carries, as one faded copy each.
	 *
	 * Each rides at the offset its card held from the one under the pointer
	 * when the drag started, so the group reads as a group in flight: the
	 * picked-up card leads, the company fades behind it. Without them a group
	 * drag would show one card moving and a set of rings claiming cards were
	 * coming along that nothing on screen said were moving at all.
	 */
	let ghostExtras: { el: HTMLElement; dx: number; dy: number }[] = [];

	/** Put the copies where the pointer is: the leader centred, company offset. */
	const moveGhost = (x: number, y: number): void => {
		if (!ghost) return;
		ghost.style.left = `${x}px`;
		ghost.style.top = `${y}px`;
		for (const extra of ghostExtras) {
			extra.el.style.left = `${x + extra.dx}px`;
			extra.el.style.top = `${y + extra.dy}px`;
		}
	};

	/** Build one copy from a row, styled the way the original is styled. */
	const buildGhost = (row: HTMLElement, rect: DOMRect): HTMLElement => {
		const el = document.body.createDiv({ cls: "mm-drag-ghost" });
		el.style.width = `${rect.width}px`;
		el.style.height = `${rect.height}px`;
		// The branch colour is set by a rule on the node the copy has left
		// behind, so it is read off the original and carried over by hand.
		const branch = getComputedStyle(row).getPropertyValue("--mm-branch");
		if (branch.trim() !== "") el.style.setProperty("--mm-branch", branch.trim());
		// A card style is a class on the map, and the copy is on `document.body`
		// -- outside it. The class is what carries the fill, the border and the
		// shadow to the copy; without it the copy of a flat card would arrive as
		// a boxed one.
		for (const cls of CARD_STYLE_CLASSES) {
			if (row.closest(`.${cls}`)) el.addClass(cls);
		}
		el.appendChild(row.cloneNode(true));
		return el;
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

		ghost = buildGhost(row, rect);
		moveGhost(ev.clientX, ev.clientY);

		// One faded copy per card the drag carries besides the one under the
		// pointer, parked at the offset its original holds from the leader.
		const centerX = card.left + card.width / 2;
		const centerY = card.top + card.height / 2;
		for (const id of carryingIds) {
			if (id === dragId) continue;
			const otherRow = nodeElement(id)?.querySelector<HTMLElement>(".mm-row");
			if (!otherRow) continue;
			const otherRect = otherRow.getBoundingClientRect();
			const extra = buildGhost(otherRow, otherRect);
			extra.addClass("mm-drag-ghost-extra");
			const dx = otherRect.left + otherRect.width / 2 - centerX;
			const dy = otherRect.top + otherRect.height / 2 - centerY;
			ghostExtras.push({ el: extra, dx, dy });
			extra.style.left = `${ev.clientX + dx}px`;
			extra.style.top = `${ev.clientY + dy}px`;
		}
	};

	const endGhost = (): void => {
		ghost?.remove();
		ghost = null;
		for (const extra of ghostExtras) extra.el.remove();
		ghostExtras = [];
	};

	const endDrag = (): void => {
		cancelDropFrame();
		endGhost();
		endGuide();
		for (const carried of carryingIds) nodeElement(carried)?.removeClass("is-dragging");
		viewport.removeClass("is-dragging-node");
		clearHover();
		dragId = null;
		dragPointer = -1;
		dragging = false;
		carryingBody = false;
		carryingIds = new Set();
		cards = [];
		bodies = [];
		activeSlot = null;
	};

	on(viewport, "pointerdown", (ev) => {
		if (ev.button !== 0 || controller.isEditing()) return;
		// The pan key owns the press wherever it lands, cards included: the
		// pointer is already dragging the canvas under this one, and a second
		// gesture reading the same press would carry a card along with it.
		if (canvas.panKeyHeld) return;
		const target = ev.target as HTMLElement;
		// The fold button of a note-content card is the one handle the block
		// has: a press there starts a body drag, and the press-release without
		// a move stays what it always was -- the fold or unfold itself (the
		// drag threshold sees to that, and a completed drag suppresses the
		// click that would otherwise fold it). A branch button on a topic card
		// folds and grows, never drags.
		const add = target.closest<HTMLElement>(".mm-add");
		if (add) {
			const id = nodeIdFrom(add);
			const isBody =
				id !== null && add.closest('.mm-node[data-kind="body"]') !== null;
			if (id && isBody && controller.canDragBody(id)) {
				dragId = id;
				carryingBody = true;
				carryingIds = new Set(controller.carriedBy(id));
				dragPointer = ev.pointerId;
				origin = { x: ev.clientX, y: ev.clientY };
				dragging = false;
			}
			return;
		}
		if (target.closest(".mm-tools, .mm-checkbox")) return;
		// The two circles on a video card are controls, not card surface: a
		// press that drifts by a few pixels would otherwise be read as the
		// start of a drag and the pointer would be captured before the click
		// landed.
		if (target.closest(".mm-media-button")) return;
		// The copy button on a sample is a control too, and the same argument
		// applies: a press that drifts a few pixels is a press on the button,
		// not the start of a drag that would carry the card away instead.
		if (target.closest(".mm-code-copy")) return;
		// And once a video is playing it is a player. Its scrubber is a
		// press-and-drag gesture, which is exactly the gesture the card's own
		// drag is waiting for -- so the card gives it up while it plays.
		if (target.closest(".mm-media-video.is-playing")) return;
		const card = target.closest<HTMLElement>(".mm-card");
		if (!card) return;
		const id = nodeIdFrom(card);
		if (!id) return;
		// A body card's surface is never a handle, whatever the block holds.
		// The note owns that text -- a press there is selection, preview and
		// edit, and the one way to move the block is its button, which sits
		// on the connector line for exactly this reason. Before the button
		// existed this read the block's shape (`canDragBody`), which is why
		// some blocks dragged from the card and some did not.
		if (card.closest('.mm-node[data-kind="body"]') !== null) return;

		dragId = id;
		carryingBody = false;
		carryingIds = new Set(controller.carriedBy(id));
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
			// Everything being carried goes flat at once. Marking only the card
			// under the pointer would say the others are staying, which is the
			// one thing the rings on them were promising they would not do.
			for (const carried of carryingIds) {
				nodeElement(carried)?.addClass("is-dragging");
			}
			const node = viewport.querySelector<HTMLElement>(
				`.mm-node[data-id="${CSS.escape(dragId)}"]`,
			);
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
				const carried = [...carryingIds];
				endDrag();
				controller.moveMany(carried, slot.targetId, slot.mode);
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

		// The pan key. Not a binding but a modifier, like Shift -- and it keeps
		// whatever action the table also gives it, which is the fold by default.
		// Holding it turns any press into a pan, so that action cannot fire on
		// the way down; the release below decides, once it is known whether a
		// press came with the hold.
		if (isPanKey(combo)) {
			// A held key repeats its keydown. Arming is idempotent, but clearing
			// the press flag is not: clearing it on every repeat would forget a
			// press that had already happened and fold on the release anyway.
			if (!canvas.panKeyHeld) {
				canvas.holdPan(true);
				panKeyPressed = false;
			}
			if (action === "toggle-fold") return;
		}

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
			case "replace":
				ev.preventDefault();
				controller.openReplace();
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
			// On the way down this is reached only by a key the fold has been
			// moved to: on its default, the pan key, it waits for the release --
			// see the branch above the dispatch.
			case "toggle-fold":
				if (!id) return;
				ev.preventDefault();
				controller.toggleFold(id);
				return;
			case "indent":
				if (!id) return;
				// Stops the event rather than only preventing the default: the
				// binding sits on Ctrl/Cmd+Shift+Tab, which is Obsidian's
				// previous-tab switcher at the document, and a move that also
				// flipped tabs would look like the key did nothing at all.
				ev.preventDefault();
				ev.stopPropagation();
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

	/**
	 * The pan key coming up: the other half of the fold it is bound to.
	 *
	 * The release is the first moment the gesture can be read. Nothing was held
	 * but the key, so it was a tap and the fold fires; a press came with it, so
	 * the user was reaching for the canvas and there is nothing to fold.
	 */
	on(viewport, "keyup", (ev) => {
		if (!isPanKey(comboFromEvent(ev))) return;
		const tapped = canvas.panKeyHeld && !panKeyPressed;
		canvas.holdPan(false);
		panKeyPressed = false;
		if (!tapped) return;
		const id = controller.selectedId();
		if (!id) return;
		ev.preventDefault();
		controller.toggleFold(id);
	});

	/**
	 * The other way the key comes up: without us.
	 *
	 * The focus can leave mid-hold -- for the toolbar, the find bar, another
	 * pane -- and the release then never reaches this element. A map left
	 * holding its pan key would not select text again, so losing the focus ends
	 * the hold as surely as letting go of the key does.
	 */
	on(viewport, "blur", () => {
		canvas.holdPan(false);
		panKeyPressed = false;
	});

	// The pointer half of the same fact, and the one thing the release needs to
	// know. It is a listener of its own rather than a line in either gesture
	// handler below: what it records is that the mouse was used, whichever
	// gesture the press turned out to start.
	on(viewport, "pointerdown", () => {
		if (canvas.panKeyHeld) panKeyPressed = true;
	});

	return () => {
		cancelDropFrame();
		// The viewport's pan-ready state is put there by the key handlers above,
		// and they are what is being taken away here -- so it goes with them, and
		// a map torn down mid-hold does not come back with a grabbed cursor.
		canvas.holdPan(false);
		for (const off of cleanups) off();
		cleanups.length = 0;
	};
}
