# Skills Manager — CLI for Syncing Agent Skills Across Machines

## The Problem

Agent Skills (per the open standard at agentskills.io) are filesystem-based capability packages that live in:
- `~/.claude/skills/` — global skills, available to all projects
- `.claude/skills/` — project-scoped skills

This is powerful, but it creates a real pain point: **skills are trapped on the machine where you created them.** If you work across multiple machines, want to share skills with a team, or just want a backup, you have no native sync mechanism.

**Skills Manager** solves this by giving you a CLI to store skills in remote storage (Google Drive today, more backends later) and selectively fetch them into any agent's skills directory.

---

## What is a Skill?

A skill is a directory containing at minimum a `SKILL.md` file:

```
write-linkedin-post/
├── SKILL.md        ← required: YAML frontmatter (name, description) + instructions
├── REFERENCE.md    ← optional: reference docs the agent loads on demand
└── scripts/        ← optional: scripts the agent can invoke
```

`SKILL.md` frontmatter is the discovery contract:

```markdown
---
name: write-linkedin-post
description: Writes clear, concise LinkedIn posts with proper formatting
---
```

---

## Core Concepts

### Collections

A **collection** is a folder in remote storage containing a `SKILLS_SYNC.yaml` file and skill subdirectories. It's the unit of organization — one person might have one collection (`MY_SKILLS`), or multiple (`personal`, `work`).

Collections are automatically discovered by searching for any `SKILLS_SYNC.yaml` owned by the authenticated user.

### `SKILLS_SYNC.yaml`

The registry file that indexes all skills in a collection:

```yaml
name: personal
owner: you@gmail.com
skills:
  - name: write-linkedin-post
    path: write-linkedin-post/
    description: Writes clear, concise LinkedIn posts with proper formatting
  - name: code-review
    path: code-review/
    description: Opinionated code review workflow
```

- `name` is the logical name of the collection (without the `SKILLS_` Drive prefix)
- `owner` is the authenticated user's email
- Skills are globally unique by name within a collection

### Drive Folder Naming

All Google Drive folders created by Skills Manager are prefixed with `SKILLS_` to avoid collisions with regular Drive folders:

| Drive folder | Logical name (in YAML + CLI) |
|---|---|
| `SKILLS_MY_SKILLS` | `MY_SKILLS` |
| `SKILLS_work` | `work` |
| `SKILLS_personal` | `personal` |

The prefix is stripped everywhere in the CLI — users and agents always work with the clean logical name.

---

## CLI Commands

```bash
# Google Drive setup (human-facing, interactive)
skillsmanager setup google

# Discover / refresh collections
skillsmanager init
skillsmanager refresh

# Browse skills
skillsmanager list
skillsmanager search <query>

# Fetch a skill into an agent's skills directory
skillsmanager fetch <name> --agent <agent>

# Add a local skill to a collection
skillsmanager add <path>
skillsmanager add <path> --collection <name>

# Push local changes to an existing skill back to Drive
skillsmanager update <name>

# Manage collections
skillsmanager collection create [name]
```

### Agent-first design

All commands except `setup google` are **non-interactive** — they never block waiting for stdin. If something is missing (no collection, no credentials), they fail fast with a clear error message. This makes them safe to call from any AI agent.

---

## Authentication

No explicit login step required. Any command that needs Drive access calls `ensureAuth()` which:

1. Checks `~/.skillsmanager/credentials.json` exists — if not, throws with `Run: skillsmanager setup google`
2. Checks `~/.skillsmanager/token.json` exists — if not, launches the OAuth flow automatically
3. Returns the authenticated client with auto-refresh on token expiry

`skillsmanager setup google` is the one-time human-facing wizard that walks through:
1. Installing `gcloud` CLI (via Homebrew on macOS)
2. `gcloud auth login`
3. Creating or selecting a Google Cloud project
4. Enabling the Google Drive API
5. Opening the browser to create OAuth 2.0 Desktop credentials
6. Adding the authenticated user as a test user on the OAuth consent screen
7. Running the OAuth flow to save `token.json`

---

## Auto-Discovery

On first use of any command, `ensureReady()` runs `discoverCollections()` if no config exists yet:

```
Drive API query: name='SKILLS_SYNC.yaml' and 'me' in owners and trashed=false
```

For each match, fetches the parent folder name, strips the `SKILLS_` prefix, and stores the collection in `~/.skillsmanager/config.json`.

---

## Local Cache and Agent Symlinks

Skills are cached locally at:

```
~/.skillsmanager/cache/<collection-uuid>/<skill-name>/
```

The UUID is a stable identifier assigned per collection in `config.json`. It is backend-agnostic — it does not encode the backend type or folder ID. This keeps cache paths stable even if a collection is renamed or migrated to a different backend.

When `skillsmanager fetch write-linkedin-post --agent claude` is run:
1. Looks up which collection owns the skill
2. Downloads to `~/.skillsmanager/cache/<uuid>/write-linkedin-post/`
3. Creates symlink: `~/.claude/skills/write-linkedin-post → ~/.skillsmanager/cache/<uuid>/write-linkedin-post/`

Multiple agents can be linked to the same cache entry:

```
~/.claude/skills/write-linkedin-post  →  ~/.skillsmanager/cache/<uuid>/write-linkedin-post/
~/.codex/skills/write-linkedin-post   →  ~/.skillsmanager/cache/<uuid>/write-linkedin-post/
```

One copy, many agents. Update once, all agents get the change.

### Supported agents

| Agent | Skills directory |
|---|---|
| `claude` | `~/.claude/skills/` |
| `codex` | `~/.codex/skills/` |
| `cursor` | `~/.cursor/skills/` |
| `windsurf` | `~/.codeium/windsurf/skills/` |
| `copilot` | `~/.copilot/skills/` |
| `gemini` | `~/.gemini/skills/` |
| `roo` | `~/.roo/skills/` |
| `agents` | `~/.agents/skills/` |

---

## Config File

`~/.skillsmanager/config.json`:

```json
{
  "collections": [
    {
      "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "name": "personal",
      "backend": "gdrive",
      "folderId": "1bZW0-Nic5D53dBwMH_h7JN_aB0W-Rqyq",
      "registryFileId": "1yMuqe7JmelSYqm9TptKBWPk5ThTV5OJo"
    }
  ],
  "discoveredAt": "2026-03-15T00:06:33.570Z"
}
```

- `id` — stable UUID for the cache path, never changes even if the collection is renamed
- `name` — logical name (Drive prefix stripped)
- `folderId` — Drive folder ID, used to match collections across refreshes to preserve UUIDs
- `registryFileId` — Drive file ID of `SKILLS_SYNC.yaml`, cached to avoid re-searching on every read

---

## Storage Backend Architecture

The `StorageBackend` interface is the only contract backends must implement:

```typescript
interface StorageBackend {
  discoverCollections(): Promise<Omit<CollectionInfo, "id">[]>;
  readCollection(collection: CollectionInfo): Promise<CollectionFile>;
  writeCollection(collection: CollectionInfo, data: CollectionFile): Promise<void>;
  downloadSkill(collection: CollectionInfo, skillName: string, destDir: string): Promise<void>;
  uploadSkill(collection: CollectionInfo, localPath: string, skillName: string): Promise<void>;
}
```

Note: `discoverCollections` returns without `id` — UUID assignment is handled by the config layer (`mergeCollections()`), not the backend. This keeps backends storage-agnostic.

### Current backend: Google Drive

- Discovery: searches for `SKILLS_SYNC.yaml` owned by the user across all of Drive
- Download/upload: recursive folder operations via Drive API v3
- Auth: OAuth2 Desktop app flow, user creates their own Google Cloud project

### Future backends

- **GitHub** — skills in a repo, `SKILLS_SYNC.yaml` at root, git-based sync
- **S3 / R2** — private cloud storage
- **Local / NFS** — offline or corporate environments

---

## Tech Stack

| Layer | Choice |
|---|---|
| Language | TypeScript / Node.js (ESM, `"type": "module"`) |
| CLI framework | `commander` |
| Google Drive | `googleapis` npm package |
| Terminal output | `chalk@4` + `ora@5` |
| YAML | `yaml` |
| Config | Plain JSON at `~/.skillsmanager/` |
| Distribution | `npm install -g skillsmanager` |

---

## Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| CLI name | `skillsmanager` | Avoids conflicts with `sk`, `skills` |
| Skill structure | Flat, globally unique names | No category nesting — simpler for agents to reference |
| Registry file | `SKILLS_SYNC.yaml` | Human-readable, lives alongside skills in any storage |
| Terminology | **Collection** not Registry | More natural for personal/shared skill sets |
| Drive folder prefix | `SKILLS_` | Distinguishes skillsmanager folders from regular Drive folders |
| Logical name | Strip prefix in YAML + CLI | Users and agents work with clean names, not Drive conventions |
| Cache path | `~/.skillsmanager/cache/<uuid>/` | UUID is backend-agnostic and stable across renames/migrations |
| UUID assignment | Config layer (`mergeCollections`) | Backends don't need to know about UUIDs; preserved across refreshes by matching `folderId` |
| Auth | Auto-launch OAuth if no token | No explicit `init` required; any command triggers login when needed |
| Interactive prompts | Only in `setup google` | All other commands are non-interactive — safe for agent use |
| Drive scope | Full `drive` | Required to discover pre-existing `SKILLS_SYNC.yaml` files not created by the app |
| Google credentials | User creates own Cloud project | Avoids sharing a single OAuth app; each user controls their own credentials |
