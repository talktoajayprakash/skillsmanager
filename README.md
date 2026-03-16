# Skills Manager

A CLI for AI agents to discover, fetch, and share agent skills stored in Google Drive.

## What is it?

Skills Manager lets you maintain a personal library of agent skills in Google Drive and install them into any supported AI agent (Claude, Cursor, Windsurf, Copilot, etc.) with a single command.

Skills are downloaded to a local cache (`~/.skillsmanager/cache/`) and symlinked into the agent's skills directory. No duplication — one copy, many agents.

## Supported agents

`claude`, `codex`, `cursor`, `windsurf`, `copilot`, `gemini`, `roo`, `agents`

## Installation

```bash
npm install -g skillsmanager
```

## Google Drive setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → enable the **Google Drive API**
3. Create OAuth 2.0 credentials (Desktop app)
4. Download `credentials.json` and save it to `~/.skillsmanager/credentials.json`

## Usage

```bash
# Authenticate and discover registries
skillsmanager init

# List all available skills
skillsmanager list

# Search skills by name or description
skillsmanager search <query>

# Download a skill and install it for an agent
skillsmanager fetch <skill-name> --agent claude

# Add a local skill to your registry
skillsmanager add ./my-skill

# Push local changes to an existing skill back to Drive
skillsmanager update <skill-name>

# Re-scan Drive for new registries
skillsmanager refresh
```

## Registry format

Skills are indexed by a `SKILLS_SYNC.yaml` file inside any Google Drive folder you own:

```yaml
name: my-skills
owner: you@example.com
skills:
  - name: code-review
    path: code-review/
    description: Reviews code for bugs, style, and security issues
  - name: write-tests
    path: write-tests/
    description: Generates unit tests for a given function or module
```

Each skill is a directory containing a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: code-review
description: Reviews code for bugs, style, and security issues
---

... skill instructions ...
```

Skills Manager auto-discovers any `SKILLS_SYNC.yaml` file owned by your Google account, so registries are found automatically on `skillsmanager init` or `skillsmanager refresh`.

## Design doc

See [WRITEUP.md](./WRITEUP.md) for the full design.
