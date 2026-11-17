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

- Vault config dir (`Vault#configDir`, not a hardcoded `.obsidian`) and `.trash` are always ignored — plugin settings are **per device**, not synced by Zync.
- Networking must stay on `requestUrl` + Web Crypto (mobile-safe). No Node `http` in runtime plugin code.
- Desktop-only exception: protected-folder quit flush may use Node `fs` via `Platform.isDesktop` + `window.require?.("fs")` (never bare `require("fs")` / `path`; join paths manually). Disclose in README.
- `minAppVersion` is **1.13.0+**: settings are `getSettingDefinitions()` only (no `display()`). Do not call APIs newer than `minAppVersion` without raising it.
- Prefer `window.setTimeout` / `clearTimeout` and `activeDocument` for popout compatibility. Avoid success `console.info`; keep error logs sparse.
- Build: `npm run build` → `main.js` (esbuild). Lint: `npm run lint` (eslint-plugin-obsidianmd). Release: tag push → `.github/workflows/release.yml`.
