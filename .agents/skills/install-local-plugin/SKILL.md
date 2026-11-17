---
name: install-local-plugin
description: >-
  Build Zync and copy it into the user's local Obsidian vault plugin folder.
  Use when the user asks to update the plugin manually, install into Documents,
  or reload a local vault copy.
---

# Install local plugin

## Default vault path

`~/Documents/Obsidian Vault/.obsidian/plugins/zync/`

Confirm with `find ~/Documents -type d -name zync` if unsure.

## Steps

```bash
npm run build
cp main.js manifest.json styles.css "$HOME/Documents/Obsidian Vault/.obsidian/plugins/zync/"
```

- Preserve `data.json` (settings + sync state) — never overwrite it with repo files.
- Tell the user to reload the plugin (toggle Zync or restart Obsidian).
- Writing under Documents may require full permissions outside the sandbox.
