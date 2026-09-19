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

export type Block = TableBlock | CodeBlock | ParagraphBlock | CalloutBlock;

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

		const callout = readCallout(lines, i);
		if (callout) {
			blocks.push(callout.block);
			i = callout.next;
			continue;
		}

		const table = readTable(lines, i);
		if (table) {
			blocks.push(table.block);
			i = table.next;
			continue;
		}

		// Everything else is prose, up to whatever ends it. A fence ends it --
		// fenced code is allowed to interrupt a paragraph -- a blank line ends
		// it, and so does a table, which cannot open here but can start the next
		// block. A callout ends it the same way a table does: `> [!note]` is a
		// box of its own, and a paragraph that swallowed it would show the
		// syntax rather than the box.
		const start = i;
		while (
			i < lines.length &&
			lines[i].trim() !== "" &&
			!openingFence(lines[i]) &&
			!CALLOUT.test(lines[i]) &&
			!readTable(lines, i)
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
 * What the view asks before it commits a card to the structured path. Three
 * constructs cannot survive being read as characters: a table, whose `|` is
 * only a column edge once something has decided it is one; a callout, whose
 * `>` and `[!type]` are scaffolding the reader is never meant to see; and a
 * fenced sample, whose fences are the note's way of saying "leave this alone"
 * and are the one part of it nobody wants to read. A paragraph reads the same
 * either way, and the plain path is the one every other card is measured and
 * styled by.
 */
export function needsBlocks(blocks: readonly Block[]): boolean {
	return blocks.some(
		(block) => block.kind === "table" || block.kind === "callout" || block.kind === "code",
	);
}
