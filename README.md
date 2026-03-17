[![npm](https://img.shields.io/npm/v/%40skillsmanager%2Fcli)](https://www.npmjs.com/package/@skillsmanager/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![CI](https://github.com/talktoajayprakash/skillsmanager/actions/workflows/release.yml/badge.svg)](https://github.com/talktoajayprakash/skillsmanager/actions)

# Skills Manager

**One command to share, discover, and install AI agent skills — across every agent you use.**

AI agent skills are powerful, but they're stuck on the machine where you created them. Skills Manager solves this by storing your skills in remote storage — Google Drive, GitHub, Dropbox, AWS S3, and more — and letting you install them into any supported agent with a single command. Write a skill once, use it everywhere.

## Why Skills Manager?

- **Cross-agent** — install any skill into Claude, Cursor, Windsurf, Copilot, Gemini, and more
- **Backend-agnostic** — store skills in Google Drive, GitHub, Dropbox, AWS S3, or local filesystem
- **No duplication** — skills are cached once locally and symlinked into agent directories
- **Searchable** — full-text BM25 search across all your skills and collections
- **Git-friendly** — plain Markdown files, easy to version-control and share

## Supported Agents

`claude` · `codex` · `cursor` · `windsurf` · `copilot` · `gemini` · `roo` · `agents`

## Quick Start

### 1. Install

```bash
npm install -g skillsmanager
```

### 2. Install the skillsmanager skill (lets your agent drive Skills Manager)

```bash
skillsmanager install
```

This installs the bundled `skillsmanager` skill into all detected agents so your AI assistant can manage skills on your behalf.

### 3. One-time Google Drive setup

Skills Manager uses Google Drive as a remote registry. To connect it:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project
2. Enable the **Google Drive API** for that project
3. Create **OAuth 2.0 credentials** (Desktop app type)
4. Download `credentials.json` and save it to `~/.skillsmanager/credentials.json`

Then authenticate and discover your registries:

```bash
skillsmanager setup google   # walks you through OAuth
skillsmanager refresh        # discovers collections in your Drive
```

## Commands

| Command | Description |
|---|---|
| `skillsmanager install` | Install the skillsmanager skill to all agents |
| `skillsmanager list` | List all available skills |
| `skillsmanager search <query>` | Search skills by name or description |
| `skillsmanager fetch <name> --agent <agent>` | Download and install a skill for an agent |
| `skillsmanager add <path>` | Upload a local skill to a collection |
| `skillsmanager update <path>` | Push local changes back to remote storage |
| `skillsmanager refresh` | Re-discover collections from remote |
| `skillsmanager collection create` | Create a new skill collection |
| `skillsmanager registry push --backend gdrive` | Push local registry to Google Drive |

## Local Development

```bash
git clone https://github.com/talktoajayprakash/skillsmanager.git
cd skillsmanager
npm install
npm run build       # compiles TypeScript to dist/
npm link            # makes `skillsmanager` available globally from source
```

Run tests:

```bash
npm test
```

To run without installing globally:

```bash
node dist/index.js <command>
```

## Registry format

Skills are indexed by a `SKILLS_REGISTRY.yaml` file inside any Google Drive folder you own:

```yaml
name: my-skills
owner: you@example.com
skills:
  - name: code-review
    path: code-review/
    description: Reviews code for bugs, style, and security issues
```

Each skill is a directory with a `SKILL.md` file:

```markdown
---
name: code-review
description: Reviews code for bugs, style, and security issues
---

... skill instructions ...
```

Skills Manager auto-discovers any `SKILLS_REGISTRY.yaml` in your Google account on `refresh`.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) — PRs welcome.

## Security

See [SECURITY.md](./SECURITY.md) for how to report vulnerabilities.

## License

[MIT](LICENSE)
