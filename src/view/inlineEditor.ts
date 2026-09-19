/**
 * The one in-place editor, used by all three fields on the map.
 *
 * A node title, a content card and an annotation strip are edited the same way:
 * a `contentEditable` field that takes the focus, swallows the map's own
 * shortcuts, and ends on `Enter`/`Tab`/`Escape` or a click away. They used to
 * be three near-identical copies, which is why every change to them had to be
 * made in three places -- and the two things the copies got wrong (an input
 * method's `Enter` closing the field, and a line break that `textContent` could
 * not read back) were wrong in all three at once.
 *
 * What differs between the three is only what a key *means*, and that part is
 * `inlineIntent` below: a pure function over a plain object, so it can be
 * tested without a document. Everything that needs the view -- undo, the find
 * bar, where the focus goes afterwards -- arrives through `InlineEditorHost`,
 * which is also what keeps this module free of `obsidian`.
 */

/** The shape of a key press this module cares about, and nothing else. */
export interface InlineKeyEvent {
	readonly key: string;
	readonly shiftKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly isComposing: boolean;
}

/** What a press means inside a field. */
export type InlineIntent =
	/** Commit the text and close. */
	| "save"
	/** Close and throw the draft away. */
	| "cancel"
	/** Write a line break at the caret and stay open. */
	| "newline"
	/** Commit, then hand over to the find bar. */
	| "search"
	/** Carried to the map: the field owns the keyboard, so undo is let out by name. */
	| "undo"
	| "redo"
	/** Let the platform have it. */
	| "none";

/** How a particular field reads the keyboard. */
export interface InlineKeyShape {
	/** Prose that may hold several lines, where `Enter` writes one. */
	multiline: boolean;
	/** A code block: the one field where `Shift`+`Enter` is the line break. */
	code: boolean;
	/** Whether `Ctrl`/`Cmd`+`F` is let out to the find bar. */
	search: boolean;
}

/**
 * What this press means.
 *
 * `mapAction` is what the map's own key table made of the same press, already
 * filtered to the actions a field lets through -- `null` for everything else,
 * which is almost always the answer.
 */
export function inlineIntent(
	ev: InlineKeyEvent,
	shape: InlineKeyShape,
	mapAction: "undo" | "redo" | null,
): InlineIntent {
	// The `Enter` that confirms an input method's candidate arrives here as
	// well, and it belongs to the input method: saving on it closes the field
	// mid-word. Checked before `mapAction` for the same reason -- a rebind that
	// put undo on `Enter` would otherwise take the candidate's key too.
	if (ev.isComposing) return "none";
	// Undo and redo are the one thing a field lets through, and only while
	// nothing has been typed. A node added by accident is left with this editor
	// open and its text still empty, and taking that add back is the very next
	// thing the user wants.
	if (mapAction !== null) return mapAction;
	if (ev.key === "Escape") return "cancel";
	// Tab is the map's "new child" key, and it cannot mean that while a field
	// has the keyboard. Left to the platform it moves the focus to whatever
	// comes next in the document, which closes this editor through the blur
	// anyway -- and lands the user on an element they never picked.
	if (ev.key === "Tab") return "save";
	if (ev.key === "Enter") {
		if (!shape.multiline) return "save";
		// A code block is the one block whose own text is lines: a sample is
		// unreadable without them, so `Shift`+Enter writes one.
		if (shape.code) return ev.shiftKey ? "newline" : "save";
		return ev.ctrlKey || ev.metaKey ? "save" : "newline";
	}
	// The field stops every key at its own boundary, so the find bar has to be
	// let out by name -- the view's keymap scope never sees a key this editor
	// swallowed.
	if (shape.search && (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "f") {
		return "search";
	}
	return "none";
}

/**
 * Write a line break into `field` at the caret.
 *
 * The browser's own `Enter` is not left to do it. `plaintext-only` does write
 * the newline a block needs, but the fallback spelling -- `true`, for engines
 * that do not have it -- writes a `<div>` or a `<br>` instead, and neither of
 * those survives `textContent`, which is what the save reads back. A real `\n`
 * in a text node does survive it, and `white-space: pre-wrap` draws it as the
 * break that was asked for.
 */
export function insertLineBreak(field: HTMLElement): void {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) return;
	const range = selection.getRangeAt(0);
	// The caret belongs to the field being edited. A range anywhere else is a
	// selection in Obsidian's own interface, and a line break written into that
	// is a line break in the wrong document.
	if (!field.contains(range.startContainer)) return;
	range.deleteContents();
	const node = document.createTextNode("\n");
	range.insertNode(node);
	range.setStartAfter(node);
	range.collapse(true);
	selection.removeAllRanges();
	selection.addRange(range);
}

/** What the field needs from the view it is open inside. */
export interface InlineEditorHost {
	/** What the map's key table made of this press, filtered to undo/redo. */
	mapAction: (ev: KeyboardEvent) => "undo" | "redo" | null;
	undo: () => void;
	redo: () => void;
	/** Called after a commit that came from `Ctrl`/`Cmd`+`F`. */
	openSearch: () => void;
	/** Where the focus goes once the field is done with it. */
	releaseFocus: () => void;
}

export interface InlineEditorSpec {
	/** The element the text is written into, emptied and refilled here. */
	field: HTMLElement;
	/** What the field starts out holding. */
	text: string;
	shape: InlineKeyShape;
	/**
	 * Called once, with what the field held. `save` is false only for `Escape`.
	 *
	 * Everything that touches the note belongs here rather than in this module:
	 * what to do with an empty value, and how to write the result back, is the
	 * one part that genuinely differs between the three fields.
	 */
	commit: (value: string, save: boolean) => void;
}

/**
 * Open `spec.field` for editing, and return the function that closes it.
 *
 * The returned function is the same one the field's own keys call, so the view
 * can hold it as its `endEdit` and close this editor before acting on a key
 * that arrived outside it.
 */
export function openInlineEditor(
	spec: InlineEditorSpec,
	host: InlineEditorHost,
): (save: boolean) => void {
	const field = spec.field;
	field.replaceChildren();
	field.textContent = spec.text;
	field.classList.add("is-editing");
	// `plaintext-only` is what keeps a pasted `<div>` out of the field. Engines
	// without it throw on the assignment rather than ignoring it, and then the
	// check below catches the ones that accept it and silently downgrade.
	try {
		field.contentEditable = "plaintext-only";
	} catch {
		field.contentEditable = "true";
	}
	if (field.contentEditable !== "plaintext-only") field.contentEditable = "true";
	field.focus();

	const range = document.createRange();
	range.selectNodeContents(field);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);

	let settled = false;
	const finish = (save: boolean): void => {
		if (settled) return;
		settled = true;
		const value = field.textContent ?? "";
		field.contentEditable = "false";
		field.classList.remove("is-editing");
		spec.commit(value, save);
		host.releaseFocus();
	};

	field.addEventListener("keydown", (ev: KeyboardEvent) => {
		const intent = inlineIntent(ev, spec.shape, host.mapAction(ev));
		if (intent === "none") {
			// A composing press is left alone entirely -- including its
			// propagation, because the input method is still using it. Every
			// other key stops here: the field owns the keyboard, and a press
			// let past this boundary would reach Obsidian's own keymap first.
			if (!ev.isComposing) ev.stopPropagation();
			return;
		}
		ev.preventDefault();
		ev.stopPropagation();
		switch (intent) {
			case "save":
				finish(true);
				return;
			case "cancel":
				finish(false);
				return;
			case "newline":
				insertLineBreak(field);
				return;
			case "search":
				// Committed first, so the query runs against the text the user
				// has just typed.
				finish(true);
				host.openSearch();
				return;
			case "undo":
				host.undo();
				return;
			case "redo":
				host.redo();
				return;
		}
	});
	field.addEventListener("blur", () => finish(true), { once: true });
	return finish;
}
