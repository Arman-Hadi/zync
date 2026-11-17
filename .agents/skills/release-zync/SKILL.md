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
4. `npm test && npm run build`
5. Commit all intended sources + `main.js` / `styles.css` (this repo ships the bundle).
6. `git push origin HEAD`
7. `git tag <version> && git push origin <version>`
8. Watch `.github/workflows/release.yml` — it builds, attests, and `gh release create`s with `main.js`, `manifest.json`, `styles.css`.

## Verify

```bash
gh run list --workflow=release.yml --limit 1
gh release view <version>
```

## Notes

- Community directory listing is separate (`obsidianmd/obsidian-releases`); a GitHub release is required for updates once listed / for BRAT.
- Do not force-push tags. Do not skip the workflow by uploading a hand-built `main.js` unless the user asks.
