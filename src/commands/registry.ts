import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import { readConfig, writeConfig, mergeRegistries, CONFIG_PATH, CACHE_DIR } from "../config.js";
import { ensureAuth } from "../auth.js";
import { GDriveBackend } from "../backends/gdrive.js";
import { GithubBackend } from "../backends/github.js";
import { LocalBackend } from "../backends/local.js";
import type { CollectionInfo, Config, RegistryInfo } from "../types.js";
import { resolveBackend } from "../backends/resolve.js";

export async function registryCreateCommand(options: { backend?: string; repo?: string }): Promise<void> {
  const backend = options.backend ?? "local";

  const supported = ["local", "gdrive", "github"];
  if (!supported.includes(backend)) {
    console.log(chalk.red(`Unknown backend "${backend}". Supported: ${supported.join(", ")}`));
    return;
  }

  if (backend === "github" && !options.repo) {
    console.log(chalk.red("GitHub backend requires --repo <owner/repo>"));
    console.log(chalk.dim("  Example: skillsmanager registry create --backend github --repo owner/my-repo"));
    return;
  }

  const label = backend === "local" ? "locally" : `in ${backend}`;
  const spinner = ora(`Creating registry ${label}...`).start();
  try {
    let registry: RegistryInfo;
    if (backend === "github") {
      registry = await new GithubBackend().createRegistry(undefined, options.repo);
    } else {
      registry = await (await resolveBackend(backend)).createRegistry();
    }
    spinner.succeed(`Registry created ${label}`);

    let config: Config = { registries: [], collections: [], skills: {}, discoveredAt: new Date().toISOString() };
    if (fs.existsSync(CONFIG_PATH)) {
      try { config = readConfig(); } catch { /* use default */ }
    }
    config.registries.push(registry);
    writeConfig(config);
  } catch (err) {
    spinner.fail(`Failed: ${(err as Error).message}`);
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
      const backend = await resolveBackend(reg.backend);
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
    const backend = await resolveBackend(backendName);
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
  const backend = await resolveBackend(reg.backend);

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
  options: { delete?: boolean; backend?: string }
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

  // Search all registries for the collection; prefer one matching --backend if given
  let reg = config.registries[0];
  let data: Awaited<ReturnType<Awaited<ReturnType<typeof resolveBackend>>["readRegistry"]>> | null = null;
  let backend = await resolveBackend(reg.backend);

  for (const r of config.registries) {
    if (options.backend && r.backend !== options.backend) continue;
    try {
      const b = await resolveBackend(r.backend);
      const d = await b.readRegistry(r);
      if (d.collections.find((c) => c.name === collectionName)) {
        reg = r;
        backend = b;
        data = d;
        break;
      }
    } catch { /* skip unreadable registries */ }
  }

  if (!data) {
    // Fall back to reading the first (or backend-matched) registry for the error message
    try { data = await backend.readRegistry(reg); } catch { /**/ }
  }

  const ref = data?.collections.find((c) => c.name === collectionName);
  if (!ref) {
    console.log(chalk.yellow(`Collection "${collectionName}" not found in any registry.`));
    return;
  }

  // If --delete, delete the actual collection and skills from the backend
  if (options.delete) {
    const collectionInConfig = config.collections.find((c) => c.name === collectionName);
    if (collectionInConfig) {
      const collBackend = await resolveBackend(collectionInConfig.backend);

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
  data!.collections = data!.collections.filter((c) => c.name !== collectionName);
  await backend.writeRegistry(reg, data!);

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

export async function registryPushCommand(options: { backend?: string; repo?: string }): Promise<void> {
  const targetBackend = options.backend ?? "gdrive";

  const supportedPush = ["gdrive", "github"];
  if (!supportedPush.includes(targetBackend)) {
    console.log(chalk.red(`Push to "${targetBackend}" not yet supported. Use: --backend gdrive or --backend github`));
    return;
  }

  if (targetBackend === "github" && !options.repo) {
    console.log(chalk.red("GitHub backend requires --repo <owner/repo>"));
    console.log(chalk.dim("  Example: skillsmanager registry push --backend github --repo owner/my-repo"));
    return;
  }

  let config: Config;
  try { config = readConfig(); } catch {
    console.log(chalk.red("No config found."));
    return;
  }

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

  const remote = await resolveBackend(targetBackend);

  const spinner = ora(`Pushing collections to ${targetBackend}...`).start();

  // Find or create target registry
  let targetReg = config.registries.find((r) => r.backend === targetBackend);
  if (!targetReg) {
    spinner.text = `Creating registry in ${targetBackend}...`;
    targetReg = await remote.createRegistry();
  }

  // Read remote registry upfront to know what's already synced
  let remoteData: import("../types.js").RegistryFile;
  try {
    remoteData = await remote.readRegistry(targetReg);
  } catch {
    remoteData = { name: targetReg.name, owner: await remote.getOwner(), source: targetBackend, collections: [] };
  }
  const alreadySynced = new Set(remoteData.collections.map((c) => c.name));

  // Skip collections already present in the remote registry
  const toUpload = localCollectionRefs.filter((ref) => !alreadySynced.has(ref.name));

  if (toUpload.length === 0) {
    spinner.succeed("Remote registry is already up to date.");
    return;
  }

  // Phase 1: Upload new collections — abort on any failure
  const pushed: { ref: typeof localCollectionRefs[0]; remoteCol: CollectionInfo }[] = [];

  try {
    for (const ref of toUpload) {
      spinner.text = `Uploading collection "${ref.name}"...`;

      const collInfo = await local.resolveCollectionRef(ref);
      if (!collInfo) throw new Error(`Collection "${ref.name}" not found locally`);

      let remoteCol: CollectionInfo;
      if (targetBackend === "gdrive") {
        const gdrive = remote as import("../backends/gdrive.js").GDriveBackend;
        const folderName = `SKILLS_${ref.name.toUpperCase()}`;
        remoteCol = await gdrive.createCollection(folderName);
      } else {
        const github = remote as import("../backends/github.js").GithubBackend;
        remoteCol = await github.createCollection(ref.name, options.repo);
      }

      const colData = await local.readCollection({ ...collInfo, id: "temp" });
      for (const skill of colData.skills) {
        const localSkillPath = path.join(collInfo.folderId, skill.name);
        if (fs.existsSync(localSkillPath)) {
          spinner.text = `Uploading ${ref.name}/${skill.name}...`;
          await remote.uploadSkill(remoteCol, localSkillPath, skill.name);
        }
      }
      await remote.writeCollection(remoteCol, colData);
      pushed.push({ ref, remoteCol });
    }
  } catch (err) {
    spinner.fail(`Push failed: ${(err as Error).message}`);
    console.log(chalk.dim("  No changes were committed. Local state is unchanged."));
    return;
  }

  // Phase 2: Commit — update registry and config atomically
  spinner.text = "Updating registry...";

  try {
    for (const { ref, remoteCol } of pushed) {
      if (!remoteData.collections.find((c) => c.name === ref.name)) {
        remoteData.collections.push({ name: ref.name, backend: targetBackend, ref: remoteCol.folderId });
      }
    }
    await remote.writeRegistry(targetReg, remoteData);

    if (!config.registries.find((r) => r.id === targetReg!.id)) {
      config.registries.push(targetReg);
    }
    for (const { remoteCol } of pushed) {
      config.collections.push(remoteCol);
    }
    writeConfig(config);

    spinner.succeed(`Pushed ${pushed.length} collection(s) to ${targetBackend}`);
    for (const { ref } of pushed) {
      console.log(chalk.dim(`  ${ref.name} → ${targetBackend}`));
    }
  } catch (err) {
    spinner.fail(`Failed to update registry: ${(err as Error).message}`);
    console.log(chalk.dim("  Collections were uploaded but the registry was not updated."));
    console.log(chalk.dim(`  Run 'skillsmanager registry push --backend ${targetBackend}' again to retry.`));
  }
}

// Need path import for push command
import path from "path";
