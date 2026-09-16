# Changelog

Every released version gets a `## [x.y.z] - YYYY-MM-DD` section here, newest
first. The release workflow pastes that section into the GitHub release notes
verbatim, so write it for someone installing the plugin, not for someone reading
the diff. `npm run check-changelog` fails if the section for `manifest.json`'s
version is missing or empty.

Entries are bilingual: Chinese, then `<br>`, then English, both on one source
line. The `<br>` is deliberate — a plain newline renders as a line break in
release notes but collapses to a space when this file is viewed on GitHub, and
the entry has to read correctly in both.

## [2.0.0] - 2026-09-16

MindFlow 的第一个版本。<br>The first release of MindFlow.

### 新增 / Added

- 是一种视图模式，不是导出：在同一个标签页里把任意笔记切换成可编辑的放射状思维导图，不生成、不复制任何文件。每一次修改都按最小的行级编辑写回原来那份 `.md`，你没有动过的行逐字节原样返回，CRLF 也一样；frontmatter、围栏代码块、表格、HTML 和链接永远不会被重新格式化。<br>A view mode, not an export: toggle any note into an editable radial mind map in the same tab, creating and copying nothing. Every edit goes back to the original `.md` as the smallest line-level change, and lines you never touched come back byte for byte, CRLF included — frontmatter, fenced code blocks, tables, HTML and links are never reformatted.
- 在画布上就地编辑：重命名、新建、删除、缩进、拖拽改父级、拖拽调同级顺序、折叠、勾选复选框，都在卡片上直接完成，不弹对话框；悬停在卡片上出现的加号可以从这张卡片直接长出新节点。同级也可以用 `Ctrl`/`Cmd`+`↑` / `↓` 从键盘换位，效果和把卡片拖到那个同级的边缘一样。<br>Edit on the canvas: rename, create, delete, indent, re-parent by dragging, reorder siblings by dragging, fold and tick a checkbox, all on the card and with no dialog in the way; the plus that appears on hover grows a child straight from that card. Siblings also swap from the keyboard with `Ctrl`/`Cmd`+`↑` / `↓`, exactly as if the card had been dragged onto that sibling's edge.
- 节点注解：标题或列表项下面写一行 `: text`，它贴在卡片下方以灰色文字和左侧竖线显示，而不是单独成卡。双击或右键菜单即可编辑，写回只替换注解自己的那几行；节点折叠时注解仍然可见，导出时也跟着它的卡片一起走。<br>Node annotations: a line written as `: text` under a heading or list item hangs under that card in muted text behind a vertical rule instead of becoming a card of its own. Double-click one, or use the context menu, to edit it, and the write replaces only the annotation's own lines. An annotation stays visible when its node is folded, and goes into the exports with its card.
- 正文卡片：段落、代码块和表格画在所属标题旁边，过长的内容按卡片宽度折行而不是撑破卡片；表格按表格画 —— 表头、列对齐、单元格里的行内标记都跟着来，而不是一段等宽文字；`Shift`+`Enter` 另加一段没有标题的文字块。<br>Body cards: paragraphs, code blocks and tables are drawn beside the heading they belong to, and long content wraps at the card's width rather than bursting it; a table is drawn as a table — header row, column alignment and the inline markup inside its cells — rather than as a run of monospace text; `Shift`+`Enter` adds a plain block of text with no heading of its own.
- 三种卡片样式（边框 / 圆角卡片 / 极简）、曲线或直角连线，角落工具栏可以停在四个位置，也可以在你选中卡片之前先藏起来。<br>Three card styles (outline, rounded card, minimal), curved or right-angled connectors, and a corner toolbar that docks in any of four places or stays hidden until you pick a card.
- 导图上的每个快捷键都能自己改：设置里的 Shortcuts 组逐条列出动作、它是干什么的、以及现在绑在哪个键上。Record 记下你按下的下一个键，× 清空这一行，改过的行多出一个箭头把默认键放回来；两个动作撞到同一个键时两行都会提示。改完立刻生效，已经打开的导图不用重开。<br>Every key the map answers to can be changed: a Shortcuts group lists each action, what it does and what it is on. Record takes the next key you press, × leaves the row unbound, a reset arrow appears on any row you changed to put its default back, and a clash is called out on both rows. A change takes effect immediately, with no open map to reopen.
- 设置是一个独立窗口，浮在导图之上 —— 调外观和结构时不用离开正在看的这张图。<br>Settings are a window over the map, so changing how it looks and behaves does not mean leaving the map you are working on.
- 一篇笔记一份撤销历史：Markdown 编辑器和导图共用同一个撤销栈，`Ctrl`/`Cmd`+`Z` 会一路回退过去。<br>One undo history per note: the markdown editor and the map share a single stack, so `Ctrl`/`Cmd`+`Z` walks back through both.
- 导图自带查找：`Ctrl`/`Cmd`+`F` 打开查找条，输入即搜，计数显示第几个 / 共几个，`Enter` / `Shift`+`Enter` 在命中之间来回跳，`.*` 切换成正则。匹配的是卡片上看到的文字而不是原始 Markdown，跳到折叠分支里的命中会自动展开，走过去之后折回。<br>The map can find things: `Ctrl`/`Cmd`+`F` opens a find bar that searches as you type, counts which match you are on, steps with `Enter` / `Shift`+`Enter` and switches to a regular expression with `.*`. It matches the text you see on the card rather than the raw markdown, and opens a folded branch to reach a match and folds it back as you move on.
- 导出为 Canvas、SVG、PNG 或 HTML：右下角面板、命令面板和标签页菜单三处入口，导出的就是眼前这张图，文件落在笔记旁边，不覆盖已有文件。<br>Export to Canvas, SVG, PNG or HTML: from the corner panel, the command palette or the tab's menu, writing out the map as you see it beside the note and never over an existing file.
- 回来时还是你离开时的样子：折叠形状和焦点按笔记记住，存在插件自己的数据里，从不写进你的 markdown；笔记改名、移动时状态跟着走，笔记删除时一并清掉。<br>A map opens the way you left it: the fold shape and the card you were on are remembered per note, in the plugin's own data rather than in your markdown, and they follow the note when it is renamed or moved.
- 界面中英双语，跟随 Obsidian 自己的语言设置。<br>The interface ships in Chinese and English, following Obsidian's own language setting.
- 大图不再卡：只有看得见的那一屏会被画出来，公式只排版一次，缩放停下来之后文字按你停住的倍率重画，所以放大了也清晰。<br>Large maps stay smooth: only the screenful you can actually see is drawn, each formula is typeset once, and text is repainted at the zoom you stopped on, so it stays crisp when you zoom in.
- 每份发布都带 `LICENSE`：GitHub release 的文件列表里有一份，手动安装出来的插件目录里也有一份。<br>Every release ships `LICENSE`: it sits among the release's files and inside a plugin folder installed by hand.
