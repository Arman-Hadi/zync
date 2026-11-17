# Protected folder safety

One optional vault folder can be password-protected. Markdown notes inside are encrypted when locked; S3 must never receive their plaintext.

## Crypto

- AES-256-GCM + PBKDF2-SHA256 (310k iterations)
- Envelope text starts with `ZYNCENC1` (version, salt, nonce, ciphertext)
- Never persist password or derived key — only salt + verifier blobs in settings
- Key lives in memory only while unlocked (`ProtectedFolderManager`)

## Sync rules

- Before upload: `bytesForUpload` / `assertSafeToUpload` — refuse plaintext for protected paths
- After download: keep ciphertext on disk if locked; decrypt only if unlocked
- Hash/compare the **encrypted** payload so unlock/lock mtime churn does not false-trigger uploads
- Deterministic nonce (path + content) so unchanged plaintext does not re-upload every sync

## Multi-device

Settings are local. Second device: **Connect & unlock** (or Enable when encrypted notes already exist) adopts salt from envelopes — do not mint a new salt over synced ciphertext.

## File ops

- Atomic writes via `.zync-partial`; `recoverPartials` must never promote a partial over a valid encrypted target
- Only `.md` under the chosen folder is protected
- While unlocked, keep a warm in-memory ciphertext cache (rebuild on unlock; refresh on modify).
- Background hide: `secureDisk({ clearSession: false })` then `resumeSession` on focus.
- Quit (`pagehide` / `beforeunload` / `onunload`): `emergencyQuitFlush` sync-writes cached envelopes via desktop `fs` and drops the key — do not rely on async vault writes surviving process death.
- Never `clearSession` on partial encrypt failure while the user is still in-session.
- If plaintext remains after a crashed quit, prompt once for `lockWithPassword` and skip sync-on-load until repaired.
