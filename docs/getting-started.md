---
title: Getting Started
nav_order: 2
---

# Getting Started

## Prerequisites

- Node.js ≥ 18
- npm ≥ 9

## Install

```bash
npm install -g @skillsmanager/cli
```

## Install the skillsmanager skill

This installs the bundled `skillsmanager` skill into all detected agents so your AI assistant can drive Skills Manager on your behalf.

```bash
skillsmanager install
```

To install for a specific agent only:

```bash
skillsmanager install --agent claude
```

---

## Set up a storage backend

Skills Manager works out of the box with a **local backend** — no setup needed. Your skills are stored under `~/.skillsmanager/` and available on your current machine.

To sync across machines and share with other agents, connect a remote backend.

### Google Drive (recommended)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project
2. Enable the **Google Drive API** for the project
3. Go to **APIs & Services → Credentials** → create **OAuth 2.0 credentials** (Desktop app)
4. Download `credentials.json` and save it to `~/.skillsmanager/credentials.json`

Then run the setup wizard:

```bash
skillsmanager setup google
```

This walks you through the OAuth flow and saves your token. After this, all commands that need Drive access will authenticate automatically.

Discover your existing skill collections:

```bash
skillsmanager refresh
```

---

## Your first skill

### Fetch an existing skill

```bash
skillsmanager list                                 # see all available skills
skillsmanager search "code review"                 # search by name or description
skillsmanager fetch code-review --agent claude     # download and install
```

### Add a skill you've built

```bash
skillsmanager add ./my-skill                       # upload to your default collection
```

### Push to remote

If you started with local storage and want to move everything to Google Drive:

```bash
skillsmanager registry push --backend gdrive
```

This uploads all local collections to Drive and updates the registry. It's transactional — if anything fails, nothing changes.

---

## What's next?

- [Usage reference](./usage) — all commands explained
- [Protocol spec](./protocol) — registry and collection architecture
- [Backends](./backends) — storage backend options
