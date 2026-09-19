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
	"shortcut.edit-annotation.name": "Add or edit the annotation",
	"shortcut.edit-annotation.description":
		"Open the note under the selected node for editing, or start one where there is none. The same as double-clicking an annotation.",
	"shortcut.insert-block.name": "Add a text block",
	"shortcut.insert-block.description":
		"Write an indented block of prose under the selected node. It belongs to the node and folds with it, but carries no marker, so a long explanation does not read as a bullet.",
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
		"Make the selected node a child of the sibling above it. Ctrl/Cmd+Shift+Tab, pairing the Shift+Tab outdent; it shipped on `]` once, a key that never arrives through an input method.",
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
	"shortcut.toggle-fold.description":
		"Hide or show the selected node's children. The same key held down is the pan modifier — held and dragged it moves the map instead, and the fold waits for the release, so it fires only when the key was tapped.",
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
	"shortcut.replace.name": "Find and replace",
	"shortcut.replace.description":
		"Open the find bar with the replace row already showing. Enter in the replace field changes every match; the row's two buttons change one card or all of them.",
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
	"settings.group.preference": "Preferences",
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

	"settings.edgeStyle.name": "Branch connectors",
	"settings.edgeStyle.desc": "Curved reads as a mind map; right-angled as a hierarchy.",
	"settings.edgeStyle.option.curve": "Curved",
	"settings.edgeStyle.option.orthogonal": "Right-angled",

	"settings.cardStyle.name": "Card style",
	"settings.cardStyle.desc":
		"Bordered draws a border and background on every card, and shapes each level differently. Rounded gives the whole map one kind of card — the same quiet slab at every depth. Minimal draws nothing at rest; a card is its text until it is picked.",
	"settings.cardStyle.option.bordered": "Bordered",
	"settings.cardStyle.option.rounded": "Rounded card",
	"settings.cardStyle.option.minimal": "Minimal",

	"settings.branchColors.name": "Colour branches",
	"settings.branchColors.desc": "Give each top-level branch its own colour.",

	"settings.palette.name": "Branch palette",
	"settings.palette.desc":
		"Which ten colours the branches are drawn in. The theme palette reads the vault's own colours, so the map matches the rest of the interface.",
	"settings.palette.option.classic": "Classic",
	"settings.palette.option.theme": "Follow the theme",

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

	"settings.renderMedia.name": "Show pictures and videos",
	"settings.renderMedia.desc":
		"Draw an embedded image or video on the card instead of a chip carrying its name. Only files in the vault are drawn — a remote address in a note stays the chip it has always been — and the chip is still what a PDF, a note or an audio file becomes.",

	"settings.mediaMaxHeight.name": "Maximum media height",
	"settings.mediaMaxHeight.desc":
		"The tallest a picture or a video may be drawn, in pixels. A picture narrower than the card is never stretched to fill it.",

	"settings.toolbarVisibility.name": "Corner toolbar",
	"settings.toolbarVisibility.desc":
		"When the zoom, search and settings buttons are shown. On selection keeps them out of the way until a card is picked; always leaves them where they have always been.",
	"settings.toolbarVisibility.option.selection": "Only while a card is selected",
	"settings.toolbarVisibility.option.always": "Always",

	"settings.toolbarDock.name": "Corner toolbar position",
	"settings.toolbarDock.desc":
		"Where the buttons sit. Drag the toolbar itself to move it anywhere; the dock follows the drag and remembers where you left it.",
	"settings.toolbarDock.option.bottom-right": "Bottom right",
	"settings.toolbarDock.option.bottom-centre": "Bottom centre",
	"settings.toolbarDock.option.right": "Right edge",
	"settings.toolbarDock.option.free": "Wherever I dragged it",

	"settings.maxNodeWidth.name": "Maximum card width",
	"settings.horizontalGap.name": "Horizontal spacing",
	"settings.verticalGap.name": "Vertical spacing",

	"settings.wheel.name": "Mouse wheel",
	"settings.wheel.option.zoom": "Zooms (hold Shift to pan)",
	"settings.wheel.option.pan": "Pans (hold Ctrl to zoom)",

	"settings.dragToPan.name": "Drag mode",
	"settings.dragToPan.desc":
		"Off, a drag on blank canvas draws a selection box, and the map is moved with the pan key (hold Space and drag), with Shift and the wheel, or with the middle button. On, a drag moves the map and the selection box moves to Shift and drag. Shift and a click adds a card to the selection either way.",

	"settings.rememberFolds.name": "Remember fold state",
	"settings.rememberFolds.desc":
		"Reopen a note to the shape you left it in, focus included. The state is kept in the plugin's own data, never in the note — your markdown is untouched either way. Turn this off and every map opens at the root plus its top-level branches.",

	"settings.rememberView.name": "Reopen as a mind map",
	"settings.rememberView.desc":
		"A note you last left showing the map opens showing the map again rather than the editor. Off leaves every note to open as markdown.",
	"settings.rememberView.option.off": "Never",
	"settings.rememberView.option.session": "Until Obsidian is closed",
	"settings.rememberView.option.always": "Always",

	"settings.addHeaderButton.name": "Button in the note header",	"settings.addHeaderButton.desc":
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

	// --- the actions that reach the map -------------------------------------
	"view.action.toggleView": "Toggle mind map view",
	"view.action.openMap": "Open as mind map",
	"view.action.editMarkdown": "Edit as markdown",
	"view.action.fitWindow": "Fit map to window",

	// --- the corner toolbar -------------------------------------------------
	"view.tool.expandAll": "Expand all",
	"view.tool.collapseAll": "Collapse all",
	"view.tool.shortcuts": "Keyboard shortcuts",
	"view.tool.export": "Export",
	"view.tool.settings": "Settings",
	"view.block.placeholder": "Text block",
	"view.node.placeholder": "Type something",

	// --- the furniture on a card, read out by a screen reader ---------------
	"view.node.expand": "Expand",
	"view.node.collapse": "Collapse",
	"view.body.expand": "Show the whole block",
	"view.body.collapse": "Collapse the block to its first line",
	"view.code.copy": "Copy the code",
	"view.code.copied": "Copied",
	"view.node.annotationAria": "Annotation (double-click to edit)",
	"view.media.play": "Play here",
	"view.media.open": "Open in Obsidian's player",
	"view.media.preview": "Preview",
	"view.lightbox.close": "Close the preview",

	// --- a callout's title, when the note wrote none ------------------------
	// Obsidian's own list of types, which is also the set that gets an icon.
	// A type outside it is drawn with the word the note wrote instead.
	"view.callout.note": "Note",
	"view.callout.abstract": "Abstract",
	"view.callout.info": "Info",
	"view.callout.todo": "Todo",
	"view.callout.tip": "Tip",
	"view.callout.success": "Success",
	"view.callout.question": "Question",
	"view.callout.warning": "Warning",
	"view.callout.failure": "Failure",
	"view.callout.danger": "Danger",
	"view.callout.bug": "Bug",
	"view.callout.example": "Example",
	"view.callout.quote": "Quote",

	// --- the shortcut panel -------------------------------------------------
	"view.shortcuts.title": "Mind map shortcuts",
	"view.shortcuts.footer": "Every key above can be changed in the plugin's settings.",
	"view.shortcuts.mouse.edit.keys": "Double-click a card",
	"view.shortcuts.mouse.edit.what": "Edit the node",
	"view.shortcuts.mouse.link.keys": "Click a link in a content card",
	"view.shortcuts.mouse.link.what": "Open it",
	"view.shortcuts.mouse.reveal.keys": "Ctrl/Cmd+click a card",
	"view.shortcuts.mouse.reveal.what": "Show where it is written in the note",
	"view.shortcuts.mouse.add.keys": "+ beside a card",
	"view.shortcuts.mouse.add.what": "New child",
	"view.shortcuts.mouse.menu.keys": "Right-click a card",
	"view.shortcuts.mouse.menu.what": "The node's menu",
	"view.shortcuts.mouse.reparent.keys": "Drag onto a card",
	"view.shortcuts.mouse.reparent.what": "Reparent it",
	"view.shortcuts.mouse.reorder.keys": "Drag onto a card's top / bottom edge",
	"view.shortcuts.mouse.reorder.what": "Reorder it beside that card",
	"view.shortcuts.mouse.zoom.keys": "Wheel / pinch",
	"view.shortcuts.mouse.zoom.what": "Zoom",
	"view.shortcuts.mouse.pan.keys": "Space + drag",
	"view.shortcuts.mouse.pan.plainKeys": "Drag blank space",
	"view.shortcuts.mouse.pan.what": "Move the map",
	"view.shortcuts.mouse.band.keys": "Drag blank space",
	"view.shortcuts.mouse.band.shiftKeys": "Shift + drag blank space",
	"view.shortcuts.mouse.band.what": "Draw a box; every card it covers joins the selection",
	"view.shortcuts.mouse.multi.keys": "Shift + click a card",
	"view.shortcuts.mouse.multi.what": "Add it to the selection, or drop it again",
	"view.shortcuts.mouse.dragGroup.keys": "Drag one of several selected cards",
	"view.shortcuts.mouse.dragGroup.what":
		"Move all of them, keeping the order they are written in",

	// --- a node's context menu ----------------------------------------------
	"view.menu.showBlock": "Show the whole block",
	"view.menu.editBlock": "Edit the block source",
	"view.menu.addChild": "Add child",
	"view.menu.editAnnotation": "Edit annotation",
	"view.menu.addAnnotation": "Add annotation",
	"view.menu.addCheckbox": "Add checkbox",
	"view.menu.removeCheckbox": "Remove checkbox",
	"view.menu.addSiblingBelow": "Add sibling below",
	"view.menu.addSiblingAbove": "Add sibling above",
	"view.menu.fold": "Fold",
	"view.menu.unfold": "Unfold",
	"view.menu.rename": "Rename",
	"view.menu.delete": "Delete",
	"view.menu.linkToNote": "Link to a note…",
	"view.menu.createNote": "New note from this node",
	"view.menu.unlink": "Remove the link",
	"view.menu.openLink": "Open the linked note",

	// --- what the map says when it will not do something --------------------
	"view.notice.rootRename": "This node is the file name. Rename the note to change it.",
	"view.notice.rootDelete": "The root node cannot be deleted from the map.",
	"view.notice.blockRefused":
		"This node is not one the note holds, so there is nowhere to write a block under it.",
	"view.notice.nothingToUndo": "Nothing to undo on the map.",
	"view.notice.annotationChanged":
		"This annotation changed while the editor was open. Copy your draft and reopen it before saving.",
	"view.notice.cannotLink": "Only a node the note owns can hold a link.",
	"view.notice.noteCreated": "Created {name}",
	"view.notice.noteCreateFailed": "Could not create that note. See the console for the reason.",

	// --- linking a node to another note -------------------------------------
	"view.link.pick": "Link this node to which note?",

	// --- the settings window ------------------------------------------------
	"dialog.settings.title": "Mind map settings",

	// --- the find bar -------------------------------------------------------
	"search.regex": "Regular expression",
	"search.previous": "Previous match",
	"search.next": "Next match",
	"search.close": "Close search",
	"search.replace": "Show the replace row",
	"search.replaceWith": "Replace with",
	"search.replaceOne": "Replace in this card",
	"search.replaceAll": "Replace all",
	"search.replaced": "Replaced {count}",

	// --- the commands the plugin registers ----------------------------------
	"command.forgetFold": "Forget the saved fold state for this note",
	"command.search": "Find in the mind map",
	"command.replace": "Find and replace in the mind map",
	"command.moveUp": "Move the selected node up among its siblings",
	"command.moveDown": "Move the selected node down among its siblings",
	"command.openAsMindmap": "Open current note as a mind map",
	"command.revealLineOnMap": "Reveal the line at the cursor on the map",
	"command.settings": "Open the mind map settings",
	"command.insertAnnotation": "Insert an annotation line (in markdown editor)",
	"command.linkToNote": "Link the selected node to a note",
	"command.createNote": "Create a note from the selected node",
	"command.unlink": "Remove the link from the selected node",

	// --- what the plugin says at load ---------------------------------------
	"main.notice.onlyMarkdown": "Only markdown notes can be shown as a mind map.",
	"main.notice.update":
		"MindFlow was updated. A line written as \": text\" under a heading or list item now hangs under that node's card as an annotation instead of becoming a card of its own. Settings → MindFlow → Appearance → Inline annotations turns it off.",

	"main.notice.dragMode":
		"Drag mode is on: a drag on blank canvas now moves the map, and the selection box has moved to Shift and drag. With it off it was the other way round — a drag drew the box, and holding Space moved the map. Settings → MindFlow → Preferences → Drag mode turns it back off.",

	// --- the export, one pair of keys per format ----------------------------
	"export.canvas.name": "Export mind map as Canvas",
	"export.canvas.menu": "Export as Canvas",
	"export.svg.name": "Export mind map as SVG",
	"export.svg.menu": "Export as SVG",
	"export.png.name": "Export mind map as PNG",
	"export.png.menu": "Export as PNG",
	"export.html.name": "Export mind map as HTML",
	"export.html.menu": "Export as HTML",
	"export.notice.nothing": "Nothing to export",
	"export.notice.done": "Mind map exported to {path}",
	"export.notice.doneScaled":
		"Mind map exported to {path}, scaled down to stay within 16384 px",
	"export.notice.failed": "Mind map export failed: {reason}",
	"export.untitled": "Untitled",
	"export.error.rasterize": "The map could not be rendered as an image.",
	"export.error.noCanvas": "This platform has no 2D canvas to draw on.",
	"export.error.encode": "The image could not be encoded as a PNG.",
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
	"shortcut.edit-annotation.name": "添加或编辑注解",
	"shortcut.edit-annotation.description":
		"编辑选中节点下方的注解，没有则新建。等同于双击注解。",
	"shortcut.insert-block.name": "添加文字块",
	"shortcut.insert-block.description":
		"在选中节点下写入一段缩进文字。它属于该节点、跟随折叠，但不带任何 Markdown 标记，所以长段说明不会看起来像一个列表项。",
	"shortcut.delete-node.name": "删除节点",
	"shortcut.delete-node.description": "删除选中节点及其下的全部内容。",
	"shortcut.toggle-check.name": "勾选或取消勾选",
	"shortcut.toggle-check.description":
		"勾选选中的列表项，或再次取消。没有复选框的项会补上一个空复选框；节点右键菜单里的「移除复选框」可以把它去掉。",
	"shortcut.expand-body.name": "查看笔记正文",
	"shortcut.expand-body.description":
		"在独立对话框中完整渲染选中节点的段落与代码块。默认未绑定快捷键；正文卡片上的展开按钮效果相同。",
	"shortcut.indent.name": "降级",
	"shortcut.indent.description":
		"把选中节点变成上方同级节点的子节点。Ctrl/Cmd+Shift+Tab，与 Shift+Tab 升级成对；早期版本曾用「]」，但那个键在输入法开启时根本到不了导图。",
	"shortcut.outdent.name": "升级",
	"shortcut.outdent.description": "把选中节点变成其父节点的同级节点。",
	"shortcut.move-up.name": "在同级中上移",
	"shortcut.move-up.description": "把选中节点连同整棵子树，与上方同级节点互换位置。",
	"shortcut.move-down.name": "在同级中下移",
	"shortcut.move-down.description": "把选中节点连同整棵子树，与下方同级节点互换位置。",
	"shortcut.toggle-fold.name": "折叠或展开",
	"shortcut.toggle-fold.description":
		"隐藏或显示选中节点的子节点。同一个键按住不放时是平移修饰键 —— 按住拖动改为移动画面，折叠则推迟到松手时才判定，所以只有「点一下」才会触发。",
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
	"shortcut.replace.name": "查找替换",
	"shortcut.replace.description":
		"打开查找栏并直接展开替换行。在替换框里按回车替换全部匹配；这一行的两个按钮分别替换当前卡片和全部卡片。",
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
	"settings.group.preference": "偏好",
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

	"settings.edgeStyle.name": "分支连线",
	"settings.edgeStyle.desc": "曲线更像思维导图，直角更像层级图。",
	"settings.edgeStyle.option.curve": "曲线",
	"settings.edgeStyle.option.orthogonal": "直角",

	"settings.cardStyle.name": "卡片样式",
	"settings.cardStyle.desc":
		"边框：每张卡片都有边框和背景，各层级造型不同。圆角卡片：整张导图只留一种卡片——各层级都是同样的浅灰圆角块。极简：静止时不画任何东西，卡片就是它上面的文字，选中后才出现一个框。",
	"settings.cardStyle.option.bordered": "边框",
	"settings.cardStyle.option.rounded": "圆角卡片",
	"settings.cardStyle.option.minimal": "极简",

	"settings.branchColors.name": "分支着色",
	"settings.branchColors.desc": "让每个顶级分支拥有各自的颜色。",

	"settings.palette.name": "分支配色",
	"settings.palette.desc":
		"分支使用哪十种颜色。主题配色会读取仓库自身的颜色，让导图和界面其余部分保持一致。",
	"settings.palette.option.classic": "经典",
	"settings.palette.option.theme": "跟随主题",

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

	"settings.renderMedia.name": "显示图片和视频",
	"settings.renderMedia.desc":
		"把嵌入的图片或视频直接画在卡片上，而不是显示成一个带文件名的标签。只画笔记库里的文件 —— 笔记里写的远程地址仍然是标签 —— PDF、笔记、音频文件也仍然是标签。",

	"settings.mediaMaxHeight.name": "媒体最大高度",
	"settings.mediaMaxHeight.desc":
		"图片和视频最高画多少像素。比卡片还窄的图片不会被拉伸填满。",

	"settings.toolbarVisibility.name": "角落工具栏",
	"settings.toolbarVisibility.desc":
		"缩放、搜索、设置这些按钮何时显示。「仅选中时」会让它们先让开，直到选中某张卡片；「始终」则一直留在原来的位置。",
	"settings.toolbarVisibility.option.selection": "仅选中卡片时",
	"settings.toolbarVisibility.option.always": "始终显示",

	"settings.toolbarDock.name": "角落工具栏位置",
	"settings.toolbarDock.desc":
		"按钮停靠的位置。直接拖动工具栏本身即可移动；停靠方式会跟随拖动，并记住你放下的位置。",
	"settings.toolbarDock.option.bottom-right": "右下角",
	"settings.toolbarDock.option.bottom-centre": "底部居中",
	"settings.toolbarDock.option.right": "右侧边缘",
	"settings.toolbarDock.option.free": "我拖动到的位置",

	"settings.maxNodeWidth.name": "卡片最大宽度",
	"settings.horizontalGap.name": "水平间距",
	"settings.verticalGap.name": "垂直间距",

	"settings.wheel.name": "鼠标滚轮",
	"settings.wheel.option.zoom": "缩放（按住 Shift 平移）",
	"settings.wheel.option.pan": "平移（按住 Ctrl 缩放）",

	"settings.dragToPan.name": "拖动模式",
	"settings.dragToPan.desc":
		"关闭时，在空白处拖动是框选，平移画布要按住 Space 再拖，或者用 Shift 加滚轮、鼠标中键。开启后，拖动就是平移，框选改成 Shift 加拖动。两种情况里 Shift 加点击都是给选中加一张卡片。",

	"settings.rememberFolds.name": "记住折叠状态",
	"settings.rememberFolds.desc":
		"重新打开笔记时恢复成你离开时的形态，包括选中状态。状态存在插件自己的数据里，绝不写入笔记 —— 无论开关如何，你的 Markdown 都不会被改动。关闭后，每张导图都只展开根节点和它的顶级分支。",

	"settings.rememberView.name": "重开时显示为导图",
	"settings.rememberView.desc":
		"上次以导图形式查看的笔记，下次打开时仍显示导图，而不是编辑器。选「从不」则所有笔记都以 Markdown 打开。",
	"settings.rememberView.option.off": "从不",
	"settings.rememberView.option.session": "本次 Obsidian 关闭前",
	"settings.rememberView.option.always": "始终",

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

	// --- 作用到导图上的动作 ---------------------------------------------------
	"view.action.toggleView": "切换思维导图视图",
	"view.action.openMap": "以思维导图打开",
	"view.action.editMarkdown": "以 Markdown 编辑",
	"view.action.fitWindow": "适应窗口",

	// --- 右下角工具栏 --------------------------------------------------------
	"view.tool.expandAll": "全部展开",
	"view.tool.collapseAll": "全部折叠",
	"view.tool.shortcuts": "快捷键",
	"view.tool.export": "导出",
	"view.tool.settings": "设置",
	"view.block.placeholder": "文字块",
	"view.node.placeholder": "输入文字",

	// --- 卡片上的部件，供读屏软件朗读 -----------------------------------------
	"view.node.expand": "展开",
	"view.node.collapse": "折叠",
	"view.body.expand": "展开整块内容",
	"view.body.collapse": "把这块内容折成一行",
	"view.code.copy": "复制代码",
	"view.code.copied": "已复制",
	"view.node.annotationAria": "注解（双击编辑）",
	"view.media.play": "在卡片上播放",
	"view.media.open": "用 Obsidian 的播放器打开",
	"view.media.preview": "点击放大预览",
	"view.lightbox.close": "关闭预览",

	// --- 笔记没写标题时的 callout 标题 ---------------------------------------
	// 与 Obsidian 内置类型一一对应，也是能拿到图标的那些。列表之外的类型
	// 直接显示笔记里写的那个词。
	"view.callout.note": "笔记",
	"view.callout.abstract": "摘要",
	"view.callout.info": "信息",
	"view.callout.todo": "待办",
	"view.callout.tip": "提示",
	"view.callout.success": "成功",
	"view.callout.question": "问题",
	"view.callout.warning": "警告",
	"view.callout.failure": "失败",
	"view.callout.danger": "危险",
	"view.callout.bug": "错误",
	"view.callout.example": "示例",
	"view.callout.quote": "引用",

	// --- 快捷键面板 ----------------------------------------------------------
	"view.shortcuts.title": "导图快捷键",
	"view.shortcuts.footer": "以上所有按键都可以在插件设置中修改。",
	"view.shortcuts.mouse.edit.keys": "双击卡片",
	"view.shortcuts.mouse.edit.what": "编辑该节点",
	"view.shortcuts.mouse.link.keys": "点击正文卡片中的链接",
	"view.shortcuts.mouse.link.what": "打开它",
	"view.shortcuts.mouse.reveal.keys": "Ctrl/Cmd+点击卡片",
	"view.shortcuts.mouse.reveal.what": "跳到它在笔记中的位置",
	"view.shortcuts.mouse.add.keys": "卡片旁的 +",
	"view.shortcuts.mouse.add.what": "新建子节点",
	"view.shortcuts.mouse.menu.keys": "右键点击卡片",
	"view.shortcuts.mouse.menu.what": "打开节点菜单",
	"view.shortcuts.mouse.reparent.keys": "拖拽到某张卡片上",
	"view.shortcuts.mouse.reparent.what": "改变它的父节点",
	"view.shortcuts.mouse.reorder.keys": "拖拽到卡片的上下边缘",
	"view.shortcuts.mouse.reorder.what": "在该卡片旁重新排序",
	"view.shortcuts.mouse.zoom.keys": "滚轮 / 双指捏合",
	"view.shortcuts.mouse.zoom.what": "缩放",
	"view.shortcuts.mouse.pan.keys": "Space + 拖动",
	"view.shortcuts.mouse.pan.plainKeys": "拖动空白处",
	"view.shortcuts.mouse.pan.what": "平移画布",
	"view.shortcuts.mouse.band.keys": "拖动空白处",
	"view.shortcuts.mouse.band.shiftKeys": "Shift + 拖动空白处",
	"view.shortcuts.mouse.band.what": "拉出一个选框，框到的卡片都进入选中",
	"view.shortcuts.mouse.multi.keys": "Shift + 点击卡片",
	"view.shortcuts.mouse.multi.what": "把它加进选中，再点一次移出",
	"view.shortcuts.mouse.dragGroup.keys": "拖动多张选中卡片中的一张",
	"view.shortcuts.mouse.dragGroup.what": "整组一起搬走，保持它们在笔记里的顺序",

	// --- 节点右键菜单 --------------------------------------------------------
	"view.menu.showBlock": "查看整块内容",
	"view.menu.editBlock": "编辑块源码",
	"view.menu.addChild": "添加子节点",
	"view.menu.editAnnotation": "编辑注解",
	"view.menu.addAnnotation": "添加注解",
	"view.menu.addCheckbox": "添加复选框",
	"view.menu.removeCheckbox": "移除复选框",
	"view.menu.addSiblingBelow": "在下方添加同级节点",
	"view.menu.addSiblingAbove": "在上方添加同级节点",
	"view.menu.fold": "折叠",
	"view.menu.unfold": "展开",
	"view.menu.rename": "重命名",
	"view.menu.delete": "删除",
	"view.menu.linkToNote": "链接到某篇笔记…",
	"view.menu.createNote": "由该节点新建笔记",
	"view.menu.unlink": "移除链接",
	"view.menu.openLink": "打开链接的笔记",

	// --- 导图拒绝执行某件事时的提示 ------------------------------------------
	"view.notice.rootRename": "该节点就是文件名。要改名请重命名这篇笔记。",
	"view.notice.rootDelete": "根节点无法从导图中删除。",
	"view.notice.blockRefused": "这个节点不在笔记中，没有地方可以在它下面写入文字块。",
	"view.notice.nothingToUndo": "导图上没有可撤销的操作。",
	"view.notice.annotationChanged":
		"编辑器打开期间该注解已被修改。请先复制你的草稿，重新打开后再保存。",
	"view.notice.cannotLink": "只有笔记自身拥有的节点才能挂链接。",
	"view.notice.noteCreated": "已新建 {name}",
	"view.notice.noteCreateFailed": "无法新建该笔记，原因见控制台。",

	// --- 把节点链接到另一篇笔记 ----------------------------------------------
	"view.link.pick": "把这个节点链接到哪篇笔记？",

	// --- 设置窗口 ------------------------------------------------------------
	"dialog.settings.title": "思维导图设置",

	// --- 查找栏 --------------------------------------------------------------
	"search.regex": "正则表达式",
	"search.previous": "上一个匹配",
	"search.next": "下一个匹配",
	"search.close": "关闭查找",
	"search.replace": "展开替换行",
	"search.replaceWith": "替换为",
	"search.replaceOne": "只替换这张卡片",
	"search.replaceAll": "全部替换",
	"search.replaced": "已替换 {count} 处",

	// --- 插件注册的命令 ------------------------------------------------------
	"command.forgetFold": "清除该笔记已保存的折叠状态",
	"command.search": "在思维导图中查找",
	"command.replace": "在思维导图中查找替换",
	"command.moveUp": "把选中节点在同级中上移",
	"command.moveDown": "把选中节点在同级中下移",
	"command.openAsMindmap": "以思维导图打开当前笔记",
	"command.revealLineOnMap": "在导图中定位光标所在的行",
	"command.settings": "打开思维导图设置",
	"command.insertAnnotation": "插入注解行（在 Markdown 编辑器中）",
	"command.linkToNote": "把选中节点链接到某篇笔记",
	"command.createNote": "由选中节点新建一篇笔记",
	"command.unlink": "移除选中节点上的链接",

	// --- 加载时的提示 --------------------------------------------------------
	"main.notice.onlyMarkdown": "只有 Markdown 笔记可以显示为思维导图。",
	"main.notice.update":
		"MindFlow 已更新。在标题或列表项下写成 “: text” 的行，现在会作为注解挂在那个节点的卡片下方，而不是成为独立卡片。可在「设置 → MindFlow → 外观 → 行内注解」中关闭。",

	"main.notice.dragMode":
		"拖动模式已开启：现在在空白处拖动就是平移画布，框选改成了 Shift 加拖动。关闭时正好相反 —— 拖动画出选框，按住 Space 拖动才平移。可在「设置 → MindFlow → 偏好 → 拖动模式」中关掉。",

	// --- 导出，每种格式一对键 ------------------------------------------------
	"export.canvas.name": "导出思维导图为 Canvas",
	"export.canvas.menu": "导出为 Canvas",
	"export.svg.name": "导出思维导图为 SVG",
	"export.svg.menu": "导出为 SVG",
	"export.png.name": "导出思维导图为 PNG",
	"export.png.menu": "导出为 PNG",
	"export.html.name": "导出思维导图为 HTML",
	"export.html.menu": "导出为 HTML",
	"export.notice.nothing": "没有可导出的内容",
	"export.notice.done": "思维导图已导出到 {path}",
	"export.notice.doneScaled": "思维导图已导出到 {path}，为保持在 16384 像素以内已缩放",
	"export.notice.failed": "思维导图导出失败：{reason}",
	"export.untitled": "未命名",
	"export.error.rasterize": "无法把导图渲染成图片。",
	"export.error.noCanvas": "当前平台没有可用的 2D 画布。",
	"export.error.encode": "无法把图片编码为 PNG。",
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

/**
 * A callout's type, as far as the plugin has an opinion about it.
 *
 * The aliases are Obsidian's: `hint` and `important` are `tip` written a
 * different way, and a note that uses one means the same box. Anything outside
 * this list is a custom type, which Obsidian draws without a title of its own
 * and so does the map.
 */
export type CalloutType =
	| "note"
	| "abstract"
	| "info"
	| "todo"
	| "tip"
	| "success"
	| "question"
	| "warning"
	| "failure"
	| "danger"
	| "bug"
	| "example"
	| "quote";

const CALLOUT_KEYS: Record<CalloutType, I18nKey> = {
	note: "view.callout.note",
	abstract: "view.callout.abstract",
	info: "view.callout.info",
	todo: "view.callout.todo",
	tip: "view.callout.tip",
	success: "view.callout.success",
	question: "view.callout.question",
	warning: "view.callout.warning",
	failure: "view.callout.failure",
	danger: "view.callout.danger",
	bug: "view.callout.bug",
	example: "view.callout.example",
	quote: "view.callout.quote",
};

/**
 * Every alias Obsidian accepts, spelled out.
 *
 * Written as a flat table rather than derived from the list above because the
 * aliases are not a rule -- `error` is `danger`, `check` is `success`, and
 * `important` is `tip` -- so the only way to know them is to write them down.
 */
const CALLOUT_ALIASES: Record<string, CalloutType> = {
	note: "note",
	abstract: "abstract",
	summary: "abstract",
	tldr: "abstract",
	info: "info",
	todo: "todo",
	tip: "tip",
	hint: "tip",
	important: "tip",
	success: "success",
	check: "success",
	done: "success",
	question: "question",
	help: "question",
	faq: "question",
	warning: "warning",
	caution: "warning",
	attention: "warning",
	failure: "failure",
	fail: "failure",
	missing: "failure",
	danger: "danger",
	error: "danger",
	bug: "bug",
	example: "example",
	quote: "quote",
	cite: "quote",
};

/**
 * The built-in type a note's callout name stands for, or null when it is one
 * of the note's own.
 */
export function calloutTypeOf(raw: string): CalloutType | null {
	return CALLOUT_ALIASES[raw] ?? null;
}

/** The title Obsidian would give a callout of this type. */
export function calloutTitle(type: CalloutType): string {
	return t(CALLOUT_KEYS[type]);
}
