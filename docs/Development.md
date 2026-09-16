# MindFlow — Development

> 中文版：[开发文档.md](开发文档.md) ｜ User guide: [Usage.md](Usage.md)

This document is for people reading and changing the code. It covers three things:
**how the code is layered**, **why it is layered that way**, and **where to go when
you want to add something**.

---

## 1. In one sentence

MindFlow is a **view** of a note, not an exporter. It parses markdown into a tree and
draws it on a canvas; every change you make on the canvas is translated into a
**line-range splice** on the original text and written back to the same file.

There is exactly one core invariant:

> **The file is never regenerated from the tree.** Each node remembers the exact
> line it came from and the exact pieces that line is made of, so it can rebuild
> itself character-for-character. Lines you did not edit come back byte-for-byte
> identical.

That invariant is the foundation of the project, and the test suite is built to
guard it.

---

## 2. Layers

```
src/model/     parser + mutation engine — pure functions, no Obsidian, no DOM
src/layout/    tidy-tree layout — equally dependency-free
src/view/      canvas, cards, connectors, interactions, math, the TextFileView
src/main.ts    plugin entry: view registration, mode toggle, commands
src/settings.ts / src/i18n.ts / src/foldStore.ts / src/undoPark.ts   cross-cutting
src/export/    the four export formats
```

### Why it is split this way

`src/model` and `src/layout` depend on **neither the DOM nor Obsidian**. That is not
tidiness for its own sake — it is the precondition for testability. It means they can
be unit-tested directly with `node --test` (Node 22.6+ strips TypeScript types
natively, so there is no build step and no test framework).

`src/view` is the only place allowed to touch the Obsidian API and the DOM. It is
thick (`MindmapView.ts` is the largest file) because rendering, layout, selection,
undo, search, popovers and export all hang off one `TextFileView` lifecycle.

---

## 3. Module map

### `src/model/` — the pure layer

| File | Responsibility |
| --- | --- |
| `lines.ts` | Line-array ↔ text conversion, and `spliceLines`, the core splice primitive |
| `parse.ts` | markdown → node tree. A state machine over fenced code, ATX headings, lists, body blocks |
| `types.ts` | `MindNode` / `ParsedDoc` / `NodeKind`, plus indent-width arithmetic |
| `mutate.ts` | Every mutation: add, delete, rename, move, reorder, indent, checkbox, annotation, text block |
| `releveling.ts` | Rewrite a subtree's markers for a new parent (used when crossing the heading/list boundary) |
| `annotations.ts` | Recognising and splitting `: text` lines |
| `inlineText.ts` | Tokenising inline markdown (bold, code, links, formulas…) |
| `search.ts` | Substring / regex matching over the tree, plus fold bookkeeping |

**`spliceLines` is the single exit for every write.** To change the file you must
first work out "delete N lines starting at line M, insert this", and hand it over.
There is no second path.

**The parser is lenient in the read direction only.** A paragraph directly under a
list item, for instance, is a lazy continuation in CommonMark — this parser tells
them apart correctly — but writes still follow the spec (see
[§7 Trade-offs](#7-trade-offs)).

### `src/layout/`

`tidyTree.ts` — a classic tidy-tree layout. Input: the node tree. Output: each node's
position, size and branch number. In balanced mode the top-level branches are split
between the two sides of the root by weight.

### `src/view/`

| File | Responsibility |
| --- | --- |
| `MindmapView.ts` | The `TextFileView` subclass. Drawing, culling, selection, undo, search, popovers, export |
| `canvas.ts` | Viewport zoom/pan (`transform`) and coordinate conversion |
| `nodes.ts` | Turns a `MindNode` into a DOM card |
| `edges.ts` | Connector drawing. `edgePath()` is a pure function, with tests for both styles |
| `cardStyle.ts` | The card-style enum and the CSS class each maps to |
| `culling.ts` | Viewport culling: which cards need to be in the DOM |
| `interactions.ts` | All pointer and keyboard interaction. `attachInteractions(controller)` returns a teardown function |
| `shortcuts.ts` | **The single source of truth for key bindings** (see [§5](#5-adding-a-shortcut)) |
| `searchBar.ts` | The find bar over the canvas |
| `math.ts` / `mathCache.ts` / `mathSyntax.ts` | MathJax integration and `$…$` syntax rules |
| `perf.ts` | Render-timing instrumentation |
| `settingsModal.ts` | The standalone settings window |
| `annotationDialog.ts` / `blockDialog.ts` | Legacy modal editors (the main flow now edits in place) |
| `branchButton.ts` / `frame.ts` / `motion.ts` / `nodeWidth.ts` | Small view utilities |

### Cross-cutting

| File | Responsibility |
| --- | --- |
| `main.ts` | Plugin entry: registers the view, commands and events; `revealLine()` does the note-side scroll |
| `settings.ts` | Setting definitions + `SettingsPanel`, the rendering logic shared by the settings tab and the settings window |
| `i18n.ts` | The EN/ZH dictionaries. The English table is the source of truth for keys |
| `foldStore.ts` | Fold-state persistence, keyed by note path, stored in `data.json` |
| `undoPark.ts` | The undo-stack "parking" mechanism that lets history survive a view switch |
| `updateNotice.ts` | The one-time notice shown after a version update |

### `src/export/`

`canvasFile.ts` (Canvas), `documents.ts` (HTML), `raster.ts` (PNG), `snapshot.ts`
(snapshotting the live DOM), `paths.ts` (collision-free filenames), `xmlText.ts`
(XML escaping), `run.ts` (command registration and format dispatch).

---

## 4. The full path of one edit

Take "press `Tab` on the map to add a child":

```
interactions.ts   keydown → resolveAction → "add-child"
       ↓
MindmapView.addChildTo(id)
       ↓
withNode(id, cb)                       // fetch the parsed doc and the node
       ↓
model/mutate.ts  addChild(parsed, node, "")
       ↓                               returns { text, focusLine, ok }
MindmapView.apply(mutation)
       ↓
pushRevision(undoStack, this.data)      // push onto the undo stack
       ↓
commit(text, focusLine, edit=false)
       ↓
   ├─ data = text
   ├─ parkHistory()                     // park the stack on the plugin (survives a view switch)
   ├─ requestSave()                     // debounced write to disk
   └─ render("edit")                    // re-parse + repaint
```

The parts that matter:

- **`apply` is the only write gate.** It pushes the revision, clears redo, commits and
  repaints. Mutation functions only ever return a `Mutation`; they never touch the
  file themselves.
- **`Mutation.ok === false` means refused.** `text` is then the unchanged original and
  `apply` returns immediately, producing no undo step. What to tell the user about the
  refusal is the caller's decision.
- **`focusLine` is the line to select after the change**, or `-1` to leave the
  selection alone.

---

## 5. Adding a shortcut

The keyboard system is designed around one goal: **one table, three readers, no
drift.**

The `TABLE` in `src/view/shortcuts.ts` is the single source of truth:

```ts
const TABLE = [
    { action: "add-child", defaults: ["Tab"] },
    { action: "add-sibling", defaults: ["Enter"] },
    // …
] as const;
```

The three readers:

1. **The keydown handler in `interactions.ts`** — `resolveAction()` turns a press into
   an action, then a `switch` dispatches it;
2. **The settings tab / settings window** — one row per action, with record, clear and
   restore-default controls;
3. **The shortcut panel on the map** (the toolbar's **?**) — prints what is actually
   bound right now.

### Four places to touch

1. Add a row to `TABLE`: `{ action, defaults }`;
2. Add two entries to `i18n.ts`: `shortcut.<action>.name` and
   `shortcut.<action>.description`;
3. Add a `case` to the `switch` in `interactions.ts` (the `assertHandled(action: never)`
   in the `default` branch makes a missing case a **compile error**);
4. Add the method to the `MapController` interface and implement it on `MindmapView`.

**Forgetting step 2 will not compile** — `shortcutNameKey()` returns a template
literal type derived from the action name (`` `shortcut.${action}.name` ``), which only
resolves if the dictionary actually holds that key. That is deliberate: it turns
"added an action but wrote no words" into a compile error rather than a blank label in
the UI.

### One trap worth knowing: modified combos are claimed by Obsidian's keymap

A `keydown` listener on the viewport **does not receive some `Mod`-modified
combinations** — Obsidian's keymap pipeline handles them before the event reaches a
DOM listener. `Ctrl+Enter` is one of them.

How to confirm: put a log line at the very top of that handler. If pressing the
combination produces no output at all, it was claimed before it reached the
listener.

The fix is to register the action on an Obsidian **`Scope`** rather than only on the
DOM listener:

```ts
for (const combo of bindings["edit-annotation"]) {
    this.registerScoped(scope, combo, (evt) => {
        const id = this.selectedId();
        if (!id || this.isEditing()) return true;   // true = let it through
        evt.preventDefault();
        this.editAnnotation(id);
        return false;                               // false = handled, stop here
    });
}
```

`search` (`Ctrl+F`) and `close-search` (`Esc`) have been registered that way from the
start — a signal worth reading: **modified bindings go through the scope, plain
character keys go through the DOM listener.**

---

## 6. Adding a setting

1. Add the field to `MindmapSettings` in `settings.ts`;
2. Add a default to `DEFAULT_SETTINGS`;
3. Add a row to the `GROUPS` array (`name` / `desc` / `control`);
4. Add `settings.<key>.name` and `settings.<key>.desc` to `i18n.ts` — and for a
   dropdown, `settings.<key>.option.<value>` as well.

After that, the setting appears in both the settings window and Obsidian's own
settings tab (both renderers read the same `GROUPS`), and it **repaints automatically**
— every key except the two special cases (language, header button) goes through
`plugin.refreshAllViews()` in `SettingsPanel.commit()`.

If the setting needs a side effect of its own (refreshing the header buttons, say),
add a branch in `applySideEffects()`.

---

## 7. Trade-offs

These are deliberate choices, not oversights. Read the reasoning before changing one.

| Trade-off | Reasoning |
| --- | --- |
| **Text blocks carry no blank line** | Earlier versions put a blank line before the block for CommonMark compatibility (a paragraph directly after a list item is a lazy continuation, and other tools might swallow the block into the title). The user asked for it gone — this project's parser is lenient enough to tell them apart, and Obsidian's reading view handles it correctly. |
| **`$…$` is stricter than Obsidian's** | The body may not begin or end on whitespace, and a closing `$` may not be followed by a digit. That keeps `$5-$10` a price at the cost of `$x$2` staying literal. The rules live in their own dependency-free module so they can be tested the same way. |
| **Content cards cannot be renamed, dragged or deleted** | They stand for lines the note owns; the map is only showing them. Selecting one and pressing `Delete` is the exception — that does remove the lines. |
| **Top-level branches are not reorderable** | The layout splits them between the two sides of the root by weight, so their order is the layout's to decide. A drop on a top-level card always reparents. |
| **Fold state is found again by heading path** | Which means renaming a node forgets where it was folded. Keying by line number or by id would mis-match worse after an edit. |
| **`Ctrl+Z` in the markdown editor is not taken over** | Doing so needs `undoDepth` from `@codemirror/commands` to tell when the editor has nothing left to undo, and that is not part of Obsidian's public API. Failing to resolve it makes the plugin fail to load, and it could not be verified in this environment — so it is not done. |
| **The undo stack is parked on the plugin** | A view switch goes through `leaf.setViewState()`, and Obsidian destroys the old view instance. A stack living only in the view dies with it. `undoPark.ts` parks it on the plugin to fix that. |

---

## 8. Tests

```bash
npm test          # 401 tests across 29 files
npm run check     # version + changelog + typecheck + tests + build
```

Test files sit beside the source they test, named `*.test.ts`.

### Three kinds of test

**1. Model layer (the bulk)** — pure functions, run directly. The focus is the
round-trip invariant:

- frontmatter, CRLF, tilde fences, nested fences, ordered lists, empty list items and
  closing-hash headings all round-trip byte-identically;
- **fenced code never produces nodes**;
- **no operation ever touches frontmatter**;
- every legal reparent across a rich fixture still round-trips with code content
  intact.

**2. Layout layer** — asserts that cards never overlap in deep, uneven trees (in both
balanced and single-sided modes), and that laying out the same tree twice lands in
exactly the same place.

**3. Interaction layer (`interactions.test.ts`)** — drives `attachInteractions` for
real, against a minimal DOM stub.

### About the DOM stub

`interactions.test.ts` has `FakeEl` / `FakeStyle` / `installDom()`, plus a
`MapController` built with a `Proxy` that records calls and returns sensible defaults.

**The biggest time sink when writing a stub** is a gap in the stub masquerading as a
bug in the code. The ones already hit:

- `closest()` always returning null — a real element **is its own `closest` match**;
- `getBoundingClientRect()` missing `right` / `bottom` — a real DOMRect has both;
- `style` has two spellings (property assignment `style.left = …` and `setProperty`),
  and implementing only one misses the other;
- a missing `globalThis.HTMLElement` — `instanceof` then throws outright.

The conclusion: **list every detail of the real API before writing the stub**, or you
will spend a long time chasing your own shadow.

---

## 9. Building and releasing

```bash
npm run dev       # watch mode; output lands directly in the plugin folder
npm run build     # tsc --noEmit + esbuild production
npm run check     # the full version of the above
```

The artifacts are `main.js` (esbuild bundle, with a banner), `manifest.json` and
`styles.css`.

### Version agreement

Three places must agree, and `scripts/check-version.mjs` guards them:

- `package.json`'s `version`
- `manifest.json`'s `version`
- a `"<version>": "<minAppVersion>"` entry in `versions.json`

On release, GitHub Actions additionally checks that **the tag equals
`manifest.json`'s version exactly** — Obsidian fetches a plugin's assets from the
release whose tag matches, and a `v` prefix is the single most common reason a release
silently fails to install.

### Release process

1. `npm version minor` (keeps the three files in step);
2. Add a `## [x.y.z] - YYYY-MM-DD` section to `CHANGELOG.md`
   (`check-changelog.mjs` checks for it, and the release notes are taken from it
   verbatim);
3. `git push && git push origin <version>`;
4. The tag triggers `release.yml`, which runs the tests, builds, packages a zip,
   attests build provenance, and creates a draft release.

**Changelog entries are bilingual** — Chinese, then `<br>`, then English, all on one
source line. The `<br>` is deliberate: a plain newline renders as a line break in
release notes but collapses to a space when the file is viewed on GitHub.

---

## 10. House style

- **Comments explain "why", not "what".** The name already says what. What is worth
  writing down is the non-obvious constraint, the bug that was hit, the approach that
  was rejected.
- **No "test for X" comments.** The test name is the description.
- **Prefer letting the type system stop you.** The derived i18n key types and
  `assertHandled`'s `never` parameter both turn "forgot one place" into a compile error.
- **Pure-logic changes ship with tests**, beside the file under test.
- **Rewrite whole files for large changes** rather than accumulating small edits.

---

## 11. Branches

`main` is the baseline; feature work happens on `feat/*` branches. Releases are cut
from `main` by pushing a tag equal to `manifest.json`'s version.
