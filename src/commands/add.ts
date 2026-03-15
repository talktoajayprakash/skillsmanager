import fs from "fs";
import path from "path";
import chalk from "chalk";
import ora from "ora";
import YAML from "yaml";
import { ensureReady } from "../ready.js";
import { trackSkill } from "../config.js";

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

  const { config, backend } = await ensureReady();

  // Pick collection — first one by default, or by name
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

  const spinner = ora(`Adding ${chalk.bold(skillName)} to ${collection.name}...`).start();

  try {
    await backend.uploadSkill(collection, absPath, skillName);

    const col = await backend.readCollection(collection);
    const existing = col.skills.findIndex((s) => s.name === skillName);
    if (existing >= 0) {
      col.skills[existing] = { name: skillName, path: `${skillName}/`, description };
    } else {
      col.skills.push({ name: skillName, path: `${skillName}/`, description });
    }
    await backend.writeCollection(collection, col);
    trackSkill(skillName, collection.id, absPath);

    spinner.succeed(`${chalk.bold(skillName)} added to gdrive:${collection.name}`);
  } catch (err) {
    spinner.fail(`Failed: ${(err as Error).message}`);
  }
}
