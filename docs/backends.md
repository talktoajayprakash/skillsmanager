---
title: Storage Backends
nav_order: 6
---

# Storage Backends

Skills Manager is backend-agnostic. You choose where your skills live.

---

## Local (default)

No setup. Works immediately. Skills stored under `~/.skillsmanager/`.

```
~/.skillsmanager/
├── registry.yaml
├── collections/
│   └── my-skills/
│       ├── SKILLS_COLLECTION.yaml
│       └── code-review/
│           └── SKILL.md
└── cache/
```

**Best for:** getting started, offline environments, single-machine use.

---

## Google Drive

Skills stored as folders in your Google Drive. Discovered automatically via Drive API.

**Setup:**

```bash
skillsmanager setup google    # one-time wizard
skillsmanager refresh         # discover your collections
```

Folder naming in Drive: all folders are prefixed with `SKILLS_` to avoid conflicts with regular folders. The CLI strips the prefix — you always work with the clean name.

| Drive folder | CLI name |
|---|---|
| `SKILLS_MY_SKILLS` | `my-skills` |
| `SKILLS_WORK` | `work` |

**Best for:** personal sync across devices, sharing with teammates on the same Google account.

---

## GitHub

Skills in a Git repository. Uses the `gh` CLI (must be installed and authenticated via `gh auth login`). No additional Skills Manager setup needed.

```
my-skills-repo/
└── .skillsmanager/
    ├── SKILLS_REGISTRY.yaml
    └── my-collection/
        ├── SKILLS_COLLECTION.yaml
        └── code-review/
            └── SKILL.md
```

Skills Manager clones the repo into `~/.skillsmanager/github-workdir/` on first use and keeps it up to date with `git pull`. Writes go through a commit + push cycle; if direct push is blocked by branch protection, a PR is created automatically.

**Best for:** team sharing with full version history, open-source skill libraries, PR-based review workflows.

---

## AWS S3 / Cloudflare R2 *(planned)*

Private object storage. Skills stored as key-prefixed objects.

**Best for:** enterprise environments, compliance requirements, fine-grained access control.

---

## Dropbox *(planned)*

Skills stored in a Dropbox folder, synced via Dropbox API.

**Best for:** users already on Dropbox.

---

## Adding a backend

The `StorageBackend` interface is the only contract a backend must implement. See the [Protocol Spec](./protocol#storage-backend-interface) for the full interface definition.

Contributions welcome — see [CONTRIBUTING](https://github.com/talktoajayprakash/skillsmanager/blob/main/CONTRIBUTING.md).
