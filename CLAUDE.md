# Skills Manager — Agent Guide

> **Keep `README.md` and `docs/index.md` in sync** — when updating one, mirror the changes to the other.

Skills Manager is a CLI tool for storing and installing agent skills from local or remote storage (Google Drive). Implemented backends: `local`, `gdrive`, `github`.

For a full understanding of the design, decisions, and architecture read **[docs/WRITEUP.md](./docs/WRITEUP.md)** and **[docs/registry-architecture.md](./docs/registry-architecture.md)**.

## Package

- **npm package**: `@skillsmanager/cli`
- **Install**: `npm install -g @skillsmanager/cli`
- **CLI binary**: `skillsmanager`

## Quick reference

```bash
skillsmanager install                            # install skillsmanager skill to all agents
skillsmanager uninstall                          # remove skillsmanager skill from agent directories
skillsmanager install <name> --agent <agent>     # install a named skill
skillsmanager uninstall <name> --agent <agent>   # remove skill symlink (cache untouched)
skillsmanager search <query>                     # search by name or description (BM25)
skillsmanager add <path>                         # upload a local skill to a collection
skillsmanager update <path>                      # push local changes back to storage
skillsmanager list                               # list all available skills
skillsmanager refresh                            # re-discover collections
skillsmanager status                             # show login status and identity for each backend
skillsmanager skill delete <name>                # delete a skill from a collection
skillsmanager collection create                  # create a new collection (--backend gdrive|github)
skillsmanager registry create                    # create a registry (--backend local|gdrive|github)
skillsmanager registry list                      # show registries and collections
skillsmanager registry discover                  # search a backend for registries owned by current user
skillsmanager registry add-collection <name>     # add a collection reference to the registry
skillsmanager registry remove-collection <name>  # remove a collection reference from the registry
skillsmanager registry push --backend gdrive     # push local data to Google Drive
skillsmanager setup google                       # one-time Google Drive setup (human-facing)
skillsmanager setup github                       # one-time GitHub setup (checks gh CLI, runs gh auth login)
skillsmanager logout google                      # clear Google OAuth session
skillsmanager logout github                      # log out of GitHub
```

## Key files

| Path | Purpose |
|---|---|
| `~/.skillsmanager/config.json` | Cached registries, collections, skills index |
| `~/.skillsmanager/registry.yaml` | Local registry (SKILLS_REGISTRY.yaml) |
| `~/.skillsmanager/collections/<name>/` | Local collection storage |
| `~/.skillsmanager/credentials.json` | Google OAuth client credentials |
| `~/.skillsmanager/token.json` | OAuth access + refresh token |
| `~/.skillsmanager/cache/<uuid>/<skill>/` | Downloaded skill cache |

## Source layout

```
src/
├── index.ts              # CLI entry point (commander)
├── types.ts              # Core interfaces: CollectionInfo, RegistryInfo, Config
├── config.ts             # Config read/write, mergeCollections(), mergeRegistries()
├── auth.ts               # OAuth flow, ensureAuth()
├── ready.ts              # ensureReady() — auto-auth + auto-discover
├── cache.ts              # Cache paths (by UUID), symlink creation
├── bm25.ts               # BM25 search ranking
├── registry.ts           # YAML parse/serialize for collections and registries
├── backends/
│   ├── interface.ts      # StorageBackend interface
│   ├── local.ts          # Local filesystem backend (default, no auth)
│   ├── gdrive.ts         # Google Drive implementation
│   ├── github.ts         # GitHub implementation
│   ├── routing.ts        # Route operations to the correct backend
│   └── resolve.ts        # Resolve backend from registry/collection config
├── utils/
│   └── git.ts            # Git helpers
└── commands/
    ├── init.ts
    ├── list.ts
    ├── search.ts
    ├── add.ts
    ├── update.ts
    ├── refresh.ts
    ├── status.ts          # login status per backend
    ├── skill.ts           # skill delete
    ├── collection.ts
    ├── registry.ts        # registry create/list/discover/add-collection/remove-collection/push
    ├── install.ts         # install/uninstall bundled skill
    ├── logout.ts          # logout google/github
    └── setup/
        ├── google.ts
        └── github.ts
```
