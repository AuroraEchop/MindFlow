/**
 * A note-content block, as data.
 *
 * A card's block is read by `view/blocks.ts`, which is the only thing that
 * knows how to draw it, and by `MindmapView`, which asks whether there is a
 * table in it before it decides to draw it that way at all. Neither question
 * needs a DOM, so the rules live here -- free of every import, so `node --test`
 * can run this file as-is.
 *
 * Deliberately a fraction of CommonMark. What a body card holds is the part of
 * a note that is not a node: a paragraph, a code sample, and above all a table,
 * which is the one construct that cannot survive being drawn as one run of
 * text -- a `|` that should be a column edge is just a `|`. Everything else is
 * left to the reading-view dialog the card opens.
 */

/** Where a column's text sits, from the `:--` markers on the delimiter row. */
export type BlockAlign = "left" | "center" | "right" | null;

export interface TableBlock {
	kind: "table";
	/** One entry per column, in the order the delimiter row named them. */
	align: BlockAlign[];
	header: string[];
	/** Padded or clipped to `header.length`, so every row has every column. */
	rows: string[][];
}

export interface CodeBlock {
	kind: "code";
	/** The fence's info string, trimmed. "" when the fence named no language. */
	lang: string;
	/** The lines between the fences, with the fence's own indent removed. */
	text: string;
}

/** One run of prose. Its own newlines are kept: a card is not a reflowing page. */
export interface ParagraphBlock {
	kind: "paragraph";
	text: string;
}

/**
 * A blockquote that opens with `[!type]`: Obsidian's callout.
 *
 * The `>` is the note's way of saying "this is one box, not a paragraph", and
 * read as characters it says nothing at all -- which is why a callout is the
 * second construct, after the table, that a card cannot draw as a run of text.
 * The type is kept as written and lowercased; what it means is the renderer's
 * business, because the aliases (`tip` and `hint`, `danger` and `error`) are a
 * reading convention rather than a fact about the note.
 */
export interface CalloutBlock {
	kind: "callout";
	/** The type as written, lowercased: `note`, `warning`, or anything custom. */
	type: string;
	/** The title the note wrote, or "" when it wrote none. */
	title: string;
	/**
	 * `-` folds the callout shut and `+` pins it open; null when the note wrote
	 * neither, which is what an ordinary `> [!note]` has.
	 */
	fold: "open" | "closed" | null;
	/** The callout's own content, read exactly as a body range is. */
	blocks: Block[];
}

/**
 * A blockquote that carries no `[!type]`: a quote, and not a callout.
 *
 * The `>` is the note saying "this is somebody else's words", and read as
 * characters it is a character -- which is the same loss a callout suffers, if
 * a smaller one: the reader is shown a `>` where the note drew a bar. A quote
 * is a box whether or not the note named a type for it, and the difference
 * between the two is the heading a callout has and a quote does not.
 *
 * Its content is read exactly as a body range is, so a list inside a quote is a
 * list and a quote inside a quote is a second bar one step in.
 */
export interface QuoteBlock {
	kind: "quote";
	blocks: Block[];
}

/**
 * One item of a list, and how deep it sits.
 *
 * The marker is kept as written rather than as a number, because the card draws
 * the list the note wrote: `-` and `*` are the same bullet and `3)` is the third
 * item, and a model that decided here would have decided for every reader of a
 * block -- the map's own card and another note's preview alike.
 */
export interface ListItem {
	/** The marker alone, as written: `-`, `*`, `+`, `1.`, `3)`. */
	marker: string;
	/** Nesting, counted off the markers: 0 for the outermost items. */
	depth: number;
	/** What the item says, its continuation lines and all. */
	text: string;
}

/**
 * A run of list items, as the list it is.
 *
 * A list is the third construct that cannot be read as a run of text, and the
 * one that suffers least visibly for it: `1. a` drawn as characters is a
 * column of digits that happens to be right, and `- a` drawn as characters is a
 * dash that is nothing at all. What is lost either way is the shape -- that
 * these lines are a list, that three of them hang under the fourth, that they
 * are numbered because the note numbered them -- and this is the shape.
 */
export interface ListBlock {
	kind: "list";
	/** Whether the markers count: `1.` and `3)` do; `-`, `*` and `+` do not. */
	ordered: boolean;
	/** The number the note started the list at, so `3)` is drawn as 3. */
	start: number;
	items: ListItem[];
}

/**
 * A thematic break: the line a note writes when it wants a rule drawn.
 *
 * The block with the least to say and the most to lose by being read as text.
 * `---` read as characters is three hyphens sitting in the middle of a card --
 * and read as *emphasis* it is worse still, because `---` is not asking for the
 * words around it to be touched. What the note means is a rule, and a rule has
 * no text at all.
 */
export interface RuleBlock {
	kind: "rule";
}

export type Block =
	| TableBlock
	| CodeBlock
	| ParagraphBlock
	| CalloutBlock
	| QuoteBlock
	| ListBlock
	| RuleBlock;

const FENCE = /^([ \t]*)(`{3,}|~{3,})[ \t]*(.*)$/;
/** One cell of a delimiter row: dashes, optionally pinned to either edge. */
const DELIMITER_CELL = /^:?-+:?$/;
/**
 * A callout's opening line.
 *
 * Anchored to the `>` so a sentence that merely mentions the syntax stays
 * prose. The fold marker is only read where the title has not started yet, so
 * `> [!note]-` folds while `> [!note] - a title` keeps its dash.
 */
const CALLOUT = /^[ \t]*>[ \t]*\[!([^\]\s]+)\][ \t]*([+-])?[ \t]*(.*)$/;
/** One line still inside a blockquote, with its `>` and the space after it. */
const QUOTE_LINE = /^[ \t]*>[ \t]?(.*)$/;

/**
 * One item's own line: the indent, the marker, and the space after it.
 *
 * The space is required, which is what keeps `*emphasis*` and `1.5 kg` out of
 * this: neither is a list, and a marker rule loose enough to take them would
 * turn a line of arithmetic into an item. Item text may be empty -- `- ` on its
 * own is an item with nothing in it, which is how a note writes a blank bullet.
 */
const LIST_ITEM = /^([ \t]*)([*+-]|\d+[.)])[ \t]+(.*)$/;

/**
 * A thematic break: three or more of one of `-`, `_`, `*` and nothing else.
 *
 * Asked before the list rule, because `- - -` answers both and markdown reads
 * it as a rule -- an item it would be is one with `- -` in it, which is not a
 * thing a note writes. Spaces between the marks are allowed (`* * *` is the
 * same line), and the indent is capped at three because past that it is a code
 * sample.
 *
 * Only ever asked where a block opens. A `---` on the line under a paragraph is
 * a setext heading in markdown, not a rule -- that is what `before\n---\nafter`
 * says, and a rule drawn there would be a rule the note never asked for. After
 * a blank line there is no heading for it to be, and it is a rule.
 */
const THEMATIC_BREAK = /^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

/**
 * A task box on an item, which the map draws as a checkbox on a card.
 *
 * A block has no checkbox of its own, and the box is not part of what the item
 * says: `- [ ] buy milk` says buy milk. A card of the note's own prose is a node
 * with a checkbox when the note wrote one -- the box is the card's, not the
 * text's -- and a preview of another note draws the words.
 */
const TASK_BOX = /^\[[ xX]\][ \t]*/;

/**
 * The indentation every line shares, removed.
 *
 * A body range under a list item is indented by the note's own nesting, and
 * that indent is structural -- it is what told the parser these lines belong to
 * the item above. On the card it is just leading whitespace, so it goes; but
 * only the part every line shares, or a code sample's own shape would go with
 * it. Lines that do not carry the prefix are left alone rather than guessed at.
 */
function dedent(lines: string[]): string[] {
	let prefix: string | null = null;
	for (const line of lines) {
		if (line.trim() === "") continue;
		const ws = /^[ \t]*/.exec(line)?.[0] ?? "";
		if (ws === "") return lines;
		if (prefix === null) {
			prefix = ws;
			continue;
		}
		let shared = 0;
		while (shared < prefix.length && shared < ws.length && prefix[shared] === ws[shared]) {
			shared++;
		}
		prefix = prefix.slice(0, shared);
		if (prefix === "") return lines;
	}
	if (prefix === null || prefix === "") return lines;
	const cut = prefix;
	return lines.map((line) => (line.startsWith(cut) ? line.slice(cut.length) : line));
}

/**
 * One row's cells, or null when the line is not a row at all.
 *
 * A pipe only separates when it is not backslash-escaped, which is the one
 * piece of table syntax a plain `split` gets wrong: `a \| b` is one cell
 * holding a pipe, and it is common in exactly the notes that also use tables.
 * The escape is consumed here, so the cell reaches the inline renderer as the
 * text it stands for.
 */
function splitRow(line: string): string[] | null {
	const trimmed = line.trim();
	if (!trimmed.includes("|")) return null;

	let body = trimmed;
	if (body.startsWith("|")) body = body.slice(1);
	// A trailing pipe is the closing edge, unless it was escaped.
	if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);

	const cells: string[] = [];
	let current = "";
	for (let i = 0; i < body.length; i++) {
		const ch = body[i];
		if (ch === "\\" && body[i + 1] === "|") {
			current += "|";
			i++;
			continue;
		}
		if (ch === "|") {
			cells.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	cells.push(current);
	return cells.map((cell) => cell.trim());
}

/** Every row has every column, however many the note wrote. */
function fit(cells: string[], columns: number): string[] {
	const out = cells.slice(0, columns);
	while (out.length < columns) out.push("");
	return out;
}

/**
 * The table starting at `index`, or null when there is not one.
 *
 * A table only starts where a block starts -- a blank line, or the top of the
 * range. GFM cannot open one mid-paragraph either, and refusing to try is what
 * keeps a sentence that happens to contain a pipe from being read as a row.
 */
function readTable(lines: string[], index: number): { block: TableBlock; next: number } | null {
	const header = splitRow(lines[index]);
	if (!header || header.length === 0) return null;

	const delimiter = index + 1 < lines.length ? splitRow(lines[index + 1]) : null;
	if (!delimiter || delimiter.length !== header.length) return null;

	const align: BlockAlign[] = [];
	for (const cell of delimiter) {
		if (!DELIMITER_CELL.test(cell)) return null;
		const left = cell.startsWith(":");
		const right = cell.endsWith(":");
		align.push(left && right ? "center" : right ? "right" : left ? "left" : null);
	}

	const rows: string[][] = [];
	let next = index + 2;
	while (next < lines.length && lines[next].trim() !== "") {
		const cells = splitRow(lines[next]);
		if (!cells) break;
		rows.push(fit(cells, header.length));
		next++;
	}
	return { block: { kind: "table", align, header, rows }, next };
}

/** One item's line read into the pieces the model keeps, or null. */
function readItem(
	line: string,
): { marker: string; indent: number; ordered: boolean; number: number; text: string } | null {
	const match = LIST_ITEM.exec(line);
	if (match === null) return null;
	const ordered = /^\d/.test(match[2]);
	return {
		marker: match[2],
		indent: match[1].length,
		ordered,
		number: ordered ? Number.parseInt(match[2], 10) : 1,
		text: match[3].replace(TASK_BOX, "").trimEnd(),
	};
}

/** How far a line is indented, in characters. */
function indentOf(line: string): number {
	return /^[ \t]*/.exec(line)?.[0].length ?? 0;
}

/**
 * The list starting at `index`, or null when there is not one.
 *
 * One run of items and nothing else. A marker of the other kind ends the run,
 * which is how markdown reads `- a` followed by `1. b` -- two lists, not one --
 * and a blank line ends it the way it ends every block. A line with no marker
 * of its own is the item above it still talking, when it is indented past that
 * item's marker; anything else is the next block's first line.
 *
 * Depth comes off the indents alone: an item indented past the one before it is
 * one level deeper, and an item that skips back out closes as many levels as it
 * skipped. Nothing here decides what an indent *means*; the note wrote it and
 * the card draws it, which is the same bargain the table reader makes with the
 * pipes.
 */
function readList(lines: string[], index: number): { block: ListBlock; next: number } | null {
	const first = readItem(lines[index]);
	if (first === null) return null;

	const items: ListItem[] = [];
	/** The indent of each level opened so far, outermost first. */
	const levels: number[] = [];
	// The first item decides, and no later item can contradict it: an item of
	// the other kind ends the list rather than joining it.
	const ordered = first.ordered;
	let next = index;

	while (next < lines.length) {
		const line = lines[next];
		if (line.trim() === "") break;
		const item = readItem(line);
		if (item !== null) {
			if (item.ordered !== ordered) break;
			while (levels.length > 0 && item.indent < levels[levels.length - 1]) levels.pop();
			if (levels.length === 0 || item.indent > levels[levels.length - 1]) levels.push(item.indent);
			items.push({ marker: item.marker, depth: levels.length - 1, text: item.text });
			next++;
			continue;
		}
		// Measured against the level the last item opened, not against the
		// deepest one ever opened: it is that item the line would continue.
		const open = items[items.length - 1];
		if (open === undefined || indentOf(line) <= levels[open.depth]) break;
		open.text += `\n${line.trim()}`;
		next++;
	}

	return { block: { kind: "list", ordered, start: first.number, items }, next };
}

/** A fence's opening line, in the shape `parseMarkdown` accepts. */
function openingFence(line: string): RegExpExecArray | null {
	const match = FENCE.exec(line);
	if (!match) return null;
	// A backtick fence's info string may not contain a backtick.
	if (match[2][0] === "`" && match[3].includes("`")) return null;
	return match;
}

/**
 * The callout starting at `index`, or null when there is not one.
 *
 * The body is every following line that is still quoted, with one `>` taken
 * off, and it is read by this same function -- so a table inside a callout is a
 * table, and a callout inside a callout is a callout. A line that is not quoted
 * ends it, blank or not: that is what Obsidian does, and it is why the `>` has
 * to be repeated on an empty line to keep a callout open.
 */
function readCallout(lines: string[], index: number): { block: CalloutBlock; next: number } | null {
	const open = CALLOUT.exec(lines[index]);
	if (!open) return null;

	const inner: string[] = [];
	let next = index + 1;
	while (next < lines.length) {
		const quoted = QUOTE_LINE.exec(lines[next]);
		if (!quoted) break;
		inner.push(quoted[1]);
		next++;
	}
	// Trailing blank quote lines are the note's spacing, not content.
	while (inner.length > 0 && inner[inner.length - 1].trim() === "") inner.pop();

	return {
		block: {
			kind: "callout",
			type: open[1].toLowerCase(),
			title: open[3].trim(),
			fold: open[2] === "-" ? "closed" : open[2] === "+" ? "open" : null,
			blocks: parseBlocks(inner.join("\n")),
		},
		next,
	};
}

/**
 * The quote starting at `index`, or null when there is not one.
 *
 * The same reader the callout uses, with the type line left out: every
 * following line that is still quoted, with one `>` taken off, read by this
 * same function -- so a table inside a quote is a table and a `>>` is a quote
 * inside a quote. A line that is not quoted ends it, blank or not, which is
 * what Obsidian does and why the `>` has to be repeated on an empty line to
 * keep a quote open.
 */
function readQuote(lines: string[], index: number): { block: QuoteBlock; next: number } | null {
	const open = QUOTE_LINE.exec(lines[index]);
	if (!open) return null;

	const inner: string[] = [open[1]];
	let next = index + 1;
	while (next < lines.length) {
		const quoted = QUOTE_LINE.exec(lines[next]);
		if (!quoted) break;
		inner.push(quoted[1]);
		next++;
	}
	// Trailing blank quote lines are the note's spacing, not content.
	while (inner.length > 0 && inner[inner.length - 1].trim() === "") inner.pop();

	return { block: { kind: "quote", blocks: parseBlocks(inner.join("\n")) }, next };
}

/**
 * A body range as the blocks it is made of, in order.
 *
 * Blank lines are separators and produce nothing; a run of lines with no blank
 * line between them is one paragraph, newlines and all.
 */
export function parseBlocks(source: string): Block[] {
	const lines = dedent(source.replace(/\r\n?/g, "\n").split("\n"));
	const blocks: Block[] = [];
	let i = 0;

	while (i < lines.length) {
		if (lines[i].trim() === "") {
			i++;
			continue;
		}

		const fence = openingFence(lines[i]);
		if (fence) {
			const char = fence[2][0];
			const length = fence[2].length;
			const body: string[] = [];
			i++;
			while (i < lines.length) {
				const close = FENCE.exec(lines[i]);
				if (
					close &&
					close[2][0] === char &&
					close[2].length >= length &&
					close[3].trim() === ""
				) {
					i++;
					break;
				}
				body.push(lines[i]);
				i++;
			}
			blocks.push({ kind: "code", lang: fence[3].trim(), text: body.join("\n") });
			continue;
		}

		// The rule is asked before the list, and only here: see THEMATIC_BREAK
		// for why a `---` under a paragraph is left as the paragraph's own line.
		if (THEMATIC_BREAK.test(lines[i])) {
			blocks.push({ kind: "rule" });
			i++;
			continue;
		}

		const callout = readCallout(lines, i);
		if (callout) {
			blocks.push(callout.block);
			i = callout.next;
			continue;
		}

		const quote = readQuote(lines, i);
		if (quote) {
			blocks.push(quote.block);
			i = quote.next;
			continue;
		}

		const table = readTable(lines, i);
		if (table) {
			blocks.push(table.block);
			i = table.next;
			continue;
		}

		const list = readList(lines, i);
		if (list) {
			blocks.push(list.block);
			i = list.next;
			continue;
		}

		// Everything else is prose, up to whatever ends it. A fence ends it --
		// fenced code is allowed to interrupt a paragraph -- a blank line ends
		// it, and so does a table, which cannot open here but can start the next
		// block. A quote ends it the way a table does: `>` opens a box of its
		// own, callout or not, and a paragraph that swallowed it would show the
		// marker rather than the bar. A list ends it too: a paragraph line that
		// begins with a marker is an item, and reading it as prose would put a
		// bullet in the middle of a sentence.
		const start = i;
		while (
			i < lines.length &&
			lines[i].trim() !== "" &&
			!openingFence(lines[i]) &&
			!CALLOUT.test(lines[i]) &&
			!QUOTE_LINE.test(lines[i]) &&
			!readTable(lines, i) &&
			!LIST_ITEM.test(lines[i])
		) {
			i++;
		}
		blocks.push({ kind: "paragraph", text: lines.slice(start, i).join("\n") });
	}

	return blocks;
}

/**
 * Whether a card has to be drawn as these blocks rather than as one run of
 * text.
 *
 * What the view asks before it commits a card to the structured path. Four
 * constructs cannot survive being read as characters: a table, whose `|` is
 * only a column edge once something has decided it is one; a callout, whose
 * `>` and `[!type]` are scaffolding the reader is never meant to see; a quote,
 * whose `>` is a bar down the edge of somebody else's words and not a
 * character; and a fenced sample, whose fences are the note's way of saying
 * "leave this alone" and are the one part of it nobody wants to read. A
 * paragraph reads the same either way, and the plain path is the one every
 * other card is measured and styled by.
 *
 * A list and a rule are the two that do not force it, and a list is the one
 * that never will: a note's list items are nodes in this map -- cards of their
 * own -- so the list is already the tree's shape, and what a body card holds is
 * the lines that are *not* nodes. A rule does not force it because a card that
 * is one rule and nothing else is a card nobody writes; drawn as characters it
 * is three hyphens, which is at least honest about what the note contains. Both
 * are asked about all the same, because the question is asked of every block
 * and because a preview of another note has no tree to have drawn its lists as.
 */
export function needsBlocks(blocks: readonly Block[]): boolean {
	return blocks.some(
		(block) =>
			block.kind === "table" ||
			block.kind === "callout" ||
			block.kind === "quote" ||
			block.kind === "code",
	);
}
