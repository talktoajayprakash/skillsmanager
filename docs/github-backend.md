# GitHub Storage Backend

The GitHub backend stores skills and collections directly in GitHub repositories, using the `gh` CLI for all API and git operations. No OAuth setup or API tokens are required beyond what `gh` manages.

## Prerequisites

- `gh` CLI installed (`brew install gh` on macOS)
- Authenticated: `gh auth login`

Run the one-time setup:

```bash
skillsmanager setup github
```

This checks for `gh`, offers to install it if missing, verifies auth, and prints the authenticated username.

---

## Storage Layout

Collections and registries live under a hidden `.skillsmanager/` folder inside a GitHub repo. Multiple collections can coexist in the same repo.

```
<repo-root>/
├── .skillsmanager/
│   ├── SKILLS_REGISTRY.yaml          ← registry (optional)
│   ├── <collection-name>/
│   │   └── SKILLS_COLLECTION.yaml    ← one file per collection
│   └── <another-collection>/
│       └── SKILLS_COLLECTION.yaml
└── .agentskills/
    └── <skill-name>/                 ← external skills copied here
        └── ...skill files...
```

Skills that already live inside the repo are referenced by their **repo-relative path** and are never copied. Skills from outside the repo are copied into `.agentskills/<skill-name>/`.

---

## `folderId` Format

Each collection is identified by a `folderId` string:

```
owner/repo:.skillsmanager/collection-name
```

Example: `talktoajayprakash/my-skills:.skillsmanager/web-tools`

This is stored in `~/.skillsmanager/config.json` alongside the `backend: "github"` field.

---

## Local Workdir

The backend maintains a local clone of each repo at:

```
~/.skillsmanager/github-workdir/<owner>_<repo>/
```

All read and write operations go through this clone. On first access the repo is cloned via `gh repo clone`. On subsequent access it runs `git pull --ff-only` to stay current.

---

## Commands

### Setup

```bash
skillsmanager setup github
```

Human-facing. Checks `gh` is installed and authenticated.

### Create a collection

```bash
skillsmanager collection create <name> --backend github --repo owner/repo
```

- If `owner/repo` does not exist, it is created as a **private** repo automatically.
- Creates `.skillsmanager/<name>/SKILLS_COLLECTION.yaml` in the repo.
- Commits and pushes.

### Add a skill

```bash
skillsmanager add <path>               # auto-detects GitHub context
skillsmanager add <path> --collection <name>   # explicit collection
```

**Auto-detection:** If the skill path is inside a git repo with a GitHub remote, and a matching GitHub collection exists in config, the skill is added without any prompt.

- **In-repo skill** (path already inside the workdir clone): no file copy; the existing repo-relative path is recorded in `SKILLS_COLLECTION.yaml`.
- **External skill** (path outside the repo): copied to `skills/<skill-name>/` in the repo root, then committed and pushed.

### List skills

```bash
skillsmanager list
```

Shows each skill with its source as `github:<collection-name>`.

### Fetch a skill

```bash
skillsmanager fetch <skill-name> --agent <agent>
```

Pulls the workdir, reads `SKILLS_COLLECTION.yaml` to find the skill's path, copies it to the agent's skill directory, and creates a symlink.

### Refresh

```bash
skillsmanager refresh
```

Scans all GitHub repos accessible to the authenticated user (up to 100) via `gh repo list`. For each repo it checks for `.skillsmanager/*/SKILLS_COLLECTION.yaml` and registers discovered collections.

### Registry

```bash
skillsmanager registry create --backend github --repo owner/repo
skillsmanager registry push --backend github --repo owner/repo
```

Same `--repo` auto-create behavior applies.

---

## Push Behavior and PR Fallback

When committing changes the backend:

1. Runs `git commit -m <message>` in the workdir.
2. Tries `git push origin HEAD`.
3. **If push is blocked** (e.g. branch protection rules):
   - Creates a feature branch: `skillsmanager-update-<timestamp>`
   - Pushes the branch and opens a PR via `gh pr create`
   - Polls `gh pr view --json state` every 10 seconds for up to 5 minutes
   - Once merged: checks out the default branch and pulls
   - If not merged within 5 minutes: prints the PR URL and exits cleanly; the user can merge manually and then run `skillsmanager refresh`

---

## Repo Auto-Creation

If `--repo owner/name` is passed to any command and the repo does not exist, it is created automatically as a **private** repo:

```bash
gh repo create <name> --private --confirm
```

The repo is always private. This is intentional — skills repos should not be accidentally exposed publicly.

---

## `detectRepoContext` — In-Repo Skill Detection

`GithubBackend.detectRepoContext(absPath)` is a static method used by `add` to determine whether a skill is already tracked in a GitHub repo.

Steps:
1. `git -C <absPath> rev-parse --show-toplevel` → finds repo root
2. `git -C <repoRoot> remote get-url origin` → gets remote URL
3. Parses the URL to extract `owner/repo` (supports both HTTPS and SSH formats)
4. Returns `{ repo, repoRoot, relPath }` where `relPath` is the path of the skill relative to the repo root

Returns `null` if the path is not inside a git repo or the remote is not GitHub.

---

## Implementation Reference

| File | Role |
|---|---|
| `src/backends/github.ts` | Full `GithubBackend` class |
| `src/backends/resolve.ts` | `resolveBackend(name)` factory — returns `GithubBackend` for `"github"` |
| `src/commands/setup/github.ts` | Human-facing setup command |
| `src/commands/add.ts` | Calls `detectRepoContext()`, routes to GitHub path |
| `src/commands/collection.ts` | `collection create --backend github --repo` |
| `src/commands/registry.ts` | `registry create/push --backend github --repo` |

---

## Design Decisions

**Why `gh` CLI instead of direct API calls?**
`gh` handles auth, token refresh, SSH vs HTTPS, and org SSO transparently. No credentials to manage in skillsmanager.

**Why a local workdir clone?**
GitHub's API cannot commit multiple files atomically. A local clone lets us stage multiple files and push a single coherent commit. It also enables `git pull --ff-only` as a lightweight sync mechanism.

**Why `.skillsmanager/<collection>/SKILLS_COLLECTION.yaml` instead of a single root file?**
Multiple collections per repo. Mirrors the Google Drive backend's folder-per-collection model. The hidden `.skillsmanager/` prefix keeps it out of the way in the repo's file tree.

**Why is repo creation always private?**
Skills may contain internal tooling, prompts, or proprietary workflows. Public by default would be a surprise data leak. Users can change visibility in GitHub settings if they explicitly want a public collection.

**Why no interactive prompts in the backend?**
skillsmanager is designed to be called by agents (Claude, Cursor, etc.) in non-interactive contexts. Only the `setup` commands are human-facing. All other commands must run to completion without waiting for input.
