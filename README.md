# MindFlow

*[中文说明](README.zh.md) ｜ [Usage guide](docs/Usage.md) ｜ [Development](docs/Development.md)*

Turn any Obsidian note into an editable, radial mind map — the same way you switch
to reading mode. Same tab, same file, **no new files ever created**.

Every edit you make on the map is written straight back into the original `.md` note
as a minimal line edit. Toggle back and your note is still your note.

> [!TIP]
> **Got an idea, or something that feels wrong?**
> [Open an issue](https://github.com/AuroraEchop/MindFlow/issues) — a feature you wish
> it had, a rough edge, a note it draws badly. Most of what this plugin does now
> started as one of those.

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
- **Pictures and videos drawn on the card.** `![[hero.png]]` is the picture itself,
  and a video is a still frame with two buttons on it — one plays it in place, the
  other hands it to Obsidian's own player. Paste a picture onto a card and it is
  filed in your vault and drawn there; paste an image's **address** and it is read
  once and kept. In an exported SVG, PNG or HTML the pictures are inlined, so the
  file shows them anywhere.
- **A card that points at another note opens where it stands.** Its title carries
  two buttons: one shows what that note **says** — rendered as markdown, samples
  and tables and pictures included — and one brings its **outline** in as a
  subtree under the card, drawn with dashed connectors. A link written inside
  your prose previews on the card it was written on, and a link that leaves the
  vault gets a card naming the site. None of it opens a new tab, and none of it
  writes a single file.
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

**From the community plugin browser.** In Obsidian, open *Settings → Community
plugins → Browse*, search for **MindFlow**, press **Install**, then **Enable**.
That is the whole of it — Obsidian offers you each new version from then on.

**By hand**, if you would rather have the files yourself:

1. Download `main.js`, `manifest.json` and `styles.css` from the
   [latest release](https://github.com/AuroraEchop/MindFlow/releases/latest);
2. Copy them into your vault:

   ```
   <your vault>/.obsidian/plugins/mindflow/
   ```

3. Enable **MindFlow** in *Settings → Community plugins*.

Or download `mindflow.zip` from the same release and unzip it into
`.obsidian/plugins/` — one download instead of three.

Either way you need Obsidian **1.5.7** or later.

## Use it

Open a note and run **Toggle mind map view** from the command palette — assign a
hotkey to make it feel like switching reading mode.

| Key | Action |
| --- | --- |
| `Enter` / `Tab` | New sibling / new child |
| `Ctrl`/`Cmd`+`Enter` | Add or edit the annotation |
| `Shift`+`Enter` | Add a text block |
| `Delete` | Delete the node and its children |
| `Space` | Fold / unfold |
| `Ctrl`/`Cmd`+`Z` | Undo |
| `Ctrl`/`Cmd`+`F` | Find in the map |

**Hold `Space` and drag** to pan the canvas from anywhere — over a card and the text
on it included, without selecting a word of it.

Every key is rebindable, and the settings page warns when two actions end up on the
same one. **The full list, the editing gestures, the settings reference and the
export formats are in the [usage guide](docs/Usage.md).**

## Documentation

| Document | What it covers |
| --- | --- |
| **[Usage guide](docs/Usage.md)** ([中文](docs/使用指南.md)) | Every gesture, the full shortcut table, the shortcuts settings page, annotations, content cards, search, export, all settings |
| **[Development](docs/Development.md)** ([中文](docs/开发文档.md)) | Architecture, module map, the round-trip invariant, how to add a shortcut or a setting, testing, releasing |

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
npm run check    # version + changelog + typecheck + 555 tests + build
```

Before a release, also run the review's own rule set:

```bash
npm --prefix tools/obsidian-lint install   # once; it keeps its own dependencies
npm run lint:obsidian                      # see docs/Development.md §9
```

**See [docs/Development.md](docs/Development.md) for the architecture, the core
invariant, and how to add a shortcut, a setting or an export format.**

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 AuroraEchop.

No third-party code is bundled: there are no runtime dependencies, formulas are
typeset by Obsidian's own MathJax, and icons come from Obsidian's `setIcon`.

XMind, MindNode and Mubu are trademarks of their respective owners; this project is not affiliated with either and mentions them only to describe how the canvas behaves. Obsidian is a trademark of Dynalist Inc.
