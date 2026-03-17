import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import { writeConfig, CONFIG_PATH, readConfig } from "../config.js";
import type { Config, CollectionInfo, RegistryInfo } from "../types.js";
import { LocalBackend } from "../backends/local.js";
import { resolveBackend } from "../backends/resolve.js";

export async function collectionCreateCommand(
  name?: string,
  options: { backend?: string; repo?: string; skillsRepo?: string } = {}
): Promise<void> {
  const backendName = options.backend ?? "gdrive";

  if (backendName === "github" && !options.repo) {
    console.log(chalk.red("GitHub backend requires --repo <owner/repo>"));
    console.log(chalk.dim("  Example: skillsmanager collection create my-skills --backend github --repo owner/my-repo"));
    return;
  }

  const collectionName = name ?? (backendName === "gdrive" ? "MY_SKILLS" : "default");
  const spinner = ora(`Creating collection "${collectionName}" in ${backendName}...`).start();

  try {
    const backend = await resolveBackend(backendName);
    const collection = await backend.createCollection({
      name: collectionName,
      repo: options.repo,
      skillsRepo: options.skillsRepo,
    });
    spinner.succeed(`Collection "${collection.name}" created (${backendName}:${collection.folderId})`);

    const config = loadOrDefaultConfig();
    const registry = await ensureRegistry(config);
    await registerCollectionInRegistry(registry, collection, config);
    collection.sourceRegistryId = registry.id;
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

/** Returns the first registry in config, auto-creating a local one if none exists. */
async function ensureRegistry(config: Config): Promise<RegistryInfo> {
  if (config.registries.length > 0) return config.registries[0];

  console.log(chalk.dim("  No registry found — creating a local registry..."));
  const local = new LocalBackend();
  const registry = await local.createRegistry();
  config.registries.push(registry);
  console.log(chalk.green("  ✓ Local registry created"));
  return registry;
}

/** Registers the collection ref in the given registry (writes directly to the registry's backend). */
async function registerCollectionInRegistry(
  registry: RegistryInfo,
  collection: CollectionInfo,
  config: Config
): Promise<void> {
  const backend = await resolveBackend(registry.backend);
  const registryData = await backend.readRegistry(registry);

  if (registryData.collections.find((c) => c.name === collection.name)) return;

  registryData.collections.push({
    name: collection.name,
    backend: collection.backend,
    ref: collection.folderId,
  });
  await backend.writeRegistry(registry, registryData);

  // Keep local config registry list in sync
  if (!config.registries.find((r) => r.id === registry.id)) {
    config.registries.push(registry);
  }

  console.log(chalk.dim(`  Registered in registry "${registry.name}" (${registry.backend})`));
}
