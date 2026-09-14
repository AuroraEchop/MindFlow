import { Platform, PluginSettingTab, Setting } from "obsidian";
import type {
	App,
	ButtonComponent,
	ExtraButtonComponent,
	SettingDefinitionControl,
	SettingDefinitionItem,
	SettingDefinitionRender,
} from "obsidian";
import type { NodeSource, RootPolicy } from "./model/types.ts";
import { t } from "./i18n.ts";
import type { I18nKey, LanguagePreference } from "./i18n.ts";
import type { EdgeStyle } from "./view/edges.ts";
import {
	SHORTCUTS,
	comboToString,
	findConflicts,
	isDefaultBinding,
	recordKey,
	resolveBindings,
	serializeCombo,
	shortcutFor,
} from "./view/shortcuts.ts";
import type {
	KeyCombo,
	Shortcut,
	ShortcutAction,
	ShortcutBindings,
	StoredShortcuts,
} from "./view/shortcuts.ts";
import type MindmapPlugin from "./main.ts";

export type LayoutMode = "balanced" | "right";
export type WheelMode = "zoom" | "pan";
/**
 * Whether a note that was last left as a map opens as one again.
 *
 * `session` is the middle ground: the mark survives the note's tab being closed
 * and reopened, but not Obsidian being closed. `always` writes it down, so the
 * note opens as a map the next morning too.
 */
export type RememberViewMode = "off" | "session" | "always";

/**
 * Where the corner toolbar sits.
 *
 * The three docks are CSS. `free` is wherever the user dragged it to, which is
 * why the coordinates below are settings rather than view state -- the corner
 * should be where they left it the next time a map is opened.
 */
export type ToolbarDock = "bottom-right" | "bottom-centre" | "right" | "free";

export interface MindmapSettings {
	source: NodeSource;
	maxHeadingDepth: number;
	rootPolicy: RootPolicy;
	layout: LayoutMode;
	/** How the connectors between cards are drawn. */
	edgeStyle: EdgeStyle;
	indentUnit: "auto" | "two" | "four" | "tab";
	wheel: WheelMode;
	rememberFolds: boolean;
	/** Whether a note left as a map opens as one again. */
	rememberView: RememberViewMode;
	branchColors: boolean;
	showBodyNodes: boolean;
	inlineAnnotations: boolean;
	maxNodeWidth: number;
	horizontalGap: number;
	verticalGap: number;
	addHeaderButton: boolean;
	/** Where the corner toolbar sits. */
	toolbarDock: ToolbarDock;
	/** The toolbar's position once dragged. Read only while `toolbarDock` is `free`. */
	toolbarX: number;
	toolbarY: number;
	/**
	 * Which language the plugin speaks. `"auto"` follows Obsidian's own
	 * interface language, which is what almost everybody wants.
	 */
	language: LanguagePreference;
	/**
	 * Timing for the render path, in the console and the DevTools Timings track.
	 * Off is the default and costs one boolean branch per call site.
	 */
	debugTiming: boolean;
	/**
	 * Only the shortcuts the user has changed, spelled the way `parseCombo`
	 * reads them. An action missing here answers to its default; an action with
	 * an empty list answers to nothing.
	 */
	shortcuts: StoredShortcuts;
}

export const DEFAULT_SETTINGS: MindmapSettings = {
	source: "headings-and-lists",
	maxHeadingDepth: 6,
	rootPolicy: "auto",
	layout: "balanced",
	edgeStyle: "curve",
	indentUnit: "auto",
	wheel: "zoom",
	rememberFolds: true,
	rememberView: "session",
	branchColors: true,
	showBodyNodes: true,
	inlineAnnotations: true,
	maxNodeWidth: 340,
	horizontalGap: 64,
	verticalGap: 14,
	addHeaderButton: true,
	toolbarDock: "bottom-right",
	toolbarX: 12,
	toolbarY: 12,
	language: "auto",
	debugTiming: false,
	shortcuts: {},
};

/** Returns the literal indent string, or the sentinel `"auto"`. */
export function resolveIndentUnit(settings: MindmapSettings): string {
	switch (settings.indentUnit) {
		case "two":
			return "  ";
		case "four":
			return "    ";
		case "tab":
			return "\t";
		default:
			return "auto";
	}
}

type SettingKey = keyof MindmapSettings;

/** The one setting that redraws the note header rather than the open maps. */
const HEADER_BUTTON_KEY: SettingKey = "addHeaderButton";

/** The one setting that changes the words on every surface at once. */
const LANGUAGE_KEY: SettingKey = "language";

/**
 * A row's description.
 *
 * A builder rather than a ready-made fragment: appending a `DocumentFragment`
 * empties it, so one built here at module scope would describe the first
 * rendering of the tab and nothing after it. Both renderers call it once per
 * row they draw, and Obsidian searches the text it contains either way.
 *
 * The string case is a dictionary key rather than the wording. `GROUPS` is
 * built once when the plugin loads, and the language is a setting -- so a row
 * holding its own words would go on speaking the language the plugin started
 * in for the rest of the session.
 */
type SettingDesc = I18nKey | (() => DocumentFragment);

/** One control's specification, with every label replaced by a dictionary key. */
type ControlSpec =
	| { type: "dropdown"; key: SettingKey; options: Record<string, I18nKey> }
	| { type: "toggle"; key: SettingKey }
	| { type: "slider"; key: SettingKey; min: number; max: number; step: number };

/** A control row, with every user-visible string replaced by a dictionary key. */
interface ControlItem {
	name: I18nKey;
	desc?: SettingDesc;
	control: ControlSpec;
}

interface SettingGroup {
	heading: I18nKey;
	items: ControlItem[];
}

/** What either renderer hands Obsidian for one row's description. */
function describe(desc: SettingDesc | undefined): string | DocumentFragment | undefined {
	if (desc === undefined) return undefined;
	return typeof desc === "function" ? desc() : t(desc);
}

/** A dropdown's labels, resolved. */
function localizeOptions(options: Record<string, I18nKey>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [value, key] of Object.entries(options)) out[value] = t(key);
	return out;
}

/**
 * A row as Obsidian's newer settings API takes it, with the keys resolved.
 *
 * Called per rendering rather than at module scope, for the same reason the
 * descriptions are builders: the language can change while the plugin is
 * loaded, and the rows have to follow it.
 */
function localizeItem(item: ControlItem): SettingDefinitionControl<SettingKey> {
	const shared = { name: t(item.name), desc: describe(item.desc) };
	const control = item.control;
	switch (control.type) {
		case "dropdown":
			return {
				...shared,
				control: {
					type: "dropdown",
					key: control.key,
					options: localizeOptions(control.options),
				},
			};
		case "toggle":
			return { ...shared, control: { type: "toggle", key: control.key } };
		case "slider":
			return {
				...shared,
				control: {
					type: "slider",
					key: control.key,
					min: control.min,
					max: control.max,
					step: control.step,
				},
			};
	}
}

/**
 * The one description that has to spell out its own syntax: an annotation is a
 * convention of this plugin, so nothing in the note the user already has says
 * what a colon at the start of a line will do.
 *
 * Assembled from five translated chunks around four literal code samples. The
 * samples are syntax and stay as they are in both languages; only the prose
 * around them moves, which is why the table carries the sentence in pieces.
 */
function annotationDesc(): DocumentFragment {
	return createFragment((frag) => {
		frag.appendText(t("settings.inlineAnnotations.desc.1"));
		frag.createEl("code", { text: ": text" });
		frag.appendText(t("settings.inlineAnnotations.desc.2"));
		frag.createEl("code", { text: ": Improves during use." });
		frag.appendText(t("settings.inlineAnnotations.desc.3"));
		frag.createEl("code", { text: ": " });
		frag.appendText(t("settings.inlineAnnotations.desc.4"));
		frag.createEl("code", { text: ":" });
		frag.appendText(t("settings.inlineAnnotations.desc.5"));
	});
}

/**
 * Every setting with a plain control, declared once.
 *
 * Obsidian 1.13 renders a settings tab from `getSettingDefinitions()` and skips
 * `display()` entirely when it returns something; older versions know only
 * `display()`. Both paths below read this array, so the two renderings cannot
 * drift, and `minAppVersion` stays at 1.5.0 while 1.13 users still get their
 * settings indexed for search.
 *
 * The Shortcuts group is not here: a row there is a live key capture rather
 * than a control with a value, so both paths hand it to `renderShortcutRow`.
 */
const GROUPS: SettingGroup[] = [
	{
		heading: "settings.group.structure",
		items: [
			{
				name: "settings.source.name",
				desc: "settings.source.desc",
				control: {
					type: "dropdown",
					key: "source",
					options: {
						"headings-and-lists": "settings.source.option.headings-and-lists",
						"headings-only": "settings.source.option.headings-only",
						"lists-only": "settings.source.option.lists-only",
					},
				},
			},
			{
				name: "settings.maxHeadingDepth.name",
				desc: "settings.maxHeadingDepth.desc",
				control: { type: "slider", key: "maxHeadingDepth", min: 1, max: 6, step: 1 },
			},
			{
				name: "settings.rootPolicy.name",
				desc: "settings.rootPolicy.desc",
				control: {
					type: "dropdown",
					key: "rootPolicy",
					options: {
						auto: "settings.rootPolicy.option.auto",
						filename: "settings.rootPolicy.option.filename",
						h1: "settings.rootPolicy.option.h1",
					},
				},
			},
			{
				name: "settings.indentUnit.name",
				desc: "settings.indentUnit.desc",
				control: {
					type: "dropdown",
					key: "indentUnit",
					options: {
						auto: "settings.indentUnit.option.auto",
						two: "settings.indentUnit.option.two",
						four: "settings.indentUnit.option.four",
						tab: "settings.indentUnit.option.tab",
					},
				},
			},
		],
	},
	{
		heading: "settings.group.appearance",
		items: [
			{
				name: "settings.layout.name",
				desc: "settings.layout.desc",
				control: {
					type: "dropdown",
					key: "layout",
					options: {
						balanced: "settings.layout.option.balanced",
						right: "settings.layout.option.right",
					},
				},
			},
			{
				name: "settings.edgeStyle.name",
				desc: "settings.edgeStyle.desc",
				control: {
					type: "dropdown",
					key: "edgeStyle",
					options: {
						curve: "settings.edgeStyle.option.curve",
						orthogonal: "settings.edgeStyle.option.orthogonal",
					},
				},
			},
			{
				name: "settings.branchColors.name",
				desc: "settings.branchColors.desc",
				control: { type: "toggle", key: "branchColors" },
			},
			{
				name: "settings.showBodyNodes.name",
				desc: "settings.showBodyNodes.desc",
				control: { type: "toggle", key: "showBodyNodes" },
			},
			{
				name: "settings.inlineAnnotations.name",
				desc: annotationDesc,
				control: { type: "toggle", key: "inlineAnnotations" },
			},
			{
				name: "settings.toolbarDock.name",
				desc: "settings.toolbarDock.desc",
				control: {
					type: "dropdown",
					key: "toolbarDock",
					options: {
						"bottom-right": "settings.toolbarDock.option.bottom-right",
						"bottom-centre": "settings.toolbarDock.option.bottom-centre",
						right: "settings.toolbarDock.option.right",
						free: "settings.toolbarDock.option.free",
					},
				},
			},
			{
				name: "settings.maxNodeWidth.name",
				control: { type: "slider", key: "maxNodeWidth", min: 140, max: 520, step: 20 },
			},
			{
				name: "settings.horizontalGap.name",
				control: { type: "slider", key: "horizontalGap", min: 24, max: 160, step: 4 },
			},
			{
				name: "settings.verticalGap.name",
				control: { type: "slider", key: "verticalGap", min: 4, max: 60, step: 2 },
			},
		],
	},
	{
		heading: "settings.group.behaviour",
		items: [
			{
				name: "settings.wheel.name",
				control: {
					type: "dropdown",
					key: "wheel",
					options: {
						zoom: "settings.wheel.option.zoom",
						pan: "settings.wheel.option.pan",
					},
				},
			},
			{
				name: "settings.rememberFolds.name",
				desc: "settings.rememberFolds.desc",
				control: { type: "toggle", key: "rememberFolds" },
			},
			{
				name: "settings.rememberView.name",
				desc: "settings.rememberView.desc",
				control: {
					type: "dropdown",
					key: "rememberView",
					options: {
						off: "settings.rememberView.option.off",
						session: "settings.rememberView.option.session",
						always: "settings.rememberView.option.always",
					},
				},
			},
			{
				name: "settings.addHeaderButton.name",
				desc: "settings.addHeaderButton.desc",
				control: { type: "toggle", key: HEADER_BUTTON_KEY },
			},
			{
				name: "settings.language.name",
				desc: "settings.language.desc",
				control: {
					type: "dropdown",
					key: "language",
					options: {
						auto: "settings.language.option.auto",
						en: "settings.language.option.en",
						zh: "settings.language.option.zh",
					},
				},
			},
			{
				name: "settings.debugTiming.name",
				desc: "settings.debugTiming.desc",
				control: { type: "toggle", key: "debugTiming" },
			},
		],
	},
];

/** The row that closes the Shortcuts group, worded once for both renderers. */
const RESTORE_ALL = {
	name: "settings.restoreAll.name",
	desc: "settings.restoreAll.desc",
} as const;

/** What to warn a row about, or "" when its keys are its own. */
function conflictNote(action: ShortcutAction, bindings: ShortcutBindings): string {
	const others = new Set<string>();
	for (const group of findConflicts(bindings)) {
		if (!group.actions.includes(action)) continue;
		for (const other of group.actions) {
			if (other !== action) others.add(t(shortcutFor(other).nameKey));
		}
	}
	if (others.size === 0) return "";
	// Which one wins is not a detail the user can work out from the list: the
	// map answers with whichever action is listed first here.
	return t("settings.shortcut.conflict", { actions: [...others].join(", ") });
}

export class MindmapSettingTab extends PluginSettingTab {
	private readonly plugin: MindmapPlugin;

	constructor(app: App, plugin: MindmapPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// --- Obsidian 1.13 and later ------------------------------------------------

	override getSettingDefinitions(): SettingDefinitionItem[] {
		this.shortcutRows = [];
		const groups: SettingDefinitionItem[] = GROUPS.map((group) => ({
			type: "group" as const,
			heading: t(group.heading),
			items: group.items.map(localizeItem),
		}));
		const rows: SettingDefinitionRender[] = SHORTCUTS.map((entry) => ({
			name: t(entry.nameKey),
			desc: t(entry.descKey),
			render: (setting: Setting) => this.renderShortcutRow(setting, entry),
		}));
		rows.push({
			name: t(RESTORE_ALL.name),
			desc: t(RESTORE_ALL.desc),
			render: (setting: Setting) => this.renderRestoreAll(setting),
		});
		groups.push({ type: "group", heading: t("settings.group.shortcuts"), items: rows });
		return groups;
	}

	/**
	 * Writes the value rather than delegating to `super`. The base implementation
	 * would do the same thing, but calling it is a call into an API newer than
	 * `minAppVersion`, which the directory's review rejects -- and rightly, since
	 * on 1.12 there would be nothing there to call. Overriding a method Obsidian
	 * calls into is free; calling one it may not have is not.
	 */
	override async setControlValue(key: string, value: unknown): Promise<void> {
		await this.commit(key, value);
	}

	// --- Obsidian 1.12 and earlier ----------------------------------------------

	override display(): void {
		const { containerEl } = this;
		this.endRecording();
		this.shortcutRows = [];
		containerEl.empty();

		for (const group of GROUPS) {
			new Setting(containerEl).setName(t(group.heading)).setHeading();
			for (const item of group.items) this.renderItem(containerEl, item);
		}

		new Setting(containerEl).setName(t("settings.group.shortcuts")).setHeading();
		for (const entry of SHORTCUTS) {
			const setting = new Setting(containerEl)
				.setName(t(entry.nameKey))
				.setDesc(t(entry.descKey));
			this.renderShortcutRow(setting, entry);
		}
		this.renderRestoreAll(
			new Setting(containerEl).setName(t(RESTORE_ALL.name)).setDesc(t(RESTORE_ALL.desc)),
		);
	}

	/** A capture still listening when the tab goes away would never stop. */
	override hide(): void {
		this.endRecording();
	}

	private renderItem(containerEl: HTMLElement, item: ControlItem): void {
		const setting = new Setting(containerEl).setName(t(item.name));
		const desc = describe(item.desc);
		if (desc !== undefined) setting.setDesc(desc);

		const control = item.control;
		const commit = (value: string | number | boolean): Promise<void> =>
			this.commit(control.key, value);

		switch (control.type) {
			case "dropdown":
				setting.addDropdown((d) =>
					d
						.addOptions(localizeOptions(control.options))
						.setValue(String(this.read(control.key)))
						.onChange(commit),
				);
				break;
			case "toggle":
				setting.addToggle((box) =>
					box.setValue(this.read(control.key) === true).onChange(commit),
				);
				break;
			case "slider":
				setting.addSlider((s) =>
					s
						.setLimits(control.min, control.max, control.step)
						.setValue(Number(this.read(control.key)))
						.onChange(commit),
				);
				break;
			default:
				// No other control type appears in GROUPS.
				break;
		}
	}

	// --- shortcuts ----------------------------------------------------------------

	/** Repaints for the shortcut rows on screen: one binding affects them all. */
	private shortcutRows: Array<() => void> = [];

	/** Ends the capture in progress. Only ever one row records at a time. */
	private endCapture: (() => void) | null = null;

	/**
	 * One shortcut: what it does, what it answers to, and the buttons that
	 * change that -- record a key, unbind, put the default back.
	 *
	 * Returns the cleanup Obsidian 1.13 calls when it tears the row down, which
	 * is what keeps a repaint from reaching a row that is no longer there.
	 */
	private renderShortcutRow(setting: Setting, entry: Shortcut): () => void {
		setting.settingEl.addClass("mm-shortcut");
		// In `infoEl` rather than `descEl`, which belongs to whichever renderer
		// wrote the description into it.
		const note = setting.infoEl.createDiv({ cls: "mm-shortcut-note" });
		const keys = setting.controlEl.createDiv({ cls: "mm-shortcut-keys" });

		let unbind: ExtraButtonComponent | null = null;
		let reset: ExtraButtonComponent | null = null;
		let record: ButtonComponent | null = null;
		let recording = false;

		const paint = (): void => {
			const bindings = this.bindings();
			const combos = bindings[entry.action];
			keys.empty();
			if (recording) {
				keys.createSpan({
					cls: "mm-shortcut-capture",
					text: t("settings.shortcut.capture"),
				});
			} else if (combos.length === 0) {
				keys.createSpan({ cls: "mm-shortcut-unbound", text: t("settings.shortcut.unbound") });
			} else {
				for (const combo of combos) {
					keys.createEl("kbd", {
						cls: "mm-shortcut-key",
						text: comboToString(combo, Platform.isMacOS),
					});
				}
			}
			unbind?.extraSettingsEl.toggle(combos.length > 0);
			reset?.extraSettingsEl.toggle(!isDefaultBinding(entry.action, combos));
			const conflict = conflictNote(entry.action, bindings);
			note.setText(conflict);
			note.toggle(conflict !== "");
		};

		const stop = (): void => {
			if (!recording) return;
			recording = false;
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("blur", onBlur);
			window.removeEventListener("pointerdown", onPointerDown, true);
			if (this.endCapture === stop) this.endCapture = null;
			setting.settingEl.removeClass("is-recording");
			record?.buttonEl.removeClass("is-recording");
			record?.setButtonText(t("settings.shortcut.record"));
			paint();
		};

		const onKey = (ev: KeyboardEvent): void => {
			const outcome = recordKey(ev);
			// A modifier on its own is half of a combination, not one -- let it
			// pass so the combo it belongs to can still reach whatever else
			// wants it.
			if (outcome === "ignore") return;
			// Captured on the window, ahead of Obsidian's own keymap and the
			// modal's Escape handling, so neither ever sees the key: Escape
			// would otherwise close the settings window on its way past.
			ev.preventDefault();
			ev.stopPropagation();
			stop();
			// Escape is the way out of a capture, so it is the one key a capture
			// cannot record. Everything else is fair game, Delete and Backspace
			// included -- they are what deleting a node is bound to, and the
			// unbind button is what clears a row.
			if (outcome === "cancel") return;
			void this.bind(entry.action, [outcome.combo]);
		};

		/** Losing the window ends a capture the same as Escape would. */
		const onBlur = (): void => stop();

		/** A click anywhere outside this row ends the capture without binding. */
		const onPointerDown = (ev: PointerEvent): void => {
			if (!setting.settingEl.contains(ev.target as Node)) stop();
		};

		const start = (): void => {
			this.endRecording();
			recording = true;
			this.endCapture = stop;
			setting.settingEl.addClass("is-recording");
			record?.buttonEl.addClass("is-recording");
			record?.setButtonText(t("settings.shortcut.cancel"));
			// The button keeps the focus otherwise, and Enter or Space would be
			// read as another click on it before this listener saw them.
			record?.buttonEl.blur();
			window.addEventListener("keydown", onKey, true);
			window.addEventListener("blur", onBlur);
			window.addEventListener("pointerdown", onPointerDown, true);
			paint();
		};

		setting.addExtraButton((button) => {
			unbind = button;
			button
				.setIcon("x")
				.setTooltip(t("settings.shortcut.unbind"))
				.onClick(() => {
					this.endRecording();
					void this.bind(entry.action, []);
				});
		});
		setting.addExtraButton((button) => {
			reset = button;
			button
				.setIcon("rotate-ccw")
				.setTooltip(t("settings.shortcut.restoreDefault"))
				.onClick(() => {
					this.endRecording();
					void this.bind(entry.action, shortcutFor(entry.action).defaults);
				});
		});
		setting.addButton((button) => {
			record = button;
			button.setButtonText(t("settings.shortcut.record")).onClick(() => {
				if (recording) stop();
				else start();
			});
		});

		this.shortcutRows.push(paint);
		paint();

		return () => {
			stop();
			this.shortcutRows = this.shortcutRows.filter((other) => other !== paint);
		};
	}

	private renderRestoreAll(setting: Setting): void {
		setting.settingEl.addClass("mm-shortcut");
		setting.addButton((button) =>
			button.setButtonText(t("settings.restoreAll.button")).onClick(() => {
				this.endRecording();
				void this.writeShortcuts({});
			}),
		);
	}

	private bindings(): ShortcutBindings {
		return resolveBindings(this.plugin.settings.shortcuts);
	}

	private endRecording(): void {
		this.endCapture?.();
	}

	/** Give one action a set of keys; an empty set leaves it unbound. */
	private async bind(action: ShortcutAction, combos: KeyCombo[]): Promise<void> {
		// A whole new map rather than a mutation of the stored one: the setting's
		// value is replaced the way every other setting's is, so the write path
		// stays the same one.
		const next: StoredShortcuts = { ...this.plugin.settings.shortcuts };
		if (isDefaultBinding(action, combos)) delete next[action];
		else next[action] = combos.map(serializeCombo);
		await this.writeShortcuts(next);
	}

	private async writeShortcuts(shortcuts: StoredShortcuts): Promise<void> {
		await this.commit("shortcuts", shortcuts);
		// Every row, not just this one: a key taken from another action changes
		// what that row shows and whether either of them warns.
		for (const paint of this.shortcutRows) paint();
	}

	// --- shared ------------------------------------------------------------------

	/** The single write path, whichever renderer collected the value. */
	private async commit(key: string, value: unknown): Promise<void> {
		this.store[key] = value;
		await this.plugin.saveSettings();
		this.applySideEffects(key);
	}

	private applySideEffects(key: string): void {
		if (key === HEADER_BUTTON_KEY) {
			this.plugin.refreshHeaderButtons();
			return;
		}
		if (key === LANGUAGE_KEY) {
			this.plugin.applyLanguage();
			// Redraw the rows the user is looking at, so they are in the
			// language they just picked rather than the one they arrived in.
			// Both renderers rebuild from the same `GROUPS`, so this is the
			// legacy path doing exactly what it does on open.
			this.display();
			return;
		}
		this.plugin.refreshAllViews();
	}

	/**
	 * Each key is paired with a control whose value type matches it, but the
	 * pairing lives in the definitions rather than in the type, so the settings
	 * object is indexed as a bag of unknowns here and nowhere else.
	 */
	private get store(): Record<string, unknown> {
		return this.plugin.settings as unknown as Record<string, unknown>;
	}

	private read(key: SettingKey): unknown {
		return this.store[key];
	}
}
