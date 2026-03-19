# Skills Manager — CLI for Syncing Agent Skills Across Machines

## The Problem

Agent Skills (per the open standard at agentskills.io) are filesystem-based capability packages that live in:
- `~/.claude/skills/` — global skills, available to all projects
- `.claude/skills/` — project-scoped skills

This is powerful, but it creates a real pain point: **skills are trapped on the machine where you created them.** If you work across multiple machines, want to share skills with a team, or just want a backup, you have no native sync mechanism.

**Skills Manager** solves this by giving you a CLI to store skills in remote storage (Google Drive today, more backends later) and selectively install them into any agent's skills directory.

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

### Registry

A **registry** (`SKILLS_REGISTRY.yaml`) is the root index. It lists all collections the user has access to, each as a backend-typed ref. A registry can reference collections on any backend — e.g. a gdrive registry can point to both gdrive and github collections.

```yaml
name: my-registry
owner: you@example.com
source: gdrive
collections:
  - name: personal
    backend: gdrive
    ref: SKILLS_PERSONAL         # Drive folder name
  - name: work-tools
    backend: github
    ref: owner/repo:.skillsmanager/work-tools
```

A local registry (`~/.skillsmanager/registry.yaml`) can additionally reference local collections. A remote registry cannot — local paths don't resolve on other machines.

**Registry is always present.** `collection create` ensures a registry exists before creating a collection, auto-creating a local one if needed. A collection can never exist in an unregistered state.

### Collections

A **collection** is a folder containing a `SKILLS_COLLECTION.yaml` index and skill subdirectories. It's the unit of organization — one person might have one collection (`personal`), or multiple (`personal`, `work`).

```yaml
name: personal
owner: you@example.com
skills:
  - name: write-linkedin-post
    path: write-linkedin-post/
    description: Writes clear, concise LinkedIn posts with proper formatting
  - name: code-review
    path: code-review/
    description: Opinionated code review workflow
```

The legacy filename `SKILLS_SYNC.yaml` is still recognized for backwards compatibility.

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
# Google Drive setup (human-facing, interactive, one-time)
sm setup google
# GitHub: no setup needed — requires gh CLI authenticated via: gh auth login

# Discover / refresh collections
sm refresh

# Browse skills
sm list
sm search <query>

# Install a skill into an agent's skills directory
sm install <name> --agent <agent>

# Add a local skill to a collection
sm add <path>
sm add <path> --collection <name>

# Push local changes to an existing skill back to remote
sm update <path>

# Manage collections (auto-registers in the existing registry)
sm collection create [name]                                       # gdrive
sm collection create [name] --backend github --repo <owner/repo>  # github

# Registry management
sm registry list
sm registry create [--backend gdrive|github] [--repo <owner/repo>]
sm registry push --backend gdrive|github [--repo <owner/repo>]    # idempotent: skips already-synced collections
sm registry discover --backend gdrive|github
sm registry add-collection <name>
sm registry remove-collection <name> [--delete]
```

### Agent-first design

All commands except `setup google` are **non-interactive** — they never block waiting for stdin. If something is missing (no collection, no credentials), they fail fast with a clear error message. This makes them safe to call from any AI agent.

---

## Authentication

No explicit login step required. Any command that needs Drive access calls `ensureAuth()` which:

1. Checks `~/.skillsmanager/credentials.json` exists — if not, throws with `Run: sm setup google`
2. Checks `~/.skillsmanager/token.json` exists — if not, launches the OAuth flow automatically
3. Returns the authenticated client with auto-refresh on token expiry

`sm setup google` is the one-time human-facing wizard that walks through:
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

When `sm install write-linkedin-post --agent claude` is run:
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
  "registries": [
    {
      "id": "a1b2c3d4-...",
      "name": "my-registry",
      "backend": "gdrive",
      "folderId": "1bZW0-Nic5D53dBwMH_h7JN_aB0W-Rqyq",
      "fileId": "1yMuqe7JmelSYqm9TptKBWPk5ThTV5OJo"
    }
  ],
  "collections": [
    {
      "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "name": "personal",
      "backend": "gdrive",
      "folderId": "1bZW0-Nic5D53dBwMH_h7JN_aB0W-Rqyq",
      "registryFileId": "1yMuqe7JmelSYqm9TptKBWPk5ThTV5OJo",
      "sourceRegistryId": "a1b2c3d4-..."
    }
  ],
  "skills": {
    "code-review": [
      {
        "collectionId": "f47ac10b-...",
        "installedAt": ["/Users/you/.claude/skills/code-review"]
      }
    ]
  },
  "discoveredAt": "2026-03-16T00:06:33.570Z"
}
```

- `registries[].id` — stable UUID, matched across refreshes by `folderId`
- `collections[].id` — stable UUID for the cache path, never changes even if the collection is renamed
- `folderId` — backend-specific location identifier, used to match entities across refreshes to preserve UUIDs
- `sourceRegistryId` — links a collection back to the registry that owns it

---

## Cross-Backend Skill Routing

### The problem

A collection YAML can live anywhere (Google Drive, GitHub, local), but skill files may need to live in a different location — for example, a curated collection hosted in Drive that points to a public GitHub skills library. Initially this routing logic was duplicated inside `GDriveBackend`, which would have required repeating it in every future backend.

### The `type` field

`SKILLS_COLLECTION.yaml` gains two optional fields:

```yaml
type: github          # declares who handles skill-file operations
metadata:
  repo: owner/skills-repo   # type-specific config
```

When `type` is absent, skill files come from the same backend as the collection YAML. When `type: github` is set, `sm install` downloads skill files from `metadata.repo` regardless of where the collection YAML is stored.

### RoutingBackend — the decorator pattern

All backends are wrapped with a `RoutingBackend` decorator inside `resolveBackend()`:

```
resolveBackend("gdrive") → new RoutingBackend(new GDriveBackend(auth))
resolveBackend("github") → new RoutingBackend(new GithubBackend())
resolveBackend("local")  → new RoutingBackend(new LocalBackend())
```

`RoutingBackend` intercepts the three skill-file operations and dispatches based on `col.type`:

```
downloadSkill  → col.type == "github" && backend != "github" → GithubBackend.downloadSkillFromRepo()
               → otherwise                                    → inner.downloadSkill()

uploadSkill    → col.type != collection.backend               → throw (--remote-path hint)
               → github collection + metadata.repo != hostRepo → throw (foreign repo guard)
               → otherwise                                    → inner.uploadSkill()

deleteSkill    → col.type == "github" && backend != "github"  → GithubBackend.deleteSkillFromRepo()
               → otherwise                                    → inner.deleteSkill()
```

All other methods (registry ops, `readCollection`, `writeCollection`) pass straight through to the inner backend — the YAML always lives where the collection was declared.

**Key invariant:** cross-dispatch only happens when `skillType !== collection.backend`. Same-backend collections always fall through to the inner backend, which handles any internal routing (e.g. `GithubBackend.downloadSkill` uses `skillsRepo()` internally for `metadata.repo` GitHub collections).

### Individual backends stay pure

- `GDriveBackend` never imports `GithubBackend` — it only knows about Google Drive
- `GithubBackend` never needs to check `col.type` for foreign collections
- Adding a new skill source type (e.g. `type: s3`) only requires updating `RoutingBackend`, not each backend

### `--remote-path` for cross-backend `add`

When a collection has `type: github`, uploading local skill files makes no sense — the canonical files live in the GitHub repo. `sm add --remote-path` registers a skill entry (path + name + description) into the collection YAML without touching any skill files:

```bash
sm add --remote-path skills/write-tests/ --name write-tests \
  --description "Generate unit tests" --collection curated-col
```

---

## Storage Backend Architecture

The `StorageBackend` interface is the only contract backends must implement:

```typescript
interface BackendStatus {
  loggedIn: boolean;
  identity: string;   // email/username, or "" when not logged in
  hint?: string;      // shown when loggedIn=false
}

interface StorageBackend {
  // Identity
  getOwner(): Promise<string>;
  getStatus(): Promise<BackendStatus>;

  // Collections
  discoverCollections(): Promise<Omit<CollectionInfo, "id">[]>;
  readCollection(collection: CollectionInfo): Promise<CollectionFile>;
  writeCollection(collection: CollectionInfo, data: CollectionFile): Promise<void>;
  deleteCollection(collection: CollectionInfo): Promise<void>;
  downloadSkill(collection: CollectionInfo, skillName: string, destDir: string): Promise<void>;
  uploadSkill(collection: CollectionInfo, localPath: string, skillName: string): Promise<string>;
  deleteSkill(collection: CollectionInfo, skillName: string): Promise<void>;

  // Registries
  discoverRegistries(): Promise<Omit<RegistryInfo, "id">[]>;
  readRegistry(registry: RegistryInfo): Promise<RegistryFile>;
  writeRegistry(registry: RegistryInfo, data: RegistryFile): Promise<void>;
  resolveCollectionRef(ref: RegistryCollectionRef): Promise<Omit<CollectionInfo, "id"> | null>;
  createRegistry(options?: CreateRegistryOptions): Promise<RegistryInfo>;
  createCollection(options: CreateCollectionOptions): Promise<CollectionInfo>;
}
```

Note: `discoverRegistries` returns without `id` — UUID assignment is handled by the config layer (`mergeRegistries()`), not the backend. This keeps backends storage-agnostic.

`getStatus()` returns login state and identity without triggering auth flows. The companion `tryResolveBackend()` in `resolve.ts` constructs a backend without calling `ensureAuth()` — returns `null` for unconfigured backends (e.g. gdrive with no token) rather than launching a browser OAuth flow. Used by `sm status`.

### Implemented backends

**Local** (`~/.skillsmanager/`)
- Default backend, no setup needed
- Registry at `~/.skillsmanager/registry.yaml`, collections under `~/.skillsmanager/collections/`
- Can reference remote collections in its registry (useful as the local index for cross-backend setups)

**Google Drive**
- Discovery: searches for `SKILLS_REGISTRY.yaml` owned by the user across all of Drive
- Download/upload: recursive folder operations via Drive API v3
- Auth: OAuth2 Desktop app flow — user creates their own Google Cloud project via `sm setup google`
- Folder naming: `SKILLS_` prefix to distinguish from regular Drive folders

**GitHub**
- Uses the `gh` CLI — requires `gh auth login`, no additional Skills Manager setup
- Clones repo to `~/.skillsmanager/github-workdir/<owner_repo>/` on first access, `git pull` on subsequent
- Writes commit directly; falls back to creating a PR if branch protection blocks direct push
- Skills stored under `.skillsmanager/<collection-name>/` in the repo

### Planned backends

- **S3 / R2** — private cloud storage
- **Dropbox** — users already on Dropbox

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
| CLI name | `sm` | Avoids conflicts with `sk`, `skills` |
| Skill structure | Flat, globally unique names | No category nesting — simpler for agents to reference |
| Two-tier layout | Registry → Collections → Skills | Registry is the discovery root; collections are independently portable |
| Collection file | `SKILLS_COLLECTION.yaml` | Human-readable, lives alongside skills in any storage |
| Terminology | **Collection** not Registry | More natural for personal/shared skill sets |
| Drive folder prefix | `SKILLS_` | Distinguishes skillsmanager folders from regular Drive folders |
| Logical name | Strip prefix in YAML + CLI | Users and agents work with clean names, not Drive conventions |
| Cache path | `~/.skillsmanager/cache/<uuid>/` | UUID is backend-agnostic and stable across renames/migrations |
| UUID assignment | Config layer (`mergeRegistries`/`mergeCollections`) | Backends don't need to know about UUIDs; preserved across refreshes by matching `folderId` |
| Auth | Auto-launch OAuth if no token | No explicit `init` required; any command triggers login when needed |
| Interactive prompts | Only in `setup google` | All other commands are non-interactive — safe for agent use |
| Drive scope | Full `drive` | Required to discover pre-existing files not created by the app |
| Google credentials | User creates own Cloud project | Avoids sharing a single OAuth app; each user controls their own credentials |
| Collection create → auto-register | Always registers immediately in existing registry | Prevents orphaned collections; registry is auto-created if none exists |
| `registry push` idempotency | Skip collections already in remote registry | Safe to re-run for incremental updates; no duplicate refs |
| Direct registry writes | All mutation commands write to registry's own backend immediately | No explicit sync step needed after add/remove operations |
| Cross-backend routing | `RoutingBackend` decorator wraps all backends | Centralizes `col.type` dispatch; individual backends stay pure and don't need to know about other backends |
| `type` field in SKILLS_COLLECTION.yaml | Declares skill-file handler; absent = same as collection backend | Portable — survives moving collection between backends; self-contained in the YAML |
| `--remote-path` for cross-backend `add` | Registers path pointer without uploading files | You can't upload to a foreign repo; pointer registration is the correct operation |
