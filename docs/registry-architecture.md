# Registry Architecture

## Design Principles

1. **Agent-first** — all commands are non-interactive and designed for agent use. No human uses the CLI manually.
2. **Local-first** — everything works offline with zero setup. Remote storage is opt-in.
3. **Single source of truth** — the registry is the canonical index. Collections must be accessible via the registry's backend.
4. **All-or-nothing push** — `registry push` is transactional. Either everything is pushed to remote or nothing changes.

## Overview

SkillSync uses a two-tier architecture for organizing skills:

```
SKILLSYNC_REGISTRY.yaml          ← root index (points to all collections)
├── Collection A/
│   ├── SKILLSYNC_COLLECTION.yaml
│   ├── skill_1/
│   └── skill_2/
├── Collection B/
│   ├── SKILLSYNC_COLLECTION.yaml
│   └── skill_3/
└── ...
```

A **registry** is the root node. It lists all **collections** the user has access to.

A **collection** is a folder containing skills, indexed by a `SKILLSYNC_COLLECTION.yaml` file.

## Registry Scoping Rules

A registry's collection references must be resolvable by anyone who can read the registry:

| Registry location | Can point to | Cannot point to |
|---|---|---|
| **Local** (`~/.skillssync/`) | Local collections, remote collections | — |
| **Remote** (Google Drive, etc.) | Remote collections only | Local collections |

**Why:** A remote registry pointing to `backend: local` is broken by design — another machine reading the registry has no way to resolve a local path. Local files can also be deleted or modified outside of skillsync, making the reference unreliable.

**Enforcement:** When `registry push` migrates a local registry to a remote backend, it uploads all `backend: local` collections to the target backend and updates the refs from `backend: local` → `backend: gdrive`. No local refs survive in the remote registry.

## File Formats

### SKILLSYNC_REGISTRY.yaml

```yaml
name: ajay-skills
owner: ajay@example.com
source: local                         # where this registry lives
collections:
  - name: my_skills
    backend: local                    # stored locally (only valid in local registries)
    ref: my_skills                    # directory name under ~/.skillssync/collections/
  - name: team_prompts
    backend: gdrive                   # stored in Google Drive
    ref: SKILLSYNC_TEAM_PROMPTS       # Drive folder name
```

The `owner` field is set by the backend's `getOwner()` method:
- **Local**: `$USER` environment variable, or read from existing registry
- **Google Drive**: authenticated user's email from OAuth
- **Future backends**: username or identity from the backend's auth system

When a local registry is pushed to Google Drive, the owner is updated to the authenticated user's email.

### SKILLSYNC_COLLECTION.yaml

```yaml
name: my_skills
owner: ajay@example.com
skills:
  - name: write_linkedin_post
    path: write_linkedin_post/
    description: Writes LinkedIn posts for professional networking
```

Previously named `SKILLS_SYNC.yaml` — the old name is still recognized for backwards compatibility.

## Storage Backends

### StorageBackend Interface

Every backend implements:

```
Identity:     getOwner()
Collections:  discoverCollections, readCollection, writeCollection, downloadSkill, uploadSkill
Registry:     discoverRegistries, readRegistry, writeRegistry, resolveCollectionRef, createRegistry
```

### Local (default)

No setup required. Everything stored under `~/.skillssync/`:

```
~/.skillssync/
├── config.json              ← cached config (registries, collections, skills index)
├── registry.yaml            ← local registry (SKILLSYNC_REGISTRY.yaml)
├── collections/
│   └── my_skills/
│       ├── SKILLSYNC_COLLECTION.yaml
│       └── write_linkedin_post/
│           └── SKILL.md
└── cache/                   ← cache for remote skills (symlinks point here)
```

### Google Drive

Requires `skillsync setup google` first (human-only, one-time). Registry and collections are stored as Drive folders.

```
Google Drive:
├── SKILLSYNC_REGISTRY/
│   └── SKILLSYNC_REGISTRY.yaml
├── SKILLSYNC_MY_SKILLS/
│   ├── SKILLSYNC_COLLECTION.yaml
│   └── write_linkedin_post/
│       └── SKILL.md
└── ...
```

Discovery searches for `SKILLSYNC_REGISTRY.yaml` files where `'me' in owners` — each user sees only their own registries.

## Discovery Flow

When skillsync needs to find skills, it follows a two-phase process:

### Phase 1: Registry path
1. Search for `SKILLSYNC_REGISTRY.yaml` files owned by the current user
2. Read each registry → get collection references
3. Resolve each reference to a concrete collection via `resolveCollectionRef()`
4. No scanning needed — the registry tells you exactly where collections are

### Phase 2: Orphan fallback
1. Scan for `SKILLSYNC_COLLECTION.yaml` (or legacy `SKILLS_SYNC.yaml`) directly
2. Any collections found that aren't already known from Phase 1 are added
3. This ensures backwards compatibility with collections created before the registry existed
4. Over time, once all collections are in a registry, this phase finds nothing new

## Transactional Push

`skillsync registry push --backend gdrive` is all-or-nothing:

### Phase 1: Upload (no state changes)
1. Authenticate with Google Drive
2. Create or find the gdrive registry
3. For each `backend: local` collection in the local registry:
   - Create a Drive folder (`SKILLSYNC_<NAME>`)
   - Upload all skills to the folder
   - Write `SKILLSYNC_COLLECTION.yaml` to the folder
4. Accumulate results in memory — no config or registry writes yet
5. **If any upload fails → abort. Local state is completely untouched.**

### Phase 2: Commit (only after all uploads succeed)
1. Write all new collection refs to the Drive registry in a single `writeRegistry()` call
2. Update local `config.json` with the new gdrive collections and registry
3. Print success summary

**Why transactional:** A partial push leaves the system in an inconsistent state — some collections on Drive, some still local, registry partially updated. The user would need to manually clean up. All-or-nothing means the user can safely retry on failure.

## UUID Strategy

Both registries and collections get stable UUIDs assigned by the config layer:

- **RegistryInfo.id** — matched by `folderId` across refreshes via `mergeRegistries()`
- **CollectionInfo.id** — matched by `folderId` across refreshes via `mergeCollections()`

UUIDs are used for cache paths (`~/.skillssync/cache/<uuid>/`) so they remain stable even if names or backends change. They are never shared across machines — each machine assigns its own UUIDs.

## Commands

### Registry management
```bash
skillsync registry create                    # create local registry (default)
skillsync registry create --backend gdrive   # create registry in Google Drive
skillsync registry list                      # show all registries and their collections
skillsync registry discover --backend gdrive # search a backend for registries
skillsync registry add-collection <name>     # add a collection reference to registry
skillsync registry push --backend gdrive     # push local registry + collections to Drive
```

### Typical workflows

**New user (local only):**
```bash
skillsync install                            # install skillsync skill for agents
skillsync add ./my_skill                     # adds to local collection
skillsync fetch my_skill --agent claude      # installs via symlink
```

**Connecting to Google Drive later:**
```bash
skillsync setup google                       # one-time setup (human-only)
skillsync registry push --backend gdrive     # uploads everything to Drive
```

**Team sharing:**
```bash
skillsync registry discover --backend gdrive # find shared registries
skillsync refresh                            # update local cache
skillsync search <query>                     # search across all collections
```

## Backwards Compatibility

| Scenario | Behavior |
|---|---|
| Old `SKILLS_SYNC.yaml` | Discovered and read normally |
| No registry exists | Direct collection scan (Phase 2 only) |
| Config missing `registries` field | Backfilled to `[]` |
| Mix of local + remote collections | Both appear in unified skill list |
| Remote registry with `backend: local` refs | Should not exist — `registry push` prevents this |
