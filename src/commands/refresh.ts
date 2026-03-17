import chalk from "chalk";
import ora from "ora";
import { writeConfig, mergeCollections, mergeRegistries, readConfig } from "../config.js";
import { resolveBackend } from "../backends/resolve.js";
import type { CollectionInfo, RegistryInfo } from "../types.js";

export async function refreshCommand(): Promise<void> {
  const spinner = ora("Discovering registries...").start();

  try {
    let existingCollections: CollectionInfo[] = [];
    let existingSkills = {};
    let existingRegistries: RegistryInfo[] = [];
    try {
      const cfg = readConfig();
      existingCollections = cfg.collections;
      existingSkills = cfg.skills ?? {};
      existingRegistries = cfg.registries ?? [];
    } catch { /* no existing config */ }

    // Step 1: Discover registries across all backends
    const backendsToScan = ["gdrive", "github", "local"];
    const freshRegistries: Omit<RegistryInfo, "id">[] = [];

    const skippedBackends: string[] = [];
    for (const backendName of backendsToScan) {
      try {
        const backend = await resolveBackend(backendName);
        const found = await backend.discoverRegistries();
        freshRegistries.push(...found);
      } catch {
        skippedBackends.push(backendName);
      }
    }
    if (skippedBackends.length > 0) {
      console.log(chalk.dim(`  Skipped (not configured): ${skippedBackends.join(", ")}`));
      console.log(chalk.dim(`  Run: skillsmanager setup ${skippedBackends[0]} to enable`));
    }

    const mergedRegistries = mergeRegistries(freshRegistries, existingRegistries);
    spinner.text = `Found ${mergedRegistries.length} registry(ies). Resolving collections...`;

    // Step 2: Resolve collections from each registry's refs
    const freshCollections: Omit<CollectionInfo, "id">[] = [];

    for (const registry of mergedRegistries) {
      try {
        const backend = await resolveBackend(registry.backend);
        const registryFile = await backend.readRegistry(registry);

        for (const ref of registryFile.collections) {
          try {
            const refBackend = await resolveBackend(ref.backend);
            const colInfo = await refBackend.resolveCollectionRef(ref);
            if (colInfo) {
              freshCollections.push({ ...colInfo, sourceRegistryId: registry.id });
            } else {
              console.log(chalk.dim(`\n  Warning: collection "${ref.name}" listed in registry "${registry.name}" could not be resolved`));
            }
          } catch {
            // Skip unresolvable refs silently
          }
        }
      } catch {
        // Skip registries that can't be read
      }
    }

    // Deduplicate by folderId before merging (same collection may appear in multiple registries)
    const seenFolderIds = new Set<string>();
    const dedupedCollections = freshCollections.filter((c) => {
      if (seenFolderIds.has(c.folderId)) return false;
      seenFolderIds.add(c.folderId);
      return true;
    });

    const mergedCollections = mergeCollections(dedupedCollections, existingCollections);
    writeConfig({
      registries: mergedRegistries,
      collections: mergedCollections,
      skills: existingSkills,
      discoveredAt: new Date().toISOString(),
    });

    spinner.stop();

    if (mergedRegistries.length === 0) {
      console.log(chalk.yellow("No registries found."));
      console.log(chalk.dim("  Run: skillsmanager registry create"));
    } else {
      console.log(chalk.green(`Found ${mergedRegistries.length} registry(ies), ${mergedCollections.length} collection(s):`));
      for (const r of mergedRegistries) {
        console.log(`  registry: ${r.backend}:${r.name}`);
      }
      for (const c of mergedCollections) {
        console.log(`  collection: ${c.backend}:${c.name}`);
      }
    }

    console.log();
  } catch (err) {
    spinner.stop();
    throw err;
  }
}
