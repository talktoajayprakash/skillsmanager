import chalk from "chalk";
import fs from "fs";
import ora from "ora";
import path from "path";
import { fileURLToPath } from "url";
import { AGENT_PATHS } from "../types.js";
import { getCachePath, ensureCachePath, createSymlink, resolveSkillsDir, type Scope } from "../cache.js";
import { readConfig, trackSkill } from "../config.js";
import { resolveBackend } from "../backends/resolve.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_SOURCE = path.resolve(__dirname, "..", "..", "skills", "skillsmanager");

function installToDir(skillsDir: string, label: string): void {
  fs.mkdirSync(skillsDir, { recursive: true });
  const linkPath = path.join(skillsDir, "skillsmanager");

  if (fs.existsSync(linkPath)) {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(linkPath);
    } else {
      console.log(chalk.yellow(`  Skipped ${label} — ${linkPath} exists and is not a symlink`));
      return;
    }
  }

  fs.symlinkSync(SKILL_SOURCE, linkPath);
  console.log(chalk.green(`  Installed for ${label} → ${linkPath}`));
}

export async function installCommand(
  name: string | undefined,
  options: { agent?: string; path?: string; scope?: string }
): Promise<void> {
  if (name) {
    if (!options.agent) {
      console.log(chalk.red("--agent <agent> is required when installing a named skill"));
      return;
    }
    const scope = (options.scope ?? "global") as Scope;
    const config = readConfig();

    const allSkills: { entry: { name: string }; collection: (typeof config.collections)[number]; backend: Awaited<ReturnType<typeof resolveBackend>> }[] = [];
    for (const collection of config.collections) {
      const backend = await resolveBackend(collection.backend);
      const col = await backend.readCollection(collection);
      for (const entry of col.skills) {
        allSkills.push({ entry, collection, backend });
      }
    }

    const match = allSkills.find((s) => s.entry.name === name);
    if (!match) {
      console.log(chalk.red(`Skill "${name}" not found in any collection.`));
      return;
    }

    const spinner = ora(`Installing ${chalk.bold(name)}...`).start();
    try {
      ensureCachePath(match.collection);
      const cachePath = getCachePath(match.collection, name);
      await match.backend.downloadSkill(match.collection, name, cachePath);
      const { skillsDir, created } = createSymlink(name, cachePath, options.agent, scope, process.cwd());
      trackSkill(name, match.collection.id, path.join(skillsDir, name));
      spinner.succeed(`${chalk.bold(name)} → ${scope === "project" ? "project" : "global"} ${options.agent} skills`);
      if (created) console.log(chalk.dim(`  Created ${skillsDir}`));
    } catch (err) {
      spinner.fail(`${chalk.bold(name)}: ${(err as Error).message}`);
    }
    return;
  }

  if (!fs.existsSync(SKILL_SOURCE)) {
    console.log(chalk.red("Bundled skillsmanager skill not found. Reinstall the package."));
    return;
  }

  if (options.path) {
    const absPath = path.resolve(options.path);
    installToDir(absPath, absPath);
    return;
  }

  if (options.agent) {
    const agents = options.agent.split(",").map((a) => a.trim());
    for (const agent of agents) {
      const skillsDir = AGENT_PATHS[agent];
      if (!skillsDir) {
        console.log(chalk.red(`  Unknown agent "${agent}". Supported: ${Object.keys(AGENT_PATHS).join(", ")}`));
        continue;
      }
      installToDir(skillsDir, agent);
    }
    return;
  }

  // Default: install to all agents
  console.log(chalk.dim("Installing skillsmanager skill to all agent directories...\n"));
  for (const [agent, skillsDir] of Object.entries(AGENT_PATHS)) {
    installToDir(skillsDir, agent);
  }
}

function uninstallFromDir(skillsDir: string, label: string): void {
  const linkPath = path.join(skillsDir, "skillsmanager");

  if (!fs.existsSync(linkPath)) {
    console.log(chalk.dim(`  ${label} — not installed, skipping`));
    return;
  }

  const stat = fs.lstatSync(linkPath);
  if (!stat.isSymbolicLink()) {
    console.log(chalk.yellow(`  ${label} — ${linkPath} is not a symlink, skipping`));
    return;
  }

  fs.unlinkSync(linkPath);
  console.log(chalk.green(`  Removed from ${label} → ${linkPath}`));
}

export function uninstallCommand(
  name: string | undefined,
  options: { agent?: string; path?: string; scope?: string }
): void {
  if (name) {
    if (!options.agent) {
      console.log(chalk.red("--agent <agent> is required when uninstalling a named skill"));
      return;
    }
    let skillsDir: string;
    try {
      ({ skillsDir } = resolveSkillsDir(options.agent, (options.scope ?? "global") as Scope, process.cwd()));
    } catch (err) {
      console.log(chalk.red((err as Error).message));
      return;
    }
    const linkPath = path.join(skillsDir, name);
    let stat: fs.Stats | undefined;
    try { stat = fs.lstatSync(linkPath); } catch { /* path doesn't exist */ }
    if (!stat) {
      console.log(chalk.dim(`  "${name}" not installed for ${options.agent}, skipping`));
      return;
    }
    if (!stat.isSymbolicLink()) {
      console.log(chalk.yellow(`  ${linkPath} exists but is not a symlink — skipping`));
      return;
    }
    fs.unlinkSync(linkPath);
    console.log(chalk.green(`  Removed "${name}" from ${options.agent} → ${linkPath}`));
    return;
  }

  if (options.path) {
    const absPath = path.resolve(options.path);
    uninstallFromDir(absPath, absPath);
    return;
  }

  if (options.agent) {
    const agents = options.agent.split(",").map((a) => a.trim());
    for (const agent of agents) {
      const skillsDir = AGENT_PATHS[agent];
      if (!skillsDir) {
        console.log(chalk.red(`  Unknown agent "${agent}". Supported: ${Object.keys(AGENT_PATHS).join(", ")}`));
        continue;
      }
      uninstallFromDir(skillsDir, agent);
    }
    return;
  }

  // Default: uninstall from all agents
  console.log(chalk.dim("Removing skillsmanager skill from all agent directories...\n"));
  for (const [agent, skillsDir] of Object.entries(AGENT_PATHS)) {
    uninstallFromDir(skillsDir, agent);
  }
}
