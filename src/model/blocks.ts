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

export type Block = TableBlock | CodeBlock | ParagraphBlock;

const FENCE = /^([ \t]*)(`{3,}|~{3,})[ \t]*(.*)$/;
/** One cell of a delimiter row: dashes, optionally pinned to either edge. */
const DELIMITER_CELL = /^:?-+:?$/;

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

		const table = readTable(lines, i);
		if (table) {
			blocks.push(table.block);
			i = table.next;
			continue;
		}

		// Everything else is prose, up to whatever ends it. A fence ends it --
		// fenced code is allowed to interrupt a paragraph -- a blank line ends
		// it, and so does a table, which cannot open here but can start the next
		// block.
		const start = i;
		while (
			i < lines.length &&
			lines[i].trim() !== "" &&
			!openingFence(lines[i]) &&
			!readTable(lines, i)
		) {
			i++;
		}
		blocks.push({ kind: "paragraph", text: lines.slice(start, i).join("\n") });
	}

	return blocks;
}

/**
 * Whether these blocks hold a table.
 *
 * What the view asks before it commits a card to being drawn as blocks: a
 * paragraph reads the same either way, and the plain path is the one every
 * existing card is measured and styled by.
 */
export function holdsTable(blocks: readonly Block[]): boolean {
	return blocks.some((block) => block.kind === "table");
}
