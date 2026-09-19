import { test } from "node:test";
import assert from "node:assert/strict";

import { decodeTarget, extensionOf, markdownTarget, mediaKindOf, parseEmbedTarget } from "./media.ts";

test("an extension is read off the name, lowercased", () => {
	assert.equal(extensionOf("assets/Hero.PNG"), "png");
	assert.equal(extensionOf("a/b/clip.MP4"), "mp4");
});

test("a query string or a fragment is not part of the name", () => {
	assert.equal(extensionOf("a.png?v=2"), "png");
	assert.equal(extensionOf("a.png#page"), "png");
	// The one that would go wrong if the extension were read off the tail: a
	// fragment with a dot in it is still not the file's suffix.
	assert.equal(extensionOf("a.png#fig.1"), "png");
});

test("a name with no suffix has no extension", () => {
	assert.equal(extensionOf("notes/readme"), "");
	assert.equal(extensionOf(".gitignore"), "");
	assert.equal(extensionOf("trailing."), "");
	assert.equal(extensionOf(""), "");
});

test("the kinds the map draws are recognised", () => {
	assert.equal(mediaKindOf("assets/hero.png"), "image");
	assert.equal(mediaKindOf("assets/hero.svg"), "image");
	assert.equal(mediaKindOf("clips/demo.mp4"), "video");
	assert.equal(mediaKindOf("clips/demo.webm"), "video");
});

test("everything else is left to the chip", () => {
	assert.equal(mediaKindOf("paper.pdf"), null);
	assert.equal(mediaKindOf("note.md"), null);
	assert.equal(mediaKindOf("song.mp3"), null);
	assert.equal(mediaKindOf("README"), null);
	// Audio is an embed the map does not draw, and a target that only looks
	// like a picture is not one.
	assert.equal(mediaKindOf("assets/hero.png.txt"), null);
});

test("an embed target keeps its path and loses its markers", () => {
	assert.deepEqual(parseEmbedTarget("assets/hero.png"), {
		path: "assets/hero.png",
		label: null,
		width: null,
	});
	assert.deepEqual(parseEmbedTarget("note#Heading"), { path: "note", label: null, width: null });
	assert.deepEqual(parseEmbedTarget("note^block-id"), { path: "note", label: null, width: null });
});

test("a pipe names an alias -- unless it names a size", () => {
	assert.deepEqual(parseEmbedTarget("assets/hero.png|The hero shot"), {
		path: "assets/hero.png",
		label: "The hero shot",
		width: null,
	});
	// `![[a.png|300]]` is a picture drawn 300 wide, not one called "300".
	assert.deepEqual(parseEmbedTarget("assets/hero.png|300"), {
		path: "assets/hero.png",
		label: null,
		width: 300,
	});
	assert.deepEqual(parseEmbedTarget("assets/hero.png|300x200"), {
		path: "assets/hero.png",
		label: null,
		width: 300,
	});
});

test("the marker is stripped before the alias is read", () => {
	assert.deepEqual(parseEmbedTarget("note#Heading|Label"), {
		path: "note",
		label: "Label",
		width: null,
	});
});

test("a markdown target drops its angle brackets and its title", () => {
	assert.equal(markdownTarget("assets/hero.png"), "assets/hero.png");
	assert.equal(markdownTarget("<assets/my hero.png>"), "assets/my hero.png");
	assert.equal(markdownTarget('assets/hero.png "The hero shot"'), "assets/hero.png");
	assert.equal(markdownTarget("  assets/hero.png  "), "assets/hero.png");
});

test("a percent-escaped target decodes, and a stray percent does not throw", () => {
	assert.equal(decodeTarget("assets/my%20hero.png"), "assets/my hero.png");
	assert.equal(decodeTarget("assets/100%.png"), "assets/100%.png");
});
