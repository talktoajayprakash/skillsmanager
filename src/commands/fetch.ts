import chalk from "chalk";
import ora from "ora";
import path from "path";
import { getCachePath, ensureCachePath, createSymlink, type Scope } from "../cache.js";
import { ensureReady } from "../ready.js";
import { trackSkill } from "../config.js";

export async function fetchCommand(
  names: string[],
  options: { agent: string; scope: Scope }
): Promise<void> {
  if (names.length === 0) {
    console.log(chalk.red("Please specify at least one skill name."));
    console.log(chalk.dim("  Example: skillsmanager fetch pdf-skill --agent claude"));
    return;
  }

  const { config, backend } = await ensureReady();

  // Gather all skills across collections
  const allSkills = [];
  for (const collection of config.collections) {
    const col = await backend.readCollection(collection);
    for (const entry of col.skills) {
      allSkills.push({ entry, collection });
    }
  }

  const scope = options.scope ?? "global";
  const cwd = process.cwd();

  for (const name of names) {
    const match = allSkills.find((s) => s.entry.name === name);
    if (!match) {
      console.log(chalk.red(`Skill "${name}" not found in any collection.`));
      continue;
    }

    const spinner = ora(`Fetching ${chalk.bold(name)}...`).start();

    try {
      ensureCachePath(match.collection);
      const cachePath = getCachePath(match.collection, name);

      await backend.downloadSkill(match.collection, name, cachePath);
      const { skillsDir, created } = createSymlink(name, cachePath, options.agent, scope, cwd);
      trackSkill(name, match.collection.id, path.join(skillsDir, name));

      spinner.succeed(
        `${chalk.bold(name)} → ${scope === "project" ? "project" : "global"} ${options.agent} skills`
      );

      if (created) {
        console.log(chalk.dim(`  Created ${skillsDir}`));
      }
    } catch (err) {
      spinner.fail(`${chalk.bold(name)}: ${(err as Error).message}`);
    }
  }
}
