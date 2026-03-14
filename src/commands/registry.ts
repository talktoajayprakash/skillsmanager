import readline from "readline";
import chalk from "chalk";
import ora from "ora";
import { writeConfig, CONFIG_PATH } from "../config.js";
import type { Config } from "../types.js";
import { getAuthClient } from "../auth.js";
import { GDriveBackend } from "../backends/gdrive.js";
import fs from "fs";

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); });
  });
}

export async function registryCreateCommand(): Promise<void> {
  const name = await ask(`Registry name ${chalk.dim('(leave blank for "my-skills")')}: `);
  const folderName = name || "my-skills";

  const auth = getAuthClient();
  const backend = new GDriveBackend(auth);
  const spinner = ora(`Creating registry "${folderName}" in Google Drive...`).start();

  try {
    const registry = await backend.createRegistry(folderName);
    spinner.succeed(`Registry "${folderName}" created in Google Drive`);

    // Merge into config
    let config: Config = { registries: [], discoveredAt: new Date().toISOString() };
    if (fs.existsSync(CONFIG_PATH)) {
      try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as Config; } catch { /* use default */ }
    }
    const already = config.registries.findIndex((r) => r.name === registry.name);
    if (already >= 0) {
      config.registries[already] = registry;
    } else {
      config.registries.push(registry);
    }
    writeConfig(config);

    console.log(`\nRun ${chalk.bold("skillsync add <path>")} to add skills to it.\n`);
  } catch (err) {
    spinner.fail(`Failed: ${(err as Error).message}`);
  }
}
