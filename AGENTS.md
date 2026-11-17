# Agent guide (Zync)

Canonical agent docs live under **`.agents/`**. Cursor mirrors them under **`.cursor/`**.

```text
.agents/
  rules/           # shared rules (.md)
  skills/          # shared skills (*/SKILL.md)
.cursor/
  rules/           # Cursor .mdc wrappers (same bodies + frontmatter)
  skills/          # symlink → ../.agents/skills
```

## Always follow

- `.agents/rules/dual-write-agent-docs.md` — when writing rules/skills, update **both** trees
- `.agents/rules/zync-architecture.md` — plugin map and sync lifecycle
- `.agents/rules/protected-folder-safety.md` — encryption / no-plaintext-upload invariants

## Skills

| Skill | Use when |
| --- | --- |
| `protected-folder` | Changing lock/unlock, crypto, or protected sync hooks |
| `release-zync` | Version bump, tag, GitHub/Obsidian release |
| `install-local-plugin` | Copying build into a local Obsidian vault |

In Cursor, project skills are discovered via `.cursor/skills` (symlink).
