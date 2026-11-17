import { isEncryptedBytes, isEncryptedEnvelope } from "./crypto";
import { isProtectedMarkdownPath } from "./paths";

/**
 * Decide whether a buffer is safe to upload for a path under the current protection state.
 * Pure helper used by the sync engine and tests.
 */
export function assertSafeToUpload(options: {
  path: string;
  protectedFolder: string;
  body: ArrayBuffer | Uint8Array | string;
}): void {
  const { path, protectedFolder, body } = options;
  if (!isProtectedMarkdownPath(path, protectedFolder)) return;

  const encrypted =
    typeof body === "string" ? isEncryptedEnvelope(body) : isEncryptedBytes(body);
  if (!encrypted) {
    throw new Error(`Refusing plaintext upload for protected file: ${path}`);
  }
}

/**
 * After download: choose on-disk bytes.
 * - locked → keep ciphertext
 * - unlocked → plaintext (caller supplies already-decrypted buffer)
 */
export function chooseDownloadMaterialization(options: {
  path: string;
  protectedFolder: string;
  unlocked: boolean;
  encryptedBody: ArrayBuffer | Uint8Array;
  decryptedBody?: ArrayBuffer | Uint8Array;
}): ArrayBuffer | Uint8Array {
  const { path, protectedFolder, unlocked, encryptedBody, decryptedBody } = options;
  if (!isProtectedMarkdownPath(path, protectedFolder)) {
    return encryptedBody;
  }
  if (!isEncryptedBytes(encryptedBody)) {
    throw new Error(`Downloaded protected file is not encrypted: ${path}`);
  }
  if (unlocked) {
    if (!decryptedBody) {
      throw new Error(`Missing decrypted body for unlocked protected file: ${path}`);
    }
    return decryptedBody;
  }
  return encryptedBody;
}

/**
 * Recovery rule for `.zync-partial` siblings after an interrupted lock/unlock.
 * Never promote a partial over a valid encrypted target for a protected path.
 */
export function shouldPromotePartial(options: {
  isProtectedPath: boolean;
  targetExists: boolean;
  targetIsEncrypted: boolean;
}): "promote" | "discard-partial" {
  const { isProtectedPath, targetExists, targetIsEncrypted } = options;
  if (isProtectedPath && targetExists && targetIsEncrypted) {
    return "discard-partial";
  }
  return "promote";
}
