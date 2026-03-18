import os from "os";
import path from "path";
import chalk from "chalk";
import ora from "ora";
import { readConfig } from "../config.js";
import { resolveBackend } from "../backends/resolve.js";
import type { CollectionFile, CollectionInfo, RegistryInfo, SkillEntry, SkillIndex, ResolvedSkill } from "../types.js";

export async function getAllSkills(): Promise<ResolvedSkill[]> {
  const config = readConfig();
  const allSkills: ResolvedSkill[] = [];

  for (const collection of config.collections) {
    const backend = await resolveBackend(collection.backend);
    const col = await backend.readCollection(collection);
    for (const entry of col.skills) {
      allSkills.push({ entry, collection });
    }
  }

  return allSkills;
}

function collectionTag(col: CollectionInfo, colFile?: CollectionFile): string {
  if (col.backend === "github") {
    const repo = col.folderId.split(":")[0];
    return `[github: https://github.com/${repo}]`;
  }
  const repo = colFile?.type === "github" ? (colFile.metadata?.repo as string | undefined) : undefined;
  if (repo) return `[${col.backend}] → github: https://github.com/${repo}`;
  return `[${col.backend}]`;
}

const HOME = os.homedir();

function shortenPath(p: string): string {
  return p.startsWith(HOME) ? "~" + p.slice(HOME.length) : p;
}

function installedPaths(skillName: string, collectionId: string, skillIndex: SkillIndex): string[] {
  const entries = skillIndex[skillName] ?? [];
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.collectionId !== collectionId) continue;
    for (const p of entry.installedAt) {
      paths.push(shortenPath(p));
    }
  }
  return paths;
}

function renderCollections(
  cols: CollectionInfo[],
  collectionSkills: Map<string, SkillEntry[]>,
  collectionFiles: Map<string, CollectionFile>,
  skillIndex: SkillIndex
): void {
  for (let ci = 0; ci < cols.length; ci++) {
    const col = cols[ci];
    const isLastCol = ci === cols.length - 1;
    const colBranch = isLastCol ? "└──" : "├──";
    const childPad = isLastCol ? "    " : "│   ";

    console.log(
      `${colBranch} ${chalk.bold.yellow(col.name)} ${chalk.dim(collectionTag(col, collectionFiles.get(col.id)))}`
    );

    const skills = (collectionSkills.get(col.id) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    for (let si = 0; si < skills.length; si++) {
      const skill = skills[si];
      const isLastSkill = si === skills.length - 1;
      const skillBranch = isLastSkill ? "└──" : "├──";
      const paths = installedPaths(skill.name, col.id, skillIndex);
      console.log(
        `${childPad}${skillBranch} ${chalk.cyan(skill.name)}  ${chalk.dim(skill.description)}`
      );
      if (paths.length > 0) {
        const installPad = childPad + (isLastSkill ? "    " : "│   ");
        console.log(`${installPad}${chalk.magenta(`(${paths.join(", ")})`)}`)
      }
    }
  }
}

export async function listCommand(): Promise<void> {
  const spinner = ora("Fetching skills...").start();

  try {
    const config = readConfig();

    // Fetch skills per collection
    const collectionSkills = new Map<string, SkillEntry[]>();
    const collectionFiles = new Map<string, CollectionFile>();
    for (const col of config.collections) {
      const backend = await resolveBackend(col.backend);
      const colFile = await backend.readCollection(col);
      collectionSkills.set(col.id, colFile.skills);
      collectionFiles.set(col.id, colFile);
    }

    spinner.stop();

    const totalSkills = [...collectionSkills.values()].reduce(
      (n, s) => n + s.length,
      0
    );

    if (totalSkills === 0) {
      console.log(chalk.yellow("No skills found across any collections."));
      console.log(
        chalk.dim(
          'Run "skillsmanager collection create <name>" to create a collection, then "skillsmanager add <path>" to add skills.'
        )
      );
      return;
    }

    // Group collections by their source registry
    const byRegistry = new Map<string | null, CollectionInfo[]>();
    for (const col of config.collections) {
      const key = col.sourceRegistryId ?? null;
      if (!byRegistry.has(key)) byRegistry.set(key, []);
      byRegistry.get(key)!.push(col);
    }

    console.log();

    // Render each registry and its collections
    for (const reg of config.registries) {
      const cols = byRegistry.get(reg.id);
      if (!cols || cols.length === 0) continue;

      console.log(
        `${chalk.bold.white(reg.name)}  ${chalk.dim(`${reg.backend}`)}`
      );
      renderCollections(cols, collectionSkills, collectionFiles, config.skills);
      console.log();
    }

    // Collections not associated with any registry
    const orphans = byRegistry.get(null);
    if (orphans && orphans.length > 0) {
      console.log(
        `${chalk.bold.white("(unregistered)")}  ${chalk.dim("run 'skillsmanager refresh' to link to a registry")}`
      );
      renderCollections(orphans, collectionSkills, collectionFiles, config.skills);
      console.log();
    }
  } catch (err) {
    spinner.stop();
    throw err;
  }
}
