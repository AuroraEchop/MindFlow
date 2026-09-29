/**
 * A note-content card's blocks, drawn.
 *
 * The map draws a body card from `node.text`, one run of characters, which is
 * enough for a paragraph and wrong for a table: the `|` that a reader sees as a
 * column edge is just a character, and a table read as characters is a table
 * nobody can read. Everything here exists to give those characters a shape.
 *
 * It is not a markdown renderer and does not try to be. `MarkdownRenderer` is
 * asynchronous and appends whatever it likes wherever it likes, and a card is
 * measured the instant it is built -- a block that arrived later would leave
 * the whole map laid out around a box that no longer exists. So the blocks come
 * from `model/blocks.ts`, the markup is emitted here, and every value goes in
 * as text through the same inline renderer a title uses.
 */

import { setIcon } from "obsidian";
import { calloutTitle, calloutTypeOf, t } from "../i18n.ts";
import type { CalloutType, I18nKey } from "../i18n.ts";
import type {
	Block,
	BlockAlign,
	CalloutBlock,
	CodeBlock,
	ListBlock,
	QuoteBlock,
	TableBlock,
} from "../model/blocks.ts";
import { renderInlineOrNothing } from "./inline.ts";
import type { InlineRender } from "./inline.ts";
import type { MediaContext } from "./media.ts";

/** Nothing drawn: the starting point for the flags a block reports back. */
const NOTHING: InlineRender = { math: false, media: false };

function either(a: InlineRender, b: InlineRender): InlineRender {
	return { math: a.math || b.math, media: a.media || b.media };
}

/** Where a column's text sits, or nothing at all when the note did not say. */
function alignCell(cell: HTMLElement, align: BlockAlign): void {
	if (align !== null) cell.style.textAlign = align;
}

function renderTable(host: HTMLElement, block: TableBlock, media: MediaContext | null): InlineRender {
	const table = host.createEl("table", { cls: "mm-table" });
	let drawn = NOTHING;

	// A header is not optional in the syntax -- the delimiter row is what makes
	// the thing a table at all -- so it is always drawn as one.
	const headRow = table.createEl("thead").createEl("tr");
	block.header.forEach((text, column) => {
		const th = headRow.createEl("th");
		alignCell(th, block.align[column] ?? null);
		drawn = either(drawn, renderInlineOrNothing(th, text, media));
	});

	if (block.rows.length > 0) {
		const body = table.createEl("tbody");
		for (const row of block.rows) {
			const tr = body.createEl("tr");
			row.forEach((text, column) => {
				const td = tr.createEl("td");
				alignCell(td, block.align[column] ?? null);
				drawn = either(drawn, renderInlineOrNothing(td, text, media));
			});
		}
	}
	return drawn;
}

/**
 * A fenced sample, drawn as the sample rather than as its source.
 *
 * The fence itself never reaches the card: it is the note's way of saying
 * "leave this alone", and on the card that is what a monospace face already
 * says. `setText`, not `renderInline` -- markup inside a sample is the point of
 * writing one.
 *
 * The corner carries the language the fence named and the button that takes the
 * sample away with the user. Both sit above the sample rather than in it, so
 * neither is something the code appears to contain -- and the corner is a
 * sibling of the `<code>`, not a child, which is what keeps a press on the
 * button out of the sample's own text.
 */
function renderCode(host: HTMLElement, block: CodeBlock): void {
	const pre = host.createEl("pre", { cls: "mm-code-block" });
	const code = pre.createEl("code", { text: block.text });
	if (block.lang !== "") code.addClass(`language-${block.lang}`);

	const corner = pre.createDiv({ cls: "mm-code-corner" });
	if (block.lang !== "") corner.createSpan({ cls: "mm-code-lang", text: block.lang });
	if (block.text !== "") copyButton(corner, block.text);
}

/**
 * The button that puts a sample on the clipboard.
 *
 * `navigator.clipboard` rather than Obsidian's own helper: this is the DOM's
 * own clipboard, the one the sample came from, and the write is the same one
 * the platform's copy command makes. A refused write leaves the button alone --
 * a permission the user declined is not an error worth a notice.
 */
function copyButton(parent: HTMLElement, text: string): void {
	const el = parent.createDiv({ cls: "mm-code-copy" });
	el.setAttribute("role", "button");
	el.setAttribute("tabindex", "0");
	label(el, "copy", "view.code.copy");

	const take = (): void => {
		const writing = navigator.clipboard?.writeText(text);
		// `=== undefined`, not `!writing`: what is being asked is whether the
		// API is there at all, and a promise is truthy either way -- a truthiness
		// test on one says what it does not mean.
		if (writing === undefined) return;
		void writing.then(
			() => {
				label(el, "check", "view.code.copied");
				el.addClass("is-done");
				window.setTimeout(() => {
					el.removeClass("is-done");
					label(el, "copy", "view.code.copy");
				}, COPIED_FOR);
			},
			() => undefined,
		);
	};

	el.addEventListener("click", (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		take();
	});
	// `role="button"` promises the keyboard works, and this one is inside a
	// card the keyboard is otherwise navigating.
	el.addEventListener("keydown", (ev) => {
		if (ev.key !== "Enter" && ev.key !== " ") return;
		ev.preventDefault();
		ev.stopPropagation();
		take();
	});
}

/** How long the button says it worked. */
const COPIED_FOR = 1200;

/** Say what the button is, in both the places that say it. */
function label(el: HTMLElement, icon: string, key: I18nKey): void {
	const text = t(key);
	el.empty();
	setIcon(el, icon);
	// `setIcon` is silent when the id is not in the bundled set, which would
	// leave an invisible but clickable square on the sample.
	if (!el.firstElementChild) el.setText(text);
	el.setAttribute("aria-label", text);
}

/**
 * The glyph Obsidian gives each built-in type.
 *
 * Lucide names, which is what `setIcon` resolves -- and the same ones
 * Obsidian's own callout stylesheet asks for, so the box on the card is the box
 * in the note. A type outside the list falls back to the pencil, which is what
 * Obsidian draws for one of the note's own.
 */
const CALLOUT_ICONS: Record<CalloutType, string> = {
	note: "pencil",
	abstract: "clipboard-list",
	info: "info",
	todo: "check-circle-2",
	tip: "flame",
	success: "check",
	question: "help-circle",
	warning: "alert-triangle",
	failure: "x",
	danger: "zap",
	bug: "bug",
	example: "list",
	quote: "quote",
};

/**
 * A `> [!type]` box, drawn as the box rather than as its scaffolding.
 *
 * The colour comes from a `data-callout` attribute rather than from a class
 * built out of the type: a note may name its callout anything, and a class name
 * assembled from that would be a class the stylesheet never heard of. The
 * attribute carries the *built-in* type the name resolves to, which is also
 * what decides the icon -- a custom type is drawn the way Obsidian draws one,
 * in the default colour, with the word the note wrote as its title.
 *
 * A `-` fold is honoured: the note asked for a closed box, and the card is the
 * same box. The content is still reachable -- the expand button on a content
 * card shows the block whole.
 */
function renderCallout(
	host: HTMLElement,
	block: CalloutBlock,
	media: MediaContext | null,
): InlineRender {
	const type = calloutTypeOf(block.type);
	const box = host.createDiv({ cls: "mm-callout" });
	box.dataset.callout = type ?? "note";

	const head = box.createDiv({ cls: "mm-callout-head" });
	const icon = head.createSpan({ cls: "mm-callout-icon" });
	setIcon(icon, type === null ? "pencil" : CALLOUT_ICONS[type]);
	// `setIcon` is silent when the id is not in the bundled set. An empty span
	// would still take a gap's worth of room in the row, so it goes.
	if (!icon.firstElementChild) icon.remove();

	const label = block.title !== "" ? block.title : type === null ? block.type : calloutTitle(type);
	const drawn = renderInlineOrNothing(
		head.createSpan({ cls: "mm-callout-title" }),
		label,
		media,
	);

	if (block.fold === "closed" || block.blocks.length === 0) return drawn;
	return either(drawn, renderBlocks(box.createDiv({ cls: "mm-callout-body" }), block.blocks, media));
}

/**
 * A quote, drawn as the quote the note wrote.
 *
 * A `<blockquote>`, which is the element that means it and the one whose bar
 * the stylesheet draws: `>` is the note's way of saying these are somebody
 * else's words, and a card that answered with the character would be answering
 * with the note's scaffolding. The content goes through `renderBlocks` like a
 * callout's, because what a quote holds is whatever the note put under the
 * marker -- a list, a table, a second quote one step in.
 */
function renderQuote(host: HTMLElement, block: QuoteBlock, media: MediaContext | null): InlineRender {
	const box = host.createEl("blockquote", { cls: "mm-quote" });
	return renderBlocks(box, block.blocks, media);
}

/**
 * A list, drawn as the list the note wrote.
 *
 * The markers are the whole of it. `1. a` read as characters is a column of
 * digits that happens to be right; `- a` read as characters is a dash that says
 * nothing, and a run of them says a dash column where the note said a list. So
 * the items go into the real thing and the browser draws the numbers and the
 * bullets, which is also what makes a nested level arrive indented without
 * anything here working out what an indent is worth.
 *
 * Nesting is a list inside the item above it, because that is what the depth
 * meant: the item was written under another item, and a list is what hangs
 * under an item. Depths only ever grow by one, but the loop does not assume it
 * -- a block whose items skip a level is drawn at the depth it has, hung under
 * the item that is there, rather than dropped.
 */
function renderList(host: HTMLElement, block: ListBlock, media: MediaContext | null): InlineRender {
	const list = host.createEl(block.ordered ? "ol" : "ul", { cls: "mm-list" });
	// `3.` starts a list at three, and the note's own numbering is the one
	// thing about a list a reader may be counting on.
	if (block.ordered && block.start !== 1) list.setAttribute("start", String(block.start));

	/** The list drawn at each depth so far, outermost first. */
	const lists: HTMLElement[] = [list];
	/** The item drawn last at each depth, which is where a deeper list hangs. */
	const items: HTMLElement[] = [];
	let drawn = NOTHING;

	for (const item of block.items) {
		const depth = Math.max(0, item.depth);
		while (lists.length > depth + 1) lists.pop();
		while (items.length > depth + 1) items.pop();
		while (lists.length < depth + 1) {
			const parent = items[items.length - 1] ?? list;
			lists.push(parent.createEl(block.ordered ? "ol" : "ul", { cls: "mm-list" }));
		}
		const li = lists[depth].createEl("li");
		items[depth] = li;
		drawn = either(drawn, renderInlineOrNothing(li, item.text, media));
	}
	return drawn;
}

/**
 * A thematic break, drawn as the rule it is.
 *
 * An `<hr>`, which is the element that means it and the one the stylesheet
 * draws as a hairline instead of three hyphens. It holds no text, so it draws
 * no inline content either -- nothing about it can be a formula or a picture.
 *
 * The one block that ends a paragraph without being asked to: a `---` under a
 * line is a heading in markdown and is left as the paragraph's own line, so by
 * the time a rule reaches here it is a rule the note asked for on its own line.
 */
function renderRule(host: HTMLElement): void {
	host.createEl("hr", { cls: "mm-rule" });
}

/** Returns what the blocks drew, so the view knows what to wait for: formulas
 *  for MathJax's stylesheet, pictures and videos for their own load. */
export function renderBlocks(
	host: HTMLElement,
	blocks: readonly Block[],
	media: MediaContext | null,
): InlineRender {
	let drawn = NOTHING;
	for (const block of blocks) {
		if (block.kind === "table") drawn = either(drawn, renderTable(host, block, media));
		else if (block.kind === "code") renderCode(host, block);
		else if (block.kind === "callout") drawn = either(drawn, renderCallout(host, block, media));
		else if (block.kind === "quote") drawn = either(drawn, renderQuote(host, block, media));
		else if (block.kind === "list") drawn = either(drawn, renderList(host, block, media));
		else if (block.kind === "rule") renderRule(host);
		else {
			drawn = either(
				drawn,
				renderInlineOrNothing(host.createDiv({ cls: "mm-para" }), block.text, media),
			);
		}
	}
	return drawn;
}
