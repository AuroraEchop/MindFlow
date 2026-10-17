import { test } from "node:test";
import assert from "node:assert/strict";

import {
	extensionForType,
	imageAddressIn,
	nameForAddress,
	pastePlan,
	pastedImageName,
} from "./pasteImage.ts";

test("one picture's address is read, whichever way it was written", () => {
	assert.equal(imageAddressIn("https://a.com/pic.png"), "https://a.com/pic.png");
	// A query or a fragment is part of the request, not of the name, and the
	// address is kept whole because that is what has to be read back.
	assert.equal(imageAddressIn("https://a.com/pic.png?v=2#top"), "https://a.com/pic.png?v=2#top");
	assert.equal(imageAddressIn("http://a.com/pic.JPEG"), "http://a.com/pic.JPEG");
	assert.equal(imageAddressIn("  https://a.com/pic.png  "), "https://a.com/pic.png");
	// A markdown picture around the address: the note has already said what it
	// is, and the syntax around it is not part of what it points at.
	assert.equal(imageAddressIn("![](https://a.com/pic.png)"), "https://a.com/pic.png");
	assert.equal(imageAddressIn("![a caption](https://a.com/pic.png)"), "https://a.com/pic.png");
	assert.equal(imageAddressIn("![a](<https://a.com/my pic.png>)"), "https://a.com/my pic.png");
	assert.equal(
		imageAddressIn('![a](https://a.com/pic.png "hover text")'),
		"https://a.com/pic.png",
	);
});

test("an address that is not one picture is left to the platform", () => {
	// Only what the map itself would draw. A video, a page and a doc are all
	// things this paste would have to guess about, and a guess eats the paste.
	assert.equal(imageAddressIn("https://a.com/clip.mp4"), null);
	assert.equal(imageAddressIn("https://a.com/page.html"), null);
	assert.equal(imageAddressIn("https://a.com/notes.md"), null);
	// No extension at all: a picture behind one is real, and unknowable before
	// the request is made -- which is after the platform's paste is cancelled.
	assert.equal(imageAddressIn("https://a.com/photo"), null);
	assert.equal(imageAddressIn("https://a.com/dir/?f=pic.png"), null);
	// A link into the vault is already a link into the vault, and every other
	// scheme is somebody else's business.
	assert.equal(imageAddressIn("[[pic.png]]"), null);
	assert.equal(imageAddressIn("![[pic.png]]"), null);
	assert.equal(imageAddressIn("C:\\pics\\pic.png"), null);
	assert.equal(imageAddressIn("ftp://a.com/pic.png"), null);
	assert.equal(imageAddressIn("file:///C:/pic.png"), null);
	assert.equal(imageAddressIn("data:image/png;base64,AAAA"), null);
	// Prose that happens to hold an address, and an empty clipboard.
	assert.equal(imageAddressIn("看图 https://a.com/pic.png"), null);
	assert.equal(imageAddressIn("https://a.com/pic.png 还有别的"), null);
	assert.equal(imageAddressIn(""), null);
	assert.equal(imageAddressIn("   "), null);
});

test("what a paste carries is decided before anything is taken from the platform", () => {
	assert.deepEqual(pastePlan(["image/png"], ""), { kind: "picture" });
	// The bytes win over the address: a browser that offers both has the
	// picture in hand, and the bytes are what the note should keep.
	assert.deepEqual(pastePlan(["image/png"], "https://a.com/pic.png"), { kind: "picture" });
	assert.deepEqual(pastePlan(["IMAGE/PNG"], ""), { kind: "picture" });
	assert.deepEqual(pastePlan(["image/png", "image/jpeg"], ""), { kind: "many" });
	// A file that is not a picture is not this file's business, and neither is
	// the text that came with it.
	assert.deepEqual(pastePlan(["application/pdf"], "hello"), null);
	assert.deepEqual(pastePlan(["text/plain"], "https://a.com/pic.png"), {
		kind: "url",
		url: "https://a.com/pic.png",
	});
	assert.deepEqual(pastePlan([], "https://a.com/pic.png"), {
		kind: "url",
		url: "https://a.com/pic.png",
	});
	assert.equal(pastePlan([], "一段话"), null);
	assert.equal(pastePlan([], ""), null);
});

test("a clipboard picture is filed under the name Obsidian gives it", () => {
	// The same spelling the editor's own paste uses, so one attachment folder
	// does not hold two conventions.
	assert.equal(
		pastedImageName("png", new Date(2026, 9, 6, 0, 45, 12)),
		"Pasted image 20261006004512.png",
	);
	assert.equal(
		pastedImageName("jpg", new Date(2026, 0, 3, 9, 7, 5)),
		"Pasted image 20260103090705.jpg",
	);
});

test("a picture off an address keeps the name the address gave it", () => {
	const at = new Date(2026, 9, 6, 0, 45, 12);
	assert.equal(nameForAddress("https://a.com/pic.png", "png", at), "pic.png");
	assert.equal(nameForAddress("https://pic1.zh.com/v2-abcd_1440w.jpg", "jpg", at), "v2-abcd_1440w.jpg");
	// A query string is not part of the name, and an escaped name is decoded
	// back into the one the picture actually has.
	assert.equal(nameForAddress("https://a.com/pic.png?v=2#top", "png", at), "pic.png");
	assert.equal(nameForAddress("https://a.com/%E5%9B%BE%E7%89%87.png", "png", at), "图片.png");

	// Everything a file name cannot hold, and everything that is not a file
	// name at all, falls back to the name a clipboard picture would have got --
	// rather than writing a name the file system would refuse or a file the map
	// would not draw.
	assert.equal(nameForAddress("https://a.com/dir/", "png", at), "Pasted image 20261006004512.png");
	assert.equal(nameForAddress("https://a.com/download", "png", at), "Pasted image 20261006004512.png");
	assert.equal(nameForAddress("https://a.com/a:b.png", "png", at), "Pasted image 20261006004512.png");
	assert.equal(nameForAddress("https://a.com/a?b.png", "png", at), "Pasted image 20261006004512.png");
});

test("a picture is filed under an extension the map can draw", () => {
	assert.equal(extensionForType("image/png"), "png");
	assert.equal(extensionForType("image/jpeg"), "jpg");
	assert.equal(extensionForType("image/svg+xml"), "svg");
	assert.equal(extensionForType("image/webp"), "webp");
	// What a server writes after the type is not part of the type.
	assert.equal(extensionForType("  IMAGE/PNG; charset=binary  "), "png");
	// A picture nobody has listed is a screenshot, which is a PNG: filed under
	// anything else, the map would refuse to draw it.
	assert.equal(extensionForType("image/x-nikon-raw"), "png");
	// Not a picture at all: there is no extension to give it.
	assert.equal(extensionForType("text/plain"), null);
	assert.equal(extensionForType("application/pdf"), null);
	assert.equal(extensionForType(""), null);
});
