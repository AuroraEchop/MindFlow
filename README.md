# MindFlow

*[中文说明](README.zh.md) ｜ [Usage guide](docs/Usage.md) ｜ [Development](docs/Development.md)*

Turn any Obsidian note into an editable, radial mind map — the same way you switch
to reading mode. Same tab, same file, **no new files ever created**.

Every edit you make on the map is written straight back into the original `.md` note
as a minimal line edit. Toggle back and your note is still your note.

![MindFlow](assets/hero.png)

---

## Highlights

- **A view mode, not an export.** Toggling swaps the view type on the leaf you are
  already in, so the same `TFile` stays open in the same tab. Nothing is generated,
  copied, or written to a sidecar file.
- **Your outline is the map.** Headings nest by level; nested bullets hang under the
  heading they belong to. What you already wrote is the structure.
- **Edit on the canvas, in place.** Rename, add, delete, indent, drag to reparent,
  drag to reorder, fold, tick checkboxes — no dialogs, no modal editors. Text fields
  open right on the card.
- **Annotations.** A line written as `: text` under a heading or a bullet hangs under
  that node's card in muted text instead of becoming a card of its own.
- **Three card styles.** Bordered, rounded, or minimal — the last draws nothing at
  rest and frames a card only while you are editing it.
- **Curved or right-angled connectors**, four toolbar dock positions, and a corner
  toolbar that can hide itself until you pick a card.
- **Reopens where you left it.** Fold state and focus are remembered per note, in the
  plugin's own data — never in your markdown.
- **One undo history per note.** The markdown editor and the map share a single
  stack, so `Ctrl+Z` walks back through both.
- **Nothing else is touched.** Frontmatter, fenced code, tables, HTML and links are
  never reformatted. Lines you did not edit come back byte-for-byte identical,
  including CRLF endings.

## Screenshots

| Editing in place | Annotations | Card styles |
| --- | --- | --- |
| ![Editing](assets/inline-edit.png) | ![Annotations](assets/annotation.png) | ![Card styles](assets/card-styles.png) |

| Dragging | Shortcuts settings | Find |
| --- | --- | --- |
| ![Dragging](assets/drag-ghost.png) | ![Shortcuts](assets/shortcuts-settings.png) | ![Find](assets/search.png) |

## Install

Not in the community plugin browser yet, so install manually.

1. Download `main.js`, `manifest.json` and `styles.css` from the
   [latest release](../../releases/latest);
2. Copy them into your vault:

   ```
   <your vault>/.obsidian/plugins/mindflow/
   ```

3. Enable **MindFlow** in *Settings → Community plugins*.

Or download `mindflow.zip` and unzip it into `.obsidian/plugins/` — one download
instead of three.

## Use it

Open a note and run **Toggle mind map view** from the command palette — assign a
hotkey to make it feel like switching reading mode.

| Key | Action |
| --- | --- |
| `Enter` / `Tab` | New sibling / new child |
| `F2` | Edit the node |
| `Ctrl`/`Cmd`+`Enter` | Add or edit the annotation |
| `Shift`+`Enter` | Add a text block |
| `Delete` | Delete the node and its children |
| `Space` | Fold / unfold |
| `Ctrl`/`Cmd`+`Z` | Undo |
| `Ctrl`/`Cmd`+`F` | Find in the map |

Every key is rebindable, and the settings page warns when two actions end up on the
same one. **The full list, the editing gestures, the settings reference and the
export formats are in the [usage guide](docs/Usage.md).**

## Documentation

| Document | What it covers |
| --- | --- |
| **[Usage guide](docs/Usage.md)** ([中文](docs/使用指南.md)) | Every gesture, the full shortcut table, the shortcuts settings page, annotations, content cards, search, export, all settings |
| **[Development](docs/Development.md)** ([中文](docs/开发文档.md)) | Architecture, module map, the round-trip invariant, how to add a shortcut or a setting, testing, releasing |
| [Requirements & plan](docs/需求与实施方案.md) | The original planning document for this project (Chinese) |

## Development

```
src/model/     parser + mutation engine — pure functions, no Obsidian imports
src/layout/    tidy-tree layout
src/view/      canvas, cards, connectors, interactions, math, the TextFileView
src/main.ts    plugin: view registration, the mode toggle, commands
```

`src/model` and `src/layout` have no DOM or Obsidian dependency, which is why they
can be unit-tested directly with `node --test` (Node 22.6+ strips the TypeScript
types natively — no build step, no test framework).

```bash
npm install
npm run dev      # watch build, straight into the plugin folder
npm run build    # typecheck + production bundle
npm run check    # version + changelog + typecheck + 401 tests + build
```

**See [docs/Development.md](docs/Development.md) for the architecture, the core
invariant, and how to add a shortcut, a setting or an export format.**

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 AuroraEchop.

No third-party code is bundled: there are no runtime dependencies, formulas are
typeset by Obsidian's own MathJax, and icons come from Obsidian's `setIcon`.

XMind, MindNode and Mubu are trademarks of their respective owners; this project is not affiliated with either and mentions them only to describe how the canvas behaves. Obsidian is a trademark of Dynalist Inc.
