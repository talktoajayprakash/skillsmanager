---
name: skillsync
description: Discover, fetch, add, and update agent skills from local or remote storage using the skillsync CLI
---

# SkillSync

SkillSync is a CLI tool for managing agent skills stored locally or in remote storage (Google Drive). Use it to find, install, share, and update skills. Works offline by default — no setup needed for local use.

## Prerequisites

- Local storage works out of the box — no setup needed.
- For Google Drive: a human must run `skillsync setup google` once to configure credentials.
- All commands except `setup google` are non-interactive and designed for agent use.

## Commands

### Find and install a skill

```bash
# Search by name or description (BM25 ranked — partial/reordered terms work)
skillsync search <query>

# Download and install for this agent
skillsync fetch <name> --agent <agent>

# Install to current project only (instead of global)
skillsync fetch <name> --agent <agent> --scope project

# List all available skills across all collections
skillsync list
```

Supported agents: `claude`, `codex`, `agents`, `cursor`, `windsurf`, `copilot`, `gemini`, `roo`

### Share a skill

```bash
# Upload a local skill directory to a collection
# The directory must contain a SKILL.md with name and description in YAML frontmatter
skillsync add <path>

# Upload to a specific collection
skillsync add <path> --collection <name>
```

### Update a skill

```bash
# Push local edits back to storage
# The skill must have been fetched on this machine first
skillsync update <path>

# If the skill exists in multiple collections, specify which one
skillsync update <path> --collection <name>
```

After updating, the local cache is refreshed so all symlinks on this machine reflect the change immediately.

### Registry and collection management

```bash
# Create a local registry (auto-created on first use)
skillsync registry create

# Create a registry in Google Drive
skillsync registry create --backend gdrive

# Show all registries and their collection references
skillsync registry list

# Search a backend for registries owned by the current user
skillsync registry discover --backend gdrive

# Add a collection reference to the registry
skillsync registry add-collection <name>

# Push local registry and collections to Google Drive
skillsync registry push --backend gdrive

# Create a new collection
skillsync collection create [name]

# Re-discover collections from storage
skillsync refresh
```

### Install the skillsync skill for agents

```bash
# Install to all agent directories
skillsync install

# Install to specific agents
skillsync install --agent claude,codex

# Install to a custom path
skillsync install --path <dir>

# Remove from all agents
skillsync uninstall
```

## Common Workflows

**User asks to find a skill:**
1. `skillsync search <relevant terms>`
2. `skillsync fetch <skill-name> --agent claude`

**User asks to share a skill they created:**
1. Ensure the skill directory has a `SKILL.md` with `name` and `description` in YAML frontmatter
2. `skillsync add <path-to-skill-directory>`

**User asks to update a skill:**
1. Edit the skill files locally
2. `skillsync update <path-to-skill-directory>`

**User asks to install a skill for this project only:**
1. `skillsync fetch <name> --agent claude --scope project`

**User wants to back up local skills to Google Drive:**
1. `skillsync setup google` (one-time, human-only)
2. `skillsync registry push --backend gdrive`

**User wants to see what registries and collections exist:**
1. `skillsync registry list`

## Architecture

- **Registry** (`SKILLSYNC_REGISTRY.yaml`): root index pointing to all collections across backends
- **Collection** (`SKILLSYNC_COLLECTION.yaml`): folder of skills with an index file
- **Backends**: `local` (default, `~/.skillssync/`) and `gdrive` (Google Drive)
- **Cache**: skills are cached at `~/.skillssync/cache/<uuid>/` and symlinked to agent directories
- **Symlinks**: all agents share one cached copy — updating the cache updates all agents

## Scope

- `--scope global` (default): installs to `~/.agent/skills/` — available across all projects
- `--scope project`: installs to `./.agent/skills/` in the current working directory — this project only
