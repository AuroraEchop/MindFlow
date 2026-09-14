/**
 * Every word the plugin says, in one place.
 *
 * Nothing here imports `obsidian` -- the tests run these sources through Node's
 * type stripping, where that module does not exist, and a dictionary is the last
 * file that should need a running app to be checked.
 *
 * The English table is the source of truth for two things at once: the wording
 * the plugin shipped with, and the set of keys that exist. `I18nKey` is derived
 * from it, so the Chinese table is typed as `Record<I18nKey, string>` and a key
 * added to one language but not the other is a typecheck failure rather than a
 * blank label somebody notices in a screenshot.
 */

/** The languages the plugin speaks. */
export type Language = "en" | "zh";

/**
 * What the user picked in settings.
 *
 * `"auto"` follows Obsidian's own interface language, which is what almost
 * everybody wants; the other two pin it, which is what a reader who runs
 * Obsidian in one language but reads notes in another wants.
 */
export type LanguagePreference = "auto" | Language;

const EN = {
	// --- shortcuts: the table in `view/shortcuts.ts` -------------------------
	"shortcut.add-child.name": "Add a child",
	"shortcut.add-child.description":
		"Add an empty child to the selected node and start editing it.",
	"shortcut.add-sibling.name": "Add a sibling",
	"shortcut.add-sibling.description":
		"Add an empty node below the selected one, at the same level.",
	"shortcut.edit-title.name": "Edit the title",
	"shortcut.edit-title.description": "Edit the selected node's text in place.",
	"shortcut.delete-node.name": "Delete the node",
	"shortcut.delete-node.description":
		"Delete the selected node and everything under it.",
	"shortcut.toggle-check.name": "Check or uncheck",
	"shortcut.toggle-check.description":
		"Tick the selected list item off, or clear it again. An item with no checkbox gets an empty one; Remove checkbox in the node's context menu takes one away.",
	"shortcut.expand-body.name": "Show the note content",
	"shortcut.expand-body.description":
		"Open the selected node's paragraphs and code blocks whole, rendered, in their own dialog. Unbound by default; the expand button on a content card does the same thing.",
	"shortcut.indent.name": "Indent",
	"shortcut.indent.description":
		"Make the selected node a child of the sibling above it.",
	"shortcut.outdent.name": "Outdent",
	"shortcut.outdent.description":
		"Make the selected node a sibling of its own parent.",
	"shortcut.move-up.name": "Move up among siblings",
	"shortcut.move-up.description":
		"Swap the selected node, subtree and all, with the sibling above it.",
	"shortcut.move-down.name": "Move down among siblings",
	"shortcut.move-down.description":
		"Swap the selected node, subtree and all, with the sibling below it.",
	"shortcut.toggle-fold.name": "Fold or unfold",
	"shortcut.toggle-fold.description": "Hide or show the selected node's children.",
	"shortcut.navigate-up.name": "Select the node above",
	"shortcut.navigate-up.description": "Move the selection to the nearest card above.",
	"shortcut.navigate-down.name": "Select the node below",
	"shortcut.navigate-down.description": "Move the selection to the nearest card below.",
	"shortcut.navigate-left.name": "Select the node to the left",
	"shortcut.navigate-left.description": "Move the selection to the nearest card to the left.",
	"shortcut.navigate-right.name": "Select the node to the right",
	"shortcut.navigate-right.description": "Move the selection to the nearest card to the right.",
	"shortcut.search.name": "Find in the map",
	"shortcut.search.description":
		"Open the find bar over the canvas. Enter and Shift+Enter step through the matches.",
	"shortcut.close-search.name": "Close the find bar",
	"shortcut.close-search.description":
		"Only the map's while a find bar is open; with no bar up the key keeps whatever meaning Obsidian gives it.",
	"shortcut.undo.name": "Undo",
	"shortcut.undo.description": "Undo the last edit made on the map.",
	"shortcut.redo.name": "Redo",
	"shortcut.redo.description": "Redo the last undone edit.",
	"shortcut.fit.name": "Fit to window",
	"shortcut.fit.description": "Frame the whole map in the viewport.",
	"shortcut.zoom-in.name": "Zoom in",
	"shortcut.zoom-in.description": "Zoom the canvas in one step.",
	"shortcut.zoom-out.name": "Zoom out",
	"shortcut.zoom-out.description": "Zoom the canvas out one step.",
	"shortcut.centre-selection.name": "Centre on the selection",
	"shortcut.centre-selection.description":
		"Bring the selected node to the middle of the viewport.",

	// --- settings: the groups in `settings.ts` ------------------------------
	"settings.group.structure": "Structure",
	"settings.group.appearance": "Appearance",
	"settings.group.behaviour": "Behaviour",
	"settings.group.shortcuts": "Shortcuts",

	"settings.source.name": "Nodes come from",
	"settings.source.desc": "Which markdown structures become cards on the map.",
	"settings.source.option.headings-and-lists": "Headings and list items",
	"settings.source.option.headings-only": "Headings only",
	"settings.source.option.lists-only": "List items only",

	"settings.maxHeadingDepth.name": "Deepest heading level",
	"settings.maxHeadingDepth.desc":
		"Headings below this level stay in the note as body content.",

	"settings.rootPolicy.name": "Root node",
	"settings.rootPolicy.desc":
		"Auto uses a lone top-level heading when the note has one, and the file name otherwise.",
	"settings.rootPolicy.option.auto": "Auto",
	"settings.rootPolicy.option.filename": "Always the file name",
	"settings.rootPolicy.option.h1": "Always the first H1",

	"settings.indentUnit.name": "Indent for new list items",
	"settings.indentUnit.desc": "Auto copies whatever the note already uses.",
	"settings.indentUnit.option.auto": "Auto-detect",
	"settings.indentUnit.option.two": "Two spaces",
	"settings.indentUnit.option.four": "Four spaces",
	"settings.indentUnit.option.tab": "Tab",

	"settings.layout.name": "Layout",
	"settings.layout.desc": "Balanced splits top-level branches to both sides of the root.",
	"settings.layout.option.balanced": "Balanced (both sides)",
	"settings.layout.option.right": "Single side (right)",

	"settings.branchColors.name": "Colour branches",
	"settings.branchColors.desc": "Give each top-level branch its own colour.",

	"settings.showBodyNodes.name": "Show note content",
	"settings.showBodyNodes.desc":
		"Paragraphs, code blocks and tables become their own cards, so they fold and unfold with the branch they belong to. Use the expand button on a card to see the whole block rendered, or double-click it to edit.",

	"settings.inlineAnnotations.name": "Inline annotations",
	"settings.inlineAnnotations.desc.1": "A body line written as ",
	"settings.inlineAnnotations.desc.2":
		" under a heading or list item hangs under that node's card in muted text instead of becoming a card of its own — a bullet followed by ",
	"settings.inlineAnnotations.desc.3": " carries that line as its note. Consecutive ",
	"settings.inlineAnnotations.desc.4": " lines keep their line breaks, and a lone ",
	"settings.inlineAnnotations.desc.5":
		" is a blank line between them. Obsidian's own editing and reading views show such a line as an ordinary paragraph that starts with a colon. Double-click an annotation on the map, or pick Add annotation from a node's context menu, to edit one — the colon prefixes are written back to the note for you. Turn this off to read those lines as ordinary body cards again.",

	"settings.maxNodeWidth.name": "Maximum card width",
	"settings.horizontalGap.name": "Horizontal spacing",
	"settings.verticalGap.name": "Vertical spacing",

	"settings.wheel.name": "Mouse wheel",
	"settings.wheel.option.zoom": "Zooms (hold Shift to pan)",
	"settings.wheel.option.pan": "Pans (hold Ctrl to zoom)",

	"settings.rememberFolds.name": "Remember fold state",
	"settings.rememberFolds.desc":
		"Reopen a note to the shape you left it in, focus included. The state is kept in the plugin's own data, never in the note — your markdown is untouched either way. Turn this off and every map opens at the root plus its top-level branches.",

	"settings.addHeaderButton.name": "Button in the note header",
	"settings.addHeaderButton.desc":
		"Adds a mind map toggle beside the other view actions. The command and ribbon icon work either way.",

	"settings.debugTiming.name": "Log render timings",
	"settings.debugTiming.desc":
		"Write how long each paint, cull and connector redraw took to the developer console, and to the Timings track of a performance profile. For diagnosing a slow map; leave it off otherwise.",

	"settings.language.name": "Language",
	"settings.language.desc":
		"Follow Obsidian's interface language, or pin the plugin to one language.",
	"settings.language.option.auto": "Follow Obsidian",
	"settings.language.option.en": "English",
	"settings.language.option.zh": "简体中文",

	"settings.shortcut.capture": "Press any key — Esc cancels",
	"settings.shortcut.unbound": "Not bound",
	"settings.shortcut.record": "Record",
	"settings.shortcut.cancel": "Cancel",
	"settings.shortcut.unbind": "Unbind",
	"settings.shortcut.restoreDefault": "Restore the default",
	"settings.shortcut.conflict":
		"Also bound to {actions} — the one listed first is the one that answers.",

	"settings.restoreAll.name": "Restore all defaults",
	"settings.restoreAll.desc": "Put every shortcut back to the key the map shipped with.",
	"settings.restoreAll.button": "Restore",
} as const;

/** Every key the plugin knows. Derived from the English table, so it cannot drift. */
export type I18nKey = keyof typeof EN;

/** The Chinese wording, key for key. A missing key is a typecheck failure. */
const ZH: Record<I18nKey, string> = {
	// --- 快捷键 --------------------------------------------------------------
	"shortcut.add-child.name": "添加子节点",
	"shortcut.add-child.description": "在选中节点下添加一个空子节点，并立即进入编辑。",
	"shortcut.add-sibling.name": "添加同级节点",
	"shortcut.add-sibling.description": "在选中节点下方、同一层级添加一个空节点。",
	"shortcut.edit-title.name": "编辑标题",
	"shortcut.edit-title.description": "就地编辑选中节点的文字。",
	"shortcut.delete-node.name": "删除节点",
	"shortcut.delete-node.description": "删除选中节点及其下的全部内容。",
	"shortcut.toggle-check.name": "勾选或取消勾选",
	"shortcut.toggle-check.description":
		"勾选选中的列表项，或再次取消。没有复选框的项会补上一个空复选框；节点右键菜单里的「移除复选框」可以把它去掉。",
	"shortcut.expand-body.name": "查看笔记正文",
	"shortcut.expand-body.description":
		"在独立对话框中完整渲染选中节点的段落与代码块。默认未绑定快捷键；正文卡片上的展开按钮效果相同。",
	"shortcut.indent.name": "降级",
	"shortcut.indent.description": "把选中节点变成上方同级节点的子节点。",
	"shortcut.outdent.name": "升级",
	"shortcut.outdent.description": "把选中节点变成其父节点的同级节点。",
	"shortcut.move-up.name": "在同级中上移",
	"shortcut.move-up.description": "把选中节点连同整棵子树，与上方同级节点互换位置。",
	"shortcut.move-down.name": "在同级中下移",
	"shortcut.move-down.description": "把选中节点连同整棵子树，与下方同级节点互换位置。",
	"shortcut.toggle-fold.name": "折叠或展开",
	"shortcut.toggle-fold.description": "隐藏或显示选中节点的子节点。",
	"shortcut.navigate-up.name": "选中上方节点",
	"shortcut.navigate-up.description": "把选中状态移到上方最近的卡片。",
	"shortcut.navigate-down.name": "选中下方节点",
	"shortcut.navigate-down.description": "把选中状态移到下方最近的卡片。",
	"shortcut.navigate-left.name": "选中左侧节点",
	"shortcut.navigate-left.description": "把选中状态移到左侧最近的卡片。",
	"shortcut.navigate-right.name": "选中右侧节点",
	"shortcut.navigate-right.description": "把选中状态移到右侧最近的卡片。",
	"shortcut.search.name": "在导图中查找",
	"shortcut.search.description":
		"在画布上打开查找栏。Enter 与 Shift+Enter 在匹配项之间前后跳转。",
	"shortcut.close-search.name": "关闭查找栏",
	"shortcut.close-search.description":
		"仅在查找栏打开时由导图接管；没有查找栏时，该键保持 Obsidian 原本的含义。",
	"shortcut.undo.name": "撤销",
	"shortcut.undo.description": "撤销在导图上做的上一次修改。",
	"shortcut.redo.name": "重做",
	"shortcut.redo.description": "重做上一次被撤销的修改。",
	"shortcut.fit.name": "适应窗口",
	"shortcut.fit.description": "让整张导图完整显示在视口内。",
	"shortcut.zoom-in.name": "放大",
	"shortcut.zoom-in.description": "把画布放大一档。",
	"shortcut.zoom-out.name": "缩小",
	"shortcut.zoom-out.description": "把画布缩小一档。",
	"shortcut.centre-selection.name": "居中显示选中节点",
	"shortcut.centre-selection.description": "把选中节点移到视口正中央。",

	// --- 设置 -----------------------------------------------------------------
	"settings.group.structure": "结构",
	"settings.group.appearance": "外观",
	"settings.group.behaviour": "行为",
	"settings.group.shortcuts": "快捷键",

	"settings.source.name": "节点来源",
	"settings.source.desc": "哪些 Markdown 结构会成为导图上的卡片。",
	"settings.source.option.headings-and-lists": "标题和列表项",
	"settings.source.option.headings-only": "仅标题",
	"settings.source.option.lists-only": "仅列表项",

	"settings.maxHeadingDepth.name": "最深层级标题",
	"settings.maxHeadingDepth.desc": "低于该层级的标题会留在笔记中，作为正文内容。",

	"settings.rootPolicy.name": "根节点",
	"settings.rootPolicy.desc":
		"自动：笔记只有一个顶级标题时用它，否则用文件名。",
	"settings.rootPolicy.option.auto": "自动",
	"settings.rootPolicy.option.filename": "始终用文件名",
	"settings.rootPolicy.option.h1": "始终用第一个一级标题",

	"settings.indentUnit.name": "新建列表项的缩进",
	"settings.indentUnit.desc": "自动：沿用笔记中已有的缩进方式。",
	"settings.indentUnit.option.auto": "自动检测",
	"settings.indentUnit.option.two": "两个空格",
	"settings.indentUnit.option.four": "四个空格",
	"settings.indentUnit.option.tab": "制表符",

	"settings.layout.name": "布局",
	"settings.layout.desc": "均衡布局把顶级分支分到根节点的两侧。",
	"settings.layout.option.balanced": "均衡（两侧）",
	"settings.layout.option.right": "单侧（右侧）",

	"settings.branchColors.name": "分支着色",
	"settings.branchColors.desc": "让每个顶级分支拥有各自的颜色。",

	"settings.showBodyNodes.name": "显示笔记正文",
	"settings.showBodyNodes.desc":
		"段落、代码块和表格会成为独立卡片，随所属分支一起折叠展开。点击卡片上的展开按钮可查看整块的渲染结果，双击可编辑。",

	"settings.inlineAnnotations.name": "行内注解",
	"settings.inlineAnnotations.desc.1": "在标题或列表项下写成 ",
	"settings.inlineAnnotations.desc.2":
		" 的正文行，会以浅色文字挂在那个节点的卡片下方，而不是成为独立卡片 —— 列表项后跟 ",
	"settings.inlineAnnotations.desc.3": " 就把该行作为它的注解。连续的 ",
	"settings.inlineAnnotations.desc.4": " 行会保留换行，单独的 ",
	"settings.inlineAnnotations.desc.5":
		" 表示它们之间的空行。Obsidian 自身的编辑和阅读视图会把这样的行显示为以冒号开头的普通段落。在导图上双击注解，或从节点右键菜单选择「添加注解」即可编辑 —— 冒号前缀会替你写回笔记。关闭此项后，这些行会重新作为普通正文卡片显示。",

	"settings.maxNodeWidth.name": "卡片最大宽度",
	"settings.horizontalGap.name": "水平间距",
	"settings.verticalGap.name": "垂直间距",

	"settings.wheel.name": "鼠标滚轮",
	"settings.wheel.option.zoom": "缩放（按住 Shift 平移）",
	"settings.wheel.option.pan": "平移（按住 Ctrl 缩放）",

	"settings.rememberFolds.name": "记住折叠状态",
	"settings.rememberFolds.desc":
		"重新打开笔记时恢复成你离开时的形态，包括选中状态。状态存在插件自己的数据里，绝不写入笔记 —— 无论开关如何，你的 Markdown 都不会被改动。关闭后，每张导图都只展开根节点和它的顶级分支。",

	"settings.addHeaderButton.name": "笔记标题栏按钮",
	"settings.addHeaderButton.desc":
		"在其他视图操作旁添加一个导图切换按钮。无论开关如何，命令和侧边栏图标都能使用。",

	"settings.debugTiming.name": "记录渲染耗时",
	"settings.debugTiming.desc":
		"把每次绘制、裁剪和连线重绘的耗时写入开发者控制台，并记入性能分析的 Timings 轨道。用于排查导图卡顿，平时保持关闭。",

	"settings.language.name": "界面语言",
	"settings.language.desc": "跟随 Obsidian 的界面语言，或把插件固定为某一种语言。",
	"settings.language.option.auto": "跟随 Obsidian",
	"settings.language.option.en": "English",
	"settings.language.option.zh": "简体中文",

	"settings.shortcut.capture": "按下任意键 —— Esc 取消",
	"settings.shortcut.unbound": "未绑定",
	"settings.shortcut.record": "录制",
	"settings.shortcut.cancel": "取消",
	"settings.shortcut.unbind": "解除绑定",
	"settings.shortcut.restoreDefault": "恢复默认",
	"settings.shortcut.conflict": "同时也绑定到 {actions} —— 列表中靠前的那个生效。",

	"settings.restoreAll.name": "全部恢复默认",
	"settings.restoreAll.desc": "把所有快捷键恢复到导图出厂时的按键。",
	"settings.restoreAll.button": "恢复",
};

/** Both tables, keyed by language. Exported so a test can walk them. */
export const DICTIONARIES: Record<Language, Record<I18nKey, string>> = { en: EN, zh: ZH };

/** What the plugin speaks before anything has told it otherwise. */
const FALLBACK: Language = "en";

/** Where Obsidian keeps the interface language, in its own words. */
const LANGUAGE_KEY = "language";

let current: Language = FALLBACK;

/**
 * Reads a language tag down to the two the plugin has words for.
 *
 * Obsidian reports the full tag -- `"zh"`, `"zh-TW"`, `"en-GB"` -- and a
 * Simplified table is the only Chinese one there is, so every `zh` variant
 * lands on it rather than falling through to English.
 */
export function normalizeLanguage(raw: string | null | undefined): Language {
	if (typeof raw !== "string") return FALLBACK;
	const tag = raw.trim().toLowerCase();
	if (tag === "") return FALLBACK;
	if (tag === "zh" || tag.startsWith("zh-") || tag.startsWith("zh_")) return "zh";
	return "en";
}

/**
 * What Obsidian is running in, or English when nothing can be read.
 *
 * `localStorage` is the only place the setting is reachable from a plugin, and
 * it is read defensively: the property can be absent (Node, a test) or throw
 * (a hardened renderer), and a missing translation table is not worth a crash.
 */
export function detectLanguage(): Language {
	try {
		const stored = globalThis.localStorage?.getItem(LANGUAGE_KEY);
		if (typeof stored === "string" && stored.trim() !== "") return normalizeLanguage(stored);
	} catch {
		// Storage refused; fall through to the default.
	}
	return FALLBACK;
}

/** The language a preference resolves to, with `"auto"` asking Obsidian. */
export function resolveLanguage(preference: LanguagePreference): Language {
	return preference === "auto" ? detectLanguage() : preference;
}

/** The language the plugin is speaking right now. */
export function getLanguage(): Language {
	return current;
}

/**
 * Point the plugin at a language.
 *
 * Deliberately module state rather than a parameter threaded through every
 * call site: `t` is read from a hundred places that have no opinion about
 * language, and the one place that does -- the settings tab -- is what calls
 * this and then repaints.
 */
export function setLanguage(language: Language): void {
	current = language;
}

/** `{name}` placeholders, which is the whole of the templating. */
const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * The words for a key, with any placeholders filled in.
 *
 * Falls back to English before falling back to the key itself, so a table that
 * lost a row shows English rather than `settings.foo.desc` on screen.
 */
export function t(key: I18nKey, params?: Record<string, string | number>): string {
	const template = DICTIONARIES[current][key] ?? EN[key] ?? key;
	if (params === undefined) return template;
	return template.replace(PLACEHOLDER, (whole, name: string) =>
		Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
	);
}
