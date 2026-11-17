# Zync

Two-way Obsidian vault sync over **S3-compatible** storage. One plugin build works on **desktop and mobile**.

Works with Cloudflare R2, AWS S3, Backblaze B2, MinIO, and other SigV4 S3 APIs. No VPS required.

## Features

- Manual sync (ribbon + command) and optional interval / sync-on-load
- Upload, download, and delete propagation across devices
- Conflict copies when both sides edited the same file
- Ignore globs (`.obsidian` and `.trash` are always skipped)
- Mobile-safe networking via Obsidian `requestUrl` + Web Crypto SigV4

## Install

### From Community plugins (after approval)

Settings → Community plugins → Browse → search **Zync** → Install → Enable.

### Manual / BRAT

1. Create `<vault>/.obsidian/plugins/zync/`
2. Copy `manifest.json`, `main.js`, and `styles.css` from a [GitHub release](https://github.com/Arman-Hadi/zync/releases)
3. Enable **Zync** under Community plugins

## Setup

1. Create an S3-compatible bucket and keys with list/get/put/delete.
2. Open **Settings → Zync**.
3. Enter endpoint, region, bucket, and keys.
4. Click **Test connection**, then **Sync**.

Use the **same** bucket settings on every device.

### Provider tips

| Provider | Endpoint | Region | Path-style |
| --- | --- | --- | --- |
| Cloudflare R2 | `https://<accountid>.r2.cloudflarestorage.com` | `auto` | try either |
| AWS S3 | *(leave empty)* | your region | usually off |
| MinIO | your MinIO HTTPS URL | e.g. `us-east-1` | **on** |
| Backblaze B2 | S3 endpoint from B2 | B2 region | usually on |

Optional **key prefix** lets several vaults share one bucket.

## How sync works

- Compares local files with remote objects under your prefix
- Uploads newer/missing local files; downloads newer/missing remote files
- Propagates deletes via tombstones
- If both sides changed the same path: renames local to `name (conflict YYYYMMDD-HHMM).ext` and downloads remote

**Privacy:** files are stored in your bucket in plain form (no end-to-end encryption in v1). Credentials stay in the vault’s plugin data (`data.json`) on each device.

## Commands

- Ribbon refresh icon → sync now
- Command palette: **Zync: Sync now**, **Zync: Test S3 connection**

## Develop

```bash
npm install
npm run dev    # watch build → main.js
npm run build  # production build
```

Reload Obsidian (or toggle the plugin) after rebuilds.

## License

MIT
