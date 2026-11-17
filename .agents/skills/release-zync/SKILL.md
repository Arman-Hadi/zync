---
name: release-zync
description: >-
  Version-bump Zync, rebuild, commit, tag, and publish a GitHub release for the
  Obsidian plugin. Use when the user asks to release, cut a version, ship to
  Community Plugins/BRAT, or publish a new Zync tag.
---

# Release Zync

## Steps

1. Decide semver: patch for fixes, minor for features (e.g. protected folder → `1.1.0`).
2. Update in lockstep:
   - `package.json` `version`
   - `manifest.json` `version`
   - `versions.json` → `"<version>": "<minAppVersion>"` (match `manifest.minAppVersion`)
3. Update `README.md` if user-facing behavior changed.
4. `npm test && npm run build && npm run lint`
5. Commit all intended sources + `main.js` / `styles.css` (this repo ships the bundle).
6. `git push origin HEAD`
7. `git tag <version> && git push origin <version>`
8. Watch `.github/workflows/release.yml` — it builds, attests, and `gh release create`s with `main.js`, `manifest.json`, `styles.css`.

## Verify

```bash
gh run list --workflow=release.yml --limit 1
gh release view <version>
```

## Community directory review (pre-submit)

Obsidian’s scanner runs `eslint-plugin-obsidianmd`. Before asking for a review resubmit, clear `npm run lint` and spot-check:

| Finding | Fix we use |
| --- | --- |
| API newer than `minAppVersion` | Raise `manifest.minAppVersion` / `versions.json` together, or drop the API |
| `display()` deprecated / leftover | With min **1.13.0+**, only `getSettingDefinitions()` + `this.update()`; no `display()` |
| Node `fs` / `path` / bare `require` | `Platform.isDesktop` guard + `window.require?.("fs")`; no `path` module |
| Hardcoded `.obsidian` | `app.vault.configDir` only |
| Undescribed `eslint-disable` | Prefer fixing the code; if a disable remains, add `-- reason` |
| Noisy `console.info` | Remove; keep rare `console.error` |
| Desktop filesystem behavior warning | Expected for quit flush — keep README disclosure |

Behavior notes like “vault enumeration” are normal for a sync plugin; do not “fix” by breaking sync.

## Notes

- Community directory listing is separate (`obsidianmd/obsidian-releases`); a GitHub release is required for updates once listed / for BRAT.
- Do not force-push tags. Do not skip the workflow by uploading a hand-built `main.js` unless the user asks.
