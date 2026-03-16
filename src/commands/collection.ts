import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import { writeConfig, CONFIG_PATH, readConfig } from "../config.js";
import type { Config, CollectionInfo } from "../types.js";
import { ensureAuth } from "../auth.js";
import { GDriveBackend } from "../backends/gdrive.js";
import { GithubBackend } from "../backends/github.js";

export async function collectionCreateCommand(
  name?: string,
  options: { backend?: string; repo?: string } = {}
): Promise<void> {
  const backendName = options.backend ?? "gdrive";

  if (backendName === "github") {
    await createGithubCollection(name, options.repo);
  } else {
    await createGdriveCollection(name);
  }
}

async function createGithubCollection(name?: string, repo?: string): Promise<void> {
  if (!repo) {
    console.log(chalk.red("GitHub backend requires --repo <owner/repo>"));
    console.log(chalk.dim("  Example: skillsmanager collection create my-skills --backend github --repo owner/my-repo"));
    return;
  }

  const collectionName = name ?? "default";
  const backend = new GithubBackend();

  console.log(chalk.bold(`\nCreating GitHub collection "${collectionName}" in ${repo}...\n`));

  try {
    const collection = await backend.createCollection(collectionName, repo);
    console.log(chalk.green(`\n  ✓ Collection "${collectionName}" created in github:${collection.folderId}`));

    const config = loadOrDefaultConfig();
    upsertCollection(config, collection);
    writeConfig(config);

    console.log(`\nRun ${chalk.bold("skillsmanager add <path>")} to add skills to it.\n`);
  } catch (err) {
    console.log(chalk.red(`Failed: ${(err as Error).message}`));
  }
}

async function createGdriveCollection(name?: string): Promise<void> {
  const auth = await ensureAuth();
  const backend = new GDriveBackend(auth);

  const PREFIX = "SKILLS_";
  const folderName = !name
    ? `${PREFIX}MY_SKILLS`
    : name.startsWith(PREFIX) ? name : `${PREFIX}${name}`;

  const spinner = ora(`Creating collection "${folderName}" in Google Drive...`).start();

  try {
    const collection = await backend.createCollection(folderName);
    spinner.succeed(`Collection "${folderName}" created in Google Drive`);

    const config = loadOrDefaultConfig();
    upsertCollection(config, collection);
    writeConfig(config);

    console.log(`\nRun ${chalk.bold("skillsmanager add <path>")} to add skills to it.\n`);
  } catch (err) {
    spinner.fail(`Failed: ${(err as Error).message}`);
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function loadOrDefaultConfig(): Config {
  if (fs.existsSync(CONFIG_PATH)) {
    try { return readConfig(); } catch { /* fall through */ }
  }
  return { registries: [], collections: [], skills: {}, discoveredAt: new Date().toISOString() };
}

function upsertCollection(config: Config, collection: CollectionInfo): void {
  const idx = config.collections.findIndex((c) => c.name === collection.name);
  if (idx >= 0) {
    config.collections[idx] = collection;
  } else {
    config.collections.push(collection);
  }
}
