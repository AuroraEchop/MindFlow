import {
	Keymap,
	MarkdownView,
	Menu,
	Notice,
	Platform,
	Scope,
	TextFileView,
	setIcon,
} from "obsidian";
import type {
	KeymapContext,
	KeymapEventHandler,
	KeymapEventListener,
	Modifier,
	TFile,
	WorkspaceLeaf,
} from "obsidian";

import { t } from "../i18n.ts";
import type { I18nKey } from "../i18n.ts";

import { parseMarkdown } from "../model/parse.ts";
import { annotationText, bodyCardCount } from "../model/annotations.ts";
import { needsBlocks, parseBlocks } from "../model/blocks.ts";
import type { Block } from "../model/blocks.ts";
import type { MindNode, ParsedDoc } from "../model/types.ts";
import {
	addChild,
	addSibling,
	addSiblingBefore,
	addBlock,
	bodyRangeText,
	canMove,
	canMoveBodyBlock,
	canRename,
	canReorder,
	canReorderDown,
	canReorderUp,
	deleteNode,
	indentNode,
	moveAfter,
	moveBefore,
	moveBodyBlock,
	moveNode,
	outdentNode,
	renameNode,
	setAnnotation,
	reorderDown,
	reorderUp,
	replaceBodyRange,
	removeCheckbox,
	toggleCheckbox,
	deleteNodes,
	moveNodesAfter,
	moveNodesBefore,
	moveNodesInto,
} from "../model/mutate.ts";
import type { Mutation } from "../model/mutate.ts";
import { hasMoreThanOneLine, toText, spliceLines } from "../model/lines.ts";
import { linkMarkup, noteNameFrom, soleLink, unlinkedText } from "../model/noteName.ts";

import {
	foldedToFirstLevel,
	hiddenAncestorKeys,
	refoldKeys,
	searchTree,
} from "../model/search.ts";
import type { SearchQuery } from "../model/search.ts";
import { replaceInTree } from "../model/replace.ts";

import { createLayoutNode, layoutTree } from "../layout/tidyTree.ts";
import type { LayoutNode, LayoutResult } from "../layout/tidyTree.ts";
import { buildCanvas, randomId, serializeCanvas } from "../export/canvasFile.ts";
import { snapshotMap } from "../export/snapshot.ts";
import type { Snapshot } from "../export/snapshot.ts";
import { EXPORT_COMMANDS, runExport } from "../export/run.ts";
import type { ExportFormat } from "../export/run.ts";
import { Canvas } from "./canvas.ts";
import {
	branchAction,
	branchIcon,
	branchLabelKey,
	showsPlus,
	BRANCH_FALLBACK_TEXT,
} from "./branchButton.ts";
import type { BranchButtonState } from "./branchButton.ts";
import { Frame } from "./frame.ts";
import { clampedMargin, covers, emptyPlan, overlaps, planCull, viewBoxFrom } from "./culling.ts";
import type { CullPlan, ViewBox } from "./culling.ts";
import { Perf } from "./perf.ts";
import { createEdgeLayer, renderEdges } from "./edges.ts";
import type { EdgeStyle } from "./edges.ts";
import { buildNodeElement } from "./nodes.ts";
import type { NodeElement } from "./nodes.ts";
import { renderInline } from "./inline.ts";
import { openInlineEditor } from "./inlineEditor.ts";
import type { InlineEditorHost } from "./inlineEditor.ts";
import { NotePickerModal, createNoteBeside, linkTextFor } from "./noteLink.ts";
import { activateMedia, mediaLoading, whenMediaReady } from "./media.ts";
import type { MediaContext, MediaSize } from "./media.ts";
import { Lightbox } from "./lightbox.ts";
import { inlineExportMedia } from "../export/media.ts";
import { ToastStack } from "./toast.ts";
import { nodeMaxWidth } from "./nodeWidth.ts";
import { attachInteractions } from "./interactions.ts";
import {
	SHORTCUTS,
	comboFromEvent,
	comboToString,
	resolveAction,
	resolveBindings,
	survivesEditing,
} from "./shortcuts.ts";
import type { KeyCombo, ShortcutBindings } from "./shortcuts.ts";
import { SearchBar } from "./searchBar.ts";
import type { ReplaceScope } from "./searchBar.ts";
import { SettingsModal } from "./settingsModal.ts";
import {
	clearMathCache,
	ensureMath,
	finishRenderMath,
	mathAvailable,
	mathSettled,
	resetPendingMath,
	upgradePendingMath,
} from "./math.ts";
import type { Direction, DropMode, MapController } from "./interactions.ts";
import { resolveIndentUnit } from "../settings.ts";
import { CARD_STYLE_CLASSES, cardStyleClass } from "./cardStyle.ts";
import { pushRevision } from "../undoPark.ts";
import type { UndoStacks } from "../undoPark.ts";
import type MindmapPlugin from "../main.ts";

export const MINDMAP_VIEW_TYPE = "mindflow-view";

/** How far a press has to travel before it is a drag rather than a click. */
const TOOLBAR_DRAG_THRESHOLD = 5;

/** Kept inside its host: a corner dragged off the edge cannot be dragged back. */
function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/**
 * Depth kept open when a map is first painted. 0 would leave only the root, 1
 * shows the root plus its top-level branches with a descendant count on each
 * toggle -- compact enough to scan, complete enough to navigate.
 */
const INITIAL_EXPAND_LEVEL = 1;

/** Separates a body card's id from its owner's. Never appears in a parsed id. */
const BODY_ID_MARK = "$body";

/** Body cards show their block in full up to this much, then trail off. */
const BODY_PREVIEW_CHARS = 2000;
const BODY_PREVIEW_LINES = 40;

/**
 * How far past the edge of the viewport a card is still kept in the document,
 * in screen pixels.
 *
 * The whole map lives in one composited layer, so everything in it is content
 * the browser rasterises and hit-tests whether or not it is on screen -- and a
 * map of a few hundred cards is tens of thousands of pixels tall. Only what is
 * nearly in view earns its place; the margin is what stops a card appearing at
 * the edge of the screen mid-pan, and what leaves room for the tools row that
 * hangs outside a card's own box.
 */
const CULL_MARGIN = 400;

/**
 * The same, for the connector layer, and deliberately much wider.
 *
 * Connectors are inert -- one SVG, no pointer events, no style of their own to
 * recalculate -- so the only thing culling them saves is the size of the paint
 * list, and rebuilding the layer costs an invalidation of the whole thing. At
 * this margin a pan crosses out of the drawn region every screenful or so
 * rather than every frame, which is what keeps the layer still while the
 * camera moves over it.
 */
const EDGE_MARGIN = 1600;

/**
 * How much further than `CULL_MARGIN` a card has to travel before it is taken
 * out again, in screen pixels.
 *
 * Show and hide on the same boundary makes a card sitting on it flip on every
 * other frame of a slow pan -- a style recalc and a paint apiece, for a card
 * nobody can see either way. The band is the whole fix: it comes back early and
 * leaves late.
 */
const CULL_HYSTERESIS = 200;

/**
 * The furthest the connector layer is ever drawn past the viewport, in *content*
 * pixels.
 *
 * `EDGE_MARGIN` is a screen distance, so zooming out multiplies it: at the
 * smallest zoom it asks for sixteen thousand content pixels on every side, and
 * the whole layer is rebuilt each time the camera leaves that region. The cap
 * has to stay above `CULL_MARGIN` divided by the smallest zoom, or the drawn
 * region stops containing the cards' own box and `covers` fails every frame.
 */
const EDGE_MAX_CONTENT = 6000;

/**
 * How many cards may have their `is-offscreen` class flipped in one frame.
 *
 * The scan is arithmetic and runs over the whole map; this caps only the part
 * that touches the DOM, because a few hundred class flips in one frame is a
 * style recalc long enough to drop it. Whatever is left over is carried to the
 * next frame, which is why the continuation exists.
 */
const CULL_BUDGET = 150;

/**
 * How many times a cull may measure cards it just showed and lay the map out
 * again before it leaves the rest to the next one.
 *
 * Each round is a whole layout, and what it corrects are sizes that were real
 * measurements to begin with, so stopping early costs a little drift and never
 * a wrong map.
 */
const REMEASURE_ROUNDS = 3;

/**
 * Cards on screen at once past which the map stops animating its hovers.
 *
 * Past this, a pointer crossing the map costs more style recalculation than the
 * transitions are worth; `mm-dense` in `styles.css` is what turns them off.
 */
const DENSE_NODE_COUNT = 300;

/**
 * What asked for the work, carried into the timing log so a slow map can be
 * read as "typing is slow" rather than as a list of milliseconds.
 */
export type PaintReason =
	| "edit"
	| "fold"
	| "search"
	| "settings"
	| "resize"
	| "setViewData"
	| "math-remeasure"
	| "media-remeasure"
	| "cull"
	| "export";

/**
 * What a body card shows. The full text stays one click away on the card's own
 * expand button, so this only has to stop a 300-line code block from becoming a
 * 300-line card.
 */
function previewOf(text: string): string {
	const lines = text.replace(/\s+$/, "").split("\n");
	let clipped = lines.length > BODY_PREVIEW_LINES;
	let out = lines.slice(0, BODY_PREVIEW_LINES).join("\n");
	if (out.length > BODY_PREVIEW_CHARS) {
		out = out.slice(0, BODY_PREVIEW_CHARS);
		clipped = true;
	}
	return clipped ? `${out.replace(/\s+$/, "")}…` : out;
}

/**
 * A text block's preview, with blank lines and leading indentation stripped:
 * the indent is structural metadata (it tells the parser this line belongs to
 * the list item above), not something to read on the card.
 */
function blockPreviewOf(text: string): string {
	const stripped = text
		.split("\n")
		.map((line) => line.replace(/^[ \t]+/, ""))
		.filter((line) => line.trim() !== "")
		.join("\n");
	return previewOf(stripped);
}

/**
 * The one line a folded card keeps: the first line of the block that says
 * anything at all.
 *
 * A body range under a heading or a list item usually opens with the blank line
 * that separates it from the item above -- the blank is part of the range, which
 * is why `hasMoreThanOneLine` counts content rather than lines. Taking the
 * literal first line would give those cards a fold that showed an empty card,
 * and for a fenced sample drawn through the block parser the leading blank is
 * not even trimmed away first. Blank lines are skipped for the same reason
 * `blockPreviewOf` drops them: they are the note's spacing, not its content.
 *
 * Indentation is kept. A sample's fence is indented in the note, and the folded
 * card is meant to read as the note does.
 */
function firstLineOf(text: string): string {
	for (const line of text.split("\n")) {
		if (line.trim() !== "") return line;
	}
	return "";
}

/** Somewhere a keystroke means a character rather than a command. */
function inTextField(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.isContentEditable ||
		target.tagName === "INPUT" ||
		target.tagName === "TEXTAREA"
	);
}

/**
 * Blocks that must keep their own shape: fenced code, indented code and tables.
 * These skip the inline markdown pass, so a `**` inside a code sample stays a
 * `**`, and they are drawn in a monospace face where alignment carries meaning.
 */
function looksPreformatted(text: string): boolean {
	return /^(?:```|~~~|\t| {4}|\|)/.test(text);
}

/**
 * A block that is a code sample, as opposed to prose or a table.
 *
 * The same question `beginBodyEdit` and `makeBodyNode` both ask, asked here so
 * there is one answer -- and `canDragBody` asks it a third time, because a
 * sample is the one block the user may pick up and move. Nothing about folding
 * goes through here: what a card may fold is a question about its line range,
 * not about what those lines are (`hasMoreThanOneLine`).
 */
function looksCode(text: string): boolean {
	return /^\s*(```|~~~)/.test(text);
}

interface PendingFocus {
	line: number;
	edit: boolean;
}

/** Where a body card came from, so its editor can find the range again. */
interface BodyRef {
	ownerKey: string;
	index: number;
	/**
	 * The block structure to draw, or null for the plain one-run card.
	 *
	 * Parsed once, where the card's text is prepared, rather than in the
	 * builder: it is the same question twice, and the answer is what decided
	 * how the text was prepared in the first place.
	 */
	blocks: Block[] | null;
}

/**
 * A node to hold still across a repaint, and the viewport point to hold it at.
 *
 * Folding re-runs the whole layout, and `normalize` re-origins every card on the
 * new bounding box, so without this the entire map slides under the cursor even
 * though the branch you clicked is where you left it.
 */
interface Anchor {
	key: string;
	screenX: number;
	screenY: number;
}

/**
 * What a paint owed the camera, held for the MathJax wait that follows it.
 *
 * The framing is spent by the paint that promised it, and the map the user ends
 * up looking at is the one the formulas were rendered into -- so a paint that
 * was going to fit, focus or reveal has to be able to promise it again.
 */
interface Framing {
	fit: boolean;
	focus: string | null;
	reveal: string | null;
}

export class MindmapView extends TextFileView implements MapController {
	readonly canvas: Canvas;
	/** The enlarged preview, a child of `contentEl` rather than of the map. */
	private readonly lightbox: Lightbox;

	private readonly plugin: MindmapPlugin;
	private edgeLayer: SVGSVGElement | null = null;
	private nodeLayer: HTMLElement | null = null;
	private parsed: ParsedDoc | null = null;
	private layoutNodes: LayoutNode[] = [];
	/**
	 * The same entries as `layoutNodes`, reachable by node id and by key.
	 *
	 * `layoutFor` asks by id -- the index path. `selectedNode` and `markAnchor`
	 * ask by key, because a key is the text-derived path that survives a
	 * re-parse, and so is what the selection and the scroll anchor are held as.
	 * All three used to be linear scans of the whole array, and two of them sit
	 * on paths a pointer move reaches. Written only through `setLayoutNodes`, so
	 * the array and its indexes cannot drift apart.
	 */
	private layoutById = new Map<string, LayoutNode>();
	private layoutByKey = new Map<string, LayoutNode>();
	private elements = new Map<string, NodeElement>();
	/**
	 * The card for each entry of `layoutNodes`, at the same index.
	 *
	 * Filled once per paint so the scan behind every pan frame is an array read
	 * rather than a string-keyed lookup per node.
	 */
	private layoutElements: Array<NodeElement | null> = [];
	/** Reused between frames: a pan plans its culling without allocating. */
	private readonly cullPlan: CullPlan = emptyPlan();
	/**
	 * The one frame everything the view defers reaches it through: the cull's
	 * continuation when a budget ran out, and the pane resize, which may not do
	 * any of its work where Obsidian calls it from.
	 */
	private readonly frame = new Frame(window);
	/** A pane resize the frame has not acted on yet. */
	private resized = false;
	/**
	 * The tree the last paint built, kept so a cull that puts an unmeasured card
	 * back can measure it and lay the map out again around it.
	 */
	private paintRoot: LayoutNode | null = null;
	/** True while that re-measure is running, so it cannot re-enter itself. */
	private remeasuring = false;
	/**
	 * The natural size of every picture and video this map has drawn.
	 *
	 * Kept across paints on purpose. A paint rebuilds every card, so without
	 * this a picture would arrive empty on every keystroke and cost a second
	 * measurement each time; with it, only the first look at a picture waits.
	 * Thrown away with the math cache -- a different note, or a different
	 * vault -- which is the same rule and the same two places.
	 */
	private readonly mediaSizes = new Map<string, MediaSize>();
	/** Cards whose media has landed and which the next flush has to measure. */
	private mediaRoot: LayoutNode | null = null;
	private mediaCards: LayoutNode[] = [];
	/** The camera the paint owed, for the first flush and only that one. */
	private mediaFraming: Framing | null = null;
	private mediaAnchor: Anchor | null = null;
	private mediaDirty = false;
	/** The coalescing timer. A burst of loads is one measurement, not twenty. */
	private mediaTimer: number | null = null;
	/** The laid-out size of the whole map, for redrawing the connector layer. */
	private mapWidth = 0;
	private mapHeight = 0;
	/** The region the connectors were last drawn for. Null means "all of it". */
	private edgeView: ViewBox | null = null;

	private collapsedKeys = new Set<string>();
	/**
	 * Note-content cards the user has folded down to their first line.
	 *
	 * Keyed by the body node's own key, which is `ownerKey + BODY_ID_MARK +
	 * index`, and kept apart from `collapsedKeys` rather than mixed into it:
	 * that set is the map's fold shape, and `isDefaultFold` compares it against
	 * the fold-to-depth seed by size. A card that folds its own body has no
	 * place in that comparison, and one loose key in there would make every
	 * note look like the user had folded something by hand.
	 *
	 * Both sets are written to the same `collapsed` array in the plugin's data,
	 * because that is where the user's fold state already lives -- the two are
	 * told apart on the way back in by the marker in the key. Nothing here
	 * touches the note.
	 */
	private collapsedBodies = new Set<string>();
	private foldSeedPending = false;
	/**
	 * A restored focus waiting for the first framing to honour it.
	 *
	 * Not `pendingFocus`, which is where an edit wants the caret. This one only
	 * decides where the camera lands when a note opens: on the node the user was
	 * last working on, or -- when that node is gone, renamed out from under its
	 * key, or hidden inside a branch they left folded -- on the whole map.
	 */
	private restoreFocusKey: string | null = null;
	/** Body cards drawn by the last paint, keyed by their synthetic id. */
	private bodyNodes = new Map<string, BodyRef>();
	/** Consumed by the next paint. */
	private anchor: Anchor | null = null;
	private selectionKey: string | null = null;
	/**
	 * The rest of a multiple selection.
	 *
	 * `selectionKey` stays the anchor -- the card the keyboard acts on, the one
	 * a step of `navigate` measures from -- and this holds everything a shift
	 * click or a band added to it. Empty for the ordinary single selection, so
	 * nothing that only ever reads the anchor had to learn about it.
	 */
	private extraKeys = new Set<string>();
	private editingId: string | null = null;
	/**
	 * The title element a card is being edited in, and what it held when the
	 * editor opened. Together they are the answer to "has anything been typed",
	 * which is what decides whether undo belongs to the card or to the map.
	 */
	private editTextEl: HTMLElement | null = null;
	private editStartText: string | null = null;
	/** Ends the edit in progress. True writes the text back to the note. */
	private endEdit: ((save: boolean) => void) | null = null;
	private pendingFocus: PendingFocus | null = null;

	private undoStack: string[] = [];
	private redoStack: string[] = [];
	/**
	 * The map's own messages, drawn on the map rather than in Obsidian's corner.
	 *
	 * `undo` is the one caller today, and the reason it is not `Notice`: a run of
	 * empty-undo messages arrives in a burst, and Obsidian puts its notices over
	 * the tab strip and the window controls. See `toast.ts` for the rest.
	 */
	private readonly notices: ToastStack;

	private search: SearchBar | null = null;
	/** Kept when the bar closes, dropped when the file changes. */
	private searchQuery: SearchQuery = { text: "", regex: false };
	/** The replace field's contents, remembered on the same terms. */
	private searchReplacement = "";
	/** The current match list, in document order. */
	private matchKeys: string[] = [];
	private matchIndex = 0;
	/**
	 * Branches this search session opened to show a match.
	 *
	 * Handed back as the session moves rather than all at once at the end:
	 * stepping to a match elsewhere folds every recorded branch that is not on the
	 * new match's own path, so the map never accumulates the trail of a search.
	 * Closing the bar folds the rest -- except that same path, because the card
	 * the query was asked for has to still be there once the bar is gone. A branch
	 * the user folds or unfolds themselves meanwhile is theirs and drops out of
	 * the set.
	 */
	private searchRevealed = new Set<string>();
	/** A match to bring into view once the next paint has measured it. */
	private pendingReveal: string | null = null;

	/**
	 * The resolved key table, rebuilt on demand.
	 *
	 * Dropped by `refresh`, which is what the plugin calls after a setting is
	 * written -- so a shortcut rebound in the settings tab is live in every open
	 * map before the tab is even closed.
	 */
	private shortcutBindings: ShortcutBindings | null = null;
	/** What `bindScope` registered, so a rebinding can take them off again. */
	private scopeHandlers: KeymapEventHandler[] = [];

	private detachInteractions: (() => void) | null = null;
	/** The corner, kept so its visibility can follow the selection. */
	private toolbars: HTMLElement | null = null;
	/** The fold button, kept because what it says depends on the map. */
	private foldButton: HTMLElement | null = null;
	private popover: HTMLElement | null = null;
	private needsFit = true;
	private paintedEmpty = false;
	private paintToken = 0;
	/** Off unless the user asked for it, and one branch per call site when off. */
	private readonly perf = new Perf();

	constructor(leaf: WorkspaceLeaf, plugin: MindmapPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.perf.enabled = plugin.settings.debugTiming;

		this.contentEl.addClass("mindflow");
		this.notices = new ToastStack(this.contentEl);
		this.canvas = new Canvas(this.contentEl, {
			wheel: plugin.settings.wheel,
			// Only blank space starts a pan; everything a node owns belongs to the
			// drag and click handlers. The whole node, not just the card: the
			// toggle, the add button and the annotation strip all sit outside the
			// card, and letting a pan start on one means the canvas takes pointer
			// capture, after which Chromium retargets the click to the viewport
			// and the button never fires. A leaf's empty tools slot is still
			// pannable because that row is `pointer-events: none` until hovered,
			// so the pointer never lands on the node at all.
			// Shift is spoken for: on a card it extends the selection, and on
			// blank canvas it bands one. Neither is a pan, so the press is left
			// to whoever handles it.
			//
			// With the drag mode off, blank canvas is not the camera's at all:
			// the press draws a band, and moving the map waits for the pan key.
			// That is the one place the setting is read here -- `dragToPan` is
			// what `interactions.ts` asks as well, so the band and the camera
			// cannot both claim the same press.
			canPan: (target, ev) =>
				this.plugin.settings.dragToPan && !ev.shiftKey && !target.closest(".mm-node"),
			// Every camera move ends up here, coalesced to one call a frame:
			// panning, zooming, fitting, and the jumps that framing does.
			onView: () => this.cullToView(),
		});
		this.canvas.viewport.tabIndex = 0;
		// A sibling of the viewport, not a child of it: the preview must not
		// pan or zoom with the map underneath it.
		this.lightbox = new Lightbox(this.app, this.contentEl);
		this.buildToolbar();
		this.scope = this.buildScope();
	}

	/**
	 * The hotkeys a map owns while its tab is the active one.
	 *
	 * Obsidian pushes a view's scope whenever its leaf is active, whatever inside
	 * the view happens to hold the DOM focus -- which is the whole point: the
	 * viewport handler in `interactions.ts` only fires once a card has been
	 * clicked, so a map that was just opened saw no find key at all. `View.scope`
	 * is what raised `minAppVersion` to 1.5.7; the viewport handler stays as the
	 * path that also holds when the keymap is busy with a scope of its own.
	 */
	private buildScope(): Scope {
		const scope = new Scope(this.app.scope);
		this.bindScope(scope);
		return scope;
	}

	/**
	 * Puts the scoped actions on the keys they are bound to now, replacing
	 * whatever they were on before, so rebinding "Find in the map" moves this
	 * path along with the viewport handler rather than leaving the old key half
	 * working.
	 *
	 * `edit-annotation` is registered here rather than only in the viewport's
	 * keydown handler because Ctrl+Enter is swallowed by Obsidian's keymap
	 * pipeline before it reaches a DOM-level addEventListener. Scope registration
	 * hooks into that pipeline directly, which is the only path the combination
	 * survives on.
	 */
	private bindScope(scope: Scope): void {
		for (const handler of this.scopeHandlers) scope.unregister(handler);
		this.scopeHandlers = [];

		const bindings = this.bindings();
		for (const combo of bindings.search) {
			this.registerScoped(scope, combo, (evt) => {
				evt.preventDefault();
				this.openSearch();
				return false;
			});
		}
		// Only ours while a bar is up. Returning anything but `false` hands the
		// key straight on, so every other meaning it has in Obsidian is left
		// alone.
		for (const combo of bindings["close-search"]) {
			this.registerScoped(scope, combo, () => !this.closeSearch());
		}
		// edit-annotation is registered through scope because Ctrl+Enter does
		// not reach the viewport's DOM keydown listener — Obsidian's keymap
		// pipeline claims it first. Scope is the only way in.
		for (const combo of bindings["edit-annotation"]) {
			this.registerScoped(scope, combo, (evt) => {
				const id = this.selectedId();
				if (!id || this.isEditing()) return true;
				evt.preventDefault();
				this.editAnnotation(id);
				return false;
			});
		}
	}

	private registerScoped(scope: Scope, combo: KeyCombo, run: KeymapEventListener): void {
		const modifiers: Modifier[] = [];
		if (combo.mod) modifiers.push("Mod");
		if (combo.alt) modifiers.push("Alt");
		if (combo.shift) modifiers.push("Shift");

		// A press with no modifier is a character somebody may be typing, and
		// this scope answers wherever the focus is -- including the find bar's
		// own input. Escape and the named keys are not characters, so they are
		// left to fire.
		//
		// `KeymapEventListener` answers `false | any`, and only the `false` is
		// load-bearing -- every other value hands the key on -- so what `run`
		// said comes back as that one distinction rather than as an untyped
		// value passed straight through.
		const guarded =
			modifiers.length === 0 && combo.key.length === 1
				? (evt: KeyboardEvent, ctx: KeymapContext): boolean =>
						inTextField(evt.target) ? true : run(evt, ctx) !== false
				: run;

		// Obsidian matches a registered key against an interpreted "virtual key",
		// and which case it normalises a letter to is not part of the public API:
		// `hotkeys.json` spells them uppercase, a KeyboardEvent reports "f". Both
		// spellings are registered rather than betting on one -- both handlers do
		// the same idempotent thing, so a keymap that ran both costs nothing.
		const keys =
			combo.key.length === 1 && combo.key.toLowerCase() !== combo.key.toUpperCase()
				? [combo.key.toUpperCase(), combo.key.toLowerCase()]
				: [combo.key === "Space" ? " " : combo.key];
		for (const key of keys) this.scopeHandlers.push(scope.register(modifiers, key, guarded));
	}

	// --- Obsidian plumbing ---------------------------------------------------

	override getViewType(): string {
		return MINDMAP_VIEW_TYPE;
	}

	override getDisplayText(): string {
		return this.file?.basename ?? "Mind map";
	}

	override getIcon(): string {
		return "git-fork";
	}

	override getViewData(): string {
		return this.data;
	}

	override setViewData(data: string, clear: boolean): void {
		// The save round-trip hands back the exact string that was just written,
		// and a map already drawn from it has nothing to do about it. `clear`
		// means a different file and is never skipped; neither is the first call
		// for a file, which has no parse behind it yet.
		if (!clear && data === this.data && this.parsed !== null) {
			this.perf.event("setViewData", { clear, skipped: true });
			return;
		}
		this.perf.event("setViewData", { clear, skipped: false });

		// Reached with the map already drawn and a different document in hand,
		// which is a document that changed without the map's help -- the
		// markdown editor in the next split, another window, a sync client. It
		// is a step back like any other, and filing it here is what keeps one
		// stack for both views while they are open at the same time.
		if (!clear && this.parsed !== null) {
			pushRevision(this.undoStack, this.data);
			this.redoStack = [];
		}

		this.data = data;
		if (clear) {
			// Torn down without restoring folds: `this.file` already points at the
			// new note, so a restore would write this map's shape onto that path.
			this.resetSearch();
			this.searchQuery = { text: "", regex: false };
			this.searchReplacement = "";
			this.collapsedKeys.clear();
			this.collapsedBodies.clear();
			this.setAnchor(null);
			this.restoreFocusKey = null;
			// A view is destroyed when its leaf changes view type, so a note
			// toggled to markdown and back arrives here as a brand new instance
			// with empty stacks. The plugin has been holding them, and hands them
			// back when this note is still the document they were recorded from.
			const adopted = this.adoptHistory(data);
			this.undoStack = adopted?.undo ?? [];
			this.redoStack = adopted?.redo ?? [];
			this.needsFit = true;
			// Nothing this map measured is about the note now arriving, and the
			// camera is about to be reframed for it, so the next paint measures
			// every card rather than reusing a size from the last note.
			this.setLayoutNodes([]);
			this.layoutElements = [];
			this.paintRoot = null;
			// Nothing this note's formulas render to is worth keeping for the
			// next one, and the cache is bounded by dropping it here.
			clearMathCache();
			// `clear` means a different file, which is the only moment the map
			// may re-fold. Saves and external edits arrive with clear === false,
			// so typing can never collapse the tree out from under the user.
			this.foldSeedPending = true;
		}
		this.render("setViewData");

		// The other half of Ctrl+click on a card, run backwards: the note was
		// showing a line, and the map is to put its selection on the card written
		// there. Taken once, and only by a map that loaded the note it names.
		const path = this.file?.path;
		const reveal = path === undefined ? null : this.plugin.takeReveal(path);
		if (reveal !== null) {
			const target = this.nodeAtLine(reveal);
			if (target) {
				this.select(target.id);
				this.revealSelection();
			}
		}
	}

	override clear(): void {
		this.data = "";
		this.parsed = null;
		this.cancelFrame();
		this.cancelMedia();
		this.notices.clear();
		// The preview is showing a file from the note being cleared, and it
		// sits outside everything else that is torn down here.
		this.lightbox.close();
		this.resized = false;
		this.setLayoutNodes([]);
		this.layoutElements = [];
		this.paintRoot = null;
		this.elements.clear();
		resetPendingMath();
		this.resetSearch();
		this.searchQuery = { text: "", regex: false };
		this.searchReplacement = "";
		this.collapsedKeys.clear();
		this.collapsedBodies.clear();
		this.setAnchor(null);
		this.restoreFocusKey = null;
		this.paintToken++;
		this.closePopover();
	}

	override async onOpen(): Promise<void> {
		// Warm MathJax now rather than on the first formula: opening a map is
		// already a deliberate action, so the cost is invisible here, and it
		// spares the first painted map its one placeholder-to-formula rebuild.
		// Deliberately not in the plugin's onload -- users who never open a map
		// should not pay for it at Obsidian startup.
		void ensureMath();
		this.detachInteractions = attachInteractions(this);
		this.applyToolbarVisibility();
		this.addAction("file-text", t("view.action.editMarkdown"), () => {
			void this.plugin.toggleLeaf(this.leaf);
		});
	}

	override async onClose(): Promise<void> {
		this.paintToken++;
		this.cancelFrame();
		// A picture may still be loading when the tab goes, and `onSettled` is
		// reached from the element's own event, so closing is the second place
		// a timer has to be called off -- `clear` is not guaranteed to run.
		this.cancelMedia();
		this.notices.clear();
		// A preview is a child of `contentEl`, which is going away with the
		// view; `canvas.destroy()` below does not know about it.
		this.lightbox.close();
		// Closing the tab is the last chance to keep a search out of the record:
		// what reaches disk has to be the fold shape the user chose.
		if (this.restoreSearchFolds()) this.rememberState();
		this.resetSearch();
		this.detachInteractions?.();
		this.detachInteractions = null;
		this.closePopover();
		this.canvas.destroy();
	}

	/**
	 * The pane changed shape.
	 *
	 * Nothing here may read or write the DOM, and the frame below is why. Obsidian
	 * reports a resize from a `ResizeObserver`, so this runs inside that
	 * observer's own callback -- and anything that touches layout there changes
	 * the boxes the observer is in the middle of reporting on. Chromium's answer
	 * is to log "ResizeObserver loop completed with undelivered notifications"
	 * and schedule another frame to deliver what it had to drop, which calls this
	 * again: a console full of warnings and a map that never stops re-culling.
	 * Even the read is enough -- `cullToView` asks the viewport for its size, and
	 * on a map with a few hundred cards that forced layout is the expensive half.
	 *
	 * So the resize is only recorded here. Invalidating the cached rect is pure
	 * bookkeeping -- it drops a number, it does not measure anything -- and the
	 * frame does the rest, after the observer has finished and a size change is
	 * once again just a size change. A split dragged across the window reports
	 * dozens of resizes a frame; they coalesce into one cull.
	 */
	override onResize(): void {
		// The one thing that moves the viewport itself without going through
		// `Canvas.apply`, which is what the cached rect is for.
		this.canvas.invalidateRect();
		this.resized = true;
		this.requestFrame();
	}

	/** Whatever the view has deferred, on the next frame, once. */
	private requestFrame(): void {
		this.frame.request(() => this.runFrame());
	}

	private runFrame(): void {
		const resized = this.resized;
		this.resized = false;
		// A view painted while hidden measured every card as zero-sized, so there
		// is no map to cull -- only one to paint, now that the pane has a size.
		if (resized && this.paintedEmpty) {
			this.render("resize");
			return;
		}
		// Nothing moved the camera, but the window it looks through changed
		// shape, so what is on screen changed with it.
		this.cullToView();
	}

	override onPaneMenu(menu: Menu, source: string): void {
		super.onPaneMenu(menu, source);
		menu.addItem((item) =>
			item
				.setTitle(t("view.action.editMarkdown"))
				.setIcon("file-text")
				.onClick(() => void this.plugin.toggleLeaf(this.leaf)),
		);
		menu.addItem((item) =>
			item
				.setTitle(t("view.action.fitWindow"))
				.setIcon("maximize")
				.onClick(() => this.fit()),
		);
	}

	/** Called by the plugin when settings change. */
	refresh(): void {
		this.shortcutBindings = null;
		this.perf.enabled = this.plugin.settings.debugTiming;
		// A setting can change what every card measures, so the next paint has to
		// measure them rather than reuse the sizes this one left behind.
		this.setLayoutNodes([]);
		this.layoutElements = [];
		// A formula is rendered against the settings in force, so the typeset
		// copies go with them. A picture's box is measured against the caps in
		// force too -- the sizes themselves are still true, but they are read
		// through those caps, so the drawn box is recomputed on the next paint
		// without the cache being wrong about anything.
		clearMathCache();
		if (this.scope) this.bindScope(this.scope);
		this.canvas.setOptions({ wheel: this.plugin.settings.wheel });
		this.applyToolbarVisibility();
		this.render("settings");
	}

	/**
	 * Whether the corner is showing.
	 *
	 * The setting says when and the selection says whether: on `selection` it is
	 * the presence of a picked card that brings the toolbar out, which is why
	 * this is called from `applySelection` as well as on the way in.
	 */
	private applyToolbarVisibility(): void {
		const hidden =
			this.plugin.settings.toolbarVisibility === "selection" && this.selectedId() === null;
		this.toolbars?.toggleClass("is-hidden", hidden);
	}

	/**
	 * What the fold button says, which is what pressing it would do.
	 *
	 * Follows the map rather than the click, so it is written on every paint
	 * instead of once when the bar was built -- but only when the answer changed,
	 * because a paint is not the place to rebuild an icon.
	 */
	private applyFoldButton(): void {
		const el = this.foldButton;
		if (!el) return;
		const folded = this.isFoldedToFirstLevel();
		const state = folded ? "folded" : "open";
		if (el.dataset.foldState === state) return;
		el.dataset.foldState = state;
		el.empty();
		setIcon(el, folded ? "chevrons-up-down" : "chevrons-down-up");
		el.setAttribute(
			"aria-label",
			t(folded ? "view.tool.expandAll" : "view.tool.collapseAll"),
		);
	}

	bindings(): ShortcutBindings {
		this.shortcutBindings ??= resolveBindings(this.plugin.settings.shortcuts);
		return this.shortcutBindings;
	}

	// --- toolbar --------------------------------------------------------------

	/**
	 * The corner of the map: one bar, holding everything the map can be asked to
	 * do.
	 *
	 * It was two bars -- the export on its own, in a panel above the rest -- left
	 * over from when the export was four buttons and needed the width. One button
	 * alone in a panel of its own spends a whole row of the corner on nothing,
	 * and the formats are behind it either way.
	 *
	 * The bar sits on `contentEl`, outside `.mm-viewport` and so outside
	 * `.mm-content` -- which is what the export clones, and the reason none of
	 * these buttons can end up in a file.
	 */
	private buildToolbar(): void {
		const bars = this.contentEl.createDiv({ cls: "mm-toolbars" });
		this.toolbars = bars;
		this.applyToolbarDock(bars);
		this.attachToolbarDrag(bars);
		const bar = bars.createDiv({ cls: "mm-toolbar" });

		const button = (
			icon: string,
			label: string,
			onClick: (ev: MouseEvent, el: HTMLElement) => void,
		): HTMLElement => {
			const el = bar.createDiv({ cls: "mm-tool", attr: { "aria-label": label } });
			setIcon(el, icon);
			el.addEventListener("click", (ev) => {
				ev.preventDefault();
				onClick(ev, el);
			});
			return el;
		};

		// The export leads the bar. Every other button here has a place the
		// pointer already knows, and a button added at the far end would push all
		// of them along. The palette still lists the four formats by name, which
		// is where a format becomes something worth binding a key to.
		button("share", t("view.tool.export"), (_ev, el) => this.showExportMenu(el));

		// The rest borrow the shortcut table's own wording, so a tooltip and the
		// settings row that rebinds the same action agree.
		button("zoom-in", t("shortcut.zoom-in.name"), () => this.canvas.zoomBy(1.2));
		button("zoom-out", t("shortcut.zoom-out.name"), () => this.canvas.zoomBy(1 / 1.2));
		button("maximize", t("shortcut.fit.name"), () => this.fit());
		button("crosshair", t("shortcut.centre-selection.name"), () =>
			this.centreOnSelection(),
		);
		// One button for the fold shape rather than two. See `toggleFoldAll`: of
		// the pair it replaces, one does nothing in either state.
		this.foldButton = button("chevrons-up-down", t("view.tool.expandAll"), () =>
			this.toggleFoldAll(),
		);
		button("search", t("shortcut.search.name"), () => this.openSearch());
		button("help-circle", t("view.tool.shortcuts"), () => this.showShortcuts());
		button("settings", t("view.tool.settings"), () => this.openSettings());
		this.applyToolbarVisibility();
		this.applyFoldButton();
	}

	/**
	 * The settings, as a window over the map.
	 *
	 * The plugin's own settings tab is still where Obsidian's settings window
	 * sends anyone who goes looking. This is the door for somebody who is
	 * looking at the map and wants to change one thing about it.
	 */
	private openSettings(): void {
		this.closePopover();
		new SettingsModal(this.app, this.plugin).open();
	}

	/**
	 * Where the corner sits.
	 *
	 * The three docks are classes the stylesheet positions; the free one is a
	 * pair of coordinates set here, because they come from the settings rather
	 * than from the stylesheet.
	 */
	private applyToolbarDock(bars: HTMLElement): void {
		const { toolbarDock, toolbarX, toolbarY } = this.plugin.settings;
		bars.toggleClass("is-dock-bottom-right", toolbarDock === "bottom-right");
		bars.toggleClass("is-dock-bottom-centre", toolbarDock === "bottom-centre");
		bars.toggleClass("is-dock-right", toolbarDock === "right");
		bars.toggleClass("is-dock-free", toolbarDock === "free");
		if (toolbarDock !== "free") return;
		bars.style.setProperty("--mm-toolbar-x", `${toolbarX}px`);
		bars.style.setProperty("--mm-toolbar-y", `${toolbarY}px`);
	}

	/**
	 * Let the corner be dragged.
	 *
	 * A press that travels is a drag and one that does not is a click, on the
	 * same threshold the cards use -- the buttons under the pointer have to keep
	 * working. The first real movement switches the dock to `free`, so the place
	 * the user chose is the one that is kept rather than being snapped back to a
	 * corner on the next paint.
	 *
	 * Everything is measured against `contentEl`, which is the positioned
	 * ancestor the toolbar is absolutely placed in, and clamped to it: a corner
	 * dragged past the edge could not be reached again to be dragged back.
	 */
	private attachToolbarDrag(bars: HTMLElement): void {
		let pointer = -1;
		let dragging = false;
		let origin = { x: 0, y: 0 };
		let start = { x: 0, y: 0 };

		const move = (x: number, y: number): void => {
			bars.style.setProperty("--mm-toolbar-x", `${x}px`);
			bars.style.setProperty("--mm-toolbar-y", `${y}px`);
		};

		bars.addEventListener("pointerdown", (ev) => {
			if (ev.button !== 0) return;
			pointer = ev.pointerId;
			dragging = false;
			origin = { x: ev.clientX, y: ev.clientY };
			const host = this.contentEl.getBoundingClientRect();
			const rect = bars.getBoundingClientRect();
			start = { x: rect.left - host.left, y: rect.top - host.top };
		});

		bars.addEventListener("pointermove", (ev) => {
			if (pointer !== ev.pointerId) return;
			const dx = ev.clientX - origin.x;
			const dy = ev.clientY - origin.y;
			if (!dragging) {
				if (Math.hypot(dx, dy) < TOOLBAR_DRAG_THRESHOLD) return;
				dragging = true;
				bars.setPointerCapture(ev.pointerId);
				bars.addClass("is-dragging");
				bars.removeClass("is-dock-bottom-right");
				bars.removeClass("is-dock-bottom-centre");
				bars.removeClass("is-dock-right");
				bars.addClass("is-dock-free");
			}
			ev.preventDefault();
			const host = this.contentEl.getBoundingClientRect();
			const rect = bars.getBoundingClientRect();
			move(
				clamp(start.x + dx, 0, Math.max(0, host.width - rect.width)),
				clamp(start.y + dy, 0, Math.max(0, host.height - rect.height)),
			);
		});

		const finish = (ev: PointerEvent): void => {
			if (pointer !== ev.pointerId) return;
			pointer = -1;
			if (!dragging) return;
			dragging = false;
			bars.removeClass("is-dragging");

			const host = this.contentEl.getBoundingClientRect();
			const rect = bars.getBoundingClientRect();
			const settings = this.plugin.settings;
			settings.toolbarDock = "free";
			settings.toolbarX = Math.round(rect.left - host.left);
			settings.toolbarY = Math.round(rect.top - host.top);
			void this.plugin.saveSettings();
		};
		bars.addEventListener("pointerup", finish);
		bars.addEventListener("pointercancel", finish);
	}

	/**
	 * The export formats, as a menu hanging off the button that offers them.
	 *
	 * Built from the same list the palette registers its commands from, so the
	 * two cannot drift and neither is the source of truth on its own.
	 *
	 * Anchored to the button rather than to the pointer. The bar is docked at the
	 * bottom of the map by default, where a menu dropped at the pointer's own
	 * coordinates runs off the bottom of the window; `showAtPosition` moves a
	 * menu up over the point it is given when it does not fit below, and over to
	 * the left when it does not fit on the right. Which edge of the button that
	 * point is depends on which way the menu opens -- see below -- so the menu
	 * lands clear of the bar either way, and `overlap` is what lines it up with
	 * the button instead of beside it. The button's own document is passed on:
	 * the map can be open in a popout, and a menu belongs to its window.
	 */
	private showExportMenu(el: HTMLElement): void {
		const menu = new Menu();
		for (const entry of EXPORT_COMMANDS) {
			menu.addItem((item) =>
				item
					.setTitle(t(entry.menuKey))
					.setIcon(entry.icon)
					.onClick(() => this.exportAs(entry.format)),
			);
		}
		const rect = el.getBoundingClientRect();
		// Which way the menu opens decides which edge it hangs from, because
		// `showAtPosition` lifts a menu that does not fit below so that it *ends*
		// at the point it was given. Anchored to the button's bottom edge, that
		// point is inside the bar and the menu lands on top of it -- which is
		// exactly what it was doing. The top edge puts the same lift clear above.
		// With room below, the bottom edge is the right anchor and the menu hangs
		// under the bar, so the direction is measured rather than assumed.
		const MENU_HEIGHT = 160;
		const room = (el.doc.defaultView?.innerHeight ?? 0) - rect.bottom;
		const y = room >= MENU_HEIGHT ? rect.bottom : rect.top;
		menu.showAtPosition({ x: rect.left, y, width: rect.width, overlap: true }, el.doc);
	}

	/**
	 * What the map answers to, as it stands.
	 *
	 * The keys are read out of the live bindings rather than a list of their
	 * own, so a shortcut the user has rebound in the settings tab is shown here
	 * the way they bound it -- and an unbound one is not shown at all.
	 */
	private showShortcuts(): void {
		// Keys, not words: the panel is built once per opening, and a row holding
		// its own wording would keep speaking the language the plugin started in.
		const mouse: Array<[I18nKey, I18nKey]> = [
			["view.shortcuts.mouse.edit.keys", "view.shortcuts.mouse.edit.what"],
			["view.shortcuts.mouse.link.keys", "view.shortcuts.mouse.link.what"],
			["view.shortcuts.mouse.reveal.keys", "view.shortcuts.mouse.reveal.what"],
			["view.shortcuts.mouse.add.keys", "view.shortcuts.mouse.add.what"],
			["view.shortcuts.mouse.multi.keys", "view.shortcuts.mouse.multi.what"],
			["view.shortcuts.mouse.menu.keys", "view.shortcuts.mouse.menu.what"],
			["view.shortcuts.mouse.reparent.keys", "view.shortcuts.mouse.reparent.what"],
			["view.shortcuts.mouse.reorder.keys", "view.shortcuts.mouse.reorder.what"],
			["view.shortcuts.mouse.dragGroup.keys", "view.shortcuts.mouse.dragGroup.what"],
			["view.shortcuts.mouse.zoom.keys", "view.shortcuts.mouse.zoom.what"],
			["view.shortcuts.mouse.pan.keys", "view.shortcuts.mouse.pan.what"],
		];
		// The two rows the drag mode swaps, because the setting *is* this pair of
		// questions: which press a plain drag on blank canvas is, and which press
		// draws the box. The pan key's row is above both because it moves the map
		// either way -- that is what makes the setting safe to try.
		if (this.plugin.settings.dragToPan) {
			mouse.push(["view.shortcuts.mouse.pan.plainKeys", "view.shortcuts.mouse.pan.what"]);
			mouse.push(["view.shortcuts.mouse.band.shiftKeys", "view.shortcuts.mouse.band.what"]);
		} else {
			mouse.push(["view.shortcuts.mouse.band.keys", "view.shortcuts.mouse.band.what"]);
		}

		const panel = this.openPopover();
		panel.addClass("mm-shortcuts");
		panel.createEl("h4", { text: t("view.shortcuts.title") });
		const table = panel.createEl("table");
		const row = (keys: string, what: string): void => {
			const tr = table.createEl("tr");
			tr.createEl("td", { cls: "mm-keys", text: keys });
			tr.createEl("td", { text: what });
		};

		const bindings = this.bindings();
		const isMac = Platform.isMacOS;
		for (const entry of SHORTCUTS) {
			const combos = bindings[entry.action];
			if (combos.length === 0) continue;
			row(combos.map((combo) => comboToString(combo, isMac)).join("  /  "), t(entry.nameKey));
		}
		for (const [keys, what] of mouse) row(t(keys), t(what));

		panel.createDiv({
			cls: "mm-popover-hint mm-shortcuts-footer",
			text: t("view.shortcuts.footer"),
		});
	}

	// --- rendering ------------------------------------------------------------

	private parseOptions() {
		const s = this.plugin.settings;
		return {
			title: this.file?.basename ?? t("export.untitled"),
			annotations: s.inlineAnnotations,
			source: s.source,
			rootPolicy: s.rootPolicy,
			maxHeadingDepth: s.maxHeadingDepth,
			indentUnit: resolveIndentUnit(s),
		};
	}

	private render(reason: PaintReason): void {
		this.parsed = parseMarkdown(this.data, this.parseOptions());

		// Before anything reveals a node: seeding replaces the whole set.
		if (this.foldSeedPending) {
			this.foldSeedPending = false;
			this.seedFolds();
		}

		// An edit or an external change can add, remove or rename a match, and
		// the highlight has to follow the note rather than the stale class list.
		this.refreshSearch();

		if (this.pendingFocus) {
			const focus = this.pendingFocus;
			this.pendingFocus = null;
			const target = this.findByLine(focus.line);
			if (target) {
				this.setAnchor(target.key);
				this.revealAncestors(target);
				this.paint(reason);
				if (focus.edit) this.beginEdit(target.id);
				this.revealSelection();
				return;
			}
		}
		this.paint(reason);
	}

	/**
	 * Every node at or below `depth`, counting the root as 0, that has anything
	 * to hide. `Infinity` yields nothing, which is how "expand all" is spelled.
	 *
	 * The walk continues past nodes that are themselves collapsed. `paint()` just
	 * stops descending when it meets a collapsed key, so the deeper entries cost
	 * nothing to carry -- and they are what makes expanding a branch reveal one
	 * level at a time rather than dumping the whole subtree on screen.
	 */
	private collapsedAtDepth(depth: number): Set<string> {
		const keys = new Set<string>();
		if (!this.parsed || !Number.isFinite(depth)) return keys;
		// childCount, not children.length: a section whose only content is
		// paragraphs or callouts still has body cards to fold away.
		const showBody = this.plugin.settings.showBodyNodes;
		const visit = (node: MindNode, d: number): void => {
			if (d >= depth && this.childCount(node, showBody) > 0) keys.add(node.key);
			for (const child of node.children) visit(child, d + 1);
		};
		visit(this.parsed.root, 0);
		return keys;
	}

	private foldFrom(depth: number): void {
		this.collapsedKeys = this.collapsedAtDepth(depth);
		// The whole fold shape is being replaced, so there is nothing left for a
		// search to put back.
		this.searchRevealed.clear();
	}

	/**
	 * The shape a freshly opened note starts in: what the user left behind if
	 * anything was remembered, and the default otherwise.
	 */
	private seedFolds(): void {
		const parsed = this.parsed;
		const path = this.file?.path;
		const saved = parsed && path ? this.plugin.readNoteState(path) : null;
		if (!parsed || !saved) {
			this.foldFrom(INITIAL_EXPAND_LEVEL);
			return;
		}

		// Keys the note no longer has are dropped rather than carried. They would
		// cost a lookup on every paint, and the next save would write them
		// straight back -- a note edited outside Obsidian would accumulate the
		// ghost of every heading it ever had.
		const showBody = this.plugin.settings.showBodyNodes;
		const restored = new Set<string>();
		const restoredBodies = new Set<string>();
		for (const key of saved.collapsed) {
			// One array holds both kinds, because that is the shape the plugin's
			// data has always had and the marker in the key tells them apart.
			const mark = key.indexOf(BODY_ID_MARK);
			if (mark >= 0) {
				if (this.bodyFoldStillApplies(parsed, key, mark, showBody)) restoredBodies.add(key);
				continue;
			}
			const node = parsed.byKey.get(key);
			if (node && this.childCount(node, showBody) > 0) restored.add(key);
		}
		this.collapsedKeys = restored;
		this.collapsedBodies = restoredBodies;

		const focus = this.findSaved(parsed, saved.focusKey, saved.focusId);
		// A focus inside a branch the user left folded loses to the fold: opening
		// the branch to show it would undo a decision they made on purpose, and
		// selecting a card that is not on screen leaves the keyboard aimed at
		// nothing. The map simply frames itself instead.
		if (!focus || !this.isVisible(focus)) return;
		this.setAnchor(focus.key);
		this.restoreFocusKey = focus.key;
	}

	/**
	 * The node a saved focus points at: by text path first, by tree position
	 * when the text has changed since.
	 *
	 * Renaming a node moves its key and leaves its position; inserting a sibling
	 * above it does the reverse. Only an edit that does both at once loses the
	 * focus, and losing it costs a default framing, nothing more.
	 */
	private findSaved(parsed: ParsedDoc, key?: string, id?: string): MindNode | null {
		const byKey = key === undefined ? undefined : parsed.byKey.get(key);
		if (byKey) return byKey;
		return (id === undefined ? undefined : parsed.byId.get(id)) ?? null;
	}

	/** False when a collapsed ancestor is keeping the node off the map. */
	private isVisible(node: MindNode): boolean {
		for (let p: MindNode | null = node.parent; p; p = p.parent) {
			if (this.collapsedKeys.has(p.key)) return false;
		}
		return true;
	}

	/**
	 * Hand the current shape to the plugin, which batches the writes.
	 *
	 * A map sitting at exactly the default fold with nothing selected is stored
	 * as nothing at all. That is what a note looks like the moment it is opened
	 * and never touched, and an entry apiece for those would be the bulk of the
	 * file in exchange for restoring precisely the state you get without it.
	 */
	private rememberState(): void {
		const path = this.file?.path;
		if (!this.parsed || !path || !this.plugin.settings.rememberFolds) return;

		const focus = this.selectedNode();
		// A folded code block is the user's doing too, so it has to keep the
		// entry alive on its own -- the default-fold test knows nothing about
		// it, and would throw the fold away the moment the map was closed.
		if (!focus && this.collapsedBodies.size === 0 && this.isDefaultFold()) {
			this.plugin.forgetNoteState(path);
			return;
		}
		this.plugin.writeNoteState(path, {
			// Both kinds in the one array the store has always had: a node's
			// fold and a card's own are the same thing to the user, and the
			// marker in the key is what tells them apart on the way back in.
			collapsed: [...this.collapsedKeys, ...this.collapsedBodies],
			focusKey: focus?.key,
			focusId: focus?.id,
		});
	}

	/**
	 * Whether a remembered body fold still points at a card that can fold.
	 *
	 * The key is `ownerKey + BODY_ID_MARK + index`, and it is checked against a
	 * fresh parse for the same reason a node's key is: the note may have been
	 * rewritten somewhere else entirely. A block that is gone, that the parser
	 * no longer sees, or that no longer has a second line is dropped -- a fold
	 * remembered onto a block that has since been cut down to one line would
	 * leave a button on a card with nothing to close and no way back out of a
	 * fold that showed the whole thing anyway.
	 *
	 * `mark` is the marker's offset, already found by the caller, so the search
	 * is not repeated once per key.
	 */
	private bodyFoldStillApplies(
		parsed: ParsedDoc,
		key: string,
		mark: number,
		showBody: boolean,
	): boolean {
		if (!showBody) return false;
		const owner = parsed.byKey.get(key.slice(0, mark));
		const index = Number(key.slice(mark + BODY_ID_MARK.length));
		const range = owner?.bodyRanges[index];
		if (!owner || !range) return false;
		if (owner.annotationIndices.includes(index)) return false;
		// One line is nothing to fold, which is the same bar the paint uses to
		// decide whether the card gets the button at all -- asked of the same
		// helper, so a fold the note has outgrown is dropped here and never
		// reaches a card that would have no button for it.
		return hasMoreThanOneLine(parsed.doc.lines, range[0], range[1]);
	}

	private isDefaultFold(): boolean {
		const fallback = this.collapsedAtDepth(INITIAL_EXPAND_LEVEL);
		if (fallback.size !== this.collapsedKeys.size) return false;
		for (const key of this.collapsedKeys) if (!fallback.has(key)) return false;
		return true;
	}

	/**
	 * Open whatever is hiding a node the user is about to work on.
	 *
	 * Indent, outdent, drag and undo can all land a node under a collapsed
	 * parent. Without this the node simply vanishes, and every follow-up -- the
	 * selection, `beginEdit` -- silently no-ops against a missing element.
	 */
	private revealAncestors(node: MindNode): void {
		for (let p: MindNode | null = node.parent; p; p = p.parent) {
			this.collapsedKeys.delete(p.key);
		}
	}

	/**
	 * Note where a node currently sits on screen, so the next paint can put it
	 * back there. Reads the layout the *previous* paint left behind.
	 */
	private markAnchor(key: string | undefined): void {
		const layout = key ? this.layoutByKey.get(key) : undefined;
		if (!layout || !key) {
			this.anchor = null;
			return;
		}
		const canvas = this.canvas;
		this.anchor = {
			key,
			screenX: canvas.tx + layout.x * canvas.scale,
			screenY: canvas.ty + layout.y * canvas.scale,
		};
	}

	/** Nothing was clicked, so hold the selection still, or the root. */
	private markGlobalAnchor(): void {
		this.markAnchor(this.selectedNode()?.key ?? this.parsed?.root.key);
	}

	/**
	 * Whether the map is showing no more than its first level -- the rule itself
	 * is `foldedToFirstLevel`, in the model, where it can be tested.
	 *
	 * Asked of the fold keys rather than of what is on screen: the cull decides
	 * what is drawn, and a map scrolled away from its second level has not been
	 * folded.
	 */
	private isFoldedToFirstLevel(): boolean {
		const parsed = this.parsed;
		if (!parsed) return true;
		const showBody = this.plugin.settings.showBodyNodes;
		return foldedToFirstLevel(
			parsed.root,
			this.collapsedKeys,
			(node) => this.childCount(node, showBody) > 0,
		);
	}

	/**
	 * The fold button, as one control rather than two.
	 *
	 * Two buttons asked the user to know the shape of their own map before
	 * choosing one of them, and one of the two does nothing in either state: "expand
	 * all" on an open map, "collapse all" on one already at its first level. So
	 * the button is the shape that is not the current one, and which that is
	 * follows from the map.
	 */
	toggleFoldAll(): void {
		if (this.isFoldedToFirstLevel()) this.expandAll();
		else this.collapseAll();
	}

	expandAll(): void {
		this.markGlobalAnchor();
		this.foldFrom(Infinity);
		this.paint("fold");
	}

	/** Back to the view the map opens with. */
	collapseAll(): void {
		this.markGlobalAnchor();
		this.foldFrom(INITIAL_EXPAND_LEVEL);
		this.paint("fold");
	}

	/**
	 * Back to the shape a note with nothing remembered opens in.
	 *
	 * The paint that follows finds the map at exactly the default with nothing
	 * selected, which is the one state `rememberState` stores as no entry at
	 * all -- so the command's own `forgetNoteState` is confirmed, not undone.
	 */
	resetFolds(): void {
		this.setAnchor(null);
		this.restoreFocusKey = null;
		this.collapseAll();
	}

	// --- body content as nodes -------------------------------------------------

	/**
	 * A node's children as the map draws them: its real children plus one card
	 * per block of note content, interleaved in the order they appear in the file.
	 *
	 * The body cards are synthesised here and never enter `parsed.byId`, so every
	 * mutation -- rename, move, delete, indent -- looks them up, misses, and does
	 * nothing. That is the whole safety story: the note owns those lines, and the
	 * only way to change them is the editor `openBody` puts up.
	 */
	private childrenOf(parsed: ParsedDoc, node: MindNode, showBody: boolean): MindNode[] {
		if (!showBody || node.bodyRanges.length === 0) return node.children;

		const merged: Array<{ line: number; node: MindNode }> = node.children.map((c) => ({
			line: c.lineStart,
			node: c,
		}));

		node.bodyRanges.forEach((range, index) => {
			if (node.annotationIndices.includes(index)) return;
			const body = this.makeBodyNode(parsed, node, range, index);
			merged.push({ line: range[0], node: body });
		});

		merged.sort((a, b) => a.line - b.line);
		return merged.map((entry) => entry.node);
	}

	private makeBodyNode(
		parsed: ParsedDoc,
		owner: MindNode,
		range: [number, number],
		index: number,
	): MindNode {
		const id = `${owner.id}${BODY_ID_MARK}${index}`;
		const key = `${owner.key}${BODY_ID_MARK}${index}`;
		const raw = bodyRangeText(parsed, range);
		// A text block (indented prose under a list item) carries its indent as
		// structural metadata; strip it from the preview so the card reads as
		// the text itself. Fenced code keeps its indent, which carries meaning.
		const isCode = looksCode(raw);
		const clipped = previewOf(raw);
		// A table is the one construct that cannot be read as a run of
		// characters, so a block holding one is parsed into its parts and drawn
		// as them. A callout is the same argument: `> [!note]` drawn as text is
		// the scaffolding, not the box. Nothing else changes -- a paragraph
		// reads the same either way, and the plain path is the one every other
		// card is measured by.
		const blocks = parseBlocks(clipped);
		const structured = needsBlocks(blocks);
		// A drawn block keeps its blank lines: they are what separates one
		// block from the next, and the parser is the thing that reads them.
		const drawn = isCode || structured ? clipped : blockPreviewOf(raw);
		// Folded, the card is its first line and nothing else -- which is what a
		// closed branch shows too: what the card is, and what it is holding back.
		// For a fenced sample that line is the opening fence, so it names the
		// language, which is the one line worth keeping; for prose it is the
		// first sentence. `firstLineOf` rather than the literal first line,
		// because a range that opens with the note's blank line would otherwise
		// fold down to an empty card.
		//
		// A folded card takes the plain path, and that is the whole of how the
		// fold shows: a card drawn as blocks is drawn from the blocks, so
		// trimming `text` alone would leave a table or a sample on screen at
		// full height with nothing saying it had been closed.
		const folded = this.collapsedBodies.has(key);
		const body: MindNode = {
			id,
			key,
			kind: "body",
			virtual: true,
			text: folded ? firstLineOf(drawn) : drawn,
			level: owner.level,
			indentWidth: 0,
			indent: "",
			marker: "",
			spacing: "",
			checkbox: null,
			checkboxSpacing: "",
			suffix: "",
			lineStart: range[0],
			blockEnd: range[1],
			bodyRanges: [],
			annotationIndices: [],
			children: [],
			// Kept for `revealAncestors`; `owner.children` is never touched, so the
			// parsed tree stays exactly as the parser left it.
			parent: owner,
		};
		this.bodyNodes.set(id, {
			ownerKey: owner.key,
			index,
			blocks: structured && !folded ? blocks : null,
		});
		return body;
	}

	private childCount(node: MindNode, showBody: boolean): number {
		return node.children.length + (showBody ? bodyCardCount(node) : 0);
	}

	/**
	 * Whether folding this note-content card would take something away.
	 *
	 * One question, asked in four places -- the paint builds the button from it,
	 * `branchStateFor` says what the button does, `Space` on a selection acts on
	 * it, and a remembered fold is checked against it -- so it is answered here
	 * rather than spelled out four times. It was spelled out before, and the
	 * paint's copy of it still asked whether the block was a *code sample* while
	 * the other three had already been widened: a paragraph card therefore got
	 * no button at all, and the fold looked like a feature code blocks had.
	 *
	 * A body card's `lineStart`/`blockEnd` *is* its range -- `makeBodyNode` puts
	 * the range there and nothing else uses them on that node.
	 */
	private foldsBody(node: MindNode): boolean {
		const doc = this.parsed?.doc;
		if (!doc || node.kind !== "body") return false;
		return hasMoreThanOneLine(doc.lines, node.lineStart, node.blockEnd);
	}

	/**
	 * Leaves in a branch counted over the whole note, folded parts included.
	 *
	 * This is what the balanced layout splits on. Counting only what is on screen
	 * would let a fold deep inside one branch shunt a different branch across to
	 * the other side of the root.
	 */
	private branchWeight(node: MindNode, showBody: boolean): number {
		const bodies = showBody ? bodyCardCount(node) : 0;
		if (node.children.length === 0) return Math.max(1, bodies);
		let total = bodies;
		for (const child of node.children) total += this.branchWeight(child, showBody);
		return total;
	}

	/** Everything a collapsed node is hiding, body cards included. */
	private hiddenCount(node: MindNode, showBody: boolean): number {
		let total = showBody ? bodyCardCount(node) : 0;
		for (const child of node.children) total += 1 + this.hiddenCount(child, showBody);
		return total;
	}

	private findByLine(line: number): MindNode | null {
		if (!this.parsed || line < 0) return null;
		for (const node of this.parsed.byId.values()) {
			if (node.lineStart === line) return node;
		}
		return null;
	}

	/**
	 * The card the note writes at `line`, or the one whose block contains it.
	 *
	 * A caret sits wherever it was left, which is as often inside a node's
	 * paragraphs as on its marker line -- and the card is the same card either
	 * way. Falling back to the containing block is what makes the note-to-map
	 * direction land on something the user recognises rather than on nothing.
	 */
	private nodeAtLine(line: number): MindNode | null {
		const exact = this.findByLine(line);
		if (exact) return exact;
		for (const node of this.parsed?.byId.values() ?? []) {
			if (node.lineStart >= 0 && line > node.lineStart && line <= node.blockEnd) return node;
		}
		return null;
	}

	private paint(reason: PaintReason): void {
		const parsed = this.parsed;
		if (!parsed) return;
		const started = this.perf.now();

		// Invalidates any measurement callback still in flight from an earlier
		// paint, so a slow MathJax flush cannot lay out a map that is now gone.
		const token = ++this.paintToken;
		const anchor = this.anchor;
		this.anchor = null;

		const s = this.plugin.settings;
		this.elements.clear();
		// The placeholders the last build left are about to be thrown away with
		// the cards holding them, so only this build's may be upgraded.
		resetPendingMath();
		// Both layers are built off-tree and swapped in at the end of the build,
		// below. A large map is a few hundred cards and as many connectors, and
		// growing them inside the live document means the browser carries an
		// invalidation for each one; a detached tree costs nothing until it is
		// attached, and `replaceChildren` drops the old paint in the same step.
		this.edgeLayer = createEdgeLayer();
		this.nodeLayer = createDiv({ cls: "mm-nodes" });
		// The layer that had connectors on it is being thrown away, so whatever
		// region it was drawn for is no longer drawn anywhere.
		this.edgeView = null;

		const showBody = s.showBodyNodes;
		this.bodyNodes.clear();

		// Build the tree of visible nodes; a collapsed node contributes no children.
		const rootLayout = createLayoutNode(parsed.root, null, 0);
		const visible: LayoutNode[] = [];
		const build = (node: MindNode, layout: LayoutNode): void => {
			visible.push(layout);
			if (this.collapsedKeys.has(node.key)) return;
			for (const child of this.childrenOf(parsed, node, showBody)) {
				const childLayout = createLayoutNode(child, layout, layout.depth + 1);
				layout.children.push(childLayout);
				build(child, childLayout);
			}
		};
		build(parsed.root, rootLayout);

		// Fixed by the note, not by what happens to be unfolded, so the balanced
		// layout keeps every branch on the side it started on.
		for (const branch of rootLayout.children) {
			branch.weight = this.branchWeight(branch.node, showBody);
		}

		// What the last paint measured, and where it put it. A card whose text has
		// not changed measures the same, so the only ones this paint has to lay
		// out are the ones it is about to show. `layoutById` still holds the
		// previous paint's index -- this paint's own is only installed at the end.
		const previous = this.layoutById;
		const nearView = viewBoxFrom(this.canvas.metrics(), CULL_MARGIN);

		let sawMath = false;
		let reused = 0;
		for (const layout of visible) {
			const node = layout.node;
			const isBody = node.kind === "body";
			// A note-content card folds its own body rather than a branch, so
			// "collapsed" answers out of a different set for one -- and what a
			// folded one is hiding is lines of the note, not cards under it.
			const foldedBody = isBody && this.collapsedBodies.has(node.key);
			const collapsed = isBody ? foldedBody : this.collapsedKeys.has(node.key);
			const hasAnnotation = node.annotationIndices.length > 0;
			// Body cards were all made by `childrenOf`, above, so the ref is
			// there for every one of them and nothing else has an entry at all.
			const blocks = isBody ? (this.bodyNodes.get(node.id)?.blocks ?? null) : null;
			const maxWidth = nodeMaxWidth(node.kind, hasAnnotation, s.maxNodeWidth);
			const element = buildNodeElement(this.nodeLayer, layout, {
				annotation: hasAnnotation ? annotationText(parsed, node) : null,
				maxWidth,
				branchColors: s.branchColors,
				blocks,
				media: this.mediaContext(maxWidth.text ?? maxWidth.node),
			preformatted: isBody && blocks === null && looksPreformatted(node.text),
			addable: !isBody,
				// Any block with more than one line to show, a sample or a
				// paragraph or a table alike: what the fold is for is a card
				// that takes up more of the map than what it says needs, and a
				// three-line paragraph is that as much as a thirty-line listing
				// is. The test is the range's, not the drawn text's, so the
				// button does not vanish the moment it has been used.
				collapsible: this.foldsBody(node),
				collapsed,
				hasChildren: this.childCount(node, showBody) > 0,
				// Only ever read by a card with a branch under it: a folded
				// block is offered the way back out rather than a count.
				hiddenCount: collapsed ? this.hiddenCount(node, showBody) : 0,
				selected: this.selectedId() === node.id,
			});
			this.elements.set(node.id, element);
			if (element.hasMath) sawMath = true;
			// Built straight into the state the cull would have put it in anyway,
			// which is the point: a card that the camera is nowhere near costs this
			// paint no layout at all. Its size is the one it was measured at, and
			// the cull that shows it again is what finally measures it.
			const before = previous.get(node.id);
			if (before === undefined || before.width === 0 || nearView === null) continue;
			// Everything the card's own box is drawn from has to be what it was:
			// the text, the checkbox in front of it, and the two attributes the
			// stylesheet sizes a card by -- `data-depth` and `data-kind`.
			if (
				before.node.text !== node.text ||
				before.node.checkbox !== node.checkbox ||
				before.node.kind !== node.kind ||
				before.depth !== layout.depth ||
				overlaps(before, nearView)
			) {
				continue;
			}
			layout.width = before.width;
			layout.height = before.height;
			layout.cardWidth = before.cardWidth;
			layout.cardHeight = before.cardHeight;
			element.offscreen = true;
			element.el.addClass("is-offscreen");
			reused++;
		}
		this.perf.span("paint-build", started, { reason, nodes: visible.length, reused });

		// On the content layer, not on the view root: the root is the box
		// Obsidian's workspace observes for resizes, and nothing a paint does may
		// give that observer a reason to fire.
		this.canvas.content.toggleClass("mm-dense", visible.length > DENSE_NODE_COUNT);

		// One class per drawn style, and none at all for the default: `bordered`
		// is what the stylesheet draws with no style class, so it is the absence
		// of one rather than a class of its own. On the content layer so that a
		// drag can carry the same class onto its copy.
		const drawn = cardStyleClass(this.plugin.settings.cardStyle);
		for (const cls of CARD_STYLE_CLASSES) {
			this.canvas.content.toggleClass(cls, cls === drawn);
		}

		// The branch palette, as an attribute on the same layer. The default
		// carries no attribute at all: `classic` is what the ten variables are
		// declared with, so a map drawn by a build that never wrote the
		// attribute is drawn the way this one draws `classic`.
		const palette = this.plugin.settings.palette;
		if (palette === "classic") this.canvas.content.removeAttribute("data-palette");
		else this.canvas.content.dataset.palette = palette;

		// Attached only now that every card exists: one mutation of the live
		// tree per paint, and the measuring pass below is the first thing that
		// makes the browser lay any of it out.
		this.canvas.content.replaceChildren(this.edgeLayer, this.nodeLayer);

		// Pictures and videos start loading here and nowhere earlier, and only
		// for the cards that are on screen. A card built off screen -- the ones
		// this paint marked above -- would otherwise fetch every picture in the
		// note to draw none of them; the cull that brings one back is what
		// starts it, in `cullToView`.
		activateMedia(this.nodeLayer);

		// The fold shape and the selection are both final by now, and neither
		// changes again before the next paint.
		this.rememberState();

		this.paintRoot = rootLayout;
		const framing: Framing = {
			fit: this.needsFit,
			focus: this.restoreFocusKey,
			reveal: this.pendingReveal,
		};
		this.measureAndPlace(rootLayout, visible, anchor, reason);
		this.perf.span("paint", started, { reason, nodes: visible.length, reused });

		// What the pictures in this map are owed, armed before the paint returns
		// because the first of them can land while it is still running. It is
		// armed whether or not any media was drawn: a card the cull brings back
		// later may be the first one to hold a picture, and it settles into the
		// same promise.
		this.armMedia(rootLayout, visible, anchor, framing);
		if (!sawMath) return;

		if (!mathSettled()) {
			// First map with formulas this session: what is on screen right now
			// is placeholder source text, because `renderMath` is only
			// synchronous once MathJax is up. `ensureMath` settles either way, so
			// this can run at most once per session.
			void this.typesetMath(token, rootLayout, visible, anchor, framing);
			return;
		}
		if (!mathAvailable()) return;

		// MathJax emits its stylesheet adaptively, one glyph at a time, so a
		// formula reaching for a glyph nobody has used yet measures short until
		// the flush lands. Re-measure, but never rebuild: `measureAndPlace` only
		// reads and positions, so it cannot schedule itself again.
		//
		// The flush is only ever worth a re-measure while a glyph is still new to
		// the session, and the formulas on screen say whether this paint was one
		// of those: when none of them moved, the pass is a layout of the whole
		// note for no change at all, so it is skipped.
		void finishRenderMath().then(() => {
			if (token !== this.paintToken) return;
			const mathStarted = this.perf.now();
			if (!this.mathSizeChanged(visible)) {
				this.perf.span("math-remeasure", mathStarted, { changed: false });
				return;
			}
			this.reframe(framing);
			this.measureAndPlace(rootLayout, this.staleMathCards(visible), anchor, "math-remeasure");
			this.perf.span("math-remeasure", mathStarted, { changed: true });
		});
	}

	/**
	 * Put the formulas into the map that is already on screen, then measure it.
	 *
	 * The one thing the first paint of the session could not do was typeset, so
	 * that is the only thing this does: the cards, their text and the layout
	 * around them are all still right, and rebuilding them would render every
	 * formula a second time to arrive at the same map.
	 */
	private async typesetMath(
		token: number,
		rootLayout: LayoutNode,
		visible: LayoutNode[],
		anchor: Anchor | null,
		framing: Framing,
	): Promise<void> {
		await ensureMath();
		if (token !== this.paintToken) return;

		const started = this.perf.now();
		const upgraded = upgradePendingMath();
		if (upgraded === 0) {
			// MathJax never came up. The source text on the cards is the final
			// answer, and it is what the map was laid out around already.
			this.perf.span("math-typeset", started, { upgraded });
			return;
		}

		// The formulas are in their cards, but MathJax emits its stylesheet
		// adaptively, so they measure short until the flush lands.
		await finishRenderMath();
		if (token !== this.paintToken) return;

		this.reframe(framing);
		this.measureAndPlace(rootLayout, this.staleMathCards(visible), anchor, "math-remeasure");
		this.perf.span("math-typeset", started, { upgraded });
	}

	/** Promise the camera again what the paint that waited on MathJax owed it. */
	private reframe(framing: Framing): void {
		if (framing.fit) {
			this.needsFit = true;
			this.restoreFocusKey = framing.focus;
		}
		// Outside the guard on purpose: a jump has to be honoured on the map that
		// formulas were actually rendered into, fit or no fit.
		this.pendingReveal = framing.reveal;
	}

	/**
	 * The cards a formula just changed the size of, and which of them can say so.
	 *
	 * Only a card carrying a formula can have moved, so the rest of the note is
	 * left alone -- a whole-map pass here is a measurement of every card in the
	 * note to correct a few dozen. A culled card has no size to read, so it is
	 * marked unmeasured instead and the cull that puts it back takes the
	 * measurement, which is the path a card built off screen already takes.
	 */
	private staleMathCards(visible: LayoutNode[]): LayoutNode[] {
		const readable: LayoutNode[] = [];
		for (const layout of visible) {
			const element = this.elements.get(layout.node.id);
			if (!element || !element.hasMath) continue;
			if (element.offscreen) element.measured = false;
			else readable.push(layout);
		}
		return readable;
	}

	/**
	 * Did the stylesheet flush move a formula that is actually on screen?
	 *
	 * Only the cards in the document are asked: a culled one has no size to
	 * compare, and a card built off screen is carrying a size from a paint where
	 * it was measured, not from this one.
	 */
	private mathSizeChanged(visible: LayoutNode[]): boolean {
		for (const layout of visible) {
			const element = this.elements.get(layout.node.id);
			if (!element || !element.hasMath || element.offscreen) continue;
			if (
				element.el.offsetWidth !== layout.width ||
				element.el.offsetHeight !== layout.height
			) {
				return true;
			}
		}
		return false;
	}

	// --- pictures and videos --------------------------------------------------

	/**
	 * The licence a card is built with to draw its own pictures.
	 *
	 * Per card rather than one for the paint, because the cap a picture is drawn
	 * under is the card's own: a title with an annotation underneath it is
	 * capped at the annotation's width, and a picture filling a title is a
	 * different size for that reason alone.
	 *
	 * Null when the setting is off, which is what turns every embed back into
	 * the chip it used to be -- decided once, here, rather than asked per token.
	 */
	private mediaContext(maxWidth: number): MediaContext | null {
		const s = this.plugin.settings;
		if (!s.renderMedia) return null;
		return {
			app: this.app,
			sourcePath: this.file?.path ?? "",
			maxWidth,
			maxHeight: s.mediaMaxHeight,
			sizes: this.mediaSizes,
			onSettled: this.onMediaSettled,
		};
	}

	/**
	 * What the pictures in this paint are owed: the cards to measure again, and
	 * the camera the paint promised before any of them had landed.
	 *
	 * Armed whether or not this paint drew any media. A card the cull brings
	 * back later may be the first one holding a picture -- it was built off
	 * screen, so nothing in it started loading until the cull showed it -- and
	 * that load settles into the same promise.
	 */
	private armMedia(
		root: LayoutNode,
		visible: LayoutNode[],
		anchor: Anchor | null,
		framing: Framing,
	): void {
		this.mediaRoot = root;
		this.mediaCards = visible;
		this.mediaAnchor = anchor;
		this.mediaFraming = framing;
	}

	/** Called by `media.ts` when one picture or video has landed. */
	private readonly onMediaSettled = (): void => {
		this.mediaDirty = true;
		if (this.mediaTimer !== null) return;
		// A map of twenty pictures finishes loading in a burst, and twenty
		// measurements of the same tree is nineteen too many. The timer is what
		// makes a burst one pass -- and it also lets a load that lands while the
		// paint is still running fold into that paint's own measurement.
		this.mediaTimer = window.setTimeout(() => {
			this.mediaTimer = null;
			this.flushMedia();
		}, 0);
	};

	/**
	 * Measure the cards a picture has just changed the size of.
	 *
	 * A re-measure and never a rebuild, exactly like the MathJax flush: the
	 * cards, their text and the layout around them are all still right, and the
	 * only thing that was wrong was the box a picture had not filled yet.
	 */
	private flushMedia(): void {
		if (!this.mediaDirty) return;
		this.mediaDirty = false;

		const root = this.mediaRoot;
		// A repaint since the load was registered has its own tree, and this one
		// belongs to a map that is no longer on screen.
		if (root === null || this.paintRoot !== root) return;

		const started = this.perf.now();
		const stale = this.staleMediaCards(this.mediaCards);
		if (stale.length === 0) {
			this.perf.span("media-remeasure", started, { changed: 0 });
			return;
		}

		// The camera half is spent once. The paint that armed it owed a fit
		// computed around cards with no pictures in them yet, so it is honoured
		// again here; a later flush is a picture appearing under a camera that
		// has already been set, and moving it then would be the map jumping for
		// no reason the user can see.
		const framing = this.mediaFraming;
		const anchor = this.mediaAnchor;
		this.mediaFraming = null;
		this.mediaAnchor = null;
		if (framing !== null) this.reframe(framing);

		this.measureAndPlace(root, stale, anchor, "media-remeasure");
		this.perf.span("media-remeasure", started, { changed: stale.length });
	}

	/**
	 * The cards whose media has landed, and which can therefore say what size
	 * they really are.
	 *
	 * A culled card has no size to read, so it is marked unmeasured instead and
	 * the cull that puts it back takes the measurement -- the same path a card
	 * built off screen already takes, and the one the media guard in
	 * `measureUnmeasured` exists for.
	 */
	private staleMediaCards(visible: LayoutNode[]): LayoutNode[] {
		const readable: LayoutNode[] = [];
		for (const layout of visible) {
			const element = this.elements.get(layout.node.id);
			if (!element || !element.hasMedia) continue;
			if (element.offscreen) {
				element.measured = false;
				continue;
			}
			if (mediaLoading(element.el)) continue;
			readable.push(layout);
		}
		return readable;
	}

	/**
	 * Measure cards and position everything.
	 *
	 * `measure` is what a paint has just built, or -- for a re-measure -- only the
	 * cards something can have changed the size of. Everything else keeps the size
	 * it was last measured at, which is the size the layout it is about to be run
	 * through was given.
	 *
	 * Safe to run more than once over the same tree: `layoutTree` assigns
	 * coordinates outright rather than accumulating them, and `renderEdges`
	 * clears the layer before it draws.
	 */
	private measureAndPlace(
		rootLayout: LayoutNode,
		measure: LayoutNode[],
		anchor: Anchor | null,
		reason: PaintReason,
	): void {
		const started = this.perf.now();
		let measured = 0;

		// One batched read pass: every write above, every measurement here.
		// offsetWidth, not getBoundingClientRect -- the cards sit inside a
		// scaled `.mm-content`, and a rect would feed the zoom back into layout.
		for (const layout of measure) {
			const element = this.elements.get(layout.node.id);
			// A culled card is out of the document and measures as nothing. The
			// size it had when it was last in view is the one that still holds,
			// and it is already on the layout node.
			if (!element || element.offscreen) continue;
			layout.width = element.el.offsetWidth;
			layout.height = element.el.offsetHeight;
			// The card apart from the node: the annotation strip is inside `.mm-row`
			// under `.mm-card`, so the layout centres, anchors and offsets on the
			// title's box while spacing siblings by the whole node.
			layout.cardWidth = element.card.offsetWidth;
			layout.cardHeight = element.card.offsetHeight;
			element.measured = true;
			measured++;
		}
		this.perf.span("paint-measure", started, { reason, measured });

		this.paintedEmpty = rootLayout.width === 0;
		if (this.paintedEmpty) return;

		this.applySelection();
		this.applySearchState();
		// A card this paint rebuilt came out of `buildNodeElement` without the
		// markers the live one was carrying, and the card being written in is the
		// one that may not lose them.
		this.markEditing();
		// The fold shape is settled by now, and the fold button says what it is.
		this.applyFoldButton();
		this.place(rootLayout, anchor, reason, true);
	}

	/**
	 * Lay the measured cards out and write the result to the DOM.
	 *
	 * `frame` is what separates a paint from a re-measure: a paint owes the
	 * camera whatever it was promised -- a fit, a restored focus, a jump to a
	 * search match -- and a re-measure of a few cards the cull just showed owes
	 * it nothing at all.
	 */
	private place(
		rootLayout: LayoutNode,
		anchor: Anchor | null,
		reason: PaintReason,
		frame: boolean,
	): void {
		const result = this.layOut(rootLayout, reason);

		if (frame) {
			// Read here, past the `paintedEmpty` return and before the framing
			// branches: a map painted while hidden keeps its jump until `onResize`
			// repaints it, and a jump that survives the read is spent either way.
			const reveal = this.pendingReveal;
			this.pendingReveal = null;
			this.frameMap(result, anchor, reveal);
		}

		// Last, and unconditionally: the camera has finished moving, so this is
		// the first moment the map can tell which cards are worth keeping. It
		// draws the connectors too, which is why it runs even when nothing has
		// changed hands -- a fresh paint has an empty layer to fill.
		this.cullToView(true);
	}

	/**
	 * Run the layout over the measured cards and write it to the DOM.
	 *
	 * Everything a repositioning needs and nothing a repaint does, which is what
	 * lets the export re-place a map it has just shown in full without the cull
	 * that would take half of it away again.
	 */
	private layOut(rootLayout: LayoutNode, reason: PaintReason): LayoutResult {
		const s = this.plugin.settings;
		const laidOut = this.perf.now();
		const result = layoutTree(rootLayout, {
			mode: s.layout,
			horizontalGap: s.horizontalGap,
			verticalGap: s.verticalGap,
			padding: 60,
		});
		this.perf.span("paint-layout", laidOut, { reason, nodes: result.nodes.length });

		const written = this.perf.now();
		for (const layout of result.nodes) {
			const element = this.elements.get(layout.node.id);
			if (!element) continue;
			element.el.style.transform = `translate(${layout.x}px, ${layout.y}px)`;
			element.el.dataset.side = layout.side === 1 ? "right" : "left";
		}

		this.canvas.content.style.width = `${result.width}px`;
		this.canvas.content.style.height = `${result.height}px`;
		this.mapWidth = result.width;
		this.mapHeight = result.height;
		this.setLayoutNodes(result.nodes);
		this.layoutElements = result.nodes.map(
			(layout) => this.elements.get(layout.node.id) ?? null,
		);
		this.perf.span("paint-transform", written, { reason, nodes: result.nodes.length });
		return result;
	}

	/**
	 * Measure the cards a cull has just put back for the first time, and lay the
	 * map out again around them.
	 *
	 * A card built off screen carries the size the paint before it measured, and
	 * that size is what the layout used. Once it is actually in the document it
	 * can say what it really is, and a title that grew or shrank since moves
	 * everything below it -- so the map is placed again, and the cull at the end
	 * of that may show more cards that have never been measured either. Bounded
	 * rather than run to a fixed point: each round is a whole layout, and the
	 * sizes it is correcting were real measurements to begin with.
	 */
	private measureNewlyShown(): void {
		const root = this.paintRoot;
		if (root === null || this.remeasuring) return;
		this.remeasuring = true;
		try {
			for (let round = 0; round < REMEASURE_ROUNDS; round++) {
				const started = this.perf.now();
				const { measured, changed } = this.measureUnmeasured();
				if (measured === 0) return;
				this.perf.span("cull-measure", started, { measured, changed, round });
				// Almost always nothing: the size a card was built with is one it
				// was measured at, under the same text and the same rules, so the
				// map it was laid out into is already the right one.
				if (changed === 0) return;
				this.place(root, null, "cull", false);
			}
		} finally {
			this.remeasuring = false;
		}
	}

	/**
	 * Measure every card that is in the document without ever having been
	 * measured there.
	 *
	 * Reports both how many it read and how many turned out to be a size other
	 * than the one the layout was given, because only the second number is worth
	 * a layout: the cards it read are ones a cull has just put back, and a card
	 * whose reused size was right changes nothing about where anything sits.
	 */
	private measureUnmeasured(): { measured: number; changed: number } {
		let measured = 0;
		let changed = 0;
		for (let i = 0; i < this.layoutNodes.length; i++) {
			const element = this.layoutElements[i];
			if (!element || element.offscreen || element.measured) continue;
			// A card whose picture has not landed yet measures as a card with no
			// picture in it, and the cull would lay the whole map out around
			// that. Left unmeasured on purpose: the flush that follows the load
			// is what measures it, and the size it is carrying until then is the
			// one some earlier paint measured it at.
			if (element.hasMedia && mediaLoading(element.el)) continue;
			const layout = this.layoutNodes[i];
			const width = element.el.offsetWidth;
			const height = element.el.offsetHeight;
			const cardWidth = element.card.offsetWidth;
			const cardHeight = element.card.offsetHeight;
			element.measured = true;
			measured++;
			if (
				width === layout.width &&
				height === layout.height &&
				cardWidth === layout.cardWidth &&
				cardHeight === layout.cardHeight
			) {
				continue;
			}
			layout.width = width;
			layout.height = height;
			layout.cardWidth = cardWidth;
			layout.cardHeight = cardHeight;
			changed++;
		}
		return { measured, changed };
	}

	/** Point the camera at whatever this paint owes it. */
	private frameMap(result: LayoutResult, anchor: Anchor | null, reveal: string | null): void {
		if (this.needsFit) {
			// A first look at the map reframes it deliberately; holding a node
			// still would fight that. Where it reframes *to* is the one thing a
			// restored session gets to change -- and only when the node it names
			// actually made it onto the canvas.
			this.needsFit = false;
			const focus = this.restoreFocusKey;
			this.restoreFocusKey = null;
			const framed = focus === null ? undefined : result.nodes.find((l) => l.node.key === focus);
			if (framed) {
				this.canvas.centreOn(framed.x + framed.width / 2, framed.y + framed.height / 2);
			} else {
				this.canvas.fit(result.width, result.height);
			}
			return;
		}
		if (anchor) {
			const held = result.nodes.find((l) => l.node.key === anchor.key);
			if (held) this.canvas.placeAt(held.x, held.y, anchor.screenX, anchor.screenY);
		}
		// After the anchor, never before it: holding a node still re-origins the
		// whole map, and the smallest pan that brings a match into view is only
		// the smallest one once the map has stopped moving.
		if (reveal !== null) {
			const target = result.nodes.find((l) => l.node.key === reveal);
			if (target) this.canvas.reveal(target.x, target.y, target.width, target.height);
		}
	}

	/**
	 * Keep the document down to the cards the viewport can nearly see.
	 *
	 * A map is one composited layer holding every card and every connector, and
	 * a few hundred nodes is already tens of thousands of pixels of it -- all of
	 * it rasterised, hit-tested and restyled on the frames where any of that has
	 * to happen, however far off screen it sits. Culling makes that work
	 * proportional to a screenful rather than to the note.
	 *
	 * Cheap enough to run on every frame of a pan: the scan is arithmetic over
	 * the layout the last paint produced, and only the cards that actually
	 * crossed the boundary touch the DOM -- at most `CULL_BUDGET` of them, with
	 * the rest carried to the next frame by the continuation at the end. The
	 * connectors keep their own, wider region and are left alone until the camera
	 * leaves it.
	 *
	 * `force` is the paint's own cull and the export's: no budget, no
	 * continuation, and the connectors redrawn whether the camera moved or not.
	 */
	private cullToView(force = false): void {
		const started = this.perf.now();
		this.cancelFrame();

		// One read of the viewport, two boxes: the cards' and the connectors'.
		const metrics = this.canvas.metrics();
		const show = viewBoxFrom(metrics, CULL_MARGIN);
		const hide = viewBoxFrom(metrics, CULL_MARGIN + CULL_HYSTERESIS);

		const nodes = this.layoutNodes;
		const cards = this.layoutElements;
		const editing = this.editingId;
		const plan = this.cullPlan;
		planCull(
			{
				boxes: nodes,
				offscreen: (i) => cards[i]?.offscreen === true,
				// A card with no element of its own cannot be flipped either way,
				// and the one being edited holds the focus: taking it out of the
				// document would drop the caret mid-word.
				keep: (i) => cards[i] === null || nodes[i].node.id === editing,
				show,
				hide,
				// A forced cull is the paint's own, and the export's: both need a
				// map that is right now rather than right in a few frames.
				budget: force ? Infinity : CULL_BUDGET,
			},
			plan,
		);

		let unmeasured = false;
		for (const i of plan.show) {
			const element = cards[i];
			if (!element) continue;
			element.offscreen = false;
			element.el.removeClass("is-offscreen");
			// On screen for the first time, or again: this is where the pictures
			// and videos inside it start loading. A card that was never culled
			// had them started by the paint.
			if (element.hasMedia) activateMedia(element.el);
			if (!element.measured) unmeasured = true;
		}
		for (const i of plan.hide) {
			const element = cards[i];
			if (!element) continue;
			element.offscreen = true;
			element.el.addClass("is-offscreen");
		}

		let paths = 0;
		const redrew = force || !covers(this.edgeView, show);
		if (redrew) {
			this.edgeView = viewBoxFrom(
				metrics,
				clampedMargin(EDGE_MARGIN, metrics.scale, EDGE_MAX_CONTENT),
			);
			paths = this.drawEdges(this.edgeView);
		}

		// A resize still on the books is one this cull was not the answer to --
		// only `runFrame` knows what a map painted at zero size owes it.
		if (plan.backlog > 0 || this.resized) this.requestFrame();

		this.perf.span("cull", started, {
			total: nodes.length,
			shown: plan.show.length,
			hidden: plan.hide.length,
			backlog: plan.backlog,
			edgesRedrawn: redrew,
			pathCount: paths,
		});

		// Last: a card that has never been in the document is on the map at the
		// size some earlier paint measured, and only now can it say what it
		// really is. The re-measure lays the map out again and culls once more,
		// which is why nothing below here may depend on this frame's plan.
		if (unmeasured) this.measureNewlyShown();
	}

	/** Nothing may be left to fire at a map that has been repainted or closed. */
	private cancelFrame(): void {
		this.frame.cancel();
	}

	/** The same, for the pass a picture's load asks for. */
	private cancelMedia(): void {
		if (this.mediaTimer !== null) {
			window.clearTimeout(this.mediaTimer);
			this.mediaTimer = null;
		}
		this.mediaDirty = false;
		// The tree goes too, and it is what covers the load that has not landed
		// yet: a picture already in flight still fires its own event after the
		// map is gone, `onSettled` arms a fresh timer from it, and this is the
		// only thing `flushMedia` reads as "there is no map to measure". The
		// next paint arms its own root.
		this.mediaRoot = null;
		// Released for the same reason: these are cards of the tree just let go
		// of, and holding them is holding the whole detached map alive.
		this.mediaCards = [];
	}

	/** Returns how many connectors it drew. */
	private drawEdges(view: ViewBox | null): number {
		if (!this.edgeLayer) return 0;
		const started = this.perf.now();
		const paths = renderEdges(
			this.edgeLayer,
			this.layoutNodes,
			this.mapWidth,
			this.mapHeight,
			this.plugin.settings.branchColors,
			this.plugin.settings.edgeStyle,
			view,
		);
		this.perf.span("edges", started, { paths, whole: view === null });
		return paths;
	}

	/**
	 * Put every card back in the document.
	 *
	 * The one thing culling cannot survive is a re-measure: a card that is out
	 * of the document has no size to report, so anything that means to measure
	 * the whole map again has to undo the culling first and let the pass that
	 * follows redo it.
	 */
	private showAllCards(): void {
		for (const element of this.elements.values()) {
			if (!element.offscreen) continue;
			element.offscreen = false;
			element.el.removeClass("is-offscreen");
		}
	}

	private applySelection(): void {
		const previous: NodeElement[] = [];
		for (const element of this.elements.values()) {
			if (element.el.hasClass("is-selected")) previous.push(element);
			element.el.removeClass("is-selected");
		}
		const picked: NodeElement[] = [];
		for (const key of this.selectedKeys()) {
			const node = this.nodeForKey(key);
			const element = node ? this.elements.get(node.id) : undefined;
			if (!element) continue;
			element.el.addClass("is-selected");
			picked.push(element);
		}
		// The branch button answers to the picked state, and the selection moves
		// without a paint: the class and icon the paint built the button with
		// were the state then, not the state now. Both ends of the move are
		// re-asked here -- the cards picked and the cards unpicked -- so the
		// minus the ring lands on becomes the plus, and the ones it leaves grow
		// their minus back.
		//
		// Only the anchor counts as picked for this: the button's press acts on
		// the card it is on, and in a multiple selection there is one card the
		// keyboard is aimed at. Ringing the others says "these go too", which
		// is a different sentence.
		const anchor = picked[0] ?? null;
		const ends = new Set<NodeElement>(picked);
		for (const element of previous) ends.add(element);
		for (const element of ends) {
			this.syncBranchButton(element, element === anchor);
		}
		// The corner follows the selection when the setting asks it to.
		this.applyToolbarVisibility();
	}

	/**
	 * Re-ask the branch button what it does, for the state the card is in now.
	 *
	 * The paint built the button from the same question, but the answer moves
	 * when the selection or the fold does, and neither of those repaints the
	 * card. The icon is only re-drawn when it changes: `setIcon` replaces the
	 * child it has, and a swap per selection move would flicker for nothing.
	 */
	private syncBranchButton(element: NodeElement, selected: boolean): void {
		if (!element.add) return;
		const id = element.el.dataset.id;
		const layout = id ? this.layoutFor(id) : null;
		if (!layout) return;
		const action = branchAction(this.branchStateFor(layout.node, selected));
		const plus = showsPlus(action);
		element.add.removeClass("is-plus", "is-minus");
		element.add.addClass(plus ? "is-plus" : "is-minus");
		element.add.setAttribute("aria-label", t(branchLabelKey(action)));
		if (element.add.dataset.branchAction !== action) {
			element.add.dataset.branchAction = action;
			setIcon(element.add, branchIcon(action));
			if (!element.add.firstElementChild) {
				element.add.setText(BRANCH_FALLBACK_TEXT[action]);
			}
		}
	}

	/**
	 * The branch button's state for a card, wherever the question is asked.
	 *
	 * One place rather than three, because the paint, the press and the
	 * selection move all have to agree about it -- and the one that disagrees
	 * is a button whose icon says something the press does not do.
	 */
	private branchStateFor(node: MindNode, selected: boolean): BranchButtonState {
		const isBody = node.kind === "body";
		return {
			hasChildren: this.childCount(node, this.plugin.settings.showBodyNodes) > 0,
			collapsed: isBody
				? this.collapsedBodies.has(node.key)
				: this.collapsedKeys.has(node.key),
			selected,
			// The same question the paint asked to decide the button exists --
			// one line is nothing to fold, five are, whatever they say.
			collapsible: this.foldsBody(node),
		};
	}

	/**
	 * The node a selection key names.
	 *
	 * A body card's key is `ownerKey + BODY_ID_MARK + index`. It is not in
	 * `parsed.byKey` because the node is virtual, so it is looked up in the
	 * layout index instead -- the layout has the synthesised node.
	 */
	private nodeForKey(key: string): MindNode | null {
		return this.parsed?.byKey.get(key) ?? this.layoutByKey.get(key)?.node ?? null;
	}

	private selectedNode(): MindNode | null {
		if (this.selectionKey === null) return null;
		return this.nodeForKey(this.selectionKey);
	}

	/** Every selected key, the anchor first. */
	private selectedKeys(): string[] {
		if (this.selectionKey === null) return [];
		return [this.selectionKey, ...this.extraKeys];
	}

	/** Everything a batch acts on. Missing keys drop out rather than fail. */
	private selectedNodes(): MindNode[] {
		const nodes: MindNode[] = [];
		for (const key of this.selectedKeys()) {
			const node = this.nodeForKey(key);
			if (node) nodes.push(node);
		}
		return nodes;
	}

	/** A value that changes exactly when the selection does. */
	private selectionSignature(): string {
		return this.selectedKeys().join("\u0000");
	}

	/** Point the selection at one card, dropping anything a band added. */
	private setAnchor(key: string | null): void {
		this.selectionKey = key;
		this.extraKeys.clear();
	}

	/** The key a card's id stands for, or null when it names no node. */
	private keyForId(id: string): string | null {
		const ref = this.bodyNodes.get(id);
		if (ref) return `${ref.ownerKey}${BODY_ID_MARK}${ref.index}`;
		return this.parsed?.byId.get(id)?.key ?? null;
	}

	private layoutFor(id: string): LayoutNode | null {
		return this.layoutById.get(id) ?? null;
	}

	/** `layoutNodes` and its two indexes move together, or not at all. */
	private setLayoutNodes(nodes: LayoutNode[]): void {
		this.layoutNodes = nodes;
		this.layoutById.clear();
		this.layoutByKey.clear();
		for (const layout of nodes) {
			this.layoutById.set(layout.node.id, layout);
			this.layoutByKey.set(layout.node.key, layout);
		}
	}

	// --- mutation plumbing ----------------------------------------------------

	/**
	 * What an inline editor wrote, with one case the writes alone do not cover.
	 *
	 * An editor that ends on an empty field takes the card's placeholder out with
	 * the text and leaves nothing behind it -- and both editors that can end that
	 * way leave something else too: the title's has emptied the card's text, and
	 * the annotation's may have had to synthesise a strip to type into. When the
	 * field was already empty there is nothing to write, and `renameNode` and
	 * `setAnnotation` both say so.
	 *
	 * `apply` is right to do nothing with that: a note that did not change must
	 * not be saved again, and must not earn an undo step. But the card on screen
	 * is not the note, and it is the card the editor has left wrong -- bare, with
	 * no way to tell it is a card, sized to nothing; or a line taller than it was,
	 * under a strip that is not there any more. So an edit that ended empty is
	 * repainted whatever the mutation says, and a write that did happen goes the
	 * usual way, where the repaint comes with it.
	 *
	 * Blank is the only ending that shows this: an editor that ends on the text
	 * it started with leaves that text in place, and the card looks untouched.
	 *
	 * The title's editor also puts its own field back on the way out, and does
	 * not wait for this: it is the one thing that knows what it emptied, and the
	 * repaint is the second half of the story rather than the first.
	 */
	private applyEdit(mutation: Mutation, endedEmpty: boolean): void {
		if (endedEmpty && !mutation.ok) this.render("edit");
		else this.apply(mutation);
	}

	private apply(mutation: Mutation, edit = false): void {
		if (!mutation.ok) return;
		// A drop onto the position a node already holds rewrites it to exactly what
		// it was. Nothing changed, so it earns neither an undo step nor a save.
		if (mutation.text === this.data) return;
		pushRevision(this.undoStack, this.data);
		this.redoStack = [];
		this.commit(mutation.text, mutation.focusLine, edit);
	}

	private commit(text: string, focusLine: number, edit: boolean): void {
		this.data = text;
		this.pendingFocus = focusLine >= 0 ? { line: focusLine, edit } : null;
		// Parked on every write, not on the way out: the leaf swaps this view for
		// a markdown one by way of a brand new instance, so the stacks have to
		// live somewhere that outlasts this one.
		this.parkHistory();
		this.requestSave();
		this.render("edit");
	}

	/**
	 * Hand this map's history to the plugin, which outlives the view.
	 *
	 * The stacks are only meaningful against the document they were recorded
	 * from, so the current text goes with them -- see `adoptUndo` for what the
	 * plugin does with that.
	 */
	private parkHistory(): void {
		const path = this.file?.path;
		if (path === undefined) return;
		this.plugin.parkUndo(path, this.data, this.undoStack, this.redoStack);
	}

	/** Take back this note's history, if the note is still the one it was. */
	private adoptHistory(data: string): UndoStacks | null {
		const path = this.file?.path;
		if (path === undefined) return null;
		return this.plugin.adoptUndo(path, data);
	}

	private withNode(id: string, run: (parsed: ParsedDoc, node: MindNode) => void): void {
		const parsed = this.parsed;
		const node = parsed?.byId.get(id);
		if (!parsed || !node) return;
		run(parsed, node);
	}

	// --- MapController --------------------------------------------------------

	isEditing(): boolean {
		return this.editingId !== null;
	}

	/**
	 * Whether the card being edited has been typed into.
	 *
	 * Read off the element rather than tracked with an input listener: the text
	 * is what the user sees, and a listener that missed one path -- a paste, a
	 * spell-check correction, an undo inside the field -- would leave this
	 * answering for a document that no longer matches the screen.
	 */
	editingHasTyped(): boolean {
		if (this.editTextEl === null || this.editStartText === null) return false;
		return (this.editTextEl.textContent ?? "") !== this.editStartText;
	}

	/**
	 * Close an editor that has typed nothing, so the map can act on the key.
	 *
	 * Discarded rather than committed: there is nothing to write, and a commit
	 * would push a rename step that undoes straight back to the text the user
	 * is already looking at.
	 *
	 * Closing it first is not optional. The undo that follows repaints, and the
	 * element the editor was living in goes with the node it belonged to -- a
	 * blur that never fires, which is how `editingId` gets stuck and the map
	 * goes deaf to every key afterwards.
	 */
	private discardIdleEdit(): void {
		if (this.editingId === null || this.editingHasTyped()) return;
		this.endEdit?.(false);
	}

	/**
	 * Mark the card that is being written in, and unmark the one that was.
	 *
	 * The marker is derived from `editingId` rather than added and removed in
	 * pairs because the order a new editor and a closing one take in is not
	 * fixed: `discardIdleEdit` closes the old field after the new one has already
	 * recorded itself, and an unmark that ran late would come off the field the
	 * user is typing in.
	 */
	private markEditing(): void {
		for (const [id, element] of this.elements) {
			element.el.toggleClass("is-editing", id === this.editingId);
		}
	}

	/**
	 * Done with a card: it is no longer being written in.
	 *
	 * The id is passed rather than read off `editingId` because of the same
	 * ordering: by the time an idle editor is closed, `editingId` may be the card
	 * the user has just opened, and an unconditional clear there would leave the
	 * map thinking nothing is being edited at all.
	 */
	private endEditing(id: string): void {
		if (this.editingId !== id) return;
		this.editingId = null;
		this.markEditing();
	}

	/**
	 * What an in-place editor needs from the view it is open inside.
	 *
	 * A fresh object per editor, because the closures are cheap and the three
	 * fields genuinely share one answer each: the map's undo, and where the
	 * focus belongs when the field is done with it.
	 */
	private editorHost(): InlineEditorHost {
		return {
			mapAction: (ev) => {
				// Only undo and redo ever survive editing, and only while nothing
				// has been typed -- which is what `survivesEditing` says. Naming
				// the two here rather than casting keeps that contract visible.
				const action = resolveAction(this.bindings(), comboFromEvent(ev));
				if (action !== "undo" && action !== "redo") return null;
				return survivesEditing(action, this.editingHasTyped()) ? action : null;
			},
			undo: () => this.undo(),
			redo: () => this.redo(),
			openSearch: () => this.openSearch(),
			releaseFocus: () => this.canvas.viewport.focus({ preventScroll: true }),
		};
	}

	/**
	 * Take the user to where this card is written.
	 *
	 * The map and the note share one leaf, so this is a change of view type and
	 * a scroll -- no file is opened and nothing is written. The pending save is
	 * flushed first: the editor reads the file, and a write still sitting on the
	 * debounce timer would hand it the text from before the last edit, which is
	 * the wrong note to land in even by one line.
	 */
	async revealInNote(id: string): Promise<void> {
		const node = this.parsed?.byId.get(id);
		if (!node || node.lineStart < 0) return;
		const line = node.lineStart;

		await this.save();
		await this.plugin.setMarkdownView(this.leaf, false);

		// Read off the leaf rather than `this`: the view that was here is gone.
		const view = this.leaf.view;
		if (!(view instanceof MarkdownView)) return;
		await this.plugin.revealLine(view, line);
	}

	selectedId(): string | null {
		return this.selectedNode()?.id ?? null;
	}

	/**
	 * Point the selection at a card, or at nothing.
	 *
	 * `additive` is what Shift and Ctrl/Cmd ask for: the card joins the
	 * selection instead of replacing it, and a card already in it leaves --
	 * which is what makes a second shift-click on the same card undo the first.
	 * The anchor is the exception: dropping it hands the anchor over to
	 * whatever else is selected, so a selection always has one card the
	 * keyboard can act on, and the last one left can be dropped like any other.
	 */
	select(id: string | null, additive = false): void {
		const before = this.selectionSignature();

		if (id === null) {
			this.setAnchor(null);
		} else {
			const key = this.keyForId(id);
			if (key === null) return;
			if (!additive) {
				this.setAnchor(key);
			} else if (key === this.selectionKey) {
				const rest = [...this.extraKeys];
				this.selectionKey = rest.shift() ?? null;
				this.extraKeys = new Set(rest);
			} else if (this.extraKeys.has(key)) {
				this.extraKeys.delete(key);
			} else if (this.selectionKey === null) {
				this.selectionKey = key;
			} else {
				this.extraKeys.add(key);
			}
		}

		if (this.selectionSignature() === before) return;
		this.applySelection();
		// Moving the selection is the one change that never repaints, so it is
		// the one change that has to record itself.
		this.rememberState();
	}

	/** What a band swept over, replacing whatever was selected. */
	selectMany(ids: readonly string[]): void {
		const before = this.selectionSignature();
		const keys: string[] = [];
		for (const id of ids) {
			const key = this.keyForId(id);
			if (key !== null && !keys.includes(key)) keys.push(key);
		}
		this.selectionKey = keys[0] ?? null;
		this.extraKeys = new Set(keys.slice(1));
		if (this.selectionSignature() === before) return;
		this.applySelection();
		this.rememberState();
	}

	selectionSize(): number {
		return this.selectedKeys().length;
	}

	beginEdit(id: string): void {
		// Body cards are edited in place, not through a dialog.
		if (this.bodyNodes.has(id)) {
			const ref = this.bodyNodes.get(id)!;
			const node = this.parsed?.byKey.get(ref.ownerKey);
			if (node && node.bodyRanges[ref.index]) {
				this.beginBodyEdit(node.id, node.bodyRanges[ref.index][0]);
			}
			return;
		}

		const element = this.elements.get(id);
		const node = this.parsed?.byId.get(id);
		if (!element || !node) return;
		if (!canRename(node)) {
			new Notice(t("view.notice.rootRename"));
			return;
		}

		this.editingId = id;
		this.select(id);

		// A card culled for being off screen is out of the document and cannot
		// take the focus. Setting `editingId` above keeps the next cull off it.
		if (element.offscreen) {
			element.offscreen = false;
			element.el.removeClass("is-offscreen");
		}
		this.markEditing();

		const el = element.text;
		// Recorded before the first keystroke can arrive, so "has anything been
		// typed" answers for this editor and not the last one.
		this.editTextEl = el;
		this.editStartText = node.text;

		// Handed to the viewport handler by `finishEdit` on the way out, so the
		// map can close this editor before it acts.
		this.endEdit = openInlineEditor(
			{
				field: el,
				text: node.text,
				// A title is one line, so `Enter` saves it -- there is no second
				// line for it to write. `Ctrl`/`Cmd`+`F` is let out to the find
				// bar, because a rename is often the run-up to a search for the
				// new name.
				shape: { multiline: false, code: false, search: true },
				commit: (value, save) => {
					// The field is the card's own text box, and it was emptied
					// to hold what the user was writing. An edit that ends on
					// nothing has to hand it back the way a paint would draw it
					// -- the placeholder that says there is something to write
					// here -- rather than leaving a box with nothing in it. A
					// write repaints this element away a moment later; this is
					// for the endings that write nothing, and it does not depend
					// on that repaint arriving. See `applyEdit`.
					if (value.trim() === "") renderInline(el, "");
					this.endEditing(id);
					this.editTextEl = null;
					this.editStartText = null;
					this.endEdit = null;
					if (save) {
						this.withNode(id, (parsed, current) => {
							this.applyEdit(renameNode(parsed, current, value), value.trim() === "");
						});
					} else {
						this.render("edit");
					}
				},
			},
			this.editorHost(),
		);
	}

	addChildTo(id: string): void {
		this.withNode(id, (parsed, node) => {
			this.collapsedKeys.delete(node.key);
			this.apply(addChild(parsed, node, ""), true);
		});
	}

	addSiblingTo(id: string): void {
		this.withNode(id, (parsed, node) => {
			if (!node.parent) {
				this.addChildTo(id);
				return;
			}
			this.apply(addSibling(parsed, node, ""), true);
		});
	}

	/**
	 * Write an indented text block under the node, and open it to be written.
	 *
	 * Straight into the editor, the way double-clicking the card would: the
	 * whole point of the key is to write something, and a block the user cannot
	 * see yet is not something to leave them staring at.
	 *
	 * The placeholder is real text rather than an empty line, because an empty
	 * one is dropped by the parser -- there would be no block to open, and the
	 * line would sit in the note invisible to the map.
	 */
	/**
	 * Write an indented text block under the node, and focus it for editing
	 * in place — no dialog. The block lands on the map as a body card, and
	 * that card's text element is turned into a contentEditable field, the
	 * same way a node title is edited. Enter saves, Escape cancels.
	 */
	addBlock(id: string): void {
		this.withNode(id, (parsed, node) => {
			const mutation = addBlock(parsed, node, t("view.block.placeholder"));
			if (!mutation.ok) {
				new Notice(t("view.notice.blockRefused"));
				return;
			}
			this.collapsedKeys.delete(node.key);
			this.apply(mutation, true);
			// After the repaint, the new body card exists on the map. Find it
			// by locating the body range whose first line is the one the
			// mutation focused, and start editing it in place.
			this.beginBodyEdit(id, mutation.focusLine);
		});
	}

	addSiblingBeforeTo(id: string): void {
		this.withNode(id, (parsed, node) => {
			if (!node.parent) {
				this.addChildTo(id);
				return;
			}
			this.apply(addSiblingBefore(parsed, node, ""), true);
		});
	}

	/**
	 * Find the body card that contains `focusLine` and start editing it in
	 * place, the same way a node title is edited. `Ctrl`/`Cmd`+Enter saves with
	 * `replaceBodyRange`, Escape cancels.
	 *
	 * A code block is the one exception: `Shift`+Enter writes a line there
	 * too, because a sample without its line breaks is not the sample. Every
	 * other spelling of Enter still saves. `inlineEditor.ts` is where those
	 * rules live.
	 */
	private beginBodyEdit(ownerId: string, focusLine: number): void {
		const parsed = this.parsed;
		if (!parsed) return;
		const owner = parsed.byId.get(ownerId);
		if (!owner) return;

		// Find which body range contains the focused line.
		let rangeIndex = -1;
		for (let i = 0; i < owner.bodyRanges.length; i++) {
			const [s, e] = owner.bodyRanges[i];
			if (focusLine >= s && focusLine <= e) {
				rangeIndex = i;
				break;
			}
		}
		if (rangeIndex < 0) return;

		// The body card's id is `ownerId${BODY_ID_MARK}${rangeIndex}`.
		const bodyId = `${ownerId}${BODY_ID_MARK}${rangeIndex}`;
		const element = this.elements.get(bodyId);
		if (!element) return;

		const range = owner.bodyRanges[rangeIndex];
		const rawText = bodyRangeText(parsed, range);
		const isCode = /^\s*(```|~~~)/.test(rawText);
		// The indent the block carries in the source: a list item's body is
		// indented to its content column. Shown to the user without it, and
		// put back on save so the note stays the same to the parser.
		const indent =
			owner.kind === "listitem"
				? owner.indent + " ".repeat(owner.marker.length) + owner.spacing
				: "";
		// Display text: strip blank lines and leading indent so the user edits
		// the prose itself, not the structural whitespace around it.
		const displayText = isCode
			? rawText
			: rawText
					.split("\n")
					.map((line) => line.replace(/^[ \t]+/, ""))
					.filter((line) => line.trim() !== "")
					.join("\n");
		const key = owner.key;

		if (element.offscreen) {
			element.offscreen = false;
			element.el.removeClass("is-offscreen");
		}

		this.editingId = bodyId;
		// Picked before the field is focused, so that "being edited" always comes
		// with "picked": the frame round the card and the fill it is drawn with
		// belong to the picked state, and a block opened from the keyboard is
		// picked by nothing else. `select` only writes classes -- it does not
		// touch the focus -- so the field still gets it.
		this.select(bodyId);
		this.markEditing();
		this.discardIdleEdit();

		const el = element.text;
		this.editTextEl = el;
		this.editStartText = displayText;

		this.endEdit = openInlineEditor(
			{
				field: el,
				text: displayText,
				// Prose, so `Enter` writes a line and `Ctrl`/`Cmd`+Enter saves.
				// A code block is the one exception: its own text is lines, so
				// there `Shift`+Enter is the break and a plain `Enter` saves --
				// which is also what `Shift`+Enter means on the map itself when
				// no editor is open.
				shape: { multiline: true, code: isCode, search: false },
				commit: (value, save) => {
					this.endEditing(bodyId);
					this.editTextEl = null;
					this.editStartText = null;
					this.endEdit = null;
					if (save && value !== displayText) {
						// Re-indent the edited text before writing it back: each
						// line gets the owner's indent prefix so the parser still
						// sees the block as belonging to the node above.
						const toWrite = isCode
							? value
							: value
									.split("\n")
									.map((line) => (line === "" ? "" : indent + line))
									.join("\n");
						const snapshot = parseMarkdown(this.data, this.parseOptions());
						const current = snapshot.byKey.get(key);
						if (current && current.bodyRanges[rangeIndex]) {
							this.apply(replaceBodyRange(snapshot, current, rangeIndex, toWrite));
						} else {
							this.render("edit");
						}
					} else {
						this.render("edit");
					}
				},
			},
			this.editorHost(),
		);
	}

	removeNode(id: string): void {
		// A body card stands for a range of lines in the note; deleting it
		// means removing those lines. The body node is virtual (not in
		// `parsed.byId`), so it is resolved through `bodyNodes` instead.
		const ref = this.bodyNodes.get(id);
		if (ref) {
			const parsed = this.parsed;
			const owner = parsed?.byKey.get(ref.ownerKey);
			if (!parsed || !owner || !owner.bodyRanges[ref.index]) return;
			const range = owner.bodyRanges[ref.index];
			const text = bodyRangeText(parsed, range).trim();
			// An annotation (lines starting with ": ") is deleted entirely
			// when its content is empty — no leftover ":" line. A code block
			// or other note content is kept even when empty, because an
			// empty code block is still a block the user may fill in.
			const isAnnotation = owner.annotationIndices.includes(ref.index);
			if (isAnnotation && text.replace(/^:\s*/, "").trim() === "") {
				// Clear the annotation text; `setAnnotation` with "" removes
				// the annotation lines entirely.
				this.apply(setAnnotation(parsed, owner, ""));
				return;
			}
			// Non-annotation body: replace the range with a single empty line
			// (keeps the block, just clears it) or delete it entirely. The
			// user asked for deletion, so splice the range out.
			const doc = spliceLines(parsed.doc, range[0], range[1] - range[0] + 1, []);
			this.apply({ text: toText(doc), focusLine: owner.lineStart, ok: true });
			return;
		}
		// A card inside a multiple selection takes the whole selection with it,
		// which is what every file list does and what the rings are promising.
		// A card outside one is deleted on its own, as it always was.
		if (this.isInSelection(id) && this.extraKeys.size > 0) {
			this.removeSelection();
			return;
		}
		this.withNode(id, (parsed, node) => {
			if (!node.parent) {
				new Notice(t("view.notice.rootDelete"));
				return;
			}
			this.apply(deleteNode(parsed, node));
		});
	}

	/** Whether this card is part of what is selected right now. */
	private isInSelection(id: string): boolean {
		const key = this.keyForId(id);
		return key !== null && (key === this.selectionKey || this.extraKeys.has(key));
	}

	/**
	 * Delete every selected node as one edit.
	 *
	 * One edit, so it comes back as one undo step, and one `Notice` when the
	 * selection held the root -- which has no line to delete and is the one
	 * thing here that cannot go.
	 */
	removeSelection(): void {
		const parsed = this.parsed;
		if (!parsed) return;
		const nodes = this.selectedNodes().filter((node) => node.kind !== "body");
		const roots = nodes.filter((node) => node.parent === null);
		if (roots.length > 0) {
			new Notice(t("view.notice.rootDelete"));
			return;
		}
		const mutation = deleteNodes(parsed, nodes);
		if (!mutation.ok) return;
		this.setAnchor(null);
		this.applySelection();
		this.apply(mutation);
	}

	indent(id: string): void {
		this.withNode(id, (parsed, node) => this.apply(indentNode(parsed, node)));
	}

	outdent(id: string): void {
		this.withNode(id, (parsed, node) => this.apply(outdentNode(parsed, node)));
	}

	/**
	 * Swap the node with the sibling above / below it -- the same drop dragging
	 * it onto that sibling's near edge performs.
	 *
	 * Nothing else is needed to keep the selection and the folds: the mutation
	 * focuses the line the block landed on, and fold state is keyed by text
	 * path, which a swap between siblings written the same way never disturbs.
	 */
	moveUp(id: string): void {
		this.withNode(id, (parsed, node) => this.apply(reorderUp(parsed, node)));
	}

	moveDown(id: string): void {
		this.withNode(id, (parsed, node) => this.apply(reorderDown(parsed, node)));
	}

	/** Whether the commands have a selection with somewhere to move it. */
	canMoveSelection(direction: "up" | "down"): boolean {
		const node = this.selectedNode();
		if (!node) return false;
		return direction === "up" ? canReorderUp(node) : canReorderDown(node);
	}

	moveSelection(direction: "up" | "down"): void {
		const id = this.selectedId();
		if (!id) return;
		if (direction === "up") this.moveUp(id);
		else this.moveDown(id);
	}

	toggleCheck(id: string): void {
		this.withNode(id, (parsed, node) => this.apply(toggleCheckbox(parsed, node)));
	}

	removeCheck(id: string): void {
		this.withNode(id, (parsed, node) => this.apply(removeCheckbox(parsed, node)));
	}

	toggleFold(id: string): void {
		// A note-content card has no branch to close, so "fold this card" means
		// folding the card itself -- which is also what its count badge offers,
		// and what the fold key does to a picked one.
		if (this.bodyNodes.has(id)) {
			this.toggleBodyFold(id);
			return;
		}
		// A card inside a multiple selection folds the whole selection: the
		// rings say these cards go together, and folding one of five would say
		// the opposite.
		if (this.isInSelection(id) && this.extraKeys.size > 0) {
			this.toggleFoldSelection();
			return;
		}
		this.withNode(id, (_parsed, node) => {
			// Has to agree with the `hasChildren` that decided whether to draw the
			// toggle at all, or the button exists and does nothing.
			if (this.childCount(node, this.plugin.settings.showBodyNodes) === 0) return;
			// Folded or unfolded by hand: the branch is the user's from here on,
			// and closing the search must not undo what they just did.
			this.searchRevealed.delete(node.key);
			this.markAnchor(node.key);
			if (this.collapsedKeys.has(node.key)) this.collapsedKeys.delete(node.key);
			else this.collapsedKeys.add(node.key);
			this.paint("fold");
		});
	}

	/**
	 * Fold the whole selection, or open it.
	 *
	 * One direction for all of it rather than one per card: folded when
	 * anything in the selection is still open, opened when all of it is folded.
	 * Asking each card separately would turn a mixed selection into a different
	 * mix and leave the key meaning nothing in particular.
	 */
	private toggleFoldSelection(): void {
		const showBody = this.plugin.settings.showBodyNodes;
		const selected = this.selectedNodes();
		const branches = selected.filter(
			(node) => node.kind !== "body" && this.childCount(node, showBody) > 0,
		);
		const bodies = selected.filter((node) => this.foldsBody(node));
		if (branches.length === 0 && bodies.length === 0) return;

		const open =
			branches.some((node) => !this.collapsedKeys.has(node.key)) ||
			bodies.some((node) => !this.collapsedBodies.has(node.key));

		for (const node of branches) {
			// Folded by hand: the branch is the user's from here on, and closing
			// the search must not undo what they just did.
			this.searchRevealed.delete(node.key);
			if (open) this.collapsedKeys.add(node.key);
			else this.collapsedKeys.delete(node.key);
		}
		for (const node of bodies) {
			if (open) this.collapsedBodies.add(node.key);
			else this.collapsedBodies.delete(node.key);
		}
		this.markAnchor(this.selectionKey ?? undefined);
		this.rememberState();
		this.paint("fold");
	}

	/**
	 * What the branch button's press means for this card right now.
	 *
	 * The button is drawn from the same question -- see `branchButton.ts` -- so
	 * the press and the icon cannot disagree: a minus on the card folds it, a
	 * plus grows it a child, and on a note-content card holding code the same
	 * two mean folding and unfolding that card's own body. The card that was
	 * picked when the button was built may have been unpicked since, which is
	 * why the question is asked again here instead of the answer being read off
	 * the DOM.
	 */
	toggleBranch(id: string): void {
		// A note-content card is not in `parsed.byId`, so it has to be answered
		// here -- `withNode` would look it up, find nothing and do nothing.
		if (this.bodyNodes.has(id)) {
			this.toggleBodyFold(id);
			return;
		}
		this.withNode(id, (_parsed, node) => {
			const action = branchAction(this.branchStateFor(node, this.selectedId() === id));
			if (action === "fold") this.toggleFold(id);
			else this.addChildTo(id);
		});
	}

	/**
	 * Fold a note-content card down to its first line, or open it back up.
	 *
	 * The state is keyed by the block's place in its owner, so it follows the
	 * block for as long as the note keeps its shape; a block that moves or is
	 * rewritten comes back open. That is the failure a remembered fold is
	 * allowed to have -- the note is never touched either way.
	 */
	toggleBodyFold(id: string): void {
		const ref = this.bodyNodes.get(id);
		const owner = ref ? this.parsed?.byKey.get(ref.ownerKey) : null;
		if (!ref || !owner) return;
		const key = `${ref.ownerKey}${BODY_ID_MARK}${ref.index}`;
		if (this.collapsedBodies.has(key)) this.collapsedBodies.delete(key);
		else this.collapsedBodies.add(key);
		// `fold` and not `edit`: what changed is the card's own text, and a
		// paint that re-measures what changed is the whole of what is needed.
		// `rememberState` rides along with the paint.
		this.paint("fold");
	}

	/**
	 * The ids of everything selected, the anchor first.
	 *
	 * A note-content card is a selection like any other -- deleting a selection
	 * takes one with it -- but it stands for lines of the note rather than for a
	 * node, so it has no id here. See `carriedBy`.
	 */
	selectedIds(): readonly string[] {
		const ids: string[] = [];
		for (const key of this.selectedKeys()) {
			const node = this.parsed?.byKey.get(key);
			if (node) ids.push(node.id);
		}
		return ids;
	}

	/**
	 * What a drag that starts on this card would carry.
	 *
	 * The card alone, unless it is part of a selection the tree can hold more
	 * than one card of -- a card outside the selection is dragged on its own
	 * whatever else is selected, which is what every file list does and what the
	 * rings on the other cards are promising. The same rule `removeNode` uses
	 * for a delete.
	 *
	 * A note-content card is never carried along with a selection, only picked
	 * up on its own: a block is written under an owner rather than becoming a
	 * card in the tree, so it has no place among nodes being dropped somewhere.
	 * Picking one up is the block drag it always was.
	 */
	carriedBy(id: string): readonly string[] {
		if (this.bodyNodes.has(id)) return [id];
		const selected = this.selectedIds();
		return this.isInSelection(id) && selected.length > 1 ? selected : [id];
	}

	canDrop(id: string, targetId: string, mode: DropMode): boolean {
		const ref = this.bodyNodes.get(id);
		if (ref) {
			const from = this.parsed?.byKey.get(ref.ownerKey);
			const slot = this.bodySlot(targetId, mode);
			if (!from || !slot) return false;
			return canMoveBodyBlock(from, ref.index, slot.owner, slot.before);
		}
		const node = this.parsed?.byId.get(id);
		const target = this.parsed?.byId.get(targetId);
		if (!node || !target) return false;
		return mode === "child" ? canMove(node, target) : canReorder(node, target);
	}

	/**
	 * Where a note-content block would land: the node whose body takes it, and
	 * the line it goes above -- or null for the end of that node's content.
	 *
	 * Null means the slot is not one a block can use at all. The three modes
	 * mean different things for a block than for a node, because a block is
	 * lines of the note rather than a thing in the tree:
	 *
	 * - inside a card, it becomes that card's body;
	 * - beside a card, it joins the body of that card's *parent*, anchored on
	 *   the card it was dropped next to -- beside a card is where that card's
	 *   own content sits, so that is where a sibling of it belongs;
	 * - beside another block, it lands above or below that one, inside whichever
	 *   node owns it. That is the only case that is about the block rather than
	 *   about an owner.
	 */
	private bodySlot(
		targetId: string,
		mode: DropMode,
	): { owner: MindNode; before: number | null } | null {
		const parsed = this.parsed;
		if (!parsed) return null;

		const targetRef = this.bodyNodes.get(targetId);
		if (targetRef) {
			// A block owns nothing, so "inside it" is not on offer.
			if (mode === "child") return null;
			const targetOwner = parsed.byKey.get(targetRef.ownerKey);
			const range = targetOwner?.bodyRanges[targetRef.index];
			if (!targetOwner || !range) return null;
			return {
				owner: targetOwner,
				before: mode === "before" ? range[0] : range[1] + 1,
			};
		}

		const target = parsed.byId.get(targetId);
		if (!target) return null;
		if (mode === "child") return { owner: target, before: null };
		const parent = target.parent;
		if (!parent) return null;
		return {
			owner: parent,
			before: mode === "before" ? target.lineStart : target.blockEnd + 1,
		};
	}

	/** Whether this note-content card is one the user may pick up and move. */
	canDragBody(id: string): boolean {
		const parsed = this.parsed;
		const ref = this.bodyNodes.get(id);
		const owner = parsed && ref ? parsed.byKey.get(ref.ownerKey) : null;
		if (!parsed || !ref || !owner) return false;
		// Any block the note owns, not just the fenced samples: the model moves
		// a body range whole whatever it holds -- a paragraph rides the same as
		// a listing -- and the button being the one handle means the answer
		// here is the difference between a card the button moves and one it
		// does nothing to.
		return owner.bodyRanges[ref.index] !== undefined;
	}

	move(id: string, targetId: string, mode: DropMode): void {
		const parsed = this.parsed;
		if (!parsed) return;

		const ref = this.bodyNodes.get(id);
		if (ref) {
			const from = parsed.byKey.get(ref.ownerKey);
			const slot = this.bodySlot(targetId, mode);
			if (!from || !slot) return;
			// Nothing to unfold on the way in: a block is written under its new
			// owner rather than under a card that could be closed over it, so
			// the only thing that could hide it is a fold on the owner itself --
			// and a block just dropped on that owner is not worth opening for.
			this.apply(moveBodyBlock(parsed, from, ref.index, slot.owner, slot.before));
			return;
		}

		const node = parsed.byId.get(id);
		const target = parsed.byId.get(targetId);
		if (!node || !target) return;

		if (mode === "child") {
			this.collapsedKeys.delete(target.key);
			this.apply(moveNode(parsed, node, target));
			return;
		}
		// Dropped beside the target, so it is the target's parent that must be
		// open for the node to be visible where it landed.
		if (target.parent) this.collapsedKeys.delete(target.parent.key);
		this.apply(
			mode === "before"
				? moveBefore(parsed, node, target)
				: moveAfter(parsed, node, target),
		);
	}

	/**
	 * Whether every card the drag is carrying could land in this slot.
	 *
	 * All of them or none: a slot that would leave part of a selection behind is
	 * a slot the drag does not offer, rather than one that quietly moves what it
	 * can. Asked through `canDrop`, so one card -- and a note-content block,
	 * which reads a slot differently -- is decided by exactly the code that
	 * decided it before there was a group to carry.
	 */
	canDropMany(ids: readonly string[], targetId: string, mode: DropMode): boolean {
		return ids.length > 0 && ids.every((id) => this.canDrop(id, targetId, mode));
	}

	/**
	 * Move everything a drag was carrying, as the one edit it is.
	 *
	 * One card takes `move`: the path every drag took before a selection could
	 * be carried, and the only one a note-content block can take. Two or more go
	 * through `moveNodes*`, which writes them as a single run -- which is what
	 * makes the whole thing one undo step, and what puts them back in the order
	 * the note had them in.
	 */
	moveMany(ids: readonly string[], targetId: string, mode: DropMode): void {
		const parsed = this.parsed;
		const target = parsed?.byId.get(targetId);
		if (!parsed || !target || ids.length === 0) return;
		if (ids.length === 1) {
			this.move(ids[0], targetId, mode);
			return;
		}

		// Fewer than two survivors means a carried card left the map since the
		// slot was offered, and the slot was offered for all of them.
		const nodes = ids
			.map((id) => parsed.byId.get(id))
			.filter((node): node is MindNode => node !== undefined);
		if (nodes.length < 2) return;

		// The same unfold the single move does, so a run dropped into a closed
		// branch ends up where the user just put it.
		if (mode === "child") this.collapsedKeys.delete(target.key);
		else if (target.parent) this.collapsedKeys.delete(target.parent.key);

		// The drop keeps what it carried. The repaint the move causes re-lands
		// the mutation's focus on the run's new home, and that focus would
		// otherwise take the selection with it -- one card picked where the
		// user was moving a group. Keys are text-derived, so the carried cards'
		// keys survive the re-parse, and the rings go back on whole.
		const keys = nodes.map((node) => node.key);

		this.apply(
			mode === "child"
				? moveNodesInto(parsed, nodes, target)
				: mode === "before"
					? moveNodesBefore(parsed, nodes, target)
					: moveNodesAfter(parsed, nodes, target),
		);

		if (keys.length > 1) {
			this.selectionKey = keys[0];
			this.extraKeys = new Set(keys.slice(1));
			this.applySelection();
		}
	}

	/**
	 * Whether a plain drag on blank canvas moves the map.
	 *
	 * The one answer both the camera (`canPan`, above) and the band are given,
	 * so a press cannot be claimed by both of them or by neither.
	 */
	dragToPan(): boolean {
		return this.plugin.settings.dragToPan;
	}

	/** How the map draws its connectors now, so a drag's guide can match them. */
	edgeStyle(): EdgeStyle {		return this.plugin.settings.edgeStyle;
	}

	dropParent(targetId: string, mode: DropMode): string | null {
		const target = this.parsed?.byId.get(targetId);
		if (target) {
			// Beside the target means among its siblings, so the parent is the one
			// they share; inside it means the target itself.
			const parent = mode === "child" ? target : target.parent;
			return parent?.id ?? null;
		}
		// A note-content card is not a node. What it sits with is the body of the
		// card that owns it, so that owner is what a block dropped beside it
		// would join -- and the connector a guide draws should say so.
		const ref = this.bodyNodes.get(targetId);
		const owner = ref ? this.parsed?.byKey.get(ref.ownerKey) : null;
		return owner?.id ?? null;
	}

	bodyOwner(id: string): string | null {
		// A body card's id is its owner's with the body mark and an index on the
		// end, so the owner is everything ahead of the mark.
		const mark = id.indexOf(BODY_ID_MARK);
		return mark <= 0 ? null : id.slice(0, mark);
	}

	/**
	 * Enlarge a picture or a video over the map.
	 *
	 * The path comes off the wrapper rather than out of the link. A link is
	 * resolved against a note, and what the preview needs is the file the note
	 * already resolved it to -- `media.ts` wrote both onto the wrapper for
	 * exactly this split: one for the click, one for whoever comes along
	 * without a note.
	 *
	 * False when there is nothing to show, so the caller can put the click back
	 * on the path it would have taken. The file may have left the vault since
	 * the card was drawn, and a chip is still a link.
	 */
	previewMedia(el: HTMLElement): boolean {
		const path = el.dataset.mediaPath;
		if (!path) return false;
		const alt = el.querySelector("img")?.getAttribute("alt");
		const label = el.getAttribute("aria-label") ?? alt ?? path;
		this.lightbox.open(path, label, this.canvas.viewport);
		return this.lightbox.isOpen;
	}

	/**
	 * Follow a link written in a note-content card.
	 *
	 * Anything with a scheme is handed to the platform, but only from a short
	 * list: the target came out of a note, and `javascript:` must never reach a
	 * window. Everything else is a vault link -- a note, a heading, a PDF -- and
	 * goes through the workspace so it opens the way Obsidian opens it anywhere
	 * else.
	 */
	openLink(href: string, ev: MouseEvent): void {
		const newLeaf = Keymap.isModEvent(ev);
		if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
			if (/^(https?|obsidian|mailto):/i.test(href)) window.open(href, "_blank");
			return;
		}
		// `[a](My%20File.pdf)` is the same file as `[[My File.pdf]]`; only the
		// wikilink spelling arrives ready to resolve.
		let path = href;
		try {
			path = decodeURIComponent(href);
		} catch {
			// A stray `%` is not an escape. Take the target as written.
		}
		void this.app.workspace.openLinkText(path, this.file?.path ?? "", newLeaf);
	}

	showMenu(id: string, ev: MouseEvent): void {
		const menu = new Menu();

		// A content card stands for lines the note owns: it can be read and
		// edited in place, but never renamed, moved or given children.
		if (this.bodyNodes.has(id)) {
			menu.addItem((item) =>
				item
					.setTitle(t("view.menu.editBlock"))
					.setIcon("pencil")
					.onClick(() => this.beginEdit(id)),
			);
			menu.showAtMouseEvent(ev);
			return;
		}

		const node = this.parsed?.byId.get(id);
		if (!node) return;
		this.select(id);

		menu.addItem((item) =>
			item
				.setTitle(t("view.menu.addChild"))
				.setIcon("corner-down-right")
				.onClick(() => this.addChildTo(id)),
		);
		if (!node.virtual && this.plugin.settings.inlineAnnotations) {
			menu.addItem((item) => item
				.setTitle(t(node.annotationIndices.length ? "view.menu.editAnnotation" : "view.menu.addAnnotation"))
				.setIcon("sticky-note")
				.onClick(() => this.editAnnotation(id)));
		}
		// Checking a task never takes its checkbox away -- so removing one lives
		// here, where adding one does too.
		if (node.kind === "listitem") {
			menu.addItem((item) =>
				item
					.setTitle(t(node.checkbox === null ? "view.menu.addCheckbox" : "view.menu.removeCheckbox"))
					.setIcon(node.checkbox === null ? "square-check" : "square")
					.onClick(() => {
						if (node.checkbox === null) this.toggleCheck(id);
						else this.removeCheck(id);
					}),
			);
		}
		if (node.parent) {
			menu.addItem((item) =>
				item
					.setTitle(t("view.menu.addSiblingBelow"))
					.setIcon("plus")
					.onClick(() => this.addSiblingTo(id)),
			);
			menu.addItem((item) =>
				item
					.setTitle(t("view.menu.addSiblingAbove"))
					.setIcon("plus")
					.onClick(() => this.addSiblingBeforeTo(id)),
			);
		}

		if (this.childCount(node, this.plugin.settings.showBodyNodes) > 0) {
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle(t(this.collapsedKeys.has(node.key) ? "view.menu.unfold" : "view.menu.fold"))
					.setIcon("chevrons-down-up")
					.onClick(() => this.toggleFold(id)),
			);
		}

		if (canRename(node) || node.parent) {
			menu.addSeparator();
			if (canRename(node)) {
				menu.addItem((item) =>
					item
						.setTitle(t("view.menu.rename"))
						.setIcon("text-cursor-input")
						.onClick(() => this.beginEdit(id)),
				);
			}
			if (node.parent) {
				menu.addItem((item) =>
					item
						.setTitle(t("view.menu.delete"))
						.setIcon("trash-2")
						.onClick(() => this.removeNode(id)),
				);
			}
		}

		// Links. A node that is already a link gets the two entries that act on
		// one; a node that is not gets the two that make one. Never both, so
		// the menu never offers to link something that is already linked -- and
		// never offers to name a new note after a link, which would name it
		// after the note it already points at.
		const linked = soleLink(node.text);
		if (linked !== null) {
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle(t("view.menu.openLink"))
					.setIcon("external-link")
					.onClick(() => this.openLinkedNote(id)),
			);
			menu.addItem((item) =>
				item
					.setTitle(t("view.menu.unlink"))
					.setIcon("unlink")
					.onClick(() => this.unlinkNode(id)),
			);
		} else if (canRename(node)) {
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle(t("view.menu.linkToNote"))
					.setIcon("link")
					.onClick(() => this.linkNodeToNote(id)),
			);
			if (noteNameFrom(node.text) !== "") {
				menu.addItem((item) =>
					item
						.setTitle(t("view.menu.createNote"))
						.setIcon("file-plus")
						.onClick(() => this.createNoteFromNode(id)),
				);
			}
		}

		menu.showAtMouseEvent(ev);
	}

	navigate(direction: Direction): void {
		if (this.layoutNodes.length === 0) return;
		const currentId = this.selectedId();
		const current = currentId ? this.layoutFor(currentId) : null;
		if (!current) {
			this.select(this.parsed?.root.id ?? null);
			this.revealSelection();
			return;
		}

		// Card centres, not node centres: an annotation hangs below the card
		// without being part of it, and a step between cards should go where the
		// cards look, not where the strips end.
		const cx = current.x + current.cardWidth / 2;
		const cy = current.y + current.cardHeight / 2;
		let best: LayoutNode | null = null;
		let bestScore = Infinity;

		for (const candidate of this.layoutNodes) {
			if (candidate === current) continue;
			// Body cards cannot hold the selection, so stepping onto one would
			// leave the arrow keys apparently stuck.
			if (this.bodyNodes.has(candidate.node.id)) continue;
			const dx = candidate.x + candidate.cardWidth / 2 - cx;
			const dy = candidate.y + candidate.cardHeight / 2 - cy;

			let along: number;
			let across: number;
			if (direction === "right") {
				if (dx <= 1) continue;
				along = dx;
				across = Math.abs(dy);
			} else if (direction === "left") {
				if (dx >= -1) continue;
				along = -dx;
				across = Math.abs(dy);
			} else if (direction === "down") {
				if (dy <= 1) continue;
				along = dy;
				across = Math.abs(dx);
			} else {
				if (dy >= -1) continue;
				along = -dy;
				across = Math.abs(dx);
			}

			// Favour candidates that stay near the current axis.
			const score = along + across * 2;
			if (score < bestScore) {
				bestScore = score;
				best = candidate;
			}
		}

		if (best) {
			this.select(best.node.id);
			this.revealSelection();
		}
	}

	/**
	 * Say there was nothing to undo -- coalesced by ToastStack so a held key
	 * does not fill the corner with copies of the same sentence.
	 */
	private announceNothingToUndo(): void {
		this.notices.show(t("view.notice.nothingToUndo"));
	}

	undo(): void {
		// An editor left open by an add has to close before the stack moves: the
		// repaint takes the element it lives in, and a blur that never fires
		// leaves `editingId` set and the map deaf to every key after it.
		this.discardIdleEdit();
		const previous = this.undoStack.pop();
		if (previous === undefined) {
			this.announceNothingToUndo();
			return;
		}
		this.redoStack.push(this.data);
		this.commit(previous, -1, false);
	}

	redo(): void {
		this.discardIdleEdit();
		const next = this.redoStack.pop();
		if (next === undefined) return;
		this.undoStack.push(this.data);
		this.commit(next, -1, false);
	}

	fit(): void {
		const width = parseFloat(this.canvas.content.style.width) || 0;
		const height = parseFloat(this.canvas.content.style.height) || 0;
		this.canvas.fit(width, height);
	}

	centreOnSelection(): void {
		const id = this.selectedId();
		const layout = id ? this.layoutFor(id) : null;
		if (!layout) {
			this.fit();
			return;
		}
		this.canvas.centreOn(layout.x + layout.width / 2, layout.y + layout.height / 2);
	}

	private revealSelection(): void {
		const id = this.selectedId();
		const layout = id ? this.layoutFor(id) : null;
		if (!layout) return;
		this.canvas.reveal(layout.x, layout.y, layout.width, layout.height);
	}

	// --- search ---------------------------------------------------------------

	/** Put the find bar up, or hand it the focus when it is already there. */
	openSearch(): void {
		this.showSearch(false);
	}

	/** The same bar, opened with the replace row showing. */
	openReplace(): void {
		this.showSearch(true);
	}

	private showSearch(replacing: boolean): void {
		if (this.search) {
			// Already up: the row is what the second way in is asking for.
			if (replacing) this.search.openReplace();
			else this.search.focus();
			return;
		}
		this.search = new SearchBar(this.contentEl, {
			query: this.searchQuery,
			replacement: this.searchReplacement,
			onQuery: (query) => this.onQueryChanged(query),
			onStep: (delta) => this.stepMatch(delta),
			onReplace: (scope, replacement) => this.replaceMatches(scope, replacement),
			onClose: () => {
				this.closeSearch();
			},
		});
		// A remembered query is run again rather than replayed: the note may well
		// have changed since the bar was last closed.
		this.refreshSearch();
		this.applySearchState();
		if (replacing) this.search.openReplace();
		else this.search.focus();
	}

	/**
	 * Write a replacement into the note, and say how much of it changed.
	 *
	 * One edit for the whole operation, however many cards it touched, so it
	 * comes back as one undo step. `"current"` narrows it to the card the bar's
	 * cursor is on -- the unit here is a node rather than an occurrence, because
	 * a node is what the bar counts and what the user is looking at.
	 */
	private replaceMatches(scope: ReplaceScope, replacement: string): void {
		const parsed = this.parsed;
		if (!parsed) return;
		this.searchReplacement = replacement;
		const result = replaceInTree(
			parsed,
			{ text: this.searchQuery.text, regex: this.searchQuery.regex, replacement },
			scope === "current" ? this.currentMatchNode() : null,
		);
		if (!result.ok) {
			new Notice(t("search.replaced", { count: 0 }));
			return;
		}
		this.apply(result);
		new Notice(t("search.replaced", { count: result.count }));
	}

	/** True when a bar was actually up, which is what makes Escape ours. */
	closeSearch(): boolean {
		if (!this.search) return false;
		const refolded = this.restoreSearchFolds();
		this.resetSearch();
		if (refolded) {
			this.markGlobalAnchor();
			this.paint("search");
		} else {
			this.applySearchState();
		}
		this.canvas.viewport.focus({ preventScroll: true });
		return true;
	}

	/** Take the bar down and drop the match list. Folds are left as they are. */
	private resetSearch(): void {
		this.search?.destroy();
		this.search = null;
		this.matchKeys = [];
		this.matchIndex = 0;
		this.pendingReveal = null;
		// The bookkeeping only means something while a session runs; whoever
		// wanted those branches folded again has already asked for it.
		this.searchRevealed.clear();
	}

	private currentMatchKey(): string | null {
		return this.matchKeys[this.matchIndex] ?? null;
	}

	/** The node the current match names, or null once the note has lost it. */
	private currentMatchNode(): MindNode | null {
		const key = this.currentMatchKey();
		if (key === null) return null;
		return this.parsed?.byKey.get(key) ?? null;
	}

	/**
	 * Recompute the match list against the current parse, keeping the current
	 * match when it survived.
	 *
	 * Never touches the camera: this runs on every render, including the one
	 * behind every keystroke of an inline edit.
	 */
	private refreshSearch(): void {
		if (!this.search) return;
		const current = this.currentMatchKey();
		const result = this.parsed
			? searchTree(this.parsed.root, this.searchQuery)
			: { matches: [], invalid: false };
		this.matchKeys = result.matches.map((match) => match.key);
		const index = current === null ? -1 : this.matchKeys.indexOf(current);
		this.matchIndex = index < 0 ? 0 : index;
		this.search.setStatus(
			this.matchKeys.length === 0 ? 0 : this.matchIndex + 1,
			this.matchKeys.length,
			result.invalid,
		);
	}

	private onQueryChanged(query: SearchQuery): void {
		this.searchQuery = query;
		const before = this.currentMatchKey();
		this.refreshSearch();
		const after = this.currentMatchKey();
		// Only a change of match moves the map. Typing on past a hit that still
		// matches leaves the camera where it is, rather than pulling it back to
		// the same card once per keystroke.
		if (after !== null && after !== before) this.jumpToCurrent();
		else this.applySearchState();
	}

	private stepMatch(delta: number): void {
		const total = this.matchKeys.length;
		if (total === 0) return;
		this.matchIndex = (this.matchIndex + delta + total) % total;
		this.search?.setStatus(this.matchIndex + 1, total, false);
		this.jumpToCurrent();
	}

	/**
	 * Bring the current match on screen: fold back what the search opened for the
	 * match before it, then open whatever is hiding this one.
	 *
	 * A branch is only owed its open state while the match inside it is the one
	 * being looked at, so a step across the map puts the last one away again --
	 * both changes in a single paint, or the map would shuffle twice per step.
	 */
	private jumpToCurrent(): void {
		const key = this.currentMatchKey();
		const node = key === null ? undefined : this.parsed?.byKey.get(key);
		if (key === null || !node) return;

		// Read before anything folds: whatever the user is looking at now is what
		// has to hold still while branches open and close under it.
		const held = this.selectedNode();

		// The selection moves first, so the fold that follows is deciding about a
		// branch the selection has already left.
		this.select(node.id);
		const refolded = this.refoldSearch(node);
		const revealed = this.revealForSearch(node);
		if (!refolded && !revealed) {
			this.applySearchState();
			this.revealSelection();
			return;
		}

		// A card the refold just hid cannot hold anything still; the root can.
		this.markAnchor(held && this.isVisible(held) ? held.key : this.parsed?.root.key);
		// The card may not exist yet; the paint that builds it does the pan.
		this.pendingReveal = key;
		this.paint("search");
	}

	/**
	 * Open only the ancestors actually in the way, and remember which.
	 *
	 * Not `revealAncestors`: that clears the whole chain, and a key deleted from
	 * a set that never held it would still be recorded as a fold the search
	 * opened -- and dutifully closed again on the way out.
	 */
	private revealForSearch(node: MindNode): boolean {
		let opened = false;
		for (const key of hiddenAncestorKeys(node, this.collapsedKeys)) {
			this.collapsedKeys.delete(key);
			this.searchRevealed.add(key);
			opened = true;
		}
		return opened;
	}

	/**
	 * Fold back the recorded branches that are not holding `keep` on the map, and
	 * drop every key it decided about from the record.
	 *
	 * A key the note no longer has, and one the user has since folded themselves,
	 * are both simply dropped. Reports whether the map actually changed shape.
	 */
	private refoldSearch(keep: MindNode | null): boolean {
		if (this.searchRevealed.size === 0) return false;
		const showBody = this.plugin.settings.showBodyNodes;
		let changed = false;
		for (const key of refoldKeys(this.searchRevealed, keep)) {
			this.searchRevealed.delete(key);
			const node = this.parsed?.byKey.get(key);
			if (!node || this.childCount(node, showBody) === 0) continue;
			if (this.collapsedKeys.has(key)) continue;
			this.collapsedKeys.add(key);
			changed = true;
		}
		return changed;
	}

	/**
	 * Wind the session up: fold back what it opened, except the path to the match
	 * it ended on. Reports whether anything moved.
	 *
	 * The one branch a search may leave behind is the one holding what it found --
	 * closing the bar is not a reason to hide the card that answered the query,
	 * and putting it away is a fold the user can ask for themselves. When the
	 * match has been edited away there is nothing to keep, and the whole record
	 * goes back.
	 */
	private restoreSearchFolds(): boolean {
		if (this.searchRevealed.size === 0) return false;
		const changed = this.refoldSearch(this.currentMatchNode());
		// Whatever survived is the kept path, and the session is over: those
		// branches belong to the map now rather than to the search.
		this.searchRevealed.clear();
		if (!changed) return false;

		// The selection may have just been folded away -- it sits wherever the user
		// last clicked, which is not necessarily the match. The fold wins -- the
		// same rule `seedFolds` follows -- and the card that swallowed it takes
		// over, so the keyboard is never left aimed at something off the map.
		const selected = this.selectedNode();
		const hidden = selected ? hiddenAncestorKeys(selected, this.collapsedKeys) : [];
		if (hidden.length > 0) this.setAnchor(hidden[0]);
		return true;
	}

	/**
	 * Redraw the rings from the current match list.
	 *
	 * Stripped and rebuilt through `byKey` every time: a paint hands out new
	 * elements, and a match inside a folded branch has no card to mark at all.
	 */
	private applySearchState(): void {
		for (const element of this.elements.values()) {
			element.el.removeClasses(["is-search-match", "is-search-current"]);
		}
		if (!this.search || !this.parsed) return;
		const current = this.currentMatchKey();
		for (const key of this.matchKeys) {
			const node = this.parsed.byKey.get(key);
			const element = node ? this.elements.get(node.id) : undefined;
			element?.el.addClass(key === current ? "is-search-current" : "is-search-match");
		}
	}

	// --- popovers -------------------------------------------------------------

	private openPopover(): HTMLElement {
		this.closePopover();
		const panel = this.contentEl.createDiv({ cls: "mm-popover" });
		this.popover = panel;

		const onOutside = (ev: MouseEvent): void => {
			// A real target always is one; the check is for the synthetic events
			// that carry `window` or `document`, which `contains` would reject
			// anyway -- this just says so without a cast.
			if (!(ev.target instanceof Node) || !panel.contains(ev.target)) this.closePopover();
		};
		const onKey = (ev: KeyboardEvent): void => {
			if (ev.key === "Escape") this.closePopover();
		};
		// Deferred so the click that opened the panel does not close it -- but
		// the timer is kept, because the panel can be closed inside the same
		// tick: a listener added after cleanup ran would never be removed, and
		// the next stray click would reach a panel that no longer exists.
		const timer = window.setTimeout(() => {
			document.addEventListener("mousedown", onOutside);
		}, 0);
		document.addEventListener("keydown", onKey);
		this.popoverCleanup = () => {
			window.clearTimeout(timer);
			document.removeEventListener("mousedown", onOutside);
			document.removeEventListener("keydown", onKey);
		};
		return panel;
	}

	private popoverCleanup: (() => void) | null = null;

	private closePopover(): void {
		this.popoverCleanup?.();
		this.popoverCleanup = null;
		this.popover?.remove();
		this.popover = null;
	}

	// --- editing in place -----------------------------------------------------

	/** Open the block for in-place editing, the same as double-clicking it. */
	expandBody(id: string): void {
		this.beginEdit(id);
	}

	/**
	 * Edit the annotation in place on the card, no dialog. The annotation
	 * strip (`.mm-annotation`) becomes a contentEditable field; `Enter`
	 * writes a line, `Ctrl`/`Cmd`+Enter saves with `setAnnotation`, Escape
	 * cancels. If the node has no annotation yet, a temporary strip is
	 * created on the fly so there is something to type into — saving writes
	 * it into the note, cancelling removes it.
	 */
	editAnnotation(id: string): void {
		const parsed = this.parsed;
		const node = parsed?.byId.get(id);
		if (!parsed || !node || node.virtual || !this.plugin.settings.inlineAnnotations) return;

		const element = this.elements.get(id);
		if (!element) return;

		const original = annotationText(parsed, node);
		const key = node.key;

		// Find the existing annotation strip, or create a temporary one so
		// there is something to focus. The strip is the last child of `.mm-row`,
		// inside the box the card is drawn with; `buildNodeElement` only draws
		// it when the node already has an annotation, so one that does not has
		// to be synthesised here -- and into the same row, or it would land
		// outside the card.
		let annotationEl = element.el.querySelector<HTMLElement>(".mm-annotation");
		if (!annotationEl) {
			annotationEl = element.row.createDiv({ cls: "mm-text mm-annotation" });
			element.el.addClass("has-annotation");
		}

		this.editingId = id;
		this.select(id);
		this.markEditing();
		this.discardIdleEdit();

		this.editTextEl = annotationEl;
		this.editStartText = original;

		this.endEdit = openInlineEditor(
			{
				field: annotationEl,
				text: original,
				// An annotation is prose too -- it may hold several lines, and a
				// blank one is kept. Enter writes one; `Ctrl`/`Cmd`+Enter saves,
				// which is what this field's own hint has always said.
				shape: { multiline: true, code: false, search: false },
				commit: (value, save) => {
					this.endEditing(id);
					this.editTextEl = null;
					this.editStartText = null;
					this.endEdit = null;
					if (save) {
						const snapshot = parseMarkdown(this.data, this.parseOptions());
						const current = snapshot.byKey.get(key);
						if (
							current &&
							this.plugin.settings.inlineAnnotations &&
							annotationText(snapshot, current) === original
						) {
							this.applyEdit(setAnnotation(snapshot, current, value), value.trim() === "");
						} else {
							new Notice(t("view.notice.annotationChanged"));
							this.render("edit");
						}
					} else {
						// Cancel: if the strip was temporary and nothing was
						// saved, repaint to take it back off the card.
						this.render("edit");
					}
				},
			},
			this.editorHost(),
		);
	}

	// --- linking a node to another note --------------------------------------

	/**
	 * The three predicates behind the three commands.
	 *
	 * Asked by the palette as well as by the context menu, which is why they
	 * take an id rather than reading the selection: the menu has a card in hand
	 * that the selection may not have caught up with yet.
	 */
	canLink(id: string): boolean {
		const node = this.parsed?.byId.get(id);
		return node !== undefined && canRename(node);
	}

	canCreateNote(id: string): boolean {
		const node = this.parsed?.byId.get(id);
		return node !== undefined && canRename(node) && noteNameFrom(node.text) !== "";
	}

	canUnlink(id: string): boolean {
		const node = this.parsed?.byId.get(id);
		return node !== undefined && soleLink(node.text) !== null;
	}

	/**
	 * Point this node at a note that already exists.
	 *
	 * The node keeps its words: the link is written as `[[Note|what it said]]`,
	 * so the card reads exactly as it did and the link is the only thing that
	 * is new. A node that is already nothing but a link has no words of its own
	 * to keep, so re-pointing one is a plain rewrite.
	 */
	linkNodeToNote(id: string): void {
		const node = this.parsed?.byId.get(id);
		if (!node || !canRename(node)) {
			new Notice(t("view.notice.cannotLink"));
			return;
		}
		const sourcePath = this.file?.path ?? "";
		new NotePickerModal(this.app, (file) => {
			const label = soleLink(node.text) === null ? node.text.trim() : null;
			this.rewriteNode(id, linkMarkup(linkTextFor(this.app, file, sourcePath), label));
		}).open();
	}

	/**
	 * Grow a note out of this node, and point the node at it.
	 *
	 * The new note lands beside the one being mapped, and the node keeps its
	 * words as the link's label -- so the map looks unchanged and the card is a
	 * door. The note is created empty: the label already says what the node
	 * says, and a heading would say it a second time.
	 */
	createNoteFromNode(id: string): void {
		const node = this.parsed?.byId.get(id);
		const name = node ? noteNameFrom(node.text) : "";
		if (!node || !canRename(node) || name === "") {
			new Notice(t("view.notice.cannotLink"));
			return;
		}
		const sourcePath = this.file?.path ?? "";
		void createNoteBeside(this.app, sourcePath, name).then((file) => {
			if (!file) {
				new Notice(t("view.notice.noteCreateFailed"));
				return;
			}
			new Notice(t("view.notice.noteCreated", { name: file.basename }));
			const target = linkTextFor(this.app, file, sourcePath);
			this.rewriteNode(id, linkMarkup(target, node.text.trim()));
		});
	}

	/** Take the link off, leaving the words a reader was already seeing. */
	unlinkNode(id: string): void {
		const node = this.parsed?.byId.get(id);
		if (!node) return;
		const parts = soleLink(node.text);
		if (parts === null) return;
		this.rewriteNode(id, unlinkedText(parts));
	}

	/**
	 * The note this card points at, or null when it points at nothing.
	 *
	 * Only a node whose whole text is one link counts. A sentence that mentions
	 * a note has no single target, and opening an arbitrary one of them would
	 * be the map guessing.
	 */
	linkedTarget(id: string): string | null {
		const node = this.parsed?.byId.get(id);
		if (!node) return null;
		const parts = soleLink(node.text);
		return parts === null ? null : parts.target;
	}

	openLinkedNote(id: string): void {
		const target = this.linkedTarget(id);
		if (target === null) return;
		void this.app.workspace.openLinkText(target, this.file?.path ?? "", false);
	}

	/**
	 * Replace a node's text, through the same gate every other edit uses.
	 *
	 * `applyEdit` rather than `apply`, because a rewrite that ends on nothing
	 * has to leave the card's placeholder behind -- which is the case
	 * `applyEdit` was written for.
	 */
	private rewriteNode(id: string, text: string): void {
		this.withNode(id, (parsed, node) => {
			this.applyEdit(renameNode(parsed, node, text), text.trim() === "");
		});
	}

	// --- export ---------------------------------------------------------------

	/**
	 * Write the map out beside the note.
	 *
	 * What is exported is what is shown: the fold state as it stands, the
	 * layout mode in force, the branch colours if they are on, and the colours
	 * of the theme that is running. Nothing is re-derived from the note.
	 */
	exportAs(format: ExportFormat): void {
		void runExport(this.app, this.file, format, {
			canvasFile: () => this.buildCanvasFile(),
			snapshot: () => this.buildSnapshot(),
		});
	}

	/** True once there is a measured map on screen to export. */
	private hasMap(): boolean {
		return this.layoutNodes.length > 0 && this.mapWidth > 0 && !this.paintedEmpty;
	}

	/**
	 * The ten branch colours, resolved through the theme.
	 *
	 * `--mm-b0`…`--mm-b9` are declared on the map's own container, so a theme or
	 * a snippet that overrides one is what the export picks up. Null when branch
	 * colours are switched off, which is what leaves every card its default.
	 */
	private branchPalette(): string[] | null {
		if (!this.plugin.settings.branchColors) return null;
		const style = getComputedStyle(this.contentEl);
		const colors: string[] = [];
		for (let i = 0; i < 10; i++) colors.push(style.getPropertyValue(`--mm-b${i}`).trim());
		return colors;
	}

	private buildCanvasFile(): string | null {
		if (!this.hasMap()) return null;
		const parsed = this.parsed;
		const palette = this.branchPalette();
		return serializeCanvas(
			buildCanvas(
				{ nodes: this.layoutNodes },
				{
					title: this.file?.basename ?? t("export.untitled"),
					branchColor: (branch) =>
						palette === null || branch < 0 ? null : palette[branch % palette.length],
					nextId: randomId,
					// A body card shows a preview; the file it goes into holds the
					// block whole. An annotation has no card of its own on the map
					// -- and gets none in the file either: its text goes into the
					// card it hangs under, which is where it is read, and the box
					// that card is exported at already includes the strip.
					fullText: (item) => {
						if (!parsed) return null;
						if (item.node.kind === "body") {
							return bodyRangeText(parsed, [item.node.lineStart, item.node.blockEnd]);
						}
						if (item.node.annotationIndices.length === 0) return null;
						return `${item.node.text}\n\n${annotationText(parsed, item.node)}`;
					},
				},
			),
		);
	}

	/**
	 * The map, read out of the live document.
	 *
	 * Three things have to be whole before it is read, and all three are undone
	 * by the cull that follows: a culled card is out of the document and has
	 * neither size nor style, the connector layer holds only the region the
	 * camera is over, and a picture the cull was holding down has never been
	 * fetched at all.
	 */
	private async buildSnapshot(): Promise<Snapshot | null> {
		if (!this.hasMap()) return null;
		// Inside the try, not in front of it: whatever these throw, the cull in
		// the `finally` is what puts the map back the way the camera left it.
		try {
			this.showAllCards();
			// Every card is in the document now, so every picture in the note
			// can start loading -- including the ones no paint has ever shown.
			// A file is not a frame that the next pan corrects: a picture
			// missing from it is missing for good.
			activateMedia(this.canvas.content);
			await whenMediaReady(this.canvas.content);
			// A card that has only ever been off screen is on the map at the size
			// some earlier paint measured for it. The file is not a frame that the
			// next pan corrects, so it is measured properly first.
			if (this.measureUnmeasured().changed > 0 && this.paintRoot) {
				this.layOut(this.paintRoot, "export");
			}
			this.drawEdges(null);
			// The map is whole; the pictures in it are not, because an exported
			// document fetches nothing. This is what puts their bytes in, and
			// the undo goes back on before anything else can look at the map.
			const restore = await inlineExportMedia(this.app, this.canvas.content);
			try {
				return snapshotMap({
					content: this.canvas.content,
					width: this.mapWidth,
					height: this.mapHeight,
					background: this.mapBackground(),
				});
			} finally {
				restore();
			}
		} finally {
			this.cullToView(true);
		}
	}

	private mapBackground(): string {
		const color = getComputedStyle(this.canvas.viewport).backgroundColor;
		return color === "" || color === "transparent" || color === "rgba(0, 0, 0, 0)"
			? "#ffffff"
			: color;
	}

	// --- file lifecycle -------------------------------------------------------

	override async onLoadFile(file: TFile): Promise<void> {
		this.needsFit = true;
		await super.onLoadFile(file);
	}
}
