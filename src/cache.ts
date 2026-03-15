import fs from "fs";
import path from "path";
import { CACHE_DIR } from "./config.js";
import { AGENT_PATHS } from "./types.js";
import type { CollectionInfo } from "./types.js";

export function getCachePath(collection: CollectionInfo, skillName?: string): string {
  const base = path.join(CACHE_DIR, collection.name);
  return skillName ? path.join(base, skillName) : base;
}

export function ensureCachePath(collection: CollectionInfo): string {
  const p = getCachePath(collection);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function createSymlink(
  skillName: string,
  cachePath: string,
  agentName: string
): void {
  const agentDir = AGENT_PATHS[agentName];
  if (!agentDir) {
    const supported = Object.keys(AGENT_PATHS).join(", ");
    throw new Error(
      `Unknown agent "${agentName}". Supported agents: ${supported}`
    );
  }

  fs.mkdirSync(agentDir, { recursive: true });

  const linkPath = path.join(agentDir, skillName);

  // Remove existing symlink or directory
  if (fs.existsSync(linkPath)) {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(linkPath);
    } else {
      throw new Error(
        `${linkPath} already exists and is not a symlink. Remove it manually to proceed.`
      );
    }
  }

  fs.symlinkSync(cachePath, linkPath);
}

export function skillExistsInCache(
  collection: CollectionInfo,
  skillName: string
): boolean {
  return fs.existsSync(getCachePath(collection, skillName));
}
