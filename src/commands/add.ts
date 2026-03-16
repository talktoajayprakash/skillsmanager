import fs from "fs";
import path from "path";
import chalk from "chalk";
import ora from "ora";
import YAML from "yaml";
import { readConfig, writeConfig, trackSkill } from "../config.js";
import { GithubBackend } from "../backends/github.js";
import { resolveBackend } from "../backends/resolve.js";
import type { CollectionInfo } from "../types.js";
import type { StorageBackend } from "../backends/interface.js";

export async function addCommand(
  skillPath: string,
  options: { collection?: string }
): Promise<void> {
  const absPath = path.resolve(skillPath);

  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
    console.log(chalk.red(`"${skillPath}" is not a valid directory.`));
    return;
  }

  const skillMdPath = path.join(absPath, "SKILL.md");
  if (!fs.existsSync(skillMdPath)) {
    console.log(chalk.red(`No SKILL.md found in "${skillPath}".`));
    return;
  }

  const content = fs.readFileSync(skillMdPath, "utf-8");
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    console.log(chalk.red("SKILL.md is missing YAML frontmatter."));
    return;
  }

  const frontmatter = YAML.parse(frontmatterMatch[1]);
  const skillName = frontmatter.name;
  const description = frontmatter.description ?? "";

  if (!skillName) {
    console.log(chalk.red("SKILL.md frontmatter is missing 'name' field."));
    return;
  }

  // ── Auto-detect if skill lives inside a GitHub-tracked repo ─────────────────
  // If no --collection specified and a matching GitHub collection exists in config,
  // use it automatically (no prompt — agent-friendly).
  if (!options.collection) {
    const ctx = GithubBackend.detectRepoContext(absPath);
    if (ctx) {
      let config;
      try { config = readConfig(); } catch { config = null; }
      const githubCollection = config?.collections.find(
        (c) => c.backend === "github" && c.folderId.startsWith(`${ctx.repo}:`)
      );
      if (githubCollection) {
        await addToGithub(absPath, ctx, skillName, description, githubCollection);
        return;
      }
      // No matching GitHub collection — fall through to standard flow
      // (user can run `skillsmanager collection create --backend github --repo <repo>` first)
    }
  }

  // ── Standard flow ─────────────────────────────────────────────────────────────
  let config;
  try { config = readConfig(); } catch {
    console.log(chalk.red("No config found. Run: skillsmanager collection create"));
    return;
  }

  let collection = config.collections[0];
  if (options.collection) {
    const found = config.collections.find((c) => c.name === options.collection);
    if (!found) {
      console.log(chalk.red(`Collection "${options.collection}" not found.`));
      console.log(chalk.dim(`  Available: ${config.collections.map((c) => c.name).join(", ")}`));
      return;
    }
    collection = found;
  }

  if (!collection) {
    console.log(chalk.red("No collections configured. Run: skillsmanager collection create"));
    return;
  }

  const backend = await resolveBackend(collection.backend);
  await uploadToCollection(backend, collection, absPath, skillName, description);
}

// ── GitHub path: register in-repo skill or copy external skill ────────────────

async function addToGithub(
  absPath: string,
  ctx: { repo: string; repoRoot: string; relPath: string },
  skillName: string,
  description: string,
  collection: CollectionInfo
): Promise<void> {
  const github = new GithubBackend();
  const spinner = ora(`Adding ${chalk.bold(skillName)} to github:${collection.folderId}...`).start();

  try {
    // uploadSkill is a no-op for in-repo skills; copies if external
    await github.uploadSkill(collection, absPath, skillName);

    // Determine effective skill path in the repo
    const skillEntry = absPath.startsWith(ctx.repoRoot)
      ? ctx.relPath                          // in-repo: use relative path
      : `.agentskills/${skillName}`;           // external: was copied here by uploadSkill

    const col = await github.readCollection(collection);
    const existing = col.skills.findIndex((s) => s.name === skillName);
    if (existing >= 0) {
      col.skills[existing] = { name: skillName, path: skillEntry, description };
    } else {
      col.skills.push({ name: skillName, path: skillEntry, description });
    }
    await github.writeCollection(collection, col);
    trackSkill(skillName, collection.id, absPath);

    spinner.succeed(`${chalk.bold(skillName)} registered in github:${collection.folderId} at ${chalk.dim(skillEntry)}`);
  } catch (err) {
    spinner.fail(`Failed: ${(err as Error).message}`);
  }
}

// ── Shared: upload to any collection backend ──────────────────────────────────

async function uploadToCollection(
  backend: StorageBackend,
  collection: CollectionInfo,
  absPath: string,
  skillName: string,
  description: string
): Promise<void> {
  const spinner = ora(`Adding ${chalk.bold(skillName)} to ${collection.name}...`).start();

  try {
    await backend.uploadSkill(collection, absPath, skillName);

    // For GitHub collections, determine the effective in-repo path
    let skillPath: string;
    if (collection.backend === "github") {
      // If the skill is already inside the repo workdir, use its relative path
      const ctx = GithubBackend.detectRepoContext(absPath);
      const repoFromCollection = collection.folderId.split(":")[0];
      if (ctx && ctx.repo === repoFromCollection) {
        skillPath = ctx.relPath;  // e.g. "src/my-inrepo-skill"
      } else {
        skillPath = `.agentskills/${skillName}`;  // external → copied here by uploadSkill
      }
    } else {
      skillPath = `${skillName}/`;
    }

    const col = await backend.readCollection(collection);
    const existing = col.skills.findIndex((s) => s.name === skillName);
    if (existing >= 0) {
      col.skills[existing] = { name: skillName, path: skillPath, description };
    } else {
      col.skills.push({ name: skillName, path: skillPath, description });
    }
    await backend.writeCollection(collection, col);
    trackSkill(skillName, collection.id, absPath);

    spinner.succeed(`${chalk.bold(skillName)} added to ${collection.backend}:${collection.name}`);
  } catch (err) {
    spinner.fail(`Failed: ${(err as Error).message}`);
  }
}
