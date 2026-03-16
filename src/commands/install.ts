import chalk from "chalk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AGENT_PATHS } from "../types.js";

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

export function installCommand(options: { agent?: string; path?: string }): void {
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

export function uninstallCommand(options: { agent?: string; path?: string }): void {
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
