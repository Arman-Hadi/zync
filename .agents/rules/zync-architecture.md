# Zync architecture

Zync is an Obsidian community plugin: two-way vault sync over S3-compatible storage (desktop + mobile).

## Layout

| Path | Role |
| --- | --- |
| `src/main.ts` | Plugin lifecycle, commands, ribbon, interval sync |
| `src/settings.ts` | Settings tab (connection, sync, protected folder) |
| `src/types.ts` | `ZyncSettings`, sync state, actions |
| `src/sync/engine.ts` | Sync orchestration: hash, plan, upload/download/delete/conflict |
| `src/sync/planner.ts` | Pure sync decision logic |
| `src/s3/client.ts` | SigV4 S3 via Obsidian `requestUrl` |
| `src/s3/sigv4.ts` | Web Crypto signing + content hashing |
| `src/local/vault-io.ts` | List/read/write/delete/conflict-rename; ignore globs |
| `src/local/meta-store.ts` | Persists `zyncSyncState` beside settings in `data.json` |
| `src/protect/*` | Protected-folder crypto + lock/unlock + sync guards |

## Sync lifecycle (integration points)

1. `listLocalFiles` + `s3.listAll`
2. Hash **bytes that will be on S3** (`protection.bytesForUpload` for protected notes)
3. Tombstone local deletes → `planSync`
4. Execute: upload / download / deleteRemote / deleteLocal / conflict
5. Persist state via `MetaStore.save` (settings + sync state together)

## Constraints

- `.obsidian` and `.trash` are always ignored — plugin settings are **per device**, not synced by Zync.
- Networking must stay on `requestUrl` + Web Crypto (mobile-safe). No Node `fs` / `http` in runtime plugin code.
- Build: `npm run build` → `main.js` (esbuild). Release: tag push → `.github/workflows/release.yml`.
