import { setIcon } from "obsidian";

import { t } from "../i18n.ts";
import type { LayoutNode } from "../layout/tidyTree.ts";
import type { Block } from "../model/blocks.ts";
import { branchAction, branchIcon, showsPlus } from "./branchButton.ts";
import { renderBlocks } from "./blocks.ts";
import { renderInline } from "./inline.ts";
import type { NodeMaxWidth } from "./nodeWidth.ts";

export interface NodeElementOptions {
	/** Null means no annotation; an empty string is an explicit blank block. */
	annotation: string | null;
	/** Both caps from `nodeMaxWidth`: the node box, and the card's own text. */
	maxWidth: NodeMaxWidth;
	branchColors: boolean;
	/**
	 * The note content as blocks, when the card holds any worth drawing as
	 * blocks. Null for everything else, and for every topic card.
	 */
	blocks: Block[] | null;
	/**
	 * Render the text verbatim: a sample or a table, which are drawn in a
	 * monospace face where alignment carries meaning. Only reached when
	 * `blocks` is null, which is every card the block parser did not claim.
	 */
	preformatted: boolean;
	/** Draw the button that opens the block whole, in its own dialog. */
	expandable: boolean;
	/** Draw the branch-side button at all. Off for note content. */
	addable: boolean;
	collapsed: boolean;
	/** True when the node has anything to unfold, body cards included. */
	hasChildren: boolean;
	/** Shown on the count while collapsed. */
	hiddenCount: number;
	/**
	 * The card is the selected one, which is what the button answers to: a
	 * picked card's button is the plus, an unpicked branch's is the minus. The
	 * paint builds the button in the state it knows; the view re-asks the
	 * question when the selection moves, because the selection moves without a
	 * paint.
	 */
	selected: boolean;
}

export interface NodeElement {
	el: HTMLElement;
	/**
	 * The box the card is drawn with: the title's box and, under it, the
	 * annotation strip. It is what carries the fill, the border and the ring, so
	 * a card with an annotation is one card and not two.
	 */
	row: HTMLElement;
	/** The title's own box: where the layout points, and where a drag starts. */
	card: HTMLElement;
	text: HTMLElement;
	toggle: HTMLElement | null;
	checkbox: HTMLElement | null;
	expand: HTMLElement | null;
	add: HTMLElement | null;
	hasMath: boolean;
	/**
	 * Owned by the view, not by the builder: true once the card has been taken
	 * out of the document for sitting outside the viewport. It rides here so
	 * culling a frame's worth of cards is a field read rather than a set lookup
	 * per node, and so nothing can ask a hidden card for its size by accident.
	 */
	offscreen: boolean;
	/**
	 * Also the view's: false until this card has been measured in the document.
	 *
	 * A card built off screen is given the size the last paint measured for it
	 * rather than a layout of its own, so this is what tells the cull that put it
	 * back that it owes the map a measurement.
	 */
	measured: boolean;
}

export function buildNodeElement(
	parent: HTMLElement,
	layout: LayoutNode,
	opts: NodeElementOptions,
): NodeElement {
	const node = layout.node;
	const el = parent.createDiv({ cls: "mm-node" });
	el.dataset.id = node.id;
	el.dataset.kind = node.kind;
	el.dataset.depth = String(Math.min(layout.depth, 6));
	if (opts.branchColors && layout.branch >= 0) {
		el.dataset.branch = String(layout.branch % 10);
	}
	if (opts.collapsed) el.addClass("is-collapsed");
	if (node.virtual) el.addClass("is-virtual");
	el.style.maxWidth = `${opts.maxWidth.node}px`;

	// Three boxes, two of them nested. `.mm-row` is the card the user sees: the
	// title and, under it, the annotation strip, inside one drawn box. `.mm-card`
	// is the title alone -- the drag handle, and the box the layout measures,
	// centres on and anchors connectors at. The strip may widen the node, and
	// with it the row, no further than the cap above; it is inside the row, so it
	// never moves the card's own box. See the row-vs-card note in styles.css.
	const row = el.createDiv({ cls: "mm-row" });
	const card = row.createDiv({ cls: "mm-card" });

	let checkbox: HTMLElement | null = null;
	if (node.checkbox !== null) {
		checkbox = card.createDiv({ cls: "mm-checkbox" });
		checkbox.dataset.checked = node.checkbox === " " ? "false" : "true";
		checkbox.setAttribute("role", "checkbox");
		checkbox.setAttribute("aria-checked", node.checkbox === " " ? "false" : "true");
		if (node.checkbox !== " ") card.addClass("is-checked");
	}

	const text = card.createDiv({ cls: "mm-text" });
	// A cap of its own only where the node box carries the wider one: without
	// it, a title under an annotation would wrap at the annotation's width
	// rather than at its own.
	if (opts.maxWidth.text !== null) text.style.maxWidth = `${opts.maxWidth.text}px`;
	let hasMath = false;
	if (opts.blocks !== null) {
		el.dataset.block = "blocks";
		hasMath = renderBlocks(text, opts.blocks);
	} else if (opts.preformatted) {
		el.dataset.block = "pre";
		text.setText(node.text);
	} else {
		hasMath = renderInline(text, node.text);
	}

	// Inside the card, not beside it. `canPan` already lets a pointerdown on
	// `.mm-card` through, and anything outside it would have to be named there
	// too or the canvas takes pointer capture and swallows the click.
	// Absolutely positioned, so it stays out of flow and cannot move the
	// measurements `measureAndPlace` takes off this element.
	let expand: HTMLElement | null = null;
	if (opts.expandable) {
		expand = card.createDiv({ cls: "mm-expand" });
		expand.setAttribute("role", "button");
		expand.setAttribute("aria-label", t("view.menu.showBlock"));
		setIcon(expand, "maximize-2");
		// `setIcon` is silent when the id is not in the bundled set, which would
		// leave an invisible but clickable box in the corner of every card.
		if (!expand.firstElementChild) expand.setText("⤢");
	}

	// The furniture on the branch side of the card, in one row absolutely
	// positioned against `.mm-row` rather than against `.mm-node`, so it stays
	// centred on the card and flush against it however far the annotation
	// reaches below.
	//
	// At most two circles, and at most one of them is the button. A closed
	// branch shows the count of what is down there; the button shows what a
	// press does right now -- the minus that closes an open branch while the
	// card sits unpicked, the plus that grows a child once the card is picked
	// or all along when there is nothing to close. The state the button answers
	// to is visible without a pointer -- the selection ring -- so a press
	// meaning one thing at rest and another when picked is readable, and it is
	// what the user asked the button to be. See `branchButton.ts`.
	let toggle: HTMLElement | null = null;
	let add: HTMLElement | null = null;
	if (opts.hasChildren || opts.addable) {
		// The button answers to hover and to the picked state, and nothing else:
		// hidden while the card sits unpicked and unhovered, the minus while the
		// pointer is on a branch that can close, the plus for as long as the
		// card is picked. A leaf's button is hover-only for the same reason.
		// The visibility matrix lives in the stylesheet next to `.mm-add`; this
		// side only has to build the button and keep it in sync -- which is
		// `syncBranchButton`'s job whenever the selection or the fold moves
		// without a paint.
		if (opts.hasChildren) el.addClass("has-children");
		const tools = row.createDiv({ cls: "mm-tools" });

		// The count, and only while the branch is closed. It stays out of the
		// button on purpose: the card's furniture is there before the pointer
		// arrives, and the button is not, so a count kept on it would be a
		// number the user can only read by hovering the thing they are about to
		// press. It stays a control all the same -- reopening a branch without
		// hovering to find the button again is the same gesture it always was.
		if (opts.hasChildren && opts.collapsed) {
			toggle = tools.createDiv({ cls: "mm-toggle" });
			toggle.setAttribute("role", "button");
			toggle.setAttribute("aria-label", t("view.node.expand"));
			toggle.setText(String(opts.hiddenCount));
		}

		if (opts.addable) {
			const action = branchAction(opts);
			add = tools.createDiv({
				cls: ["mm-add", showsPlus(action) ? "is-plus" : "is-minus"],
			});
			add.setAttribute("role", "button");
			add.setAttribute(
				"aria-label",
				t(action === "fold" ? "view.node.collapse" : "view.menu.addChild"),
			);
			add.dataset.branchAction = action;
			setIcon(add, branchIcon(action));
			// `setIcon` is silent when the id is not in the bundled set, which
			// would leave an invisible but clickable circle on the card.
			if (!add.firstElementChild) add.setText(action === "fold" ? "−" : "+");
		}
	}

	// Inside the row, below the card: the strip is part of the card the user
	// sees, so it is inside the box that is drawn, and the fill, the border and
	// the ring all cover it. It is an ordinary block, so its width counts
	// towards the node's `max-content`: a strip wider than the title widens the
	// node, and the card with it, up to the cap the node carries.
	//
	// The title keeps its own box -- `.mm-card` -- and the layout is measured
	// off that, not off the row: a connector still meets a card at the title,
	// and a sibling is still spaced by the whole node. See the row-vs-card note
	// in styles.css.
	if (opts.annotation !== null) {
		el.addClass("has-annotation");
		const annotation = row.createDiv({ cls: "mm-text mm-annotation" });
		annotation.setAttribute("aria-label", t("view.node.annotationAria"));
		if (opts.annotation.trim() !== "") {
			hasMath = renderInline(annotation, opts.annotation) || hasMath;
		} else {
			// Never empty: a blank strip still has to occupy its own line.
			annotation.setText(opts.annotation || "\u00a0");
		}
	}

	return {
		el,
		row,
		card,
		text,
		toggle,
		checkbox,
		expand,
		add,
		hasMath,
		offscreen: false,
		measured: false,
	};
}
