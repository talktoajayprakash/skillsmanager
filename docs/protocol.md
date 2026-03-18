---
title: Protocol Spec
nav_order: 5
---

# Protocol Specification

This page covers the full registry and collection architecture — the protocol that Skills Manager uses to store, discover, and resolve skills across backends.

---

## Architecture overview

Skills Manager uses a three-layer hierarchy — **registry → collections → skills** — where each layer can live on a different storage backend:

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

When a skill is installed, it is downloaded to a local cache and symlinked into each agent's skills directory:

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

**Registry** — the root node. Lists all collections the user has access to.

**Collection** — a folder containing skills, indexed by `SKILLS_COLLECTION.yaml`.

**Skill** — a directory with a `SKILL.md` file. See [Skill Format](./skill-format) for structure.

---

## File formats

### SKILLS_REGISTRY.yaml

The root registry file. Lives at the top of a backend (Drive root, repo root, `~/.skillsmanager/registry.yaml` for local).

```yaml
name: my-registry
owner: you@example.com
source: local                    # where this registry lives: local | gdrive | github
collections:
  - name: my-skills
    backend: local               # local | gdrive | github
    ref: my-skills               # backend-specific pointer (folder name, repo path, etc.)
  - name: team-prompts
    backend: gdrive
    ref: SKILLS_TEAM_PROMPTS     # Drive folder name
```

**Rules:**
- A remote registry (e.g. `source: gdrive`) cannot contain `backend: local` collection refs. Local paths don't resolve on other machines.
- `skillsmanager registry push` enforces this — it uploads all local collections to the target backend and rewrites refs before pushing.
- A registry can reference collections on **any** backend — e.g. a gdrive registry can point to both gdrive and github collections. The backend field on each collection ref determines how it is resolved.

### SKILLS_COLLECTION.yaml

The collection index file. Lives inside each collection folder.

```yaml
name: my-skills
owner: you@example.com
skills:
  - name: code-review
    path: code-review/
    description: Opinionated code review workflow
  - name: write-tests
    path: write-tests/
    description: Generates unit tests for a given function or module
```

**Optional: cross-backend skill source**

A collection can declare that its skill files live in a different backend (e.g. a GitHub repo) by adding `type` and `metadata`:

```yaml
name: curated-skills
owner: you@example.com
type: github
metadata:
  repo: owner/skills-repo
skills:
  - name: write-tests
    path: skills/write-tests/
    description: Generates unit tests for a given function or module
```

| Field | Values | Meaning |
|---|---|---|
| `type` | `github` | Skill files are fetched from a GitHub repo |
| `metadata.repo` | `owner/repo` | The GitHub repo containing the skill files |

When `type` is set, `skillsmanager install` downloads skill files from `metadata.repo` regardless of where the collection YAML lives (Drive, GitHub, local). When `type` is absent, skills are downloaded from the same backend as the collection.

{: .note }
The legacy filename `SKILLS_SYNC.yaml` is still recognized for backwards compatibility.

---

## Discovery flow

When Skills Manager needs to find skills, it runs two phases:

### Phase 1 — Registry path

1. Search the backend for `SKILLS_REGISTRY.yaml` files owned by the current user
2. Read each registry → get collection references
3. Resolve each ref to a concrete collection via `resolveCollectionRef()`
4. No scanning needed — the registry is the source of truth

---

## UUID strategy

Every registry and collection gets a **stable UUID** assigned by the config layer (not the backend).

- Stored in `~/.skillsmanager/config.json`
- Used for cache paths: `~/.skillsmanager/cache/<uuid>/<skill-name>/`
- Matched across refreshes by `folderId` (backend-specific location identifier) via `mergeCollections()` and `mergeRegistries()`
- Stable even if a collection is renamed or migrated to a different backend
- Never shared across machines — each machine assigns its own UUIDs

This means cache paths don't break when you rename a collection or move it between backends.

---

## Registry scoping rules

| Registry location | Can reference | Cannot reference |
|---|---|---|
| Local (`~/.skillsmanager/`) | Local collections, remote collections | — |
| Remote (Google Drive, GitHub, etc.) | Remote collections on any backend | Local collections |

**Why:** A remote registry pointing to `backend: local` is broken by design — another machine or agent reading it has no way to resolve a local path.

---

## Collection create invariant

**A collection can never exist without being registered.** `skillsmanager collection create` atomically:

1. Creates the collection on the target backend (gdrive or github)
2. Ensures a registry exists — if none is configured, a local registry is created automatically
3. Registers the new collection ref in the registry, writing directly to the registry's backend

This means `registry add-collection` is never a required follow-up step. It exists only for manually registering collections discovered through other means (e.g. a colleague's shared collection).

---

## Transactional push

`skillsmanager registry push --backend gdrive` (or `--backend github`) is **all-or-nothing** and **idempotent**.

**Idempotency:** Before uploading anything, the command reads the current remote registry and builds a set of already-synced collection names. Collections already present in the remote registry are skipped entirely — no duplicate entries, safe to re-run at any time.

**Phase 1 — Upload (no state changes yet):**
1. Authenticate with the target backend
2. Create or locate the remote registry
3. Read the remote registry to determine which collections are already synced
4. For each `backend: local` collection **not already in the remote registry**:
   - Create the remote folder
   - Upload all skill files
   - Write `SKILLS_COLLECTION.yaml`
5. Accumulate results in memory only
6. If any upload fails → abort. Local state is completely untouched.

**Phase 2 — Commit (only after all uploads succeed):**
1. Append new collection refs to the already-read remote registry data (dedup guard included)
2. Write updated registry in a single `writeRegistry()` call
3. Update local `config.json` with the new remote collections and registry
4. Print success summary

---

## Storage backend interface

Every backend implements this interface. Skills Manager is backend-agnostic — the protocol layer never calls backend-specific code directly.

```typescript
interface BackendStatus {
  loggedIn: boolean;
  identity: string;   // email/username, or "" when not logged in
  hint?: string;      // shown when loggedIn=false
}

interface StorageBackend {
  // Identity
  getOwner(): Promise<string>;
  getStatus(): Promise<BackendStatus>;

  // Collections
  discoverCollections(): Promise<Omit<CollectionInfo, "id">[]>;
  readCollection(collection: CollectionInfo): Promise<CollectionFile>;
  writeCollection(collection: CollectionInfo, data: CollectionFile): Promise<void>;
  deleteCollection(collection: CollectionInfo): Promise<void>;
  downloadSkill(collection: CollectionInfo, skillName: string, destDir: string): Promise<void>;
  uploadSkill(collection: CollectionInfo, localPath: string, skillName: string): Promise<string>;
  deleteSkill(collection: CollectionInfo, skillName: string): Promise<void>;

  // Registries
  discoverRegistries(): Promise<Omit<RegistryInfo, "id">[]>;
  readRegistry(registry: RegistryInfo): Promise<RegistryFile>;
  writeRegistry(registry: RegistryInfo, data: RegistryFile): Promise<void>;
  resolveCollectionRef(ref: RegistryCollectionRef): Promise<Omit<CollectionInfo, "id"> | null>;
  createRegistry(options?: CreateRegistryOptions): Promise<RegistryInfo>;
  createCollection(options: CreateCollectionOptions): Promise<CollectionInfo>;
}
```

Note: `discoverRegistries` returns without `id` — UUID assignment is handled by the config layer (`mergeRegistries()`), not the backend. This keeps backends storage-agnostic.

---

## Local cache and symlinks

When a skill is installed:

1. The skill files are downloaded to `~/.skillsmanager/cache/<collection-uuid>/<skill-name>/`
2. A symlink is created in the agent's skills directory pointing to the cache:

```
~/.claude/skills/code-review  →  ~/.skillsmanager/cache/<uuid>/code-review/
~/.cursor/skills/code-review  →  ~/.skillsmanager/cache/<uuid>/code-review/
```

One copy on disk. Many agents. Update the cache once — all agents pick up the change immediately.

---

## Config file schema

`~/.skillsmanager/config.json`:

```json
{
  "registries": [
    {
      "id": "a1b2c3d4-...",
      "name": "my-registry",
      "backend": "gdrive",
      "folderId": "1bZW0-Nic5D53dBwMH_h7JN_aB0W-Rqyq",
      "fileId": "1yMuqe7JmelSYqm9TptKBWPk5ThTV5OJo"
    }
  ],
  "collections": [
    {
      "id": "f47ac10b-...",
      "name": "my-skills",
      "backend": "gdrive",
      "folderId": "1bZW0-Nic5D53dBwMH_h7JN_aB0W-Rqyq",
      "registryFileId": "1yMuqe7JmelSYqm9TptKBWPk5ThTV5OJo",
      "sourceRegistryId": "a1b2c3d4-..."
    }
  ],
  "skills": {
    "code-review": [
      {
        "collectionId": "f47ac10b-...",
        "installedAt": ["/Users/you/.claude/skills/code-review"]
      }
    ]
  },
  "discoveredAt": "2026-03-16T00:06:33.570Z"
}
```

---

## Backwards compatibility

| Scenario | Behavior |
|---|---|
| Old `SKILLS_SYNC.yaml` | Read and recognized normally |
| Config missing `registries` field | Backfilled to `[]` |
| Mix of local + remote collections | Both appear in unified skill list |
| Remote registry with `backend: local` refs | Prevented by `registry push` |

---

## Agent Skills open standard

Skills Manager is built on top of the [Agent Skills open standard](https://agentskills.io). The `SKILL.md` format, directory structure, and loading conventions are defined by that spec. Any agent that implements the standard can consume skills managed by Skills Manager.

| Agent | Skills directory | Docs |
|---|---|---|
| Claude Code | `~/.claude/skills/` | [docs](https://code.claude.com/docs/en/skills) |
| OpenAI Codex | `~/.codex/skills/` | [docs](https://developers.openai.com/codex/skills/) |
| Cursor | `~/.cursor/skills/` | [docs](https://cursor.com/docs/context/skills) |
| Windsurf | `~/.codeium/windsurf/skills/` | [docs](https://codeium.com) |
| GitHub Copilot | `~/.copilot/skills/` | [docs](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills) |
| Gemini CLI | `~/.gemini/skills/` | [docs](https://geminicli.com/docs/cli/skills/) |
| OpenClaw | `~/.openclaw/skills/` | [docs](https://docs.openclaw.ai/tools/skills) |
| Roo Code | `~/.roo/skills/` | [docs](https://docs.roocode.com/features/skills) |
