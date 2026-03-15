import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import YAML from "yaml";
import path from "path";
import { ensureReady } from "../ready.js";
import { getCachePath, ensureCachePath } from "../cache.js";

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

  // Find the collection — --collection override, or look up by installedAt path, or by name
  let collection = config.collections.find((c) => c.name === options.collection) ?? null;

  if (!collection) {
    const entries = config.skills?.[skillName] ?? [];

    // Prefer the entry whose installedAt includes this exact path
    const byPath = entries.find((e) => e.installedAt.includes(absPath));
    // Fall back to the only entry if unambiguous
    const byName = entries.length === 1 ? entries[0] : null;
    const entry = byPath ?? byName;

    if (!entry) {
      if (entries.length > 1) {
        const names = entries.map((e) => {
          const col = config.collections.find((c) => c.id === e.collectionId);
          return col?.name ?? e.collectionId;
        }).join(", ");
        console.log(chalk.red(`"${skillName}" exists in multiple collections: ${names}`));
        console.log(chalk.dim(`  Use: skillsync update ${skillPath} --collection <name>`));
      } else {
        console.log(chalk.red(`Skill "${skillName}" is not tracked by skillsync.`));
        console.log(chalk.dim(`  Use: skillsync add ${skillPath}`));
      }
      return;
    }

    collection = config.collections.find((c) => c.id === entry.collectionId) ?? null;
    if (!collection) {
      console.log(chalk.red(`Collection not found. Run: skillsync refresh`));
      return;
    }
  }

  const spinner = ora(`Updating ${chalk.bold(skillName)} in gdrive:${collection.name}...`).start();

  try {
    await backend.uploadSkill(collection, absPath, skillName);

    // Sync updated files into the local cache so symlinks reflect the change immediately
    ensureCachePath(collection);
    const cachePath = getCachePath(collection, skillName);
    await backend.downloadSkill(collection, skillName, cachePath);

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
