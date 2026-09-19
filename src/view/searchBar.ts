import { debounce, setIcon } from "obsidian";
import type { Debouncer } from "obsidian";

import { t } from "../i18n.ts";
import type { SearchQuery } from "../model/search.ts";

/**
 * How long typing settles before the map is searched again.
 *
 * Long enough that a burst of keystrokes is one query, short enough that the
 * count still feels like it is following the input.
 */
const TYPE_DELAY = 150;

/**
 * How much of the note a replace is allowed to touch.
 *
 * `"current"` is the node the bar's cursor is on rather than a single
 * occurrence: what the bar counts is nodes, and a card is what the user is
 * looking at when they press it.
 */
export type ReplaceScope = "current" | "all";

export interface SearchBarOptions {
	/** What the session was last searching for; the bar opens holding it. */
	query: SearchQuery;
	/** What the session was last replacing with, or "". */
	replacement: string;
	onQuery: (query: SearchQuery) => void;
	/** +1 for the next match, -1 for the previous. */
	onStep: (delta: number) => void;
	/** `replacement` is read off the field at the moment the button is pressed. */
	onReplace: (scope: ReplaceScope, replacement: string) => void;
	onClose: () => void;
}

/**
 * The floating find bar, with a replace row under it.
 *
 * Mounted on `contentEl` rather than inside the canvas viewport: the map's own
 * keyboard handler sits on the viewport, so typing here cannot reach it, and
 * the bar is free to keep only the keys it actually owns.
 *
 * The replace row is built up front and hidden rather than created on demand,
 * because the two rows are one box and a box that changed shape when a button
 * was pressed would move under the pointer that pressed it.
 */
export class SearchBar {
	private readonly el: HTMLElement;
	private readonly input: HTMLInputElement;
	private readonly replaceInput: HTMLInputElement;
	private readonly count: HTMLElement;
	private readonly regexToggle: HTMLElement;
	private readonly replaceToggle: HTMLElement;
	private readonly opts: SearchBarOptions;
	private readonly submit: Debouncer<[], void>;
	private regex: boolean;
	/** True between compositionstart and compositionend. */
	private composing = false;

	constructor(parent: HTMLElement, opts: SearchBarOptions) {
		this.opts = opts;
		this.regex = opts.query.regex;

		this.el = parent.createDiv({ cls: "mm-search" });
		const findRow = this.el.createDiv({ cls: "mm-search-row" });
		// The bar's own name, borrowed from the action that opens it, so the
		// tooltip on the camera button and this placeholder agree.
		const findLabel = t("shortcut.search.name");
		this.input = findRow.createEl("input", {
			cls: "mm-search-input",
			type: "text",
			value: opts.query.text,
			attr: {
				placeholder: findLabel,
				"aria-label": findLabel,
				spellcheck: "false",
			},
		});

		this.regexToggle = this.button(findRow, null, ".*", t("search.regex"), () =>
			this.toggleRegex(),
		);
		this.regexToggle.toggleClass("is-active", this.regex);
		this.regexToggle.setAttribute("aria-pressed", String(this.regex));

		this.count = findRow.createDiv({ cls: "mm-search-count", text: "0/0" });
		this.button(findRow, "chevron-up", "↑", t("search.previous"), () => opts.onStep(-1));
		this.button(findRow, "chevron-down", "↓", t("search.next"), () => opts.onStep(1));
		this.replaceToggle = this.button(findRow, "replace", "⇄", t("search.replace"), () =>
			this.toggleReplace(),
		);
		this.replaceToggle.setAttribute("aria-expanded", "false");
		this.button(findRow, "x", "✕", t("search.close"), () => opts.onClose());

		const replaceRow = this.el.createDiv({ cls: "mm-search-row mm-replace-row" });
		const replaceLabel = t("search.replaceWith");
		this.replaceInput = replaceRow.createEl("input", {
			cls: "mm-search-input mm-replace-input",
			type: "text",
			value: opts.replacement,
			attr: {
				placeholder: replaceLabel,
				"aria-label": replaceLabel,
				spellcheck: "false",
			},
		});
		this.replaceButton(replaceRow, t("search.replaceOne"), () => this.replace("current"));
		this.replaceButton(replaceRow, t("search.replaceAll"), () => this.replace("all"));

		this.submit = debounce(() => this.emit(), TYPE_DELAY, true);

		this.input.addEventListener("input", () => {
			// A composition in progress is not a query: searching each candidate
			// keystroke would drag the camera around on half a syllable.
			if (this.composing) return;
			this.submit();
		});
		this.input.addEventListener("compositionstart", () => {
			this.composing = true;
		});
		this.input.addEventListener("compositionend", () => {
			this.composing = false;
			this.submit();
		});
		this.input.addEventListener("keydown", (ev) => this.onKeyDown(ev));
		this.replaceInput.addEventListener("keydown", (ev) => this.onReplaceKeyDown(ev));
	}

	focus(): void {
		this.input.focus();
		this.input.select();
	}

	/**
	 * Open the replace row and put the cursor in it.
	 *
	 * Idempotent, so the two ways in -- the toggle and the action that opens
	 * the bar -- can both ask without stepping on each other.
	 */
	openReplace(): void {
		this.el.addClass("is-replacing");
		this.replaceToggle.addClass("is-active");
		this.replaceToggle.setAttribute("aria-expanded", "true");
		this.replaceInput.focus();
		this.replaceInput.select();
	}

	setStatus(current: number, total: number, invalid: boolean): void {
		this.count.setText(`${current}/${total}`);
		this.input.toggleClass("is-error", invalid);
	}

	destroy(): void {
		// Cancelled before the element goes: a query firing afterwards would
		// search on behalf of a bar that no longer exists.
		this.submit.cancel();
		this.el.remove();
	}

	private button(
		parent: HTMLElement,
		icon: string | null,
		text: string,
		label: string,
		onClick: () => void,
	): HTMLElement {
		const el = parent.createDiv({
			cls: "mm-tool",
			attr: { "aria-label": label, role: "button" },
		});
		if (icon) setIcon(el, icon);
		// `setIcon` is silent when an id is not in the bundled set, which would
		// leave an invisible but clickable box beside the input.
		if (!el.firstElementChild) el.setText(text);
		el.addEventListener("click", (ev) => {
			ev.preventDefault();
			onClick();
		});
		return el;
	}

	/**
	 * A button that has to say a word rather than show a glyph.
	 *
	 * The replace row's two actions are not two icons anybody would guess at,
	 * so they are written out and given the room that takes.
	 */
	private replaceButton(parent: HTMLElement, label: string, onClick: () => void): void {
		const el = parent.createDiv({
			cls: "mm-tool mm-replace-button",
			text: label,
			attr: { "aria-label": label, role: "button" },
		});
		el.addEventListener("click", (ev) => {
			ev.preventDefault();
			onClick();
		});
	}

	private onKeyDown(ev: KeyboardEvent): void {
		// The Enter that confirms an IME candidate arrives here as well.
		if (ev.isComposing) return;

		if (ev.key === "Enter") {
			this.take(ev);
			// Anything still on the timer is this same query, and stepping before
			// it lands would walk the previous match list.
			this.submit.run();
			this.opts.onStep(ev.shiftKey ? -1 : 1);
			return;
		}
		if (ev.key === "Escape") {
			this.take(ev);
			this.opts.onClose();
			return;
		}
		if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "f") {
			this.take(ev);
			this.input.select();
			return;
		}
		if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "h") {
			this.take(ev);
			this.openReplace();
			return;
		}
		// Every other key keeps its usual meaning, the command palette included.
	}

	private onReplaceKeyDown(ev: KeyboardEvent): void {
		if (ev.isComposing) return;
		if (ev.key === "Escape") {
			this.take(ev);
			this.opts.onClose();
			return;
		}
		if (ev.key === "Enter") {
			this.take(ev);
			// Every occurrence, because the field is a bulk tool: the row has a
			// button for one card and this key for the whole note.
			this.replace("all");
			return;
		}
		if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "f") {
			this.take(ev);
			this.input.focus();
			this.input.select();
			return;
		}
		// Everything else is typing, and the query follows it.
	}

	private take(ev: KeyboardEvent): void {
		ev.preventDefault();
		ev.stopPropagation();
	}

	private toggleReplace(): void {
		if (this.el.hasClass("is-replacing")) {
			this.el.removeClass("is-replacing");
			this.replaceToggle.removeClass("is-active");
			this.replaceToggle.setAttribute("aria-expanded", "false");
			this.input.focus();
			return;
		}
		this.openReplace();
	}

	private toggleRegex(): void {
		this.regex = !this.regex;
		this.regexToggle.toggleClass("is-active", this.regex);
		this.regexToggle.setAttribute("aria-pressed", String(this.regex));
		// A button press is not typing; there is nothing left to wait for.
		this.submit.cancel();
		this.emit();
		this.input.focus();
	}

	private emit(): void {
		this.opts.onQuery({ text: this.input.value, regex: this.regex });
	}

	private replace(scope: ReplaceScope): void {
		// A query still on the timer has not been searched for yet, and
		// replacing against the previous one would act on the wrong text.
		this.submit.cancel();
		this.emit();
		this.opts.onReplace(scope, this.replaceInput.value);
	}
}
