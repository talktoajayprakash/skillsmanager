import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { spawnSync } from "child_process";
import chalk from "chalk";
import type { StorageBackend } from "./interface.js";
import type {
  CollectionFile, CollectionInfo, RegistryCollectionRef, RegistryFile, RegistryInfo,
} from "../types.js";
import {
  parseCollection, serializeCollection,
  parseRegistryFile, serializeRegistryFile,
  COLLECTION_FILENAME, REGISTRY_FILENAME,
} from "../registry.js";
import { CONFIG_DIR } from "../config.js";

const GITHUB_WORKDIR = path.join(CONFIG_DIR, "github-workdir");
const SKILLSMANAGER_DIR = ".skillsmanager";

// ── folderId format: "owner/repo:.skillsmanager/collection-name" ──────────────

function parseRef(folderId: string): { repo: string; metaDir: string } {
  const colonIdx = folderId.indexOf(":");
  if (colonIdx === -1) return { repo: folderId, metaDir: SKILLSMANAGER_DIR };
  return {
    repo: folderId.slice(0, colonIdx),
    metaDir: folderId.slice(colonIdx + 1) || SKILLSMANAGER_DIR,
  };
}

function workdirFor(repo: string): string {
  return path.join(GITHUB_WORKDIR, repo.replace("/", "_"));
}

// ── CLI helpers ───────────────────────────────────────────────────────────────

function ghExec(
  args: string[],
  opts?: { cwd?: string }
): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync("gh", args, {
    cwd: opts?.cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return {
    ok: r.status === 0,
    stdout: (r.stdout ?? "").trim(),
    stderr: (r.stderr ?? "").trim(),
  };
}

function gitExec(
  args: string[],
  cwd: string
): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" });
  return {
    ok: r.status === 0,
    stdout: (r.stdout ?? "").trim(),
    stderr: (r.stderr ?? "").trim(),
  };
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ── GithubBackend ─────────────────────────────────────────────────────────────

export class GithubBackend implements StorageBackend {

  // ── Identity ─────────────────────────────────────────────────────────────────

  async getOwner(): Promise<string> {
    const r = ghExec(["api", "user", "--jq", ".login"]);
    if (!r.ok || !r.stdout) {
      throw new Error("GitHub auth failed. Run: skillsmanager setup github");
    }
    return r.stdout;
  }

  // ── Ensure repo exists (create private if not) ───────────────────────────────

  async ensureRepo(repo: string): Promise<void> {
    const check = ghExec(["api", `repos/${repo}`]);
    if (!check.ok) {
      console.log(chalk.dim(`  Repo ${repo} not found — creating private repo...`));
      const name = repo.split("/")[1];
      const create = ghExec(["repo", "create", name, "--private", "--confirm"]);
      if (!create.ok) throw new Error(`Failed to create repo ${repo}: ${create.stderr}`);
      console.log(chalk.green(`  Created private repo: ${repo}`));
    }
  }

  // ── Private: workdir management ───────────────────────────────────────────────

  private ensureWorkdir(repo: string): string {
    const dir = workdirFor(repo);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      const r = spawnSync("gh", ["repo", "clone", repo, dir], { stdio: "inherit" });
      if (r.status !== 0) throw new Error(`Failed to clone ${repo}`);
    } else {
      gitExec(["pull", "--ff-only"], dir);
    }
    return dir;
  }

  // ── Private: push with PR fallback ───────────────────────────────────────────

  private async gitPushOrPR(workdir: string, title: string): Promise<void> {
    const pushResult = gitExec(["push", "origin", "HEAD"], workdir);
    if (pushResult.ok) return;

    // Direct push blocked — create a PR
    console.log(chalk.yellow("\n  Direct push blocked (branch protection). Creating a PR..."));

    const branch = `skillsmanager-update-${Date.now()}`;
    const checkout = gitExec(["checkout", "-b", branch], workdir);
    if (!checkout.ok) throw new Error(`Failed to create branch: ${checkout.stderr}`);

    const pushBranch = gitExec(["push", "-u", "origin", branch], workdir);
    if (!pushBranch.ok) throw new Error(`Failed to push branch: ${pushBranch.stderr}`);

    const prResult = ghExec(
      ["pr", "create", "--title", title, "--body", "Created by skillsmanager", "--fill"],
      { cwd: workdir }
    );
    if (!prResult.ok) throw new Error(`Failed to create PR: ${prResult.stderr}`);

    const prUrl = prResult.stdout.split("\n").find((l) => l.startsWith("https://")) ?? prResult.stdout;
    console.log(chalk.cyan(`\n  PR created: ${prUrl}`));
    console.log(chalk.dim("  Waiting for merge (up to 5 minutes)..."));

    const timeout = Date.now() + 5 * 60 * 1000;
    let merged = false;
    while (Date.now() < timeout) {
      await new Promise<void>((r) => setTimeout(r, 10_000));
      const stateResult = ghExec(
        ["pr", "view", prUrl, "--json", "state", "--jq", ".state"],
        { cwd: workdir }
      );
      if (stateResult.ok && stateResult.stdout.trim() === "MERGED") {
        merged = true;
        break;
      }
    }

    if (!merged) {
      console.log(chalk.yellow(`\n  PR not merged within timeout. Branch "${branch}" is still open.`));
      console.log(chalk.dim("  Merge it manually, then run: skillsmanager refresh"));
      return;
    }

    // Back to default branch, pull
    const headRef = gitExec(["rev-parse", "--abbrev-ref", "origin/HEAD"], workdir);
    const base = headRef.stdout.replace("origin/", "") || "main";
    gitExec(["checkout", base], workdir);
    gitExec(["pull", "--ff-only"], workdir);
    console.log(chalk.green("  ✓ PR merged and changes pulled."));
  }

  private async commitAndPush(workdir: string, message: string): Promise<void> {
    const commit = gitExec(["commit", "-m", message], workdir);
    const nothingToCommit =
      commit.stdout.includes("nothing to commit") ||
      commit.stderr.includes("nothing to commit");
    if (!commit.ok && nothingToCommit) return;
    if (!commit.ok) throw new Error(`Git commit failed: ${commit.stderr || commit.stdout}`);
    await this.gitPushOrPR(workdir, message);
  }

  // ── Collection operations ─────────────────────────────────────────────────────

  async discoverCollections(): Promise<Omit<CollectionInfo, "id">[]> {
    const r = ghExec(["repo", "list", "--json", "nameWithOwner", "--limit", "100"]);
    if (!r.ok) return [];

    let repos: { nameWithOwner: string }[] = [];
    try { repos = JSON.parse(r.stdout); } catch { return []; }

    const collections: Omit<CollectionInfo, "id">[] = [];

    for (const { nameWithOwner } of repos) {
      const dirCheck = ghExec([
        "api", `repos/${nameWithOwner}/contents/${SKILLSMANAGER_DIR}`,
      ]);
      if (!dirCheck.ok) continue;

      let entries: { name: string; type: string }[] = [];
      try { entries = JSON.parse(dirCheck.stdout); } catch { continue; }

      for (const entry of entries) {
        if (entry.type !== "dir") continue;
        const fileCheck = ghExec([
          "api",
          `repos/${nameWithOwner}/contents/${SKILLSMANAGER_DIR}/${entry.name}/${COLLECTION_FILENAME}`,
        ]);
        if (!fileCheck.ok) continue;
        collections.push({
          name: entry.name,
          backend: "github",
          folderId: `${nameWithOwner}:${SKILLSMANAGER_DIR}/${entry.name}`,
        });
      }
    }

    return collections;
  }

  async readCollection(collection: CollectionInfo): Promise<CollectionFile> {
    const { repo, metaDir } = parseRef(collection.folderId);
    const r = ghExec([
      "api", `repos/${repo}/contents/${metaDir}/${COLLECTION_FILENAME}`, "--jq", ".content",
    ]);
    if (!r.ok) throw new Error(`Collection file not found in "${collection.name}"`);
    const content = Buffer.from(r.stdout.replace(/\s/g, ""), "base64").toString("utf-8");
    return parseCollection(content);
  }

  async writeCollection(collection: CollectionInfo, data: CollectionFile): Promise<void> {
    const { repo, metaDir } = parseRef(collection.folderId);
    const workdir = this.ensureWorkdir(repo);
    const filePath = path.join(workdir, metaDir, COLLECTION_FILENAME);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, serializeCollection(data));
    gitExec(["add", path.join(metaDir, COLLECTION_FILENAME)], workdir);
    await this.commitAndPush(workdir, `chore: update ${COLLECTION_FILENAME} for ${collection.name}`);
  }

  async downloadSkill(
    collection: CollectionInfo, skillName: string, destDir: string
  ): Promise<void> {
    const { repo } = parseRef(collection.folderId);
    const workdir = this.ensureWorkdir(repo);
    // Refresh to get latest
    gitExec(["pull", "--ff-only"], workdir);
    const col = await this.readCollection(collection);
    const entry = col.skills.find((s) => s.name === skillName);
    if (!entry) {
      throw new Error(`Skill "${skillName}" not found in collection "${collection.name}"`);
    }
    const skillPath = path.join(workdir, entry.path);
    if (!fs.existsSync(skillPath)) {
      throw new Error(`Skill directory not found at "${entry.path}" in repo "${repo}"`);
    }
    if (path.resolve(skillPath) !== path.resolve(destDir)) {
      copyDirSync(skillPath, destDir);
    }
  }

  async uploadSkill(
    collection: CollectionInfo, localPath: string, skillName: string
  ): Promise<void> {
    const { repo } = parseRef(collection.folderId);
    const workdir = this.ensureWorkdir(repo);
    const resolvedLocal = path.resolve(localPath);
    const resolvedWorkdir = path.resolve(workdir);

    if (
      resolvedLocal.startsWith(resolvedWorkdir + path.sep) ||
      resolvedLocal === resolvedWorkdir
    ) {
      // Already in the repo — no copy needed
      return;
    }

    // External skill: copy into .agentskills/<skillName>/ in the repo
    const dest = path.join(workdir, ".agentskills", skillName);
    copyDirSync(localPath, dest);
    gitExec(["add", path.join(".agentskills", skillName)], workdir);
    await this.commitAndPush(workdir, `chore: add skill ${skillName}`);
  }

  async deleteCollection(collection: CollectionInfo): Promise<void> {
    const { repo, metaDir } = parseRef(collection.folderId);
    const workdir = this.ensureWorkdir(repo);
    const metaDirPath = path.join(workdir, metaDir);
    if (!fs.existsSync(metaDirPath)) return;
    fs.rmSync(metaDirPath, { recursive: true, force: true });
    gitExec(["add", "-A"], workdir);
    await this.commitAndPush(workdir, `chore: remove collection ${collection.name}`);
  }

  // ── Registry operations ───────────────────────────────────────────────────────

  async discoverRegistries(): Promise<Omit<RegistryInfo, "id">[]> {
    const r = ghExec(["repo", "list", "--json", "nameWithOwner", "--limit", "100"]);
    if (!r.ok) return [];
    let repos: { nameWithOwner: string }[] = [];
    try { repos = JSON.parse(r.stdout); } catch { return []; }

    const registries: Omit<RegistryInfo, "id">[] = [];
    for (const { nameWithOwner } of repos) {
      const check = ghExec([
        "api", `repos/${nameWithOwner}/contents/${SKILLSMANAGER_DIR}/${REGISTRY_FILENAME}`,
      ]);
      if (!check.ok) continue;
      registries.push({
        name: nameWithOwner.split("/")[1] ?? nameWithOwner,
        backend: "github",
        folderId: `${nameWithOwner}:${SKILLSMANAGER_DIR}`,
        fileId: `${nameWithOwner}:${SKILLSMANAGER_DIR}/${REGISTRY_FILENAME}`,
      });
    }
    return registries;
  }

  async readRegistry(registry: RegistryInfo): Promise<RegistryFile> {
    const { repo, metaDir } = parseRef(registry.folderId);
    const r = ghExec([
      "api", `repos/${repo}/contents/${metaDir}/${REGISTRY_FILENAME}`, "--jq", ".content",
    ]);
    if (!r.ok) throw new Error(`Registry file not found for "${registry.name}"`);
    const content = Buffer.from(r.stdout.replace(/\s/g, ""), "base64").toString("utf-8");
    return parseRegistryFile(content);
  }

  async writeRegistry(registry: RegistryInfo, data: RegistryFile): Promise<void> {
    const { repo, metaDir } = parseRef(registry.folderId);
    const workdir = this.ensureWorkdir(repo);
    const filePath = path.join(workdir, metaDir, REGISTRY_FILENAME);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, serializeRegistryFile(data));
    gitExec(["add", path.join(metaDir, REGISTRY_FILENAME)], workdir);
    await this.commitAndPush(workdir, `chore: update ${REGISTRY_FILENAME}`);
  }

  async resolveCollectionRef(ref: RegistryCollectionRef): Promise<Omit<CollectionInfo, "id"> | null> {
    if (ref.backend !== "github") return null;
    const { repo, metaDir } = parseRef(ref.ref);
    const check = ghExec(["api", `repos/${repo}/contents/${metaDir}/${COLLECTION_FILENAME}`]);
    if (!check.ok) return null;
    return { name: ref.name, backend: "github", folderId: ref.ref };
  }

  async createRegistry(name?: string, repoRef?: string): Promise<RegistryInfo> {
    if (!repoRef) throw new Error("GitHub backend requires --repo <owner/repo>");
    await this.ensureRepo(repoRef);
    const workdir = this.ensureWorkdir(repoRef);
    const metaDir = SKILLSMANAGER_DIR;
    const filePath = path.join(workdir, metaDir, REGISTRY_FILENAME);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const owner = await this.getOwner();
    const registryData: RegistryFile = {
      name: name ?? (repoRef.split("/")[1] ?? "default"),
      owner,
      source: "github",
      collections: [],
    };
    fs.writeFileSync(filePath, serializeRegistryFile(registryData));
    gitExec(["add", path.join(metaDir, REGISTRY_FILENAME)], workdir);
    await this.commitAndPush(workdir, "chore: init SKILLS_REGISTRY");

    return {
      id: randomUUID(),
      name: registryData.name,
      backend: "github",
      folderId: `${repoRef}:${metaDir}`,
      fileId: `${repoRef}:${metaDir}/${REGISTRY_FILENAME}`,
    };
  }

  // ── createCollection ─────────────────────────────────────────────────────────

  async createCollection(collectionName: string, repoRef?: string): Promise<CollectionInfo> {
    if (!repoRef) throw new Error("GitHub backend requires --repo <owner/repo>");
    const repo = repoRef;
    await this.ensureRepo(repo);
    const workdir = this.ensureWorkdir(repo);
    const metaDir = `${SKILLSMANAGER_DIR}/${collectionName}`;
    const filePath = path.join(workdir, metaDir, COLLECTION_FILENAME);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const owner = await this.getOwner();
    const colData: CollectionFile = { name: collectionName, owner, skills: [] };
    fs.writeFileSync(filePath, serializeCollection(colData));
    gitExec(["add", path.join(metaDir, COLLECTION_FILENAME)], workdir);
    await this.commitAndPush(workdir, `chore: init collection ${collectionName}`);

    return {
      id: randomUUID(),
      name: collectionName,
      backend: "github",
      folderId: `${repo}:${metaDir}`,
    };
  }

  // ── Static: detect if a path is inside a GitHub-tracked git repo ──────────────

  static detectRepoContext(
    absPath: string
  ): { repo: string; repoRoot: string; relPath: string } | null {
    const rootResult = spawnSync("git", ["-C", absPath, "rev-parse", "--show-toplevel"], {
      encoding: "utf-8", stdio: "pipe",
    });
    if (rootResult.status !== 0) return null;
    const repoRoot = rootResult.stdout.trim();

    const remoteResult = spawnSync("git", ["-C", repoRoot, "remote", "get-url", "origin"], {
      encoding: "utf-8", stdio: "pipe",
    });
    if (remoteResult.status !== 0) return null;
    const remoteUrl = remoteResult.stdout.trim();

    const match =
      remoteUrl.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/) ??
      remoteUrl.match(/github\.com\/([^/]+\/[^/]+)/);
    if (!match) return null;

    const repo = match[1].replace(/\.git$/, "");
    const relPath = path.relative(repoRoot, absPath).replace(/\\/g, "/");
    return { repo, repoRoot, relPath };
  }

}
