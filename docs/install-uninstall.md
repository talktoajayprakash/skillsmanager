# Install / Uninstall — Design Doc

## Problem

When a user installs `skillsmanager` via npm, agents on their machine don't know it exists. They need a skill file that teaches them how to use the CLI. Previously this was handled by a `postinstall` hook that automatically symlinked the skill to all agent directories — but users may not want skills written to their agent directories without explicit consent.

## Solution

Explicit `skillsmanager install` and `skillsmanager uninstall` commands that give the user full control over where the skill is installed.

## Commands

### `skillsmanager install`

| Usage | Effect |
|---|---|
| `skillsmanager install` | Install to all 8 supported agent directories |
| `skillsmanager install --agent claude` | Install to claude only |
| `skillsmanager install --agent claude,codex` | Install to specific agents (comma-separated) |
| `skillsmanager install --path ~/custom/dir` | Install to a custom directory |

### `skillsmanager uninstall`

| Usage | Effect |
|---|---|
| `skillsmanager uninstall` | Remove from all agent directories |
| `skillsmanager uninstall --agent claude` | Remove from specific agent(s) |
| `skillsmanager uninstall --path ~/custom/dir` | Remove from a custom directory |

## How It Works

### Bundled skill

A `SKILL.md` is bundled at `skills/skillsmanager/SKILL.md` in the npm package. This file teaches agents all skillsmanager commands, flags, and common workflows.

### Symlink architecture

```
~/.claude/skills/skillsmanager  →  <npm-package>/skills/skillsmanager/
~/.codex/skills/skillsmanager   →  <npm-package>/skills/skillsmanager/
~/.cursor/skills/skillsmanager  →  <npm-package>/skills/skillsmanager/
...
```

All symlinks point to the **same source directory** inside the installed npm package. This means:

1. **One copy, many agents** — no file duplication
2. **npm update propagates automatically** — when the package is updated, the source files change and all symlinks see the new content immediately
3. **Idempotent** — running `install` again replaces existing symlinks safely

### Safety rules

- If a non-symlink file/directory already exists at the target path, the command **skips** it with a warning. User files are never overwritten.
- `uninstall` only removes symlinks. If the path is not a symlink, it's skipped.
- Unknown agent names produce an error listing supported agents.

### Supported agents

Defined in `src/types.ts` as `AGENT_PATHS`:

| Agent | Global skills directory |
|---|---|
| claude | `~/.claude/skills` |
| codex | `~/.codex/skills` |
| agents | `~/.agents/skills` |
| cursor | `~/.cursor/skills` |
| windsurf | `~/.codeium/windsurf/skills` |
| copilot | `~/.copilot/skills` |
| gemini | `~/.gemini/skills` |
| roo | `~/.roo/skills` |

## Why Not postinstall?

The original approach used a `postinstall` npm hook. We moved away from it because:

1. **No consent** — writing to agent directories without asking is intrusive
2. **Side effects during install** — `npm install` should be predictable
3. **Hard to customize** — env vars are clunky compared to explicit flags
4. **CI/CD noise** — postinstall scripts run in CI where agent dirs don't exist, producing pointless warnings

Explicit commands are transparent, predictable, and give the user control.

## File Layout

```
skills/
└── skillsmanager/
    └── SKILL.md          # Bundled skill (agent-oriented usage guide)

src/commands/
└── install.ts            # install + uninstall command implementations

src/tests/
└── install.test.ts       # Tests for install/uninstall behavior
```

## Key Implementation Details

- `SKILL_SOURCE` is resolved relative to the compiled output (`dist/commands/install.js` → `../../skills/skillsmanager`), so it works whether the package is npm-linked or globally installed.
- Parent directories are created with `mkdirSync({ recursive: true })` — installing to `~/.gemini/skills/` works even if `~/.gemini/` doesn't exist yet.
- The `--agent` flag accepts a comma-separated list, allowing `skillsmanager install --agent claude,codex` in a single command.
