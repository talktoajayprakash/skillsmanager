---
title: Home
layout: home
nav_order: 1
---

# Skills Manager

**One place to manage, sync, and share all your AI agent skills — across every agent you use.**

[![npm](https://img.shields.io/npm/v/%40skillsmanager%2Fcli)](https://www.npmjs.com/package/@skillsmanager/cli)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://github.com/talktoajayprakash/skillsmanager/blob/main/LICENSE)
[![Node >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![CI](https://github.com/talktoajayprakash/skillsmanager/actions/workflows/release.yml/badge.svg)](https://github.com/talktoajayprakash/skillsmanager/actions)

---

You build skills for your AI agents, but keeping track of them is a mess. They're scattered across GitHub repos, local folders, and machines. Each agent has its own directory. Nothing is searchable. Nothing is shared.

**Skills Manager fixes this.** It gives every skill a home — in Google Drive, GitHub, or any storage backend you choose — and makes them instantly available to any agent via a single CLI command. Your agents can search, install, and use any skill regardless of where it lives.

Build skills confidently, store them where you want, and sync them across every device and agent you work with. Skills Manager even ships with its own skill, so your agent already knows how to use it — just ask.

---

## Why Skills Manager?

| | |
|---|---|
| **Unified skill library** | One searchable index across all your skills, wherever they're stored |
| **Cross-agent** | Install any skill into Claude, Cursor, Windsurf, Copilot, Gemini, OpenClaw, and more |
| **Backend-agnostic** | Store in Google Drive, GitHub, Dropbox, AWS S3, or local filesystem |
| **Sync across devices** | Skills follow you, not your machine |
| **No duplication** | Cached once locally, symlinked into each agent's directory |
| **Git-friendly** | Plain Markdown files, easy to version-control and review |
| **Agent-native** | Ships with a built-in skill that teaches your agent how to use Skills Manager — no commands to memorize |

---

## Supported Agents

`claude` · `codex` · `cursor` · `windsurf` · `copilot` · `gemini` · `roo` · `openclaw` · `agents`

See the [Agents reference](./agents) for install paths and details.

---

## How it works

Skills Manager organizes skills in a three-layer hierarchy — **registry → collections → skills** — where each layer can live on a different storage backend:

```mermaid
graph TD
    R["<b>Registry</b><br/>SKILLS_REGISTRY.yaml"] --> CA["<b>Collection A</b><br/><i>local</i>"]
    R --> CB["<b>Collection B</b><br/><i>gdrive</i>"]
    R --> CC["<b>Collection C</b><br/><i>github</i>"]

    CA --> S1["code-review<br/>SKILL.md"]
    CA --> S2["write-tests<br/>SKILL.md"]
    CB --> S3["summarize-pr<br/>SKILL.md"]
    CC --> S4["lint-fix<br/>SKILL.md"]

    style R fill:#4a90d9,color:#fff,stroke:#357abd
    style CA fill:#6ab04c,color:#fff,stroke:#4e8a38
    style CB fill:#6ab04c,color:#fff,stroke:#4e8a38
    style CC fill:#6ab04c,color:#fff,stroke:#4e8a38
    style S1 fill:#f6e58d,stroke:#d4b702
    style S2 fill:#f6e58d,stroke:#d4b702
    style S3 fill:#f6e58d,stroke:#d4b702
    style S4 fill:#f6e58d,stroke:#d4b702
```

When a skill is installed, it is downloaded once to a local cache and symlinked into each agent's skills directory — one copy on disk, many agents:

```mermaid
graph TD
    B["<b>Storage Backend</b><br/>local / gdrive / github"] -->|download| C["<b>Local Cache</b><br/>~/.skillsmanager/cache/&lt;uuid&gt;/skill/"]
    C -->|symlink| A1["~/.claude/skills/skill"]
    C -->|symlink| A2["~/.cursor/skills/skill"]
    C -->|symlink| A3["~/.gemini/skills/skill"]

    style B fill:#4a90d9,color:#fff,stroke:#357abd
    style C fill:#6ab04c,color:#fff,stroke:#4e8a38
    style A1 fill:#f6e58d,stroke:#d4b702
    style A2 fill:#f6e58d,stroke:#d4b702
    style A3 fill:#f6e58d,stroke:#d4b702
```

→ [Full architecture and protocol spec](./protocol)

---

## Quick install

```bash
npm install -g @skillsmanager/cli
sm install    # install the skillsmanager skill to all detected agents
```

→ [Full getting started guide](./getting-started)
