import { setIcon } from "obsidian";

import { t } from "../i18n.ts";
import type { LayoutNode } from "../layout/tidyTree.ts";
import type { Block } from "../model/blocks.ts";
import {
	branchAction,
	branchIcon,
	branchLabelKey,
	projectedBranchAction,
	showsPlus,
	BRANCH_FALLBACK_TEXT,
} from "./branchButton.ts";
import type { BranchAction } from "./branchButton.ts";
import { renderBlocks } from "./blocks.ts";
import { renderInline } from "./inline.ts";
import type { InlineRender } from "./inline.ts";
import type { MediaContext } from "./media.ts";
import { moreLinesLabel, previewBlocks } from "./linkPreview.ts";
import type { LinkPreview, SitePreview } from "./linkPreview.ts";
import type { NodeMaxWidth } from "./nodeWidth.ts";

/** Nothing drawn: what a preview with no content of its own reports back. */
const NOTHING_DRAWN: InlineRender = { math: false, media: false };

/**
 * What a card that points at something outside itself draws, or null for every
 * other card.
 *
 * Three things, and they are separate on purpose. The **arrow** is the card's
 * own control rather than the branch button's, because it acts on whatever the
 * card names rather than on the branch under it, and a link card grows no
 * children of its own -- so its branch button is only ever a fold. The
 * **preview** is what the card is showing, and the two are independent: a link
 * card can show its arrow without showing anything else, and a card of the
 * note's own prose can show a preview of a note it mentions without being a
 * link card at all.
 */
export interface LinkCardOptions {
	/**
	 * Whether the card *is* one link rather than prose that mentions one.
	 *
	 * The card whose own title line is a switch, and the reason it can be one:
	 * such a card names exactly one note, so a press on the line has one thing
	 * it could mean. A card of the note's own writing may hold three links, and
	 * a line that had to guess which of them was meant is why it opens its
	 * preview by having the link itself pressed.
	 */
	oneLink: boolean;
	/** Whether this card draws the arrow that opens the other note's outline. */
	arrow: boolean;
	/** Whether that outline is open. */
	subtreeOpen: boolean;
	/** What the card is showing, or null while it is closed. */
	preview: LinkPreview | null;
	/**
	 * How the read behind that preview is going: whether it has landed, and
	 * whether the note is in the vault at all. Null while nothing is open.
	 */
	read: "loading" | "missing" | "ready" | null;
	/**
	 * The site the card leads to, when the link leaves the vault.
	 *
	 * Non-null means the preview names a place rather than showing a note's
	 * words: there is no file to read, and the card's one action is to hand the
	 * address to the browser.
	 */
	site: SitePreview | null;
	/** The line the footer offers: the whole note, or the browser. */
	footer: "note" | "site";
}

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
	 * The licence to draw pictures and videos, or null when the map is not
	 * drawing them. Null is the chip an embed has always been.
	 */
	media: MediaContext | null;
	/**
	 * Render the text verbatim: a sample or a table, which are drawn in a
	 * monospace face where alignment carries meaning. Only reached when
	 * `blocks` is null, which is every card the block parser did not claim.
	 */
	preformatted: boolean;
	/** Draw the branch-side button at all. Off for note content. */
	addable: boolean;
	/**
	 * The card folds its own content instead of a branch under it.
	 *
	 * True for a note-content card holding code, which is the one card whose
	 * body is long enough to be worth closing and which has no branch to close
	 * instead. It is what gives such a card the button at all -- `addable` is
	 * false for every note-content card, and a card with neither has nothing
	 * for the button to do.
	 */
	collapsible: boolean;
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
	/**
	 * The card stands for a node of another note: the outline the arrow pulled
	 * in, rather than a line of the note being mapped.
	 *
	 * It draws like any other card, and it is marked so the interaction layer
	 * can leave it alone -- a projected card is read-only, and every gesture
	 * that would write to the note has to be refused before it starts rather
	 * than after it fails silently. See `view/interactions.ts`.
	 */
	projected: boolean;
	/** How this card draws the note it points at, when it points at one. */
	link: LinkCardOptions | null;
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
	add: HTMLElement | null;
	hasMath: boolean;
	/**
	 * The card holds a picture or a video. Owned by the builder rather than by
	 * the view, because only the builder saw what the note's markup turned
	 * into -- and the view needs it to know which cards a cull may not measure
	 * until the media inside them has landed.
	 */
	hasMedia: boolean;
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
	if (opts.projected) el.addClass("is-projected");
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
	let hasMedia = false;
	if (opts.blocks !== null) {
		el.dataset.block = "blocks";
		const drawn = renderBlocks(text, opts.blocks, opts.media);
		hasMath = drawn.math;
		hasMedia = drawn.media;
	} else if (opts.preformatted) {
		el.dataset.block = "pre";
		text.setText(node.text);
	} else {
		const drawn = renderInline(text, node.text, opts.media);
		hasMath = drawn.math;
		hasMedia = drawn.media;
	}

	// The title line itself is a switch, on a card that is one link or on one
	// already showing a block: a reader pressing the line means the block far
	// more often than they mean the card. What the block is says what the press
	// does, and the label is how the card says so -- a line that opens when
	// pressed and looks like every other line is a switch nobody finds. The
	// button beside the text keeps its own meaning; `interactions.ts` routes
	// the press, and it is what leaves the block below alone.
	//
	// No `title` beside the label: the hint is the row's own `aria-label`, and a
// native tooltip over it would be a second balloon where the card already has
// one.
	if (opts.link !== null && (opts.link.oneLink || opts.link.preview !== null)) {
		card.addClass("mm-opens-preview");
		card.setAttribute("aria-label", t("view.link.rowHint"));
	}
	// And which of the two kinds of line this is, because the press reads them
	// differently: on a card that *is* one link the words on the line are that
	// link, so the whole line is the switch and there is no press left over for
	// the link itself; on a card of prose the words are that card's own links
	// and keep their own meaning. See the line rule in `interactions.ts`.
	if (opts.link !== null && opts.link.oneLink) card.addClass("mm-one-link");

	// The card's own control, on the title's own line so it is measured with
	// the title rather than placed over it: whether the other note's outline is
	// open under this card. One button, and no second meaning for the card
	// itself -- a press anywhere else on the line opens what the card is
	// showing, and a press anywhere else on the card picks it, which is what a
	// press on a card means everywhere else in this map.
	//
	// On the stylesheet side the button is an auto margin away from the text,
	// which costs the card nothing while the outline is shut and puts it on the
	// card's far edge the moment the preview widens the row. The wrapper is what
	// carries that margin, and it stays whether or not the arrow is drawn.
	if (opts.link !== null && opts.link.arrow) {
		const tools = card.createDiv({ cls: "mm-link-tools" });
		buildLinkArrow(tools, opts.link);
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
	if (opts.hasChildren || opts.addable || opts.collapsible) {
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
		//
		// Only for a card with a branch under it, though: the count says how
		// many cards a fold is holding back, and a note-content card has no
		// cards to hold. What a folded block needs is not a number but the way
		// back out, and that is the button -- which the stylesheet holds out in
		// the open for as long as a block is folded, exactly where a branch's
		// count would have been.
		if (opts.hasChildren && opts.collapsed) {
			toggle = tools.createDiv({ cls: "mm-toggle" });
			toggle.setAttribute("role", "button");
			toggle.setAttribute("aria-label", t("view.node.expand"));
			toggle.setText(String(opts.hiddenCount));
		}

		if (opts.addable || opts.collapsible || opts.projected) {
			const action = branchButtonAction(opts);
			if (action !== null) {
				add = tools.createDiv({
					cls: ["mm-add", showsPlus(action) ? "is-plus" : "is-minus"],
				});
				add.setAttribute("role", "button");
				add.setAttribute("aria-label", t(branchLabelKey(action)));
				add.dataset.branchAction = action;
				setIcon(add, branchIcon(action));
				// `setIcon` is silent when the id is not in the bundled set, which
				// would leave an invisible but clickable circle on the card.
				if (!add.firstElementChild) add.setText(BRANCH_FALLBACK_TEXT[action]);
			}
		}
	}

	// Inside the row, below the title: what the note the card points at actually
	// says, and the way into the whole of it. Both inside the drawn box, for the
	// reason the annotation strip is -- the fill, the border and the ring cover
	// the card and everything hanging off it as one thing.
	//
	// The preview comes first, then the footer, then the annotation: what the
	// note says, then how to leave for it, then what this node's own note has to
	// say about the link. A card can have all three at once.
	//
	// A closed card draws neither. What it is stays one line -- the title and
	// the arrow -- so a map of a note that links to twenty others is still a map
	// and not twenty paragraphs of somebody else's prose.
	if (opts.link !== null && opts.link.preview !== null) {
		// What it drew, folded into what the card waits for: a preview with a
		// picture in it is a card whose layout is not final until that picture
		// has landed, exactly as a card of the note's own prose is.
		const drawn = buildLinkPreview(row, opts.link, opts.media);
		hasMath = hasMath || drawn.math;
		hasMedia = hasMedia || drawn.media;
		buildLinkFoot(row, opts.link);
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
			const drawn = renderInline(annotation, opts.annotation, opts.media);
			hasMath = drawn.math || hasMath;
			hasMedia = drawn.media || hasMedia;
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
		add,
		hasMath,
		hasMedia,
		offscreen: false,
		measured: false,
	};
}

/**
 * What this card's branch button would do, or null when it draws none.
 *
 * A projected card answers out of `projectedBranchAction` rather than out of
 * `branchAction`, and the difference is the whole of the rule: it can be closed
 * and opened but never grown. Every other card's answer is the one the press
 * will act on -- see `branchAction`.
 */
function branchButtonAction(opts: NodeElementOptions): BranchAction | null {
	if (opts.projected) return projectedBranchAction(opts);
	return opts.addable || opts.collapsible ? branchAction(opts) : null;
}

/**
 * The arrow that opens the other note's outline under this card.
 *
 * Always there, on every link card, whether the note is open under it or not:
 * it is the one control the card carries that acts on the note rather than on
 * the branch, and a preview that only appeared once you had already found it
 * would be a preview nobody finds.
 */
function buildLinkArrow(parent: HTMLElement, link: LinkCardOptions): void {
	const arrow = parent.createDiv({ cls: "mm-link-arrow" });
	if (link.subtreeOpen) arrow.addClass("is-open");
	arrow.setAttribute("role", "button");
	arrow.setAttribute("tabindex", "0");
	// The icon and the label answer the same question, asked once: an arrow
	// turned down is a branch already open, and the label is how a screen
	// reader hears the same thing without seeing the arrow at all.
	const label = t(link.subtreeOpen ? "view.link.collapseOutline" : "view.link.expandOutline");
	// `aria-label` alone, and no `title`: Obsidian draws its own tooltip out of
	// the label, and a `title` beside it is the browser's grey box on top of
	// that one -- two tooltips for one button.
	arrow.setAttribute("aria-label", label);
	arrow.setAttribute("aria-expanded", link.subtreeOpen ? "true" : "false");
	setIcon(arrow, "chevron-right");
	// `setIcon` is silent when the id is not in the bundled set, which would
	// leave an invisible but clickable dot on the card. What goes in its place
	// is the same shape the icon is -- a chevron, drawn by the character that
	// is one -- and not a triangle: a filled triangle is a different control to
	// most readers, the one that means *play*, and this arrow is not that. The
	// turn when the branch opens is the stylesheet's, on the span as on the
	// icon, so a fallback is not a second design.
	if (!arrow.firstElementChild) {
		arrow.createSpan({ cls: "mm-link-arrow-glyph", text: "\u203a" });
	}
}

/**
 * What the card is showing, under the title.
 *
 * Three states for a note and one for a site. The note's three are the read not
 * landed, the note not there, and here are its words: showing nothing while the
 * read is in flight would make the card jump from closed to filled with no
 * account of the wait, and showing nothing because the note is missing would
 * look like the same bug twice.
 *
 * The words go through `renderBlocks`, the same renderer a card of the note's
 * own prose is drawn with -- which is the point of doing it here rather than
 * with `renderInline` per line. A sample, a table and a callout cannot survive
 * being read as characters, and a preview that read them that way was showing
 * the reader `| a | b |` and ``` where the note had drawn a table and a sample.
 * Pictures and videos come with it for the same reason and by the same door:
 * the media context is the card's own, so what the map's settings say about
 * pictures is what the preview does about them.
 *
 * Nothing heads the block. It used to open with a line holding the word for
 * putting it away, on the argument that a preview can be taller than the screen
 * and its way out should not be a scroll away -- but the way out is above the
 * block in every case: the title line is the switch, and it is the switch for
 * the card that is one link and for the card of the note's own prose a pressed
 * link opened alike. A second way out costs a line of the reader's map to say
 * what the line above already says.
 */
function buildLinkPreview(
	row: HTMLElement,
	link: LinkCardOptions,
	media: MediaContext | null,
): InlineRender {
	const site = link.site;
	// `.mm-text` as well as its own class, for the reason the annotation strip
	// carries it: everything `renderBlocks` emits is styled under `.mm-text`,
	// and a preview is a text box in a card like any other.
	const box = row.createDiv({
		cls: site === null ? ["mm-text", "mm-preview"] : ["mm-text", "mm-preview", "is-site"],
	});
	box.setAttribute(
		"aria-label",
		t(site === null ? "view.link.previewAria" : "view.link.siteAria"),
	);

	if (site !== null) {
		box.createDiv({ cls: "mm-site-host", text: site.host });
		if (site.path !== "" && site.path !== "/") {
			box.createDiv({ cls: "mm-site-path", text: site.path });
		}
		return NOTHING_DRAWN;
	}

	const preview = link.preview;
	if (preview === null) return NOTHING_DRAWN;

	if (link.read !== "ready") {
		box.createDiv({
			cls: ["mm-preview-line", "is-hint"],
			text: t(link.read === "missing" ? "view.link.missing" : "view.link.loading"),
		});
		return NOTHING_DRAWN;
	}
	if (preview.lines.length === 0) {
		box.createDiv({ cls: ["mm-preview-line", "is-hint"], text: t("view.link.empty") });
		return NOTHING_DRAWN;
	}

	const drawn = renderBlocks(box, previewBlocks(preview), media);
	if (preview.more > 0) {
		box.createDiv({ cls: "mm-preview-more", text: moreLinesLabel(preview.more) });
	}
	return drawn;
}

/**
 * The way out of the card.
 *
 * On every open card, whatever the settings say, because it is the card's own
 * promise: a link that could not be followed from where it stands would be a
 * link this map had broken. The one sentence left on the line -- the badge that
 * used to sit at its other end is gone, and the preview's own colour and rule
 * are what say the words above them were read out of another file.
 */
function buildLinkFoot(row: HTMLElement, link: LinkCardOptions): void {
	const foot = row.createDiv({ cls: "mm-link-foot" });
	const open = foot.createDiv({
		cls: "mm-link-open",
		text: t(link.footer === "site" ? "view.link.openSite" : "view.link.openNote"),
	});
	open.setAttribute("role", "button");
	open.setAttribute("tabindex", "0");
}
