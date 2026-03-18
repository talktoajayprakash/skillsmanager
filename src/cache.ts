import fs from "fs";
import path from "path";
import { CACHE_DIR } from "./config.js";
import { AGENT_PATHS } from "./types.js";
import type { CollectionInfo } from "./types.js";

export function getCachePath(collection: CollectionInfo, skillName?: string): string {
  const base = path.join(CACHE_DIR, collection.id);
  return skillName ? path.join(base, skillName) : base;
}

export function ensureCachePath(collection: CollectionInfo): string {
  const p = getCachePath(collection);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export type Scope = "global" | "project";

/**
 * Returns the symlink target directory for the given agent and scope.
 * - global: ~/.agent/skills/  (from AGENT_PATHS)
 * - project: <cwd>/.agent/skills/
 *
 * Also returns whether the directory had to be created, so the caller
 * can print a transparent message to the user.
 */
export function resolveSkillsDir(
  agentName: string,
  scope: Scope,
  cwd: string
): { skillsDir: string; created: boolean } {
  if (!AGENT_PATHS[agentName]) {
    const supported = Object.keys(AGENT_PATHS).join(", ");
    throw new Error(`Unknown agent "${agentName}". Supported agents: ${supported}`);
  }

  let skillsDir: string;
  if (scope === "project") {
    // Derive the agent subfolder name from the global path (e.g. ".claude/skills")
    const globalDir = AGENT_PATHS[agentName];
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    const relative = path.relative(home, globalDir); // e.g. ".claude/skills"
    skillsDir = path.join(cwd, relative);
  } else {
    skillsDir = AGENT_PATHS[agentName];
  }

  const existed = fs.existsSync(skillsDir);
  fs.mkdirSync(skillsDir, { recursive: true });
  return { skillsDir, created: !existed };
}

export function createSymlink(
  skillName: string,
  cachePath: string,
  agentName: string,
  scope: Scope = "global",
  cwd: string = process.cwd()
): { skillsDir: string; created: boolean } {
  const { skillsDir, created } = resolveSkillsDir(agentName, scope, cwd);

  const linkPath = path.join(skillsDir, skillName);

  let existingStat: fs.Stats | undefined;
  try { existingStat = fs.lstatSync(linkPath); } catch { /* doesn't exist */ }
  if (existingStat) {
    if (existingStat.isSymbolicLink()) {
      fs.unlinkSync(linkPath);
    } else {
      throw new Error(
        `${linkPath} already exists and is not a symlink. Remove it manually to proceed.`
      );
    }
  }

  fs.symlinkSync(cachePath, linkPath);
  return { skillsDir, created };
}

export function skillExistsInCache(
  collection: CollectionInfo,
  skillName: string
): boolean {
  return fs.existsSync(getCachePath(collection, skillName));
}
