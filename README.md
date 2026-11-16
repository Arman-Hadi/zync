# Zync

Two-way Obsidian vault sync over **S3-compatible** storage. Same plugin build works on **desktop and mobile**.

No VPS required. Point Zync at Cloudflare R2, AWS S3, Backblaze B2, MinIO, or any SigV4 S3 API.

## Layout

This repo lives at `~/w/obsidian-sync/zync`. Sibling folders under `~/w/obsidian-sync/` (notes, secrets, etc.) are intentionally **outside** git.

## Install (dev)

1. `npm install`
2. `npm run build` (or `npm run dev` while editing)
3. Copy or symlink these files into your vault:

```
<vault>/.obsidian/plugins/zync/
  manifest.json
  main.js
  styles.css
```

4. Enable **Community plugins** → enable **Zync**.
5. Open Zync settings, enter bucket credentials, **Test connection**, then **Sync**.

### Mobile

Obsidian mobile loads community plugins from the vault’s `.obsidian/plugins` folder. After building on your laptop, copy `manifest.json`, `main.js`, and `styles.css` into that folder on the phone (USB, cloud folder, or by syncing `.obsidian/plugins/zync` once with another method). Then enable Zync and use the same S3 settings.

## Settings

| Field | Notes |
| --- | --- |
| Endpoint | Empty for AWS. Full HTTPS URL for R2 / MinIO / B2 |
| Region | e.g. `auto`, `us-east-1`, or your AWS region |
| Bucket | Bucket name |
| Access / secret key | IAM or provider keys with list/get/put/delete |
| Force path-style | On for MinIO and many compatible APIs |
| Key prefix | Optional vault root inside the bucket |
| Sync interval | Minutes; `0` = manual only |
| Ignore patterns | Extra globs (`.obsidian` / `.trash` always skipped) |

## How sync works

- Compares local vault files with remote objects under your prefix
- Uploads / downloads / deletes as needed
- Propagates deletes via tombstones across devices
- If both sides changed the same file: renames local to `name (conflict YYYYMMDD-HHMM).ext` and downloads remote

Objects are stored as plain files in the bucket (no E2E encryption in v0.1).

## Provider tips

- **Cloudflare R2:** endpoint `https://<accountid>.r2.cloudflarestorage.com`, region `auto`, path-style on or off both usually work — if listing fails, toggle path-style.
- **AWS S3:** leave endpoint empty, set region, path-style usually off.
- **MinIO:** set endpoint to your MinIO URL, path-style **on**.

## Commands

- Ribbon: refresh icon → sync now
- Command palette: **Zync: Sync now**, **Zync: Test S3 connection**

## Develop

```bash
cd ~/w/obsidian-sync/zync
npm install
npm run dev
```

Reload Obsidian (or disable/enable the plugin) after rebuilds.
