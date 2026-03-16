import chalk from "chalk";
import type { OAuth2Client } from "google-auth-library";
import { ensureAuth } from "./auth.js";
import { readConfig, writeConfig, mergeCollections, CONFIG_PATH } from "./config.js";
import { GDriveBackend } from "./backends/gdrive.js";
import type { Config } from "./types.js";
import fs from "fs";

export interface ReadyContext {
  auth: OAuth2Client;
  config: Config;
  backend: GDriveBackend;
}

/**
 * Ensures the user is authenticated and has at least one collection configured.
 * - If not authenticated: launches OAuth flow automatically.
 * - If no config or empty collections: auto-discovers from Google Drive.
 * Call this at the start of any command that needs Drive access.
 */
export async function ensureReady(): Promise<ReadyContext> {
  const auth = await ensureAuth();
  const backend = new GDriveBackend(auth);

  // Try to load config
  let config: Config | null = null;
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      config = readConfig();
    } catch {
      config = null;
    }
  }

  // Auto-discover if no config or no collections
  if (!config || config.collections.length === 0) {
    process.stdout.write(chalk.dim("Discovering collections... "));
    const fresh = await backend.discoverCollections();
    const collections = mergeCollections(fresh, config?.collections ?? []);
    config = { registries: config?.registries ?? [], collections, skills: config?.skills ?? {}, discoveredAt: new Date().toISOString() };
    writeConfig(config);

    if (collections.length === 0) {
      process.stdout.write("\n");
      throw new Error(
        "No collections found. Run: skillsmanager collection create <name>"
      );
    }
    process.stdout.write(chalk.green(`found ${collections.length}.\n`));
  }

  return { auth, config: config!, backend };
}
