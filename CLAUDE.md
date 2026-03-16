# Skills Manager — Agent Guide

Skills Manager is a CLI tool for storing and fetching agent skills from local or remote storage (Google Drive).

For a full understanding of the design, decisions, and architecture read **[WRITEUP.md](./WRITEUP.md)** and **[docs/registry-architecture.md](./docs/registry-architecture.md)**.

## Quick reference

```bash
skillsmanager install                       # install skillsmanager skill to all agents
skillsmanager search <query>                # search by name or description (BM25)
skillsmanager fetch <name> --agent <agent>  # download skill and symlink to agent
skillsmanager add <path>                    # upload a local skill to a collection
skillsmanager update <path>                 # push local changes back to storage
skillsmanager list                          # list all available skills
skillsmanager refresh                       # re-discover collections
skillsmanager collection create             # create a new collection
skillsmanager registry create               # create a local registry
skillsmanager registry list                 # show registries and collections
skillsmanager registry push --backend gdrive  # push local data to Google Drive
skillsmanager setup google                  # one-time Google Drive setup (human-facing)
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
│   └── gdrive.ts         # Google Drive implementation
└── commands/
    ├── init.ts
    ├── list.ts
    ├── search.ts
    ├── fetch.ts
    ├── add.ts
    ├── update.ts
    ├── refresh.ts
    ├── collection.ts
    ├── registry.ts       # registry create/list/discover/add-collection/push
    ├── install.ts        # install/uninstall bundled skill
    └── setup/google.ts
```
