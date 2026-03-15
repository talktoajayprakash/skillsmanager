import chalk from "chalk";
import ora from "ora";
import { writeConfig, CONFIG_PATH } from "../config.js";
import type { Config } from "../types.js";
import { ensureAuth } from "../auth.js";
import { GDriveBackend } from "../backends/gdrive.js";
import fs from "fs";

export async function collectionCreateCommand(name?: string): Promise<void> {
  const auth = await ensureAuth();
  const backend = new GDriveBackend(auth);

  const PREFIX = "SKILLSYNC_";
  let folderName: string;
  if (!name) {
    folderName = `${PREFIX}MY_SKILLS`;
  } else {
    folderName = name.startsWith(PREFIX) ? name : `${PREFIX}${name}`;
  }

  const spinner = ora(`Creating collection "${folderName}" in Google Drive...`).start();

  try {
    const collection = await backend.createCollection(folderName);
    spinner.succeed(`Collection "${folderName}" created in Google Drive`);

    let config: Config = { collections: [], skills: {}, discoveredAt: new Date().toISOString() };
    if (fs.existsSync(CONFIG_PATH)) {
      try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as Config; } catch { /* use default */ }
    }
    const already = config.collections.findIndex((c) => c.name === collection.name);
    if (already >= 0) {
      config.collections[already] = collection;
    } else {
      config.collections.push(collection);
    }
    writeConfig(config);

    console.log(`\nRun ${chalk.bold(`skillsync add <path>`)} to add skills to it.\n`);
  } catch (err) {
    spinner.fail(`Failed: ${(err as Error).message}`);
  }
}
