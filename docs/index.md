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

Build skills confidently, store them where you want, and sync them across every device and agent you work with.

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

---

## Supported Agents

`claude` · `codex` · `cursor` · `windsurf` · `copilot` · `gemini` · `roo` · `openclaw` · `agents`

See the [Agents reference](./agents) for install paths and details.

---

## Quick install

```bash
npm install -g @skillsmanager/cli
skillsmanager install    # install the skillsmanager skill to all detected agents
```

→ [Full getting started guide](./getting-started)
