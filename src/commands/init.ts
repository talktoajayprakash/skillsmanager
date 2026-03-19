import chalk from "chalk";
import ora from "ora";
import { writeConfig, mergeCollections, readConfig } from "../config.js";
import { ensureAuth } from "../auth.js";
import { resolveBackend } from "../backends/resolve.js";

export async function initCommand(): Promise<void> {
  console.log(chalk.bold("\nSkills Manager Init\n"));

  const auth = await ensureAuth();
  console.log(chalk.green("  ✓ Authenticated"));

  const spinner = ora("  Discovering collections...").start();
  const backend = await resolveBackend("gdrive");
  const fresh = await backend.discoverCollections();
  let existing: import("../types.js").CollectionInfo[] = [];
  try { existing = readConfig().collections; } catch { /* no existing config */ }
  const collections = mergeCollections(fresh, existing);
  spinner.stop();

  if (collections.length === 0) {
    console.log(chalk.yellow("  No collections found."));
    console.log(chalk.dim('  Run: sm collection create <name>'));
  } else {
    console.log(chalk.green(`  ✓ Found ${collections.length} collection(s):`));
    for (const c of collections) {
      const col = await backend.readCollection(c);
      console.log(`    ${c.backend}:${c.name}  (${col.skills.length} skills)`);
    }
  }

  let existingSkills = {}; try { existingSkills = readConfig().skills ?? {}; } catch { /* ok */ }
  let existingRegistries: import("../types.js").RegistryInfo[] = []; try { existingRegistries = readConfig().registries ?? []; } catch { /* ok */ }
  writeConfig({ registries: existingRegistries, collections, skills: existingSkills, discoveredAt: new Date().toISOString() });

  const totalSkills = (
    await Promise.all(collections.map((c) => backend.readCollection(c)))
  ).reduce((sum, col) => sum + col.skills.length, 0);

  console.log(`\n${totalSkills} skills across ${collections.length} collection(s).`);
  console.log(`\nRun ${chalk.bold("sm list")} to browse all available skills.\n`);
}
