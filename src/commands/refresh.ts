import chalk from "chalk";
import ora from "ora";
import { writeConfig, mergeCollections, readConfig } from "../config.js";
import { ensureAuth } from "../auth.js";
import { GDriveBackend } from "../backends/gdrive.js";

export async function refreshCommand(): Promise<void> {
  const spinner = ora("Discovering collections...").start();

  try {
    const auth = await ensureAuth();
    const backend = new GDriveBackend(auth);
    const fresh = await backend.discoverCollections();
    let existing: import("../types.js").CollectionInfo[] = [];
    try { existing = readConfig().collections; } catch { /* no existing config */ }
    const collections = mergeCollections(fresh, existing);

    let existingSkills = {}; try { existingSkills = readConfig().skills ?? {}; } catch { /* ok */ }
  writeConfig({ collections, skills: existingSkills, discoveredAt: new Date().toISOString() });
    spinner.stop();

    if (collections.length === 0) {
      console.log(chalk.yellow("No collections found."));
      console.log(chalk.dim("  Run: skillsync collection create <name>"));
    } else {
      console.log(chalk.green(`Found ${collections.length} collection(s):`));
      for (const c of collections) {
        console.log(`  gdrive:${c.name}`);
      }
    }

    console.log();
  } catch (err) {
    spinner.stop();
    throw err;
  }
}
