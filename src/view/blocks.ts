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

import type { Block, BlockAlign, CodeBlock, TableBlock } from "../model/blocks.ts";
import { renderInlineOrNothing } from "./inline.ts";

/** Where a column's text sits, or nothing at all when the note did not say. */
function alignCell(cell: HTMLElement, align: BlockAlign): void {
	if (align !== null) cell.style.textAlign = align;
}

function renderTable(host: HTMLElement, block: TableBlock): boolean {
	const table = host.createEl("table", { cls: "mm-table" });
	let sawMath = false;

	// A header is not optional in the syntax -- the delimiter row is what makes
	// the thing a table at all -- so it is always drawn as one.
	const headRow = table.createEl("thead").createEl("tr");
	block.header.forEach((text, column) => {
		const th = headRow.createEl("th");
		alignCell(th, block.align[column] ?? null);
		sawMath = renderInlineOrNothing(th, text) || sawMath;
	});

	if (block.rows.length > 0) {
		const body = table.createEl("tbody");
		for (const row of block.rows) {
			const tr = body.createEl("tr");
			row.forEach((text, column) => {
				const td = tr.createEl("td");
				alignCell(td, block.align[column] ?? null);
				sawMath = renderInlineOrNothing(td, text) || sawMath;
			});
		}
	}
	return sawMath;
}

/**
 * A fenced sample, drawn as the sample rather than as its source.
 *
 * The fence itself never reaches the card: it is the note's way of saying
 * "leave this alone", and on the card that is what a monospace face already
 * says. `setText`, not `renderInline` -- markup inside a sample is the point of
 * writing one.
 */
function renderCode(host: HTMLElement, block: CodeBlock): void {
	const pre = host.createEl("pre", { cls: "mm-code-block" });
	const code = pre.createEl("code", { text: block.text });
	if (block.lang !== "") code.addClass(`language-${block.lang}`);
}

/** Returns true when any block contained a formula, so the view re-measures
 *  once MathJax has flushed its stylesheet. */
export function renderBlocks(host: HTMLElement, blocks: readonly Block[]): boolean {
	let sawMath = false;
	for (const block of blocks) {
		if (block.kind === "table") sawMath = renderTable(host, block) || sawMath;
		else if (block.kind === "code") renderCode(host, block);
		else sawMath = renderInlineOrNothing(host.createDiv({ cls: "mm-para" }), block.text) || sawMath;
	}
	return sawMath;
}
