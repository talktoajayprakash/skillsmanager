import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import YAML from "yaml";
import path from "path";
import { ensureReady } from "../ready.js";

export async function updateCommand(
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
  if (!skillName) {
    console.log(chalk.red("SKILL.md frontmatter is missing 'name' field."));
    return;
  }

  const { config, backend } = await ensureReady();

  // Find the collection — from index, or --collection override
  let collection = config.collections.find((c) => c.name === options.collection) ??
    (() => {
      const entry = config.skills?.[skillName];
      if (!entry) return null;
      return config.collections.find((c) => c.id === entry.collectionId) ?? null;
    })();

  if (!collection) {
    if (options.collection) {
      console.log(chalk.red(`Collection "${options.collection}" not found.`));
      console.log(chalk.dim(`  Available: ${config.collections.map((c) => c.name).join(", ")}`));
    } else {
      console.log(chalk.red(`Skill "${skillName}" is not tracked by skillsync.`));
      console.log(chalk.dim(`  Use: skillsync add ${skillPath}`));
    }
    return;
  }

  const spinner = ora(`Updating ${chalk.bold(skillName)} in gdrive:${collection.name}...`).start();

  try {
    await backend.uploadSkill(collection, absPath, skillName);

    // Update description in SKILLS_SYNC.yaml if it changed
    if (frontmatter.description) {
      const col = await backend.readCollection(collection);
      const entry = col.skills.find((s) => s.name === skillName);
      if (entry && entry.description !== frontmatter.description) {
        entry.description = frontmatter.description;
        await backend.writeCollection(collection, col);
      }
    }

    spinner.succeed(`${chalk.bold(skillName)} updated in gdrive:${collection.name}`);
  } catch (err) {
    spinner.fail(`Failed: ${(err as Error).message}`);
  }
}
