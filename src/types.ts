export interface ZyncSettings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  prefix: string;
  syncIntervalMinutes: number;
  syncOnLoad: boolean;
  ignorePatterns: string;
}

export const DEFAULT_SETTINGS: ZyncSettings = {
  endpoint: "",
  region: "auto",
  bucket: "",
  accessKeyId: "",
  secretAccessKey: "",
  forcePathStyle: true,
  prefix: "",
  syncIntervalMinutes: 5,
  syncOnLoad: true,
  ignorePatterns: "",
};

export interface FileMeta {
  /** Vault-relative path using forward slashes */
  path: string;
  /** Content hash (hex sha256) at last successful sync */
  hash: string;
  /** Local mtime ms at last successful sync */
  mtime: number;
  /** Remote ETag when known */
  etag?: string;
  /** Remote size when known */
  size?: number;
}

export interface Tombstone {
  path: string;
  deletedAt: number;
}

export interface SyncState {
  version: 1;
  files: Record<string, FileMeta>;
  tombstones: Record<string, Tombstone>;
  lastSyncAt: number | null;
}

export const EMPTY_SYNC_STATE: SyncState = {
  version: 1,
  files: {},
  tombstones: {},
  lastSyncAt: null,
};

export interface RemoteObject {
  key: string;
  path: string;
  size: number;
  lastModified: number;
  etag: string;
  metaMtime?: number;
  metaHash?: string;
}

export interface LocalFileInfo {
  path: string;
  mtime: number;
  size: number;
}

export type SyncAction =
  | { type: "upload"; path: string }
  | { type: "download"; path: string }
  | { type: "deleteRemote"; path: string }
  | { type: "deleteLocal"; path: string }
  | { type: "conflict"; path: string };

export interface SyncResult {
  uploaded: number;
  downloaded: number;
  deletedRemote: number;
  deletedLocal: number;
  conflicts: number;
  skipped: number;
  errors: string[];
  durationMs: number;
}
