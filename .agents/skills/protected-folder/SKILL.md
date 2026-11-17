---
name: protected-folder
description: >-
  Implement or change Zync's password-protected folder encryption and its sync
  integration. Use when working on lock/unlock, AES-GCM envelopes, connect on
  another device, or ensuring protected notes never upload as plaintext.
---

# Protected folder

## Key modules

- `src/protect/crypto.ts` — PBKDF2, AES-GCM, envelope encode/decode
- `src/protect/manager.ts` — enable / connectAndUnlock / lock / unlock / download+upload hooks
- `src/protect/sync-guard.ts` — pure upload/download/partial recovery checks
- `src/protect/unlock-modal.ts` — command-palette password UI
- `src/sync/engine.ts` — calls `bytesForUpload` + `materializeDownload`

## Change checklist

1. Preserve “never upload plaintext” for protected paths.
2. Keep salt inside each encrypted file for multi-device adopt.
3. Use atomic `.zync-partial` writes; update `shouldPromotePartial` if recovery rules change.
4. Add/extend tests under `src/protect/*.test.ts` (`npm test`).
5. Manual install path for local vault: copy `main.js`, `manifest.json`, `styles.css` into `<vault>/.obsidian/plugins/zync/`.

## UX surfaces

- Settings → Protected folder: Enable & encrypt, Connect & unlock, Lock, Unlock, Disable
- Commands: Lock protected folder, Unlock protected folder (asks folder+password if not configured on this device)
