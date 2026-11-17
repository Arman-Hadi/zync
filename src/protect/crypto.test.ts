import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createVerifier,
  decryptMarkdown,
  deriveKey,
  encryptMarkdown,
  fromHex,
  isEncryptedEnvelope,
  parseEnvelope,
  PBKDF2_ITERATIONS,
  randomBytes,
  SALT_BYTES,
  toHex,
  verifyPassword,
  ENC_VERSION,
} from "./crypto";

const FAST_ITERS = 10_000;

describe("protect/crypto", () => {
  it("encrypts and decrypts markdown round-trip", async () => {
    const salt = randomBytes(SALT_BYTES);
    const key = await deriveKey("correct horse battery", salt, FAST_ITERS);
    const path = "Private/secret.md";
    const plain = "# Hello\n\nSensitive **note** with unicode 🔐\n";

    const envelope = await encryptMarkdown(plain, key, salt, path);
    assert.equal(isEncryptedEnvelope(envelope), true);
    assert.match(envelope, /^ZYNCENC1\n/);

    const payload = parseEnvelope(envelope);
    assert.equal(payload.version, ENC_VERSION);
    assert.equal(payload.salt.byteLength, SALT_BYTES);
    assert.equal(toHex(payload.salt), toHex(salt));

    const out = await decryptMarkdown(envelope, key, path, salt);
    assert.equal(out, plain);
  });

  it("is deterministic for the same path and content", async () => {
    const salt = randomBytes(SALT_BYTES);
    const key = await deriveKey("pw", salt, FAST_ITERS);
    const path = "Private/a.md";
    const plain = "same content";
    const a = await encryptMarkdown(plain, key, salt, path);
    const b = await encryptMarkdown(plain, key, salt, path);
    assert.equal(a, b);
  });

  it("changes ciphertext when content changes", async () => {
    const salt = randomBytes(SALT_BYTES);
    const key = await deriveKey("pw", salt, FAST_ITERS);
    const path = "Private/a.md";
    const a = await encryptMarkdown("one", key, salt, path);
    const b = await encryptMarkdown("two", key, salt, path);
    assert.notEqual(a, b);
  });

  it("binds ciphertext to path (AAD)", async () => {
    const salt = randomBytes(SALT_BYTES);
    const key = await deriveKey("pw", salt, FAST_ITERS);
    const plain = "path-bound";
    const envelope = await encryptMarkdown(plain, key, salt, "Private/a.md");
    await assert.rejects(
      () => decryptMarkdown(envelope, key, "Private/b.md", salt),
      /Decryption failed/,
    );
  });

  it("rejects wrong password via verifier", async () => {
    const salt = randomBytes(SALT_BYTES);
    const key = await deriveKey("right", salt, FAST_ITERS);
    const wrong = await deriveKey("wrong", salt, FAST_ITERS);
    const { nonceHex, cipherHex } = await createVerifier(key);
    assert.equal(await verifyPassword(key, nonceHex, cipherHex), true);
    assert.equal(await verifyPassword(wrong, nonceHex, cipherHex), false);
  });

  it("stores salt and nonce in the envelope metadata", async () => {
    const salt = randomBytes(SALT_BYTES);
    const key = await deriveKey("pw", salt, FAST_ITERS);
    const envelope = await encryptMarkdown("meta", key, salt, "Private/m.md");
    const payload = parseEnvelope(envelope);
    assert.equal(payload.nonce.byteLength, 12);
    assert.equal(fromHex(toHex(payload.salt)).byteLength, SALT_BYTES);
  });

  it("uses production iteration count by default", async () => {
    assert.ok(PBKDF2_ITERATIONS >= 310_000);
  });
});
