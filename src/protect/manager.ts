import type { App } from "obsidian";
import { TFile, normalizePath } from "obsidian";
import type { ZyncSettings } from "../types";
import {
  CryptoError,
  createVerifier,
  decryptMarkdown,
  deriveKey,
  encryptMarkdown,
  fromHex,
  isEncryptedBytes,
  isEncryptedEnvelope,
  parseEnvelope,
  randomBytes,
  SALT_BYTES,
  stringFromArrayBuffer,
  toHex,
  verifyPassword,
  arrayBufferFromString,
} from "./crypto";
import { isProtectedMarkdownPath, normalizeFolderPath } from "./paths";
import { shouldPromotePartial } from "./sync-guard";

export const PARTIAL_SUFFIX = ".zync-partial";

export type PersistSettings = () => Promise<void>;

export interface ProtectResult {
  encrypted: number;
  decrypted: number;
  skipped: number;
  errors: string[];
}

/**
 * Manages a single password-protected vault folder.
 * Password and AES key live only in memory while unlocked.
 */
export class ProtectedFolderManager {
  private key: CryptoKey | null = null;
  private salt: Uint8Array | null = null;

  constructor(
    private app: App,
    private getSettings: () => ZyncSettings,
    private persistSettings: PersistSettings,
  ) {}

  isConfigured(): boolean {
    const s = this.getSettings();
    return (
      !!normalizeFolderPath(s.protectedFolder) &&
      !!s.protectedSalt &&
      !!s.protectedVerifierNonce &&
      !!s.protectedVerifierCipher
    );
  }

  getFolder(): string {
    return normalizeFolderPath(this.getSettings().protectedFolder);
  }

  isUnlocked(): boolean {
    return this.key != null && this.salt != null;
  }

  isLocked(): boolean {
    return this.isConfigured() && !this.isUnlocked();
  }

  isProtectedPath(path: string): boolean {
    return isProtectedMarkdownPath(path, this.getFolder());
  }

  isEncryptedData(data: ArrayBuffer | Uint8Array | string): boolean {
    if (typeof data === "string") return isEncryptedEnvelope(data);
    return isEncryptedBytes(data);
  }

  /** Clear in-memory key (does not change files). */
  clearSession(): void {
    this.key = null;
    this.salt = null;
  }

  listProtectedMarkdownFiles(folder = this.getFolder()): TFile[] {
    if (!folder) return [];
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => isProtectedMarkdownPath(f.path, folder));
  }

  /**
   * Enable protection on a folder.
   * If the folder already has Zync-encrypted notes (e.g. synced from another device),
   * adopts their salt instead of minting a new one — phone-friendly multi-device setup.
   * Ends locked.
   */
  async enable(folder: string, password: string): Promise<ProtectResult> {
    const normalized = normalizeFolderPath(folder);
    if (!normalized) throw new CryptoError("Choose a folder to protect");
    if (!password || password.length < 1) throw new CryptoError("Password required");

    if (this.isConfigured() && this.getFolder() !== normalized) {
      throw new CryptoError(
        "A protected folder is already configured. Disable it before choosing another.",
      );
    }

    const existing = await this.findEncryptedSample(normalized);
    if (existing) {
      await this.adoptFromEncryptedFile(normalized, password, existing.file, existing.text);
      return {
        encrypted: 0,
        decrypted: 0,
        skipped: this.listProtectedMarkdownFiles(normalized).length,
        errors: [],
      };
    }

    const salt = this.getSettings().protectedSalt
      ? fromHex(this.getSettings().protectedSalt)
      : randomBytes(SALT_BYTES);
    if (salt.byteLength !== SALT_BYTES) throw new CryptoError("Invalid stored salt");

    await this.persistProtectionMeta(normalized, password, salt);

    this.key = await deriveKey(password, salt);
    this.salt = salt;

    const result = await this.encryptAllProtectedFiles();
    this.clearSession();
    return result;
  }

  /**
   * Link this device to an already-protected folder by reading salt from encrypted notes.
   * Saves local verifier metadata, then unlocks (decrypts) for editing.
   */
  async connectAndUnlock(folder: string, password: string): Promise<ProtectResult> {
    const normalized = normalizeFolderPath(folder);
    if (!normalized) throw new CryptoError("Choose a folder to protect");
    if (!password || password.length < 1) throw new CryptoError("Password required");

    if (this.isConfigured() && this.getFolder() !== normalized) {
      throw new CryptoError(
        "A protected folder is already configured. Disable it before choosing another.",
      );
    }

    const existing = await this.findEncryptedSample(normalized);
    if (!existing) {
      throw new CryptoError(
        `No encrypted notes found in "${normalized}". Sync from your other device first, or use Enable & encrypt.`,
      );
    }

    await this.adoptFromEncryptedFile(normalized, password, existing.file, existing.text);
    return this.unlock(password);
  }

  /** Remove protection metadata. Requires unlock (or empty folder). Does not decrypt — call unlock/decrypt first. */
  async disable(): Promise<void> {
    if (this.isConfigured() && this.isLocked()) {
      throw new CryptoError("Unlock the protected folder before disabling protection");
    }
    if (this.isUnlocked()) {
      await this.decryptAllProtectedFiles();
    }
    const settings = this.getSettings();
    settings.protectedFolder = "";
    settings.protectedSalt = "";
    settings.protectedVerifierNonce = "";
    settings.protectedVerifierCipher = "";
    this.clearSession();
    await this.persistSettings();
  }

  async unlock(password: string): Promise<ProtectResult> {
    if (!this.isConfigured()) throw new CryptoError("No protected folder configured");
    const settings = this.getSettings();
    const salt = fromHex(settings.protectedSalt);
    const key = await deriveKey(password, salt);
    const ok = await verifyPassword(
      key,
      settings.protectedVerifierNonce,
      settings.protectedVerifierCipher,
    );
    if (!ok) throw new CryptoError("Incorrect password");

    this.key = key;
    this.salt = salt;
    const result = await this.decryptAllProtectedFiles();
    if (result.errors.length) {
      this.clearSession();
      throw new CryptoError(result.errors[0]);
    }
    return result;
  }

  private async findEncryptedSample(
    folder: string,
  ): Promise<{ file: TFile; text: string } | null> {
    for (const file of this.listProtectedMarkdownFiles(folder)) {
      const text = await this.app.vault.read(file);
      if (isEncryptedEnvelope(text)) return { file, text };
    }
    return null;
  }

  private async adoptFromEncryptedFile(
    folder: string,
    password: string,
    sample: TFile,
    envelopeText: string,
  ): Promise<void> {
    const salt = parseEnvelope(envelopeText).salt;
    const key = await deriveKey(password, salt);
    try {
      await decryptMarkdown(envelopeText, key, sample.path, salt);
    } catch {
      throw new CryptoError("Incorrect password (could not decrypt synced notes)");
    }
    await this.persistProtectionMeta(folder, password, salt);
    this.clearSession();
  }

  private async persistProtectionMeta(
    folder: string,
    password: string,
    salt: Uint8Array,
  ): Promise<void> {
    const key = await deriveKey(password, salt);
    const verifier = await createVerifier(key);
    const settings = this.getSettings();
    settings.protectedFolder = folder;
    settings.protectedSalt = toHex(salt);
    settings.protectedVerifierNonce = verifier.nonceHex;
    settings.protectedVerifierCipher = verifier.cipherHex;
    await this.persistSettings();
  }

  /**
   * Encrypt all protected notes and clear the in-memory key.
   * Refuses to leave plaintext on disk if encryption fails mid-way for a file
   * (each file is replaced atomically only after a successful encrypt+verify).
   */
  async lock(): Promise<ProtectResult> {
    if (!this.isConfigured()) throw new CryptoError("No protected folder configured");
    if (!this.isUnlocked()) {
      // Already locked — still try to encrypt any stray plaintext notes if we can't (no key).
      return { encrypted: 0, decrypted: 0, skipped: 0, errors: ["Folder is already locked"] };
    }
    const result = await this.encryptAllProtectedFiles();
    this.clearSession();
    return result;
  }

  /**
   * Produce encrypted bytes for upload. Never returns plaintext for protected paths.
   * When unlocked and local file is plaintext, encrypts in memory (disk unchanged).
   */
  async bytesForUpload(path: string, localBytes: ArrayBuffer): Promise<ArrayBuffer> {
    if (!this.isProtectedPath(path)) return localBytes;

    if (this.isEncryptedData(localBytes)) {
      return localBytes;
    }

    if (!this.isUnlocked() || !this.key || !this.salt) {
      throw new CryptoError(
        `Refusing to upload plaintext protected file (folder locked): ${path}`,
      );
    }

    const text = stringFromArrayBuffer(localBytes);
    const envelope = await encryptMarkdown(text, this.key, this.salt, path);
    return arrayBufferFromString(envelope);
  }

  /**
   * After download: always keep encrypted bytes on disk when locked;
   * decrypt in place when unlocked.
   */
  async materializeDownload(path: string, downloaded: ArrayBuffer): Promise<ArrayBuffer> {
    if (!this.isProtectedPath(path)) return downloaded;

    // Remote protected notes must stay encrypted in transit; if somehow plaintext arrives, encrypt when possible.
    if (!this.isEncryptedData(downloaded)) {
      if (this.isUnlocked() && this.key && this.salt) {
        const envelope = await encryptMarkdown(
          stringFromArrayBuffer(downloaded),
          this.key,
          this.salt,
          path,
        );
        downloaded = arrayBufferFromString(envelope);
      } else {
        throw new CryptoError(
          `Downloaded protected file is not encrypted; refusing to write plaintext: ${path}`,
        );
      }
    }

    if (this.isUnlocked() && this.key && this.salt) {
      const plain = await decryptMarkdown(
        stringFromArrayBuffer(downloaded),
        this.key,
        path,
        this.salt,
      );
      return arrayBufferFromString(plain);
    }

    return downloaded;
  }

  async recoverPartials(): Promise<void> {
    const files = this.app.vault.getFiles();
    for (const f of files) {
      if (!f.path.endsWith(PARTIAL_SUFFIX)) continue;
      const targetPath = f.path.slice(0, -PARTIAL_SUFFIX.length);
      try {
        const partialData = await this.app.vault.readBinary(f);
        const target = this.app.vault.getAbstractFileByPath(normalizePath(targetPath));
        if (target instanceof TFile) {
          const targetData = await this.app.vault.readBinary(target);
          const action = shouldPromotePartial({
            isProtectedPath: this.isProtectedPath(targetPath),
            targetExists: true,
            targetIsEncrypted: this.isEncryptedData(targetData),
          });
          if (action === "discard-partial") {
            await this.app.fileManager.trashFile(f);
            continue;
          }
          await this.app.vault.modifyBinary(target, partialData);
          await this.app.fileManager.trashFile(f);
        } else {
          await this.app.vault.createBinary(normalizePath(targetPath), partialData);
          await this.app.fileManager.trashFile(f);
        }
      } catch (e) {
        console.warn("Zync: failed to recover partial", f.path, e);
      }
    }
  }

  private async encryptAllProtectedFiles(): Promise<ProtectResult> {
    if (!this.key || !this.salt) throw new CryptoError("Not unlocked");
    const result: ProtectResult = { encrypted: 0, decrypted: 0, skipped: 0, errors: [] };
    for (const file of this.listProtectedMarkdownFiles()) {
      try {
        const raw = await this.app.vault.read(file);
        if (isEncryptedEnvelope(raw)) {
          result.skipped++;
          continue;
        }
        const envelope = await encryptMarkdown(raw, this.key, this.salt, file.path);
        // Verify before replace
        const roundtrip = await decryptMarkdown(envelope, this.key, file.path, this.salt);
        if (roundtrip !== raw) {
          throw new CryptoError(`Encrypt verify failed for ${file.path}`);
        }
        await this.atomicWriteText(file, envelope);
        result.encrypted++;
      } catch (e) {
        result.errors.push(`${file.path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return result;
  }

  private async decryptAllProtectedFiles(): Promise<ProtectResult> {
    if (!this.key || !this.salt) throw new CryptoError("Not unlocked");
    const result: ProtectResult = { encrypted: 0, decrypted: 0, skipped: 0, errors: [] };
    for (const file of this.listProtectedMarkdownFiles()) {
      try {
        const raw = await this.app.vault.read(file);
        if (!isEncryptedEnvelope(raw)) {
          result.skipped++;
          continue;
        }
        const plain = await decryptMarkdown(raw, this.key, file.path, this.salt);
        // Ensure we never replace encrypted content with empty/corrupt plaintext blindly:
        // decryptMarkdown already authenticates via GCM tag.
        await this.atomicWriteText(file, plain);
        result.decrypted++;
      } catch (e) {
        result.errors.push(`${file.path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return result;
  }

  /**
   * Write via a sibling partial file, then replace the target.
   * If the process dies after partial write, recoverPartials can finish or discard safely.
   */
  private async atomicWriteText(file: TFile, contents: string): Promise<void> {
    const partialPath = normalizePath(file.path + PARTIAL_SUFFIX);
    const data = arrayBufferFromString(contents);

    const existingPartial = this.app.vault.getAbstractFileByPath(partialPath);
    if (existingPartial instanceof TFile) {
      await this.app.vault.modifyBinary(existingPartial, data);
    } else {
      await this.app.vault.createBinary(partialPath, data);
    }

    // Replace target only after partial exists on disk
    await this.app.vault.modifyBinary(file, data);

    const partial = this.app.vault.getAbstractFileByPath(partialPath);
    if (partial) {
      await this.app.fileManager.trashFile(partial);
    }
  }

  /** Read salt from an encrypted envelope (for diagnostics / future multi-device). */
  readSaltFromEnvelope(text: string): string {
    return toHex(parseEnvelope(text).salt);
  }
}
