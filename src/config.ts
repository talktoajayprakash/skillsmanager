import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import type { Config, CollectionInfo, SkillLocation } from "./types.js";

export const CONFIG_DIR = path.join(os.homedir(), ".skillssync");
export const CREDENTIALS_PATH = path.join(CONFIG_DIR, "credentials.json");
export const TOKEN_PATH = path.join(CONFIG_DIR, "token.json");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
export const CACHE_DIR = path.join(CONFIG_DIR, "cache");

export function ensureConfigDir(): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

export function ensureCacheDir(): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

export function readConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`No config found. Run "skillsync init" first.`);
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
  // Backwards compat: old configs used "registries" key
  if (raw.registries && !raw.collections) {
    raw.collections = raw.registries;
  }
  // Backwards compat: assign stable UUIDs to collections missing an id
  const collections = raw.collections as CollectionInfo[];
  let needsWrite = false;
  if (Array.isArray(collections)) {
    collections.forEach((c) => { if (!c.id) { c.id = randomUUID(); needsWrite = true; } });
  }
  // Backwards compat: old configs have no skills index
  if (!raw.skills) { raw.skills = {}; needsWrite = true; }
  // Backwards compat: old skills index used flat { collectionId } instead of array
  const skills = raw.skills as Record<string, unknown>;
  for (const key of Object.keys(skills)) {
    const val = skills[key];
    if (!Array.isArray(val)) {
      skills[key] = [{ collectionId: (val as { collectionId: string }).collectionId, installedAt: [] }];
      needsWrite = true;
    }
  }
  const config = raw as unknown as Config;
  // Persist any backfilled values so they are stable on subsequent reads
  if (needsWrite) fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return config;
}

/**
 * Merges freshly discovered collections with existing ones, preserving UUIDs
 * for collections already known (matched by folderId). New collections get a
 * fresh UUID. This keeps cache paths stable across refreshes.
 */
export function mergeCollections(
  fresh: Omit<CollectionInfo, "id">[],
  existing: CollectionInfo[]
): CollectionInfo[] {
  return fresh.map((c) => {
    const prev = existing.find((e) => e.folderId === c.folderId);
    return { ...c, id: prev?.id ?? randomUUID() };
  });
}

export function trackSkill(skillName: string, collectionId: string, installedPath?: string): void {
  let config: Config;
  try { config = readConfig(); } catch { config = { collections: [], skills: {}, discoveredAt: new Date().toISOString() }; }
  if (!config.skills) config.skills = {};

  const entries: SkillLocation[] = config.skills[skillName] ?? [];

  // Find existing entry for this collection
  const existing = entries.find((e) => e.collectionId === collectionId);
  if (existing) {
    if (installedPath && !existing.installedAt.includes(installedPath)) {
      existing.installedAt.push(installedPath);
    }
  } else {
    entries.push({ collectionId, installedAt: installedPath ? [installedPath] : [] });
  }

  config.skills[skillName] = entries;
  writeConfig(config);
}

export function writeConfig(config: Config): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function credentialsExist(): boolean {
  return fs.existsSync(CREDENTIALS_PATH);
}

export function readCredentials(): {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
} {
  if (!credentialsExist()) {
    throw new Error(
      `No credentials file found at ${CREDENTIALS_PATH}.\n\n` +
        `To set up Google Drive:\n` +
        `  1. Go to https://console.cloud.google.com/\n` +
        `  2. Create a project and enable the Google Drive API\n` +
        `  3. Create OAuth 2.0 credentials (Desktop app type)\n` +
        `  4. Download the JSON and save as ${CREDENTIALS_PATH}\n` +
        `  5. Run "skillsync init" again`
    );
  }
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const creds = raw.installed ?? raw.web ?? raw;
  return {
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    redirect_uris: creds.redirect_uris ?? ["urn:ietf:wg:oauth:2.0:oob"],
  };
}
