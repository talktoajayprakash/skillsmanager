import os from "os";
import path from "path";

export interface SkillEntry {
  name: string;
  path: string;
  description: string;
}

export interface CollectionFile {
  name: string;
  owner: string;
  skills: SkillEntry[];
}

export interface CollectionInfo {
  id: string;           // Stable UUID used for cache path — backend-agnostic
  name: string;
  backend: string;      // "local" | "gdrive" | "github" — string for extensibility
  folderId: string;     // backend-specific location identifier
  registryFileId?: string; // backend-specific file ID of SKILLS_COLLECTION.yaml
  sourceRegistryId?: string; // UUID of the registry that discovered this collection
}

export interface RegistryCollectionRef {
  name: string;
  backend: string;      // "local" | "gdrive" | "github"
  ref: string;          // backend-specific identifier (folder name, repo path, etc.)
}

export interface RegistryFile {
  name: string;
  owner: string;
  source: string;       // where the registry itself is stored: "local" | "gdrive" | "github"
  collections: RegistryCollectionRef[];
}

export interface RegistryInfo {
  id: string;           // stable UUID (assigned by config layer)
  name: string;
  backend: string;
  folderId: string;     // backend-specific location of the registry
  fileId?: string;      // backend-specific file ID of SKILLS_REGISTRY.yaml
}

export interface SkillLocation {
  collectionId: string;
  installedAt: string[]; // absolute paths where this skill has been installed
}

export interface SkillIndex {
  [skillName: string]: SkillLocation[];
}

export interface Config {
  registries: RegistryInfo[];
  collections: CollectionInfo[];
  skills: SkillIndex;
  discoveredAt: string;
}

// Resolved skill = skill entry + which collection it came from
export interface ResolvedSkill {
  entry: SkillEntry;
  collection: CollectionInfo;
}

// Agent name → user-level skills directory path
export const AGENT_PATHS: Record<string, string> = {
  claude: path.join(os.homedir(), ".claude", "skills"),
  codex: path.join(os.homedir(), ".codex", "skills"),
  agents: path.join(os.homedir(), ".agents", "skills"),
  cursor: path.join(os.homedir(), ".cursor", "skills"),
  windsurf: path.join(os.homedir(), ".codeium", "windsurf", "skills"),
  copilot: path.join(os.homedir(), ".copilot", "skills"),
  gemini: path.join(os.homedir(), ".gemini", "skills"),
  roo: path.join(os.homedir(), ".roo", "skills"),
};
