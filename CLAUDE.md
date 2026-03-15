# SkillSync — Agent Guide

SkillSync is a CLI tool for storing and fetching agent skills from remote storage (Google Drive).

For a full understanding of the design, decisions, and architecture read **[WRITEUP.md](./WRITEUP.md)**.

## Quick reference

```bash
skillsync setup google          # one-time Google Drive setup (human-facing)
skillsync collection create     # create a new collection in Drive
skillsync list                  # list all available skills
skillsync search <query>        # search by name or description
skillsync fetch <name> --agent <agent>  # download skill and symlink to agent
skillsync add <path>            # upload a local skill to the collection
skillsync update <name>         # push local changes back to Drive
skillsync refresh               # re-discover collections from Drive
```

## Key files

| Path | Purpose |
|---|---|
| `~/.skillssync/config.json` | Cached collection list with UUIDs |
| `~/.skillssync/credentials.json` | Google OAuth client credentials |
| `~/.skillssync/token.json` | OAuth access + refresh token |
| `~/.skillssync/cache/<uuid>/<skill>/` | Downloaded skill cache |

## Source layout

```
src/
├── index.ts              # CLI entry point (commander)
├── types.ts              # Core interfaces: CollectionInfo, CollectionFile, Config
├── config.ts             # Config read/write, mergeCollections(), UUID backfill
├── auth.ts               # OAuth flow, ensureAuth()
├── ready.ts              # ensureReady() — auto-auth + auto-discover
├── cache.ts              # Cache paths (by UUID), symlink creation
├── registry.ts           # SKILLS_SYNC.yaml parse/serialize
├── backends/
│   ├── interface.ts      # StorageBackend interface
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
    └── setup/google.ts
```
