import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  arrayBufferFromString,
  deriveKey,
  encryptMarkdown,
  randomBytes,
  SALT_BYTES,
} from "./crypto";
import {
  assertSafeToUpload,
  chooseDownloadMaterialization,
  shouldPromotePartial,
} from "./sync-guard";

const FAST_ITERS = 10_000;

describe("protect/sync-guard", () => {
  it("allows encrypted uploads and refuses plaintext for protected paths", async () => {
    const salt = randomBytes(SALT_BYTES);
    const key = await deriveKey("pw", salt, FAST_ITERS);
    const path = "Private/note.md";
    const envelope = await encryptMarkdown("# hi", key, salt, path);

    assert.doesNotThrow(() =>
      assertSafeToUpload({
        path,
        protectedFolder: "Private",
        body: envelope,
      }),
    );

    assert.throws(
      () =>
        assertSafeToUpload({
          path,
          protectedFolder: "Private",
          body: "# hi\n",
        }),
      /Refusing plaintext upload/,
    );

    assert.doesNotThrow(() =>
      assertSafeToUpload({
        path: "Notes/open.md",
        protectedFolder: "Private",
        body: "# open\n",
      }),
    );
  });

  it("keeps downloads encrypted when locked and decrypts when unlocked", async () => {
    const salt = randomBytes(SALT_BYTES);
    const key = await deriveKey("pw", salt, FAST_ITERS);
    const path = "Private/note.md";
    const plain = "secret body";
    const envelope = await encryptMarkdown(plain, key, salt, path);
    const encBuf = arrayBufferFromString(envelope);
    const decBuf = arrayBufferFromString(plain);

    const locked = chooseDownloadMaterialization({
      path,
      protectedFolder: "Private",
      unlocked: false,
      encryptedBody: encBuf,
    });
    assert.equal(new TextDecoder().decode(locked), envelope);

    const unlocked = chooseDownloadMaterialization({
      path,
      protectedFolder: "Private",
      unlocked: true,
      encryptedBody: encBuf,
      decryptedBody: decBuf,
    });
    assert.equal(new TextDecoder().decode(unlocked), plain);
  });

  it("never promotes a partial over a valid encrypted protected target", () => {
    assert.equal(
      shouldPromotePartial({
        isProtectedPath: true,
        targetExists: true,
        targetIsEncrypted: true,
      }),
      "discard-partial",
    );
    assert.equal(
      shouldPromotePartial({
        isProtectedPath: true,
        targetExists: true,
        targetIsEncrypted: false,
      }),
      "promote",
    );
    assert.equal(
      shouldPromotePartial({
        isProtectedPath: true,
        targetExists: false,
        targetIsEncrypted: false,
      }),
      "promote",
    );
  });
});
