import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import { readConfig, writeConfig, mergeRegistries, CONFIG_PATH, CACHE_DIR } from "../config.js";
import { ensureAuth } from "../auth.js";
import { GDriveBackend } from "../backends/gdrive.js";
import { LocalBackend } from "../backends/local.js";
import type { CollectionInfo, Config, RegistryInfo } from "../types.js";

export async function registryCreateCommand(options: { backend?: string }): Promise<void> {
  const backend = options.backend ?? "local";

  if (backend === "local") {
    const local = new LocalBackend();
    const spinner = ora("Creating local registry...").start();
    try {
      const registry = await local.createRegistry();
      spinner.succeed(`Local registry created`);

      let config: Config = { registries: [], collections: [], skills: {}, discoveredAt: new Date().toISOString() };
      if (fs.existsSync(CONFIG_PATH)) {
        try { config = readConfig(); } catch { /* use default */ }
      }
      config.registries.push(registry);
      writeConfig(config);
    } catch (err) {
      spinner.fail(`Failed: ${(err as Error).message}`);
    }
  } else if (backend === "gdrive") {
    const auth = await ensureAuth();
    const gdrive = new GDriveBackend(auth);
    const spinner = ora("Creating registry in Google Drive...").start();
    try {
      const registry = await gdrive.createRegistry();
      spinner.succeed(`Registry created in Google Drive`);

      let config: Config = { registries: [], collections: [], skills: {}, discoveredAt: new Date().toISOString() };
      if (fs.existsSync(CONFIG_PATH)) {
        try { config = readConfig(); } catch { /* use default */ }
      }
      config.registries.push(registry);
      writeConfig(config);
    } catch (err) {
      spinner.fail(`Failed: ${(err as Error).message}`);
    }
  } else {
    console.log(chalk.red(`Unknown backend "${backend}". Supported: local, gdrive`));
  }
}

export async function registryListCommand(): Promise<void> {
  let config: Config;
  try { config = readConfig(); } catch {
    console.log(chalk.yellow("No config found. Run: skillsmanager registry create"));
    return;
  }

  if (config.registries.length === 0) {
    console.log(chalk.yellow("No registries configured."));
    console.log(chalk.dim("  Run: skillsmanager registry create"));
    return;
  }

  for (const reg of config.registries) {
    console.log(`\n${chalk.bold(reg.name)} ${chalk.dim(`(${reg.backend})`)}`);

    try {
      const backend = reg.backend === "gdrive"
        ? new GDriveBackend(await ensureAuth())
        : new LocalBackend();
      const data = await backend.readRegistry(reg);

      if (data.collections.length === 0) {
        console.log(chalk.dim("  No collections"));
      } else {
        for (const ref of data.collections) {
          console.log(`  ${chalk.cyan(ref.name)} ${chalk.dim(`${ref.backend}:${ref.ref}`)}`);
        }
      }
    } catch (err) {
      console.log(chalk.red(`  Error reading: ${(err as Error).message}`));
    }
  }
  console.log();
}

export async function registryDiscoverCommand(options: { backend?: string }): Promise<void> {
  const backendName = options.backend ?? "local";
  const spinner = ora(`Discovering registries in ${backendName}...`).start();

  try {
    const backend = backendName === "gdrive"
      ? new GDriveBackend(await ensureAuth())
      : new LocalBackend();

    const fresh = await backend.discoverRegistries();

    let config: Config = { registries: [], collections: [], skills: {}, discoveredAt: new Date().toISOString() };
    if (fs.existsSync(CONFIG_PATH)) {
      try { config = readConfig(); } catch { /* use default */ }
    }

    config.registries = mergeRegistries(fresh, config.registries);
    writeConfig(config);
    spinner.stop();

    if (fresh.length === 0) {
      console.log(chalk.yellow(`No registries found in ${backendName}.`));
    } else {
      console.log(chalk.green(`Found ${fresh.length} registry(ies) in ${backendName}:`));
      for (const r of fresh) {
        console.log(`  ${chalk.cyan(r.name)}`);
      }
    }
  } catch (err) {
    spinner.fail(`Failed: ${(err as Error).message}`);
  }
}

export async function registryAddCollectionCommand(
  collectionName: string,
  options: { backend?: string; ref?: string }
): Promise<void> {
  let config: Config;
  try { config = readConfig(); } catch {
    console.log(chalk.red("No config found. Run: skillsmanager registry create"));
    return;
  }

  if (config.registries.length === 0) {
    console.log(chalk.red("No registries configured. Run: skillsmanager registry create"));
    return;
  }

  // Use first registry
  const reg = config.registries[0];
  const backend = reg.backend === "gdrive"
    ? new GDriveBackend(await ensureAuth())
    : new LocalBackend();

  const data = await backend.readRegistry(reg);
  const existing = data.collections.find((c) => c.name === collectionName);
  if (existing) {
    console.log(chalk.yellow(`Collection "${collectionName}" already in registry.`));
    return;
  }

  data.collections.push({
    name: collectionName,
    backend: options.backend ?? reg.backend,
    ref: options.ref ?? collectionName,
  });

  await backend.writeRegistry(reg, data);
  console.log(chalk.green(`Added "${collectionName}" to registry "${reg.name}".`));
}

export async function registryRemoveCollectionCommand(
  collectionName: string,
  options: { delete?: boolean }
): Promise<void> {
  let config: Config;
  try { config = readConfig(); } catch {
    console.log(chalk.red("No config found."));
    return;
  }

  if (config.registries.length === 0) {
    console.log(chalk.red("No registries configured."));
    return;
  }

  const reg = config.registries[0];
  const backend = reg.backend === "gdrive"
    ? new GDriveBackend(await ensureAuth())
    : new LocalBackend();

  const data = await backend.readRegistry(reg);
  const ref = data.collections.find((c) => c.name === collectionName);
  if (!ref) {
    console.log(chalk.yellow(`Collection "${collectionName}" not found in registry.`));
    return;
  }

  // If --delete, delete the actual collection and skills from the backend
  if (options.delete) {
    const collectionInConfig = config.collections.find((c) => c.name === collectionName);
    if (collectionInConfig) {
      const collBackend = collectionInConfig.backend === "gdrive"
        ? new GDriveBackend(await ensureAuth())
        : new LocalBackend();

      const spinner = ora(`Deleting collection "${collectionName}" from ${collectionInConfig.backend}...`).start();
      try {
        await collBackend.deleteCollection(collectionInConfig);
        spinner.succeed(`Deleted collection "${collectionName}" from ${collectionInConfig.backend}`);
      } catch (err) {
        spinner.fail(`Failed to delete: ${(err as Error).message}`);
        return;
      }
    }

    // Clean up local cache
    if (collectionInConfig) {
      const cachePath = path.join(CACHE_DIR, collectionInConfig.id);
      if (fs.existsSync(cachePath)) {
        fs.rmSync(cachePath, { recursive: true, force: true });
      }
    }
  }

  // Remove ref from registry
  data.collections = data.collections.filter((c) => c.name !== collectionName);
  await backend.writeRegistry(reg, data);

  // Remove from local config — capture ID before removal for skills cleanup
  const removedColId = config.collections.find((c) => c.name === collectionName)?.id;
  config.collections = config.collections.filter((c) => c.name !== collectionName);

  // Remove skills index entries for this collection
  if (removedColId) {
    for (const [skillName, locations] of Object.entries(config.skills)) {
      config.skills[skillName] = locations.filter((l) => l.collectionId !== removedColId);
      if (config.skills[skillName].length === 0) delete config.skills[skillName];
    }
  }

  writeConfig(config);

  if (options.delete) {
    console.log(chalk.green(`Removed and deleted "${collectionName}" from registry "${reg.name}".`));
  } else {
    console.log(chalk.green(`Removed "${collectionName}" from registry "${reg.name}".`));
    console.log(chalk.dim(`  Collection data was kept. Use --delete to permanently remove it.`));
  }
}

export async function registryPushCommand(options: { backend?: string }): Promise<void> {
  const targetBackend = options.backend ?? "gdrive";

  if (targetBackend !== "gdrive") {
    console.log(chalk.red(`Push to "${targetBackend}" not yet supported. Use: --backend gdrive`));
    return;
  }

  let config: Config;
  try { config = readConfig(); } catch {
    console.log(chalk.red("No config found."));
    return;
  }

  // Find local registry
  const localReg = config.registries.find((r) => r.backend === "local");
  if (!localReg) {
    console.log(chalk.yellow("No local registry to push."));
    return;
  }

  const local = new LocalBackend();
  const localData = await local.readRegistry(localReg);
  const localCollectionRefs = localData.collections.filter((c) => c.backend === "local");

  if (localCollectionRefs.length === 0) {
    console.log(chalk.yellow("No local collections to push."));
    return;
  }

  const auth = await ensureAuth();
  const gdrive = new GDriveBackend(auth);

  // ── Phase 1: Upload all collections (no state changes yet) ─────────────
  // If any collection fails, we abort and nothing is committed.

  const spinner = ora("Pushing collections to Google Drive...").start();

  // Discover or create gdrive registry (this is safe — an empty registry is harmless)
  let gdriveReg = config.registries.find((r) => r.backend === "gdrive");
  if (!gdriveReg) {
    spinner.text = "Creating registry in Google Drive...";
    gdriveReg = await gdrive.createRegistry();
  }

  // Accumulate results — only commit if ALL succeed
  const pushed: { ref: typeof localCollectionRefs[0]; driveCol: CollectionInfo; folderName: string }[] = [];

  try {
    for (const ref of localCollectionRefs) {
      spinner.text = `Uploading collection "${ref.name}"...`;

      const collInfo = await local.resolveCollectionRef(ref);
      if (!collInfo) {
        throw new Error(`Collection "${ref.name}" not found locally`);
      }

      const PREFIX = "SKILLS_";
      const folderName = `${PREFIX}${ref.name.toUpperCase()}`;
      const driveCol = await gdrive.createCollection(folderName);

      const colData = await local.readCollection({ ...collInfo, id: "temp" });
      for (const skill of colData.skills) {
        const localSkillPath = path.join(collInfo.folderId, skill.name);
        if (fs.existsSync(localSkillPath)) {
          spinner.text = `Uploading ${ref.name}/${skill.name}...`;
          await gdrive.uploadSkill(driveCol, localSkillPath, skill.name);
        }
      }
      await gdrive.writeCollection(driveCol, colData);

      pushed.push({ ref, driveCol, folderName });
    }
  } catch (err) {
    spinner.fail(`Push failed: ${(err as Error).message}`);
    console.log(chalk.dim("  No changes were committed. Local state is unchanged."));
    return;
  }

  // ── Phase 2: Commit — update registry and config atomically ────────────

  spinner.text = "Updating registry...";

  try {
    // Read current gdrive registry (may already have entries)
    let gdriveData: import("../types.js").RegistryFile;
    try {
      gdriveData = await gdrive.readRegistry(gdriveReg);
    } catch {
      gdriveData = { name: gdriveReg.name, owner: await gdrive.getOwner(), source: "gdrive", collections: [] };
    }

    // Add all pushed collections at once
    for (const { ref, folderName } of pushed) {
      gdriveData.collections.push({ name: ref.name, backend: "gdrive", ref: folderName });
    }
    await gdrive.writeRegistry(gdriveReg, gdriveData);

    // Update local config
    if (!config.registries.find((r) => r.id === gdriveReg!.id)) {
      config.registries.push(gdriveReg);
    }
    for (const { driveCol } of pushed) {
      config.collections.push(driveCol);
    }
    writeConfig(config);

    spinner.succeed(`Pushed ${pushed.length} collection(s) to Google Drive`);
    for (const { ref } of pushed) {
      console.log(chalk.dim(`  ${ref.name} → gdrive`));
    }
  } catch (err) {
    spinner.fail(`Failed to update registry: ${(err as Error).message}`);
    console.log(chalk.dim("  Collections were uploaded but the registry was not updated."));
    console.log(chalk.dim("  Run 'skillsmanager registry push' again to retry."));
  }
}

// Need path import for push command
import path from "path";
