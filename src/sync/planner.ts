import type {
  FileMeta,
  LocalFileInfo,
  RemoteObject,
  SyncAction,
  SyncState,
  Tombstone,
} from "../types";

const SKEW_MS = 2000;

export function planSync(
  state: SyncState,
  localFiles: LocalFileInfo[],
  remoteFiles: RemoteObject[],
  localHashes: Record<string, string>,
): SyncAction[] {
  const actions: SyncAction[] = [];
  const localMap = new Map(localFiles.map((f) => [f.path, f]));
  const remoteMap = new Map(remoteFiles.map((f) => [f.path, f]));
  const known = new Set([
    ...localMap.keys(),
    ...remoteMap.keys(),
    ...Object.keys(state.files),
    ...Object.keys(state.tombstones),
  ]);

  for (const path of known) {
    const local = localMap.get(path);
    const remote = remoteMap.get(path);
    const prev = state.files[path];
    const tomb = state.tombstones[path];

    if (tomb && !local) {
      if (remote) {
        const remoteMtime = remoteMtimeOf(remote);
        if (tomb.deletedAt >= remoteMtime - SKEW_MS) {
          actions.push({ type: "deleteRemote", path });
        } else {
          // Remote was rewritten after our delete — download
          actions.push({ type: "download", path });
        }
      }
      continue;
    }

    if (local && !remote) {
      if (prev && hashesMatch(prev, localHashes[path]) && !changedLocally(prev, local, localHashes[path])) {
        // Previously synced file vanished remotely → delete local
        actions.push({ type: "deleteLocal", path });
      } else {
        actions.push({ type: "upload", path });
      }
      continue;
    }

    if (!local && remote) {
      if (prev) {
        // Local deleted without tombstone yet — treat as download if we can't prove delete
        actions.push({ type: "download", path });
      } else {
        actions.push({ type: "download", path });
      }
      continue;
    }

    if (local && remote) {
      const localHash = localHashes[path];
      const localChanged = !prev || changedLocally(prev, local, localHash);
      const remoteChanged = !prev || changedRemotely(prev, remote);

      if (!localChanged && !remoteChanged) {
        continue;
      }
      if (localChanged && !remoteChanged) {
        actions.push({ type: "upload", path });
        continue;
      }
      if (!localChanged && remoteChanged) {
        actions.push({ type: "download", path });
        continue;
      }
      // Both changed
      if (localHash && remote.metaHash && localHash === remote.metaHash) {
        // Same content — just refresh meta via upload of identical bytes skipped; treat as noop upload meta
        continue;
      }
      actions.push({ type: "conflict", path });
    }
  }

  return actions;
}

function hashesMatch(prev: FileMeta, hash: string | undefined): boolean {
  return !!hash && prev.hash === hash;
}

function changedLocally(prev: FileMeta, local: LocalFileInfo, hash: string | undefined): boolean {
  if (hash && prev.hash && hash !== prev.hash) return true;
  if (Math.abs(local.mtime - prev.mtime) > SKEW_MS) return true;
  if (local.size !== (prev.size ?? local.size) && hash && prev.hash && hash !== prev.hash) return true;
  return false;
}

function changedRemotely(prev: FileMeta, remote: RemoteObject): boolean {
  if (remote.metaHash && prev.hash && remote.metaHash !== prev.hash) return true;
  if (prev.etag && remote.etag && prev.etag !== remote.etag) return true;
  const rMtime = remoteMtimeOf(remote);
  if (prev.mtime && Math.abs(rMtime - prev.mtime) > SKEW_MS && remote.etag !== prev.etag) {
    return true;
  }
  if (!prev.etag && remote.etag) {
    // First sync after upgrade — if hashes match treat as same
    if (remote.metaHash && remote.metaHash === prev.hash) return false;
    return remote.etag !== prev.hash;
  }
  return false;
}

function remoteMtimeOf(remote: RemoteObject): number {
  return remote.metaMtime || remote.lastModified || 0;
}

export function applyTombstone(state: SyncState, path: string, deletedAt: number): SyncState {
  const files = { ...state.files };
  delete files[path];
  const tombstones: Record<string, Tombstone> = {
    ...state.tombstones,
    [path]: { path, deletedAt },
  };
  return { ...state, files, tombstones };
}

export function clearTombstone(state: SyncState, path: string): SyncState {
  const tombstones = { ...state.tombstones };
  delete tombstones[path];
  return { ...state, tombstones };
}
