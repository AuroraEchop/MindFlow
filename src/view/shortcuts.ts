/**
 * Every key the map answers, declared once.
 *
 * The table below is the source of truth for three readers: the keydown handler
 * in `interactions.ts` resolves a press through it, the settings tab renders a
 * row per entry and rebinds it, and the in-app help panel prints whatever is
 * bound right now. Adding an action here is what makes it appear in all three.
 *
 * The wording is not here. Each row carries the *keys* its two strings live
 * under in `src/i18n.ts`, derived from the action name, so a row added to the
 * table cannot arrive without its words -- the derived key has to land on one
 * the English table actually holds, or this does not compile.
 *
 * Nothing in this file imports `obsidian` -- the tests run the sources through
 * Node's type stripping, where that module does not exist.
 */

import type { I18nKey } from "../i18n.ts";

/**
 * One press, normalised.
 *
 * `key` is `KeyboardEvent.key` with the two spellings that vary flattened:
 * letters are lower-cased and `" "` is written `"Space"`. Named keys keep their
 * own spelling (`"ArrowUp"`, `"Tab"`, `"Enter"`, `"Delete"`, `"Escape"`).
 *
 * `mod` is Obsidian's "Mod" -- Ctrl on Windows and Linux, Cmd on macOS -- which
 * is why a combo carries no separate ctrl and meta.
 */
export interface KeyCombo {
	key: string;
	mod: boolean;
	shift: boolean;
	alt: boolean;
}

/** The shape `comboFromEvent` reads, so a test can hand it a plain object. */
export interface KeyEventLike {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}

/** Keys that are only ever half of a combo. */
const MODIFIER_KEYS = new Set([
	"Shift",
	"Control",
	"Meta",
	"Alt",
	"AltGraph",
	"CapsLock",
	"NumLock",
	"ScrollLock",
	"Dead",
	"Process",
	"Unidentified",
]);

/** A cased letter, in any alphabet: the one thing `key` reports two ways. */
function isLetter(key: string): boolean {
	return key.length === 1 && key.toLowerCase() !== key.toUpperCase();
}

/**
 * Whether Shift is part of this combo or already spent on the character.
 *
 * A letter reports its own case, so Shift has to be kept to tell `z` from `Z`.
 * Every other single character *is* the shifted reading -- `+` is what Shift
 * and `=` produce -- so carrying the flag as well would ask for a press that no
 * keyboard can make.
 */
function shiftApplies(key: string): boolean {
	return key.length !== 1 || isLetter(key);
}

export function normaliseKey(key: string): string {
	if (key === " " || key === "Spacebar") return "Space";
	return isLetter(key) ? key.toLowerCase() : key;
}

export function comboFromEvent(ev: KeyEventLike): KeyCombo {
	const key = normaliseKey(ev.key);
	return {
		key,
		mod: ev.ctrlKey || ev.metaKey,
		shift: ev.shiftKey && shiftApplies(key),
		alt: ev.altKey,
	};
}

/** A press that is still waiting for the key it modifies. */
export function isModifierOnly(combo: KeyCombo): boolean {
	return MODIFIER_KEYS.has(combo.key);
}

export function sameCombo(a: KeyCombo, b: KeyCombo): boolean {
	return a.key === b.key && a.mod === b.mod && a.shift === b.shift && a.alt === b.alt;
}

/** What one keydown means to a shortcut row that is recording. */
export type RecordOutcome = "ignore" | "cancel" | { combo: KeyCombo };

/**
 * Turns a keydown into a recording decision, with no DOM in the way -- the
 * settings tab's window-level listener calls this and then only carries out
 * whatever it says.
 *
 * A modifier held alone is half of a combo, not one yet, so recording waits
 * for the next key. Escape is the one key a capture cannot record -- it
 * cancels the capture instead. Everything else, Delete and Backspace
 * included, becomes the new binding.
 */
export function recordKey(ev: KeyEventLike): RecordOutcome {
	const combo = comboFromEvent(ev);
	if (isModifierOnly(combo)) return "ignore";
	if (combo.key === "Escape") return "cancel";
	return { combo };
}

/** The stored spelling: `"Mod+Shift+ArrowUp"`, `"Mod++"`, `"]"`. */
export function serializeCombo(combo: KeyCombo): string {
	const parts: string[] = [];
	if (combo.mod) parts.push("Mod");
	if (combo.alt) parts.push("Alt");
	if (combo.shift) parts.push("Shift");
	parts.push(combo.key);
	return parts.join("+");
}

const MOD_ALIASES: Record<string, "mod" | "shift" | "alt"> = {
	Mod: "mod",
	Ctrl: "mod",
	Control: "mod",
	Cmd: "mod",
	Meta: "mod",
	Shift: "shift",
	Alt: "alt",
	Option: "alt",
};

/**
 * Reads the stored spelling back, or null when there is no key left in it.
 *
 * The key is whatever follows the last modifier, which is what lets `"Mod++"`
 * mean Mod and `+` rather than a trailing empty name. Everything that comes
 * back is normalised, so a hand-edited `data.json` still lands on a combo the
 * keyboard can actually produce.
 */
export function parseCombo(text: string): KeyCombo | null {
	let rest = text.trim();
	if (rest === "") return null;

	let mod = false;
	let shift = false;
	let alt = false;
	for (;;) {
		const match = /^([A-Za-z]+)\+(?=.)/.exec(rest);
		const flag = match ? MOD_ALIASES[match[1]] : undefined;
		if (!match || !flag) break;
		if (flag === "mod") mod = true;
		else if (flag === "shift") shift = true;
		else alt = true;
		rest = rest.slice(match[0].length);
	}

	// What is left is the key itself, so the only `+` it may still hold is the
	// key named `+`. Anything else is a separator with no modifier in front of
	// it, or a modifier this version does not know.
	if (rest.length > 1 && rest.includes("+")) return null;

	const key = normaliseKey(rest);
	if (key === "") return null;
	return { key, mod, shift: shift && shiftApplies(key), alt };
}

const KEY_LABELS: Record<string, string> = {
	ArrowUp: "↑",
	ArrowDown: "↓",
	ArrowLeft: "←",
	ArrowRight: "→",
	Escape: "Esc",
};

/** How a combo is written for a reader: `Ctrl + ↑`, or `⌘ ↑` on macOS. */
export function comboToString(combo: KeyCombo, isMac: boolean): string {
	const parts: string[] = [];
	if (combo.mod) parts.push(isMac ? "⌘" : "Ctrl");
	if (combo.alt) parts.push(isMac ? "⌥" : "Alt");
	if (combo.shift) parts.push(isMac ? "⇧" : "Shift");
	parts.push(KEY_LABELS[combo.key] ?? (isLetter(combo.key) ? combo.key.toUpperCase() : combo.key));
	return parts.join(isMac ? " " : " + ");
}

function mustParse(text: string): KeyCombo {
	const combo = parseCombo(text);
	if (!combo) throw new Error(`Not a key combination: ${text}`);
	return combo;
}

/**
 * The table.
 *
 * Order is the order the settings tab and the help panel list the actions in,
 * and it is also the order a press is matched in: bind two actions to one combo
 * and the earlier one answers. The settings tab warns about exactly that.
 */
const TABLE = [
	{ action: "add-child", defaults: ["Tab"] },
	{ action: "add-sibling", defaults: ["Enter"] },
	{ action: "edit-title", defaults: ["F2"] },
	{ action: "edit-annotation", defaults: ["Mod+Enter"] },
	{ action: "insert-block", defaults: ["Shift+Enter"] },
	{ action: "delete-node", defaults: ["Delete", "Backspace"] },
	// Moved off Mod+Enter, which the text block now has: that one was asked for
	// by name, and this is the same Enter family rather than a key of its own.
	{ action: "toggle-check", defaults: ["Mod+Shift+Enter"] },
	{ action: "expand-body", defaults: [] },
	{ action: "indent", defaults: ["]"] },
	{ action: "outdent", defaults: ["Shift+Tab"] },
	{ action: "move-up", defaults: ["Mod+ArrowUp"] },
	{ action: "move-down", defaults: ["Mod+ArrowDown"] },
	{ action: "toggle-fold", defaults: ["Space"] },
	{ action: "navigate-up", defaults: ["ArrowUp"] },
	{ action: "navigate-down", defaults: ["ArrowDown"] },
	{ action: "navigate-left", defaults: ["ArrowLeft"] },
	{ action: "navigate-right", defaults: ["ArrowRight"] },
	{ action: "search", defaults: ["Mod+f"] },
	{ action: "close-search", defaults: ["Escape"] },
	{ action: "undo", defaults: ["Mod+z"] },
	{ action: "redo", defaults: ["Mod+Shift+z", "Mod+y"] },
	{ action: "fit", defaults: ["Mod+0"] },
	{ action: "zoom-in", defaults: ["Mod+=", "Mod++"] },
	{ action: "zoom-out", defaults: ["Mod+-"] },
	{ action: "centre-selection", defaults: ["Mod+."] },
] as const;

/** Every action the map's keyboard performs. */
export type ShortcutAction = (typeof TABLE)[number]["action"];

/**
 * The dictionary key an action's name lives under.
 *
 * The return type is what makes the table and the English dictionary agree: a
 * row whose action has no matching pair of strings in `src/i18n.ts` produces a
 * key that is not an `I18nKey`, and this stops compiling.
 */
export function shortcutNameKey(action: ShortcutAction): I18nKey {
	return `shortcut.${action}.name`;
}

/** The dictionary key an action's one-line explanation lives under. */
export function shortcutDescKey(action: ShortcutAction): I18nKey {
	return `shortcut.${action}.description`;
}

export interface Shortcut {
	action: ShortcutAction;
	/** Where the name shown in the settings tab and the help panel lives. */
	nameKey: I18nKey;
	/** Where the line printed under it lives. */
	descKey: I18nKey;
	/** What the action answers to until the user says otherwise. */
	defaults: KeyCombo[];
}

/** The table with its literal types widened, so one `map` reads every row. */
const ROWS: ReadonlyArray<{
	action: ShortcutAction;
	defaults: readonly string[];
}> = TABLE;

export const SHORTCUTS: ReadonlyArray<Shortcut> = ROWS.map((entry) => ({
	action: entry.action,
	nameKey: shortcutNameKey(entry.action),
	descKey: shortcutDescKey(entry.action),
	defaults: entry.defaults.map(mustParse),
}));

const BY_ACTION = new Map<ShortcutAction, Shortcut>(SHORTCUTS.map((s) => [s.action, s]));

export function shortcutFor(action: ShortcutAction): Shortcut {
	const entry = BY_ACTION.get(action);
	// Unreachable: the action type is the table's own action column.
	if (!entry) throw new Error(`No such shortcut: ${action}`);
	return entry;
}

/** What every action answers to right now. An empty array means unbound. */
export type ShortcutBindings = Record<ShortcutAction, KeyCombo[]>;

/** What `data.json` holds: only the actions the user has changed. */
export type StoredShortcuts = Partial<Record<ShortcutAction, string[]>>;

/**
 * The defaults with the user's overrides laid over them.
 *
 * A missing action means "default", an empty array means "unbound", and an
 * action the table no longer knows is dropped -- so a binding left behind by an
 * older version cannot resurrect a key nothing handles.
 */
export function resolveBindings(stored: StoredShortcuts | undefined): ShortcutBindings {
	const bindings = {} as ShortcutBindings;
	for (const entry of SHORTCUTS) {
		const raw = stored?.[entry.action];
		if (!Array.isArray(raw)) {
			bindings[entry.action] = entry.defaults.map((combo) => ({ ...combo }));
			continue;
		}
		const combos: KeyCombo[] = [];
		for (const text of raw) {
			const combo = typeof text === "string" ? parseCombo(text) : null;
			if (combo && !combos.some((seen) => sameCombo(seen, combo))) combos.push(combo);
		}
		bindings[entry.action] = combos;
	}
	return bindings;
}

/** Whether an action is still on the keys it shipped with. */
export function isDefaultBinding(action: ShortcutAction, combos: KeyCombo[]): boolean {
	const defaults = shortcutFor(action).defaults;
	if (combos.length !== defaults.length) return false;
	return defaults.every((combo, index) => sameCombo(combo, combos[index]));
}

/** The action a press performs, or null when the map does not answer to it. */
export function resolveAction(
	bindings: ShortcutBindings,
	combo: KeyCombo,
): ShortcutAction | null {
	for (const entry of SHORTCUTS) {
		if (bindings[entry.action].some((bound) => sameCombo(bound, combo))) return entry.action;
	}
	return null;
}

/**
 * Whether the map still answers this action while a card's title is open for
 * editing.
 *
 * A card being edited is a text field, so every key the map would otherwise
 * claim is one the user is typing, and the map has to keep its hands off.
 *
 * Undo and redo are the exception, and only while nothing has been typed. A
 * node added by accident is left with its editor open and its text still
 * empty, so the one thing the user wants next is to take the add back -- and
 * requiring them to click away from the card first, without saying so, is a
 * trap with no way out. Once a character has been typed the card has something
 * of its own to undo, and the platform's own undo is the right answer.
 */
export function survivesEditing(action: ShortcutAction, typed: boolean): boolean {
	if (typed) return false;
	return action === "undo" || action === "redo";
}

/** Every combo more than one action answers to, in table order. */
export function findConflicts(
	bindings: ShortcutBindings,
): Array<{ combo: KeyCombo; actions: ShortcutAction[] }> {
	const groups = new Map<string, { combo: KeyCombo; actions: ShortcutAction[] }>();
	for (const entry of SHORTCUTS) {
		for (const combo of bindings[entry.action]) {
			const spelling = serializeCombo(combo);
			const group = groups.get(spelling);
			if (group) {
				if (!group.actions.includes(entry.action)) group.actions.push(entry.action);
			} else {
				groups.set(spelling, { combo, actions: [entry.action] });
			}
		}
	}
	return [...groups.values()].filter((group) => group.actions.length > 1);
}
