---
name: skillsmanager
description: Discover, fetch, add, and update agent skills from local or remote storage using the skillsmanager CLI
---

# Skills Manager

Skills Manager is a CLI tool for managing agent skills stored locally or in remote storage (Google Drive). Use it to find, install, share, and update skills. Works offline by default — no setup needed for local use.

## Prerequisites

- Local storage works out of the box — no setup needed.
- For Google Drive: a human must run `skillsmanager setup google` once to configure credentials.
- For GitHub: requires the `gh` CLI to be installed and authenticated (`gh auth login`). No additional skillsmanager setup needed.
- All commands except `setup google` are non-interactive and designed for agent use.

## Commands

### Find and install a skill

```bash
# Search by name or description (BM25 ranked — partial/reordered terms work)
skillsmanager search <query>

# Download and install for this agent
skillsmanager fetch <name> --agent <agent>

# Install to current project only (instead of global)
skillsmanager fetch <name> --agent <agent> --scope project

# List all available skills across all collections
skillsmanager list
```

Supported agents: `claude`, `codex`, `agents`, `cursor`, `windsurf`, `copilot`, `gemini`, `roo`, `openclaw`, `antigravity`

### Share a skill

```bash
# Upload a local skill directory to a collection
# The directory must contain a SKILL.md with name and description in YAML frontmatter
skillsmanager add <path>

# Upload to a specific collection
skillsmanager add <path> --collection <name>
```

### Update a skill

```bash
# Push local edits back to storage
# The skill must have been fetched on this machine first
skillsmanager update <path>

# If the skill exists in multiple collections, specify which one
skillsmanager update <path> --collection <name>
```

After updating, the local cache is refreshed so all symlinks on this machine reflect the change immediately.

### Delete a skill

```bash
# Delete a skill from its collection (removes from backend, cache, and index)
skillsmanager skill delete <name>

# If the skill exists in multiple collections, specify which one
skillsmanager skill delete <name> --collection <collection-name>
```

### Registry and collection management

```bash
# Create a local registry (auto-created on first use)
skillsmanager registry create

# Create a registry in Google Drive
skillsmanager registry create --backend gdrive

# Create a registry in a GitHub repo (creates repo if it doesn't exist)
skillsmanager registry create --backend github --repo <owner/repo>

# Show all registries and their collection references
skillsmanager registry list

# Search a backend for registries owned by the current user
skillsmanager registry discover --backend gdrive
skillsmanager registry discover --backend github

# Add a collection reference to the registry
skillsmanager registry add-collection <name>

# Push local registry and collections to Google Drive (safe to re-run — skips already-synced collections)
skillsmanager registry push --backend gdrive

# Push local registry and collections to GitHub (safe to re-run — skips already-synced collections)
skillsmanager registry push --backend github --repo <owner/repo>

# Remove a collection reference from the registry (keeps data)
skillsmanager registry remove-collection <name>

# Remove and permanently delete the collection and all its skills
skillsmanager registry remove-collection <name> --delete

# Create a new collection (local by default)
skillsmanager collection create [name]

# Create a collection in a GitHub repo
skillsmanager collection create [name] --backend github --repo <owner/repo>

# Re-discover collections from storage
skillsmanager refresh
```

### Install the skillsmanager skill for agents

```bash
# Install to all agent directories
skillsmanager install

# Install to specific agents
skillsmanager install --agent claude,codex

# Install to a custom path
skillsmanager install --path <dir>

# Remove from all agents
skillsmanager uninstall
```

## Common Workflows

**User asks to find a skill:**
1. `skillsmanager search <relevant terms>`
2. `skillsmanager fetch <skill-name> --agent claude`

**User asks to share a skill they created:**
1. Ensure the skill directory has a `SKILL.md` with `name` and `description` in YAML frontmatter
2. `skillsmanager add <path-to-skill-directory>`
3. Fetch the skill to make it immediately available to the agent:
   - For all projects: `skillsmanager fetch <skill-name> --agent claude`
   - For current project only: `skillsmanager fetch <skill-name> --agent claude --scope project`

**User asks to update a skill:**
1. Edit the skill files locally
2. `skillsmanager update <path-to-skill-directory>`

**User asks to install a skill for this project only:**
1. `skillsmanager fetch <name> --agent claude --scope project`

**User wants to back up local skills to Google Drive:**
1. `skillsmanager setup google` (one-time, human-only)
2. `skillsmanager registry push --backend gdrive`

**User wants to store skills in a GitHub repo:**
1. `skillsmanager collection create <name> --backend github --repo <owner/repo>` — creates the GitHub repo if needed, and auto-registers the collection in the existing registry (or creates a local registry if none exists)
2. `skillsmanager add <path> --collection <name>` — upload the skill into that collection

**User wants to discover GitHub-hosted collections:**
1. `skillsmanager registry discover --backend github`

**User wants to see what registries and collections exist:**
1. `skillsmanager registry list`

**User asks to delete/remove a single skill:**
1. `skillsmanager skill delete <skill-name>`
2. If the skill lives in multiple collections, add `--collection <name>` to target the right one

**User wants to remove a collection:**
1. `skillsmanager registry remove-collection <name>` (removes reference only, data is kept)
2. `skillsmanager registry remove-collection <name> --delete` (permanently deletes collection and skills)

## Architecture

- **Registry** (`SKILLS_REGISTRY.yaml`): root index pointing to all collections across backends
- **Collection** (`SKILLS_COLLECTION.yaml`): folder of skills with an index file
- **Backends**: `local` (default, `~/.skillsmanager/`), `gdrive` (Google Drive), and `github` (GitHub repo via `gh` CLI)
- **Cache**: skills are cached at `~/.skillsmanager/cache/<uuid>/` and symlinked to agent directories
- **Symlinks**: all agents share one cached copy — updating the cache updates all agents

## Scope

- `--scope global` (default): installs to `~/.agent/skills/` — available across all projects
- `--scope project`: installs to `./.agent/skills/` in the current working directory — this project only
