# Pictures and Videos

A scratch note for eyeballing what unit tests cannot reach: a picture drawn on a
card, and the two sizes that decide whether the layout around it is right.

## Pictures

- ![[wide.png]] — the plain case: an embed that names a file in this folder
- ![The same file, written the other way](media/wide.png) — markdown syntax
- ![[small.png]] — 48 pixels wide, so it must be drawn at 48 and never stretched
- ![[wide.png|120]] — a size hint: this one is capped at 120 pixels
- ![[wide.png|The bands]] — a pipe that names an alias, not a size

## Side by side

A picture written inside a sentence sits in it: ![[small.png]] and the text keeps
going after it, which is the case that catches a wrapper sized as a block.

## In note content

The same markup inside a body card, which is the other place the inline renderer
runs. This paragraph is a body card rather than a node, so the picture in it
should be capped at the wider note-content width:

![[wide.png]]

## What stays a chip

- ![[Link Fixture.pdf]] — a PDF that is really there, and stays a chip
- ![[Nowhere.png]] — a file that is not in the vault at all
- ![[a song.mp3]] — audio is not a picture either
- ![](https://example.com/remote.png) — a remote address is never fetched to be
  drawn; pasting one onto a card is the other thing, below

## Pasting

The one gesture here that has to be done by hand. Select a card above (or
double-click one open), copy a picture — a screenshot, or Copy Image in a
browser — and press `Ctrl`/`Cmd`+`V`:

- the picture should appear on that card, filed in the vault's attachment
  folder under `Pasted image <stamp>.<ext>`;
- a card that already says something should keep saying it, with the picture
  after the words;
- with **no card selected**, the paste should add nothing and say so;
- copying a picture's **address** instead (`https://…/a.png`) should fetch it
  once, file it, and draw it — the note keeps a local file, not the address;
- copying **two** pictures at once should be declined, not crammed onto the card.

The root card and a projected card (a `[[Note]]` card with its outline open)
should refuse the paste: neither has a line of its own to write on.

## Videos

Drop any `.mp4` or `.webm` into this folder and embed it here:

- `![[demo.mp4]]`

A video card is a still frame with two circles: the one in the bottom right plays
it here, the one in the top right opens the file in Obsidian's own player.
Neither is visible until the pointer arrives.

## Preview

Click any picture above: it should cover the map, enlarged, with a dark backdrop
and an ✕ in the corner. Clicking the backdrop, pressing Escape, or using the ✕
should put the map back exactly as it was — and it should never have opened a
tab. `small.png` is the case worth checking twice: 48 pixels, so the preview
enlarges it only to 96 and does not stretch it across the pane.

`Ctrl`/`Cmd`+click on the same picture is the other half: that one opens the file
in Obsidian, the way a plain click used to.
