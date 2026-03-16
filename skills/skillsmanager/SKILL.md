---
name: skillsmanager
description: Discover, fetch, add, and update agent skills from local or remote storage using the skillsmanager CLI
---

# Skills Manager

Skills Manager is a CLI tool for managing agent skills stored locally or in remote storage (Google Drive). Use it to find, install, share, and update skills. Works offline by default — no setup needed for local use.

## Prerequisites

- Local storage works out of the box — no setup needed.
- For Google Drive: a human must run `skillsmanager setup google` once to configure credentials.
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

Supported agents: `claude`, `codex`, `agents`, `cursor`, `windsurf`, `copilot`, `gemini`, `roo`

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

### Registry and collection management

```bash
# Create a local registry (auto-created on first use)
skillsmanager registry create

# Create a registry in Google Drive
skillsmanager registry create --backend gdrive

# Show all registries and their collection references
skillsmanager registry list

# Search a backend for registries owned by the current user
skillsmanager registry discover --backend gdrive

# Add a collection reference to the registry
skillsmanager registry add-collection <name>

# Push local registry and collections to Google Drive
skillsmanager registry push --backend gdrive

# Remove a collection reference from the registry (keeps data)
skillsmanager registry remove-collection <name>

# Remove and permanently delete the collection and all its skills
skillsmanager registry remove-collection <name> --delete

# Create a new collection
skillsmanager collection create [name]

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

**User asks to update a skill:**
1. Edit the skill files locally
2. `skillsmanager update <path-to-skill-directory>`

**User asks to install a skill for this project only:**
1. `skillsmanager fetch <name> --agent claude --scope project`

**User wants to back up local skills to Google Drive:**
1. `skillsmanager setup google` (one-time, human-only)
2. `skillsmanager registry push --backend gdrive`

**User wants to see what registries and collections exist:**
1. `skillsmanager registry list`

**User wants to remove a collection:**
1. `skillsmanager registry remove-collection <name>` (removes reference only, data is kept)
2. `skillsmanager registry remove-collection <name> --delete` (permanently deletes collection and skills)

## Architecture

- **Registry** (`SKILLS_REGISTRY.yaml`): root index pointing to all collections across backends
- **Collection** (`SKILLS_COLLECTION.yaml`): folder of skills with an index file
- **Backends**: `local` (default, `~/.skillsmanager/`) and `gdrive` (Google Drive)
- **Cache**: skills are cached at `~/.skillsmanager/cache/<uuid>/` and symlinked to agent directories
- **Symlinks**: all agents share one cached copy — updating the cache updates all agents

## Scope

- `--scope global` (default): installs to `~/.agent/skills/` — available across all projects
- `--scope project`: installs to `./.agent/skills/` in the current working directory — this project only
