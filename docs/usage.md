---
title: Usage
nav_order: 3
---

# Usage

All commands are non-interactive — safe to call from any AI agent. Commands fail fast with a clear error if something is missing, rather than blocking on user input.

---

## Installing skills

### `sm install`

Installs the bundled `skillsmanager` skill into all detected agent directories.

```bash
sm install                   # install to all agents
sm install --agent claude    # install to a specific agent
sm install --agent claude,cursor,openclaw  # install to multiple agents
```

### `sm install <name>`

Downloads a skill from remote storage and symlinks it into an agent's skills directory.

```bash
sm install <skill-name> --agent <agent>
```

```bash
sm install code-review --agent claude
sm install write-tests --agent cursor
```

The skill is cached at `~/.skillsmanager/cache/<uuid>/<skill-name>/` and symlinked — one copy, many agents.

---

## Browsing skills

### `sm list`

Lists all skills in a tree view grouped by registry → collection → skill. GitHub collections show the source repo in the badge.

```bash
sm list
```

Example output:

```
REGISTRY  gdrive
├── personal [gdrive]
│   ├── code-review  Opinionated code review workflow
│   └── write-tests  Generates unit tests
└── curated [github: owner/skills-repo]
    └── algorithmic-art  Generates algorithmic art
```

Collections not linked to any registry appear under `(unregistered)` — run `sm refresh` to link them.

### `sm status`

Shows the login state and identity for each backend.

```bash
sm status
```

Example output:

```
Backend   Status                    Identity
────────  ────────────────────────  ──────────────────────────────
local     ✓ logged in               ajay
gdrive    ✓ logged in               you@example.com
github    ✗ not logged in           run: sm setup github
```

Never triggers auth flows — safe to run at any time.

---

### `sm search`

Full-text BM25 search across skill names and descriptions.

```bash
sm search <query>
sm search "code review"
sm search linkedin
```

---

## Adding and updating skills

### `sm add`

Uploads a local skill directory to a collection.

```bash
sm add <path>
sm add ./my-skill
sm add ./my-skill --collection work
```

If `--collection` is omitted, the skill is added to the default collection.

**Registering a remote skill path (cross-backend collections)**

When a collection has a cross-backend skills source (e.g. `type: github` pointing to a GitHub repo), you cannot upload local files — the files already live in the remote repo. Instead, register a path pointer with `--remote-path`:

```bash
sm add --remote-path <path-in-repo> --name <skill-name> --description "<desc>" --collection <name>
```

Example:
```bash
sm add --remote-path skills/write-tests/ --name write-tests \
  --description "Generate unit tests for a function or module" \
  --collection my-curated-col
```

This writes an entry into `SKILLS_COLLECTION.yaml` without touching any skill files. When a user installs the skill, the files are pulled from the declared `metadata.repo`.

### `sm update`

Pushes local changes to an existing skill back to remote storage.

```bash
sm update <path>
sm update ./my-skill
```

---

## Collections

Collections are folders that group related skills. Each collection has a `SKILLS_COLLECTION.yaml` index file.

### `sm collection create`

Creates a new skill collection.

```bash
sm collection create
sm collection create my-collection
sm collection create my-collection --backend github --repo owner/repo
sm collection create my-collection --backend gdrive
```

**Cross-backend collections: `--skills-repo`**

Use `--skills-repo` to create a collection whose skill files live in a specific GitHub repo, regardless of where the collection YAML is stored:

```bash
# Collection YAML in Google Drive, skill files in a GitHub repo
sm collection create curated --backend gdrive --skills-repo owner/skills-repo

# Collection YAML in one GitHub repo, skill files in another
sm collection create curated --backend github --repo owner/registry-repo --skills-repo owner/skills-repo
```

This sets `type: github` and `metadata.repo` in the generated `SKILLS_COLLECTION.yaml`. After creating such a collection, register skill entries with `sm add --remote-path ...` rather than uploading files.

---

## Registries

A registry is the root index that points to all your collections. See the [Protocol spec](./protocol) for the full architecture.

### `sm registry create`

Creates a new local registry.

```bash
sm registry create
sm registry create --backend gdrive   # create directly in Google Drive
```

### `sm registry list`

Shows all registries and their collections.

```bash
sm registry list
```

### `sm registry push`

Pushes a local registry and all its collections to a remote backend. Transactional — all-or-nothing.

```bash
sm registry push --backend gdrive
```

### `sm registry discover`

Searches a backend for existing registries and adds them to local config.

```bash
sm registry discover --backend gdrive
```

### `sm registry add-collection`

Adds a collection reference to the registry.

```bash
sm registry add-collection <name>
```

---

## Discovery and sync

### `sm refresh`

Re-discovers collections from all connected backends and updates the local index.

```bash
sm refresh
```

---

## Google Drive setup

### `sm setup google`

One-time interactive wizard for Google Drive authentication. Human-facing only — not for agent use.

```bash
sm setup google
```

---

## Config file

All state is stored in `~/.skillsmanager/config.json`. You can inspect it directly — it's plain JSON with registries, collections, and a skills index.

Key paths:

| Path | Purpose |
|---|---|
| `~/.skillsmanager/config.json` | Cached registries, collections, skills index |
| `~/.skillsmanager/registry.yaml` | Local registry |
| `~/.skillsmanager/collections/<name>/` | Local collection storage |
| `~/.skillsmanager/credentials.json` | Google OAuth client credentials |
| `~/.skillsmanager/token.json` | OAuth access + refresh token |
| `~/.skillsmanager/cache/<uuid>/<skill>/` | Downloaded skill cache |
