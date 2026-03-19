import fs from "fs";
import path from "path";
import chalk from "chalk";
import ora from "ora";
import YAML from "yaml";
import { readConfig, writeConfig, trackSkill } from "../config.js";
import { detectRepoContext } from "../utils/git.js";
import { resolveBackend } from "../backends/resolve.js";
import type { CollectionInfo } from "../types.js";
import type { StorageBackend } from "../backends/interface.js";

export async function addCommand(
  skillPath: string,
  options: { collection?: string; remotePath?: string; name?: string; description?: string }
): Promise<void> {
  // ── Remote-path mode: register a skill from a foreign repo without local files ─
  if (options.remotePath) {
    await addRemotePath(options);
    return;
  }

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
    const ctx = detectRepoContext(absPath);
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
      // (user can run `sm collection create --backend github --repo <repo>` first)
    }
  }

  // ── Standard flow ─────────────────────────────────────────────────────────────
  let config;
  try { config = readConfig(); } catch {
    console.log(chalk.red("No config found. Run: sm collection create"));
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
    console.log(chalk.red("No collections configured. Run: sm collection create"));
    return;
  }

  // If the collection's skill type differs from its hosting backend, handle specially.
  // col.type declares who handles skill files; col.metadata.repo gives the target repo.
  {
    const hostBackend = await resolveBackend(collection.backend);
    const col = await hostBackend.readCollection(collection);
    const skillType = col.type ?? collection.backend;
    const foreignRepo = col.metadata?.repo as string | undefined;

    if (skillType !== collection.backend && skillType === "github" && foreignRepo) {
      const ctx = detectRepoContext(absPath);
      if (!ctx || ctx.repo !== foreignRepo) {
        console.log(chalk.red(
          `This collection's skills source is "${foreignRepo}" (type: ${skillType}). ` +
          `The provided path does not belong to that repo.\n` +
          chalk.dim(`  To register a skill by path without a local clone, use:\n`) +
          chalk.dim(`  sm add --collection ${collection.name} --remote-path <rel/path> --name <name> --description <desc>`)
        ));
        return;
      }
      // Path is from the foreign repo (cloned locally) — register relative path only, no upload
      const spinner = ora(`Adding ${chalk.bold(skillName)} to ${collection.name}...`).start();
      try {
        const existing = col.skills.findIndex((s) => s.name === skillName);
        const entry = { name: skillName, path: ctx.relPath, description };
        if (existing >= 0) { col.skills[existing] = entry; } else { col.skills.push(entry); }
        await hostBackend.writeCollection(collection, col);
        trackSkill(skillName, collection.id, absPath);
        spinner.succeed(`${chalk.bold(skillName)} registered in ${collection.name} at ${chalk.dim(ctx.relPath)}`);
      } catch (err) {
        spinner.fail(`Failed: ${(err as Error).message}`);
      }
      return;
    }
  }

  const backend = await resolveBackend(collection.backend);
  await uploadToCollection(backend, collection, absPath, skillName, description);
}

// ── Remote-path mode: register a skill entry without local files ─────────────

async function addRemotePath(
  options: { collection?: string; remotePath?: string; name?: string; description?: string }
): Promise<void> {
  const { remotePath, name: skillName, description = "", collection: collectionName } = options;
  if (!remotePath) {
    console.log(chalk.red("--remote-path requires a relative path (e.g. tools/my-skill/)"));
    return;
  }
  if (!skillName) {
    console.log(chalk.red("--remote-path requires --name <skill-name>"));
    return;
  }

  let config;
  try { config = readConfig(); } catch {
    console.log(chalk.red("No config found. Run: sm collection create"));
    return;
  }

  let collection: CollectionInfo | undefined = config.collections[0];
  if (collectionName) {
    const found = config.collections.find((c) => c.name === collectionName);
    if (!found) {
      console.log(chalk.red(`Collection "${collectionName}" not found.`));
      console.log(chalk.dim(`  Available: ${config.collections.map((c) => c.name).join(", ")}`));
      return;
    }
    collection = found;
  }

  if (!collection) {
    console.log(chalk.red("No collections configured. Run: sm collection create"));
    return;
  }

  const hostBackend = await resolveBackend(collection.backend);
  const colForType = await hostBackend.readCollection(collection);
  const skillType = colForType.type ?? collection.backend;
  if (skillType !== "github" && collection.backend !== "github") {
    console.log(chalk.red(`--remote-path is only supported for collections with type "github".`));
    return;
  }

  const spinner = ora(`Registering ${chalk.bold(skillName)} in ${collection.name} at ${chalk.dim(remotePath)}...`).start();

  try {
    const col = colForType;
    const existing = col.skills.findIndex((s) => s.name === skillName);
    const entry = { name: skillName, path: remotePath, description };
    if (existing >= 0) {
      col.skills[existing] = entry;
    } else {
      col.skills.push(entry);
    }
    await hostBackend.writeCollection(collection, col);
    spinner.succeed(`${chalk.bold(skillName)} registered in ${collection.name} at ${chalk.dim(remotePath)}`);
  } catch (err) {
    spinner.fail(`Failed: ${(err as Error).message}`);
  }
}

// ── GitHub path: register in-repo skill or copy external skill ────────────────

async function addToGithub(
  absPath: string,
  ctx: { repo: string; repoRoot: string; relPath: string },
  skillName: string,
  description: string,
  collection: CollectionInfo
): Promise<void> {
  const github = await resolveBackend("github");
  const spinner = ora(`Adding ${chalk.bold(skillName)} to github:${collection.folderId}...`).start();

  try {
    const col = await github.readCollection(collection);
    const foreignRepo = col.metadata?.repo as string | undefined;
    const hostRepo = collection.folderId.split(":")[0];

    // If collection has metadata.repo pointing to a foreign repo, validate that
    // the local skill belongs to that foreign repo (not the collection host repo).
    if (foreignRepo && foreignRepo !== hostRepo) {
      if (ctx.repo !== foreignRepo) {
        spinner.fail(
          `This collection's skills source is "${foreignRepo}" but the provided path belongs to "${ctx.repo}".`
        );
        return;
      }
      // Skill is in the foreign repo (cloned locally) — register path only, no upload
      const entry = { name: skillName, path: ctx.relPath, description };
      const existing = col.skills.findIndex((s) => s.name === skillName);
      if (existing >= 0) { col.skills[existing] = entry; } else { col.skills.push(entry); }
      await github.writeCollection(collection, col);
      trackSkill(skillName, collection.id, absPath);
      spinner.succeed(`${chalk.bold(skillName)} registered in github:${collection.folderId} at ${chalk.dim(ctx.relPath)}`);
      return;
    }

    // Standard case: skill is in (or being added to) the collection's host repo
    // uploadSkill returns the canonical in-repo path
    const skillEntry = await github.uploadSkill(collection, absPath, skillName);

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
    const skillPath = await backend.uploadSkill(collection, absPath, skillName);

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
