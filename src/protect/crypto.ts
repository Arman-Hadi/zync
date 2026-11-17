/** AES-256-GCM + PBKDF2-SHA256 envelope for protected Markdown files. */

export const ENC_VERSION = 1;
export const MAGIC_LINE = "ZYNCENC1";
export const SALT_BYTES = 16;
export const NONCE_BYTES = 12;
export const KEY_BITS = 256;
/** OWASP-recommended minimum for PBKDF2-SHA256 (2023). */
export const PBKDF2_ITERATIONS = 310_000;
export const VERIFIER_PLAINTEXT = "zync-protected-folder-v1";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/.test(clean)) {
    throw new CryptoError("Invalid hex string");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Fresh ArrayBuffer copy for Web Crypto BufferSource typing. */
function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function sha256(data: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  const digest = await crypto.subtle.digest("SHA-256", asBufferSource(copy));
  return new Uint8Array(digest);
}

export async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  if (!password) throw new CryptoError("Password required");
  if (salt.byteLength !== SALT_BYTES) {
    throw new CryptoError(`Salt must be ${SALT_BYTES} bytes`);
  }
  const baseKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: asBufferSource(salt),
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: KEY_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Deterministic 12-byte nonce bound to path + plaintext content. */
export async function deriveNonce(
  salt: Uint8Array,
  path: string,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const contentHash = await sha256(plaintext);
  const pathBytes = textEncoder.encode(path);
  const material = new Uint8Array(
    8 + salt.byteLength + pathBytes.byteLength + contentHash.byteLength,
  );
  material.set(textEncoder.encode("zyncnce1"), 0);
  material.set(salt, 8);
  material.set(pathBytes, 8 + salt.byteLength);
  material.set(contentHash, 8 + salt.byteLength + pathBytes.byteLength);
  const digest = await sha256(material);
  return digest.slice(0, NONCE_BYTES);
}

function aadForPath(path: string): Uint8Array {
  return textEncoder.encode(`zync-aad-v1:${path}`);
}

export interface EncryptedPayload {
  version: number;
  salt: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

/** Binary: version(1) | salt(16) | nonce(12) | ciphertext+tag */
export function packBinary(payload: EncryptedPayload): Uint8Array {
  const { version, salt, nonce, ciphertext } = payload;
  const out = new Uint8Array(1 + salt.byteLength + nonce.byteLength + ciphertext.byteLength);
  out[0] = version;
  out.set(salt, 1);
  out.set(nonce, 1 + salt.byteLength);
  out.set(ciphertext, 1 + salt.byteLength + nonce.byteLength);
  return out;
}

export function unpackBinary(data: Uint8Array): EncryptedPayload {
  const min = 1 + SALT_BYTES + NONCE_BYTES + 16;
  if (data.byteLength < min) throw new CryptoError("Encrypted payload too short");
  const version = data[0];
  if (version !== ENC_VERSION) {
    throw new CryptoError(`Unsupported encryption version: ${version}`);
  }
  const salt = data.slice(1, 1 + SALT_BYTES);
  const nonce = data.slice(1 + SALT_BYTES, 1 + SALT_BYTES + NONCE_BYTES);
  const ciphertext = data.slice(1 + SALT_BYTES + NONCE_BYTES);
  return { version, salt, nonce, ciphertext };
}

/** Text envelope stored inside .md files (safe for Obsidian). */
export function serializeEnvelope(binary: Uint8Array): string {
  const b64 = BufferCompat.toBase64(binary);
  return `${MAGIC_LINE}\n${b64}\n`;
}

export function isEncryptedEnvelope(text: string): boolean {
  const trimmed = text.replace(/^\uFEFF/, "").replace(/^\s+/, "");
  return trimmed.startsWith(MAGIC_LINE);
}

export function isEncryptedBytes(data: ArrayBuffer | Uint8Array): boolean {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  // Byte-level magic check (avoids TextDecoder edge cases on odd buffers).
  let offset = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    offset = 3;
  }
  while (
    offset < bytes.length &&
    (bytes[offset] === 0x20 ||
      bytes[offset] === 0x09 ||
      bytes[offset] === 0x0a ||
      bytes[offset] === 0x0d)
  ) {
    offset++;
  }
  const magic = textEncoder.encode(MAGIC_LINE);
  if (bytes.length < offset + magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[offset + i] !== magic[i]) return false;
  }
  return true;
}

export function parseEnvelope(text: string): EncryptedPayload {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  const lines = trimmed.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2 || lines[0] !== MAGIC_LINE) {
    throw new CryptoError("Not a Zync encrypted file");
  }
  const b64 = lines.slice(1).join("");
  const binary = BufferCompat.fromBase64(b64);
  return unpackBinary(binary);
}

export async function encryptMarkdown(
  plaintextUtf8: string | Uint8Array,
  key: CryptoKey,
  salt: Uint8Array,
  path: string,
): Promise<string> {
  const plaintext =
    typeof plaintextUtf8 === "string" ? textEncoder.encode(plaintextUtf8) : plaintextUtf8;
  const nonce = await deriveNonce(salt, path, plaintext);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: asBufferSource(nonce),
        additionalData: asBufferSource(aadForPath(path)),
      },
      key,
      asBufferSource(plaintext),
    ),
  );
  const packed = packBinary({ version: ENC_VERSION, salt, nonce, ciphertext });
  return serializeEnvelope(packed);
}

export async function decryptMarkdown(
  envelopeText: string,
  key: CryptoKey,
  path: string,
  expectedSalt?: Uint8Array,
): Promise<string> {
  const payload = parseEnvelope(envelopeText);
  if (expectedSalt && !bytesEqual(payload.salt, expectedSalt)) {
    throw new CryptoError("Salt mismatch for protected file");
  }
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asBufferSource(payload.nonce),
        additionalData: asBufferSource(aadForPath(path)),
      },
      key,
      asBufferSource(payload.ciphertext),
    );
    return textDecoder.decode(plain);
  } catch {
    throw new CryptoError("Decryption failed (wrong password or corrupted file)");
  }
}

export async function createVerifier(
  key: CryptoKey,
): Promise<{ nonceHex: string; cipherHex: string }> {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asBufferSource(nonce) },
      key,
      textEncoder.encode(VERIFIER_PLAINTEXT),
    ),
  );
  return { nonceHex: toHex(nonce), cipherHex: toHex(cipher) };
}

export async function verifyPassword(
  key: CryptoKey,
  nonceHex: string,
  cipherHex: string,
): Promise<boolean> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asBufferSource(fromHex(nonceHex)) },
      key,
      asBufferSource(fromHex(cipherHex)),
    );
    return textDecoder.decode(plain) === VERIFIER_PLAINTEXT;
  } catch {
    return false;
  }
}

/** Base64 helpers for Obsidian (browser) and Node tests — no Node Buffer. */
export const BufferCompat = {
  toBase64(bytes: Uint8Array): string {
    const chunk = 0x8000;
    let s = "";
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  },
  fromBase64(b64: string): Uint8Array {
    const clean = b64.replace(/\s+/g, "");
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

export function arrayBufferFromString(s: string): ArrayBuffer {
  const bytes = textEncoder.encode(s);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export function stringFromArrayBuffer(buf: ArrayBuffer): string {
  return textDecoder.decode(buf);
}
