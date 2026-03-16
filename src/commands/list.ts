import chalk from "chalk";
import ora from "ora";
import { readConfig } from "../config.js";
import { resolveBackend } from "../backends/resolve.js";
import type { ResolvedSkill } from "../types.js";

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

export async function listCommand(): Promise<void> {
  const spinner = ora("Fetching skills...").start();

  try {
    const skills = await getAllSkills();
    spinner.stop();

    if (skills.length === 0) {
      console.log(chalk.yellow("No skills found across any collections."));
      console.log(
        chalk.dim(
          'Run "skillsmanager collection create <name>" to create a collection, then "skillsmanager add <path>" to add skills.'
        )
      );
      return;
    }

    const maxName = Math.max(...skills.map((s) => s.entry.name.length), 4);
    const maxDesc = Math.max(
      ...skills.map((s) => s.entry.description.length),
      11
    );

    console.log(
      `\n  ${chalk.dim("NAME".padEnd(maxName + 2))}${chalk.dim("DESCRIPTION".padEnd(maxDesc + 2))}${chalk.dim("SOURCE")}`
    );
    console.log(`  ${chalk.dim("-".repeat(maxName + maxDesc + 30))}`);

    for (const s of skills.sort((a, b) =>
      a.entry.name.localeCompare(b.entry.name)
    )) {
      console.log(
        `  ${chalk.cyan(s.entry.name.padEnd(maxName + 2))}${s.entry.description.padEnd(maxDesc + 2)}${chalk.dim(`${s.collection.backend}:${s.collection.name}`)}`
      );
    }

    console.log();
  } catch (err) {
    spinner.stop();
    throw err;
  }
}
