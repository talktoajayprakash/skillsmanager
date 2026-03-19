import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import path from "path";
import { readConfig, writeConfig, CACHE_DIR } from "../config.js";
import { resolveBackend } from "../backends/resolve.js";

export async function skillDeleteCommand(
  skillName: string,
  options: { collection?: string }
): Promise<void> {
  let config;
  try {
    config = readConfig();
  } catch {
    console.log(chalk.red("No config found. Run `sm refresh` first."));
    return;
  }

  // Resolve which collection to target
  let collection = config.collections.find((c) => c.name === options.collection);

  if (options.collection && !collection) {
    console.log(chalk.red(`Collection "${options.collection}" not found.`));
    return;
  }

  if (!collection) {
    const locations = config.skills[skillName] ?? [];
    if (locations.length === 0) {
      console.log(chalk.red(`Skill "${skillName}" not found in any collection.`));
      return;
    }
    if (locations.length > 1) {
      const names = locations
        .map((l) => config.collections.find((c) => c.id === l.collectionId)?.name ?? l.collectionId)
        .join(", ");
      console.log(chalk.red(`Skill "${skillName}" exists in multiple collections: ${names}`));
      console.log(chalk.dim(`  Use --collection <name> to specify which one.`));
      return;
    }
    collection = config.collections.find((c) => c.id === locations[0].collectionId);
    if (!collection) {
      console.log(chalk.red(`Collection for skill "${skillName}" not found in config.`));
      return;
    }
  }

  const backend = await resolveBackend(collection.backend);

  // Delete from backend storage
  const spinner = ora(`Deleting skill "${skillName}" from ${collection.backend}...`).start();
  try {
    await backend.deleteSkill(collection, skillName);
    spinner.succeed(`Deleted "${skillName}" from ${collection.backend}`);
  } catch (err) {
    spinner.fail(`Failed to delete from backend: ${(err as Error).message}`);
    return;
  }

  // Remove from collection YAML
  try {
    const col = await backend.readCollection(collection);
    col.skills = col.skills.filter((s) => s.name !== skillName);
    await backend.writeCollection(collection, col);
  } catch {
    // Non-fatal: backend data already removed
  }

  // Clean up local cache
  const cachePath = path.join(CACHE_DIR, collection.id, skillName);
  if (fs.existsSync(cachePath)) {
    fs.rmSync(cachePath, { recursive: true, force: true });
  }

  // Update config skills index
  if (config.skills[skillName]) {
    config.skills[skillName] = config.skills[skillName].filter(
      (l) => l.collectionId !== collection!.id
    );
    if (config.skills[skillName].length === 0) {
      delete config.skills[skillName];
    }
  }
  writeConfig(config);

  console.log(chalk.green(`\n  ✓ Skill "${skillName}" removed from collection "${collection.name}".\n`));
}
