import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isProtectedMarkdownPath, normalizeFolderPath } from "./paths";

describe("protect/paths", () => {
  it("normalizes folder paths", () => {
    assert.equal(normalizeFolderPath("  Private/ "), "Private");
    assert.equal(normalizeFolderPath("\\Private\\"), "Private");
    assert.equal(normalizeFolderPath(""), "");
  });

  it("matches only markdown under the folder", () => {
    assert.equal(isProtectedMarkdownPath("Private/a.md", "Private"), true);
    assert.equal(isProtectedMarkdownPath("Private/sub/b.md", "Private"), true);
    assert.equal(isProtectedMarkdownPath("Private/a.txt", "Private"), false);
    assert.equal(isProtectedMarkdownPath("PrivateNotes/a.md", "Private"), false);
    assert.equal(isProtectedMarkdownPath("other/a.md", "Private"), false);
    assert.equal(isProtectedMarkdownPath("Private/a.md", ""), false);
  });
});
