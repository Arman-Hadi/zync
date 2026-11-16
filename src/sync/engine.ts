import type { App } from "obsidian";
import { S3Client } from "../s3/client";
import { hashArrayBuffer } from "../s3/sigv4";
import {
  deleteLocal,
  listLocalFiles,
  readBinary,
  renameAside,
  writeBinary,
} from "../local/vault-io";
import type { MetaStore } from "../local/meta-store";
import type {
  FileMeta,
  SyncResult,
  SyncState,
  ZyncSettings,
} from "../types";
import { applyTombstone, clearTombstone, planSync } from "./planner";

function conflictStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}`
  );
}

export class SyncEngine {
  private running = false;

  constructor(
    private app: App,
    private settings: ZyncSettings,
    private s3: S3Client,
    private meta: MetaStore,
    private persist: (state: SyncState) => Promise<void>,
  ) {}

  updateSettings(settings: ZyncSettings) {
    this.settings = settings;
    this.s3.updateSettings(settings);
  }

  isRunning(): boolean {
    return this.running;
  }

  async sync(): Promise<SyncResult> {
    if (this.running) {
      return {
        uploaded: 0,
        downloaded: 0,
        deletedRemote: 0,
        deletedLocal: 0,
        conflicts: 0,
        skipped: 0,
        errors: ["Sync already in progress"],
        durationMs: 0,
      };
    }

    this.running = true;
    const started = Date.now();
    const result: SyncResult = {
      uploaded: 0,
      downloaded: 0,
      deletedRemote: 0,
      deletedLocal: 0,
      conflicts: 0,
      skipped: 0,
      errors: [],
      durationMs: 0,
    };

    try {
      this.assertConfigured();
      let state = this.meta.get();
      const localFiles = listLocalFiles(this.app, this.settings.ignorePatterns);
      const remoteFiles = await this.s3.listAll();

      // Enrich remote with HEAD metadata when list lacks user-meta (ListObjects doesn't return x-amz-meta)
      // For v1 we rely on etag + optional head for conflict paths only; upload always writes meta.

      const localHashes: Record<string, string> = {};
      for (const f of localFiles) {
        try {
          const buf = await readBinary(this.app, f.path);
          localHashes[f.path] = await hashArrayBuffer(buf);
        } catch (e) {
          result.errors.push(`Hash ${f.path}: ${String(e)}`);
        }
      }

      // Record deletes: paths in state.files but not local → tombstone
      for (const path of Object.keys(state.files)) {
        if (!localFiles.some((f) => f.path === path) && !state.tombstones[path]) {
          state = applyTombstone(state, path, Date.now());
        }
      }

      const actions = planSync(state, localFiles, remoteFiles, localHashes);

      for (const action of actions) {
        try {
          if (action.type === "upload") {
            state = await this.doUpload(state, action.path, localHashes[action.path]);
            result.uploaded++;
          } else if (action.type === "download") {
            state = await this.doDownload(state, action.path);
            result.downloaded++;
          } else if (action.type === "deleteRemote") {
            await this.s3.deleteObject(action.path);
            state = clearTombstone(state, action.path);
            result.deletedRemote++;
          } else if (action.type === "deleteLocal") {
            await deleteLocal(this.app, action.path);
            const files = { ...state.files };
            delete files[action.path];
            state = { ...state, files };
            result.deletedLocal++;
          } else if (action.type === "conflict") {
            await renameAside(this.app, action.path, conflictStamp());
            state = await this.doDownload(state, action.path);
            result.conflicts++;
          }
        } catch (e) {
          result.errors.push(`${action.type} ${action.path}: ${String(e)}`);
        }
      }

      state = { ...state, lastSyncAt: Date.now() };
      await this.persist(state);
    } catch (e) {
      result.errors.push(String(e));
    } finally {
      this.running = false;
      result.durationMs = Date.now() - started;
    }

    return result;
  }

  private assertConfigured() {
    const s = this.settings;
    if (!s.bucket.trim() || !s.accessKeyId.trim() || !s.secretAccessKey.trim()) {
      throw new Error("Configure bucket, access key, and secret key in Zync settings.");
    }
    if (!s.endpoint.trim() && !s.region.trim()) {
      throw new Error("Set an endpoint (for R2/MinIO/B2) or an AWS region.");
    }
  }

  private async doUpload(
    state: SyncState,
    path: string,
    hash?: string,
  ): Promise<SyncState> {
    const buf = await readBinary(this.app, path);
    const contentHash = hash ?? (await hashArrayBuffer(buf));
    const file = this.app.vault.getAbstractFileByPath(path);
    const mtime =
      file && "stat" in file ? (file as { stat: { mtime: number } }).stat.mtime : Date.now();
    const { etag } = await this.s3.putObject(path, buf, {
      mtime,
      hash: contentHash,
    });
    const meta: FileMeta = {
      path,
      hash: contentHash,
      mtime,
      etag,
      size: buf.byteLength,
    };
    const files = { ...state.files, [path]: meta };
    let next = { ...state, files };
    next = clearTombstone(next, path);
    return next;
  }

  private async doDownload(state: SyncState, path: string): Promise<SyncState> {
    const obj = await this.s3.getObject(path);
    const hash = obj.metaHash ?? (await hashArrayBuffer(obj.body));
    const mtime = obj.metaMtime ?? Date.now();
    await writeBinary(this.app, path, obj.body, mtime);
    const meta: FileMeta = {
      path,
      hash,
      mtime,
      etag: obj.etag,
      size: obj.body.byteLength,
    };
    const files = { ...state.files, [path]: meta };
    let next = { ...state, files };
    next = clearTombstone(next, path);
    return next;
  }
}
