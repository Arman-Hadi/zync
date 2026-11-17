import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createVerifier,
  decryptMarkdown,
  deriveKey,
  encryptMarkdown,
  isEncryptedEnvelope,
  randomBytes,
  SALT_BYTES,
  sha256,
  toHex,
  verifyPassword,
} from "./crypto";
import { shouldPromotePartial } from "./sync-guard";
import { planSync } from "../sync/planner";
import type { LocalFileInfo, RemoteObject, SyncState } from "../types";

async function hashText(s: string): Promise<string> {
  return toHex(await sha256(new TextEncoder().encode(s)));
}

const FAST_ITERS = 10_000;

/** Simulate enabling protection on existing plaintext notes without Obsidian APIs. */
async function protectFolderFiles(
  files: Record<string, string>,
  password: string,
  folder: string,
): Promise<{
  files: Record<string, string>;
  salt: Uint8Array;
  verifier: { nonceHex: string; cipherHex: string };
}> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, FAST_ITERS);
  const verifier = await createVerifier(key);
  const out: Record<string, string> = { ...files };
  for (const [path, body] of Object.entries(files)) {
    if (!path.startsWith(folder + "/") || !path.endsWith(".md")) continue;
    if (isEncryptedEnvelope(body)) continue;
    const envelope = await encryptMarkdown(body, key, salt, path);
    const check = await decryptMarkdown(envelope, key, path, salt);
    assert.equal(check, body, `lossless encrypt for ${path}`);
    out[path] = envelope;
  }
  return { files: out, salt, verifier };
}

describe("initial folder protection", () => {
  it("encrypts existing markdown without data loss", async () => {
    const password = "test-password";
    const before = {
      "Private/one.md": "# One\n",
      "Private/two.md": "two",
      "Private/skip.txt": "not markdown",
      "Notes/open.md": "open",
    };
    const { files, salt, verifier } = await protectFolderFiles(before, password, "Private");

    assert.equal(isEncryptedEnvelope(files["Private/one.md"]), true);
    assert.equal(isEncryptedEnvelope(files["Private/two.md"]), true);
    assert.equal(files["Private/skip.txt"], "not markdown");
    assert.equal(files["Notes/open.md"], "open");

    const key = await deriveKey(password, salt, FAST_ITERS);
    assert.equal(await verifyPassword(key, verifier.nonceHex, verifier.cipherHex), true);
    assert.equal(
      await decryptMarkdown(files["Private/one.md"], key, "Private/one.md", salt),
      "# One\n",
    );
  });

  it("second device can adopt salt from encrypted envelope without copying settings", async () => {
    const password = "shared-secret";
    const { files, salt } = await protectFolderFiles(
      { "Private/one.md": "synced secret" },
      password,
      "Private",
    );

    // Device B: only has the encrypted file — recover salt from envelope
    const { parseEnvelope, createVerifier, verifyPassword: verify } = await import("./crypto");
    const adoptedSalt = parseEnvelope(files["Private/one.md"]).salt;
    assert.equal(toHex(adoptedSalt), toHex(salt));

    const keyB = await deriveKey(password, adoptedSalt, FAST_ITERS);
    assert.equal(
      await decryptMarkdown(files["Private/one.md"], keyB, "Private/one.md", adoptedSalt),
      "synced secret",
    );
    const verifierB = await createVerifier(keyB);
    assert.equal(await verify(keyB, verifierB.nonceHex, verifierB.cipherHex), true);

    const wrongKey = await deriveKey("nope", adoptedSalt, FAST_ITERS);
    await assert.rejects(
      () => decryptMarkdown(files["Private/one.md"], wrongKey, "Private/one.md", adoptedSalt),
      /Decryption failed/,
    );
  });
});

describe("sync behavior with protected files", () => {
  it("plans upload of encrypted local protected notes and does not treat identical ciphertext as changed", async () => {
    const salt = randomBytes(SALT_BYTES);
    const key = await deriveKey("pw", salt, FAST_ITERS);
    const path = "Private/a.md";
    const envelope = await encryptMarkdown("body", key, salt, path);
    const hash = await hashText(envelope);
    const size = new TextEncoder().encode(envelope).byteLength;

    const state: SyncState = {
      version: 1,
      files: {
        [path]: { path, hash, mtime: 1000, size, etag: "abc" },
      },
      tombstones: {},
      lastSyncAt: null,
    };
    const local: LocalFileInfo[] = [{ path, mtime: 9999, size: 12 }];
    const remote: RemoteObject[] = [
      {
        key: path,
        path,
        size,
        lastModified: 1000,
        etag: "abc",
        metaHash: hash,
      },
    ];
    const actions = planSync(state, local, remote, { [path]: hash });
    assert.deepEqual(actions, []);
  });

  it("plans upload when unlocked plaintext content changes (ciphertext hash changes)", async () => {
    const salt = randomBytes(SALT_BYTES);
    const key = await deriveKey("pw", salt, FAST_ITERS);
    const path = "Private/a.md";
    const oldEnv = await encryptMarkdown("old", key, salt, path);
    const newEnv = await encryptMarkdown("new", key, salt, path);
    const oldHash = await hashText(oldEnv);
    const newHash = await hashText(newEnv);
    const oldSize = new TextEncoder().encode(oldEnv).byteLength;

    const state: SyncState = {
      version: 1,
      files: {
        [path]: { path, hash: oldHash, mtime: 1, size: oldSize, etag: "e1" },
      },
      tombstones: {},
      lastSyncAt: null,
    };
    const local: LocalFileInfo[] = [{ path, mtime: 2, size: 3 }];
    const remote: RemoteObject[] = [
      {
        key: path,
        path,
        size: oldSize,
        lastModified: 1,
        etag: "e1",
        metaHash: oldHash,
      },
    ];
    const actions = planSync(state, local, remote, { [path]: newHash });
    assert.deepEqual(actions, [{ type: "upload", path }]);
  });
});

describe("interrupted lock/unlock operations", () => {
  it("discards partial when encrypted target is intact", () => {
    assert.equal(
      shouldPromotePartial({
        isProtectedPath: true,
        targetExists: true,
        targetIsEncrypted: true,
      }),
      "discard-partial",
    );
  });

  it("promotes partial when target is missing (crash mid-create)", () => {
    assert.equal(
      shouldPromotePartial({
        isProtectedPath: true,
        targetExists: false,
        targetIsEncrypted: false,
      }),
      "promote",
    );
  });

  it("simulates crash after writing partial but before deleting it", async () => {
    const salt = randomBytes(SALT_BYTES);
    const key = await deriveKey("pw", salt, FAST_ITERS);
    const path = "Private/a.md";
    const plain = "original";
    const envelope = await encryptMarkdown(plain, key, salt, path);

    // Disk state: target already encrypted; leftover partial is stale plaintext
    const target = envelope;
    const partial = plain;
    assert.equal(isEncryptedEnvelope(target), true);
    assert.equal(isEncryptedEnvelope(partial), false);

    const action = shouldPromotePartial({
      isProtectedPath: true,
      targetExists: true,
      targetIsEncrypted: isEncryptedEnvelope(target),
    });
    assert.equal(action, "discard-partial");
    // Valid encrypted copy preserved
    assert.equal(await decryptMarkdown(target, key, path, salt), plain);
  });
});
