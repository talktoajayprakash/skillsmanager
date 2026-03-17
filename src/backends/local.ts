import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { StorageBackend } from "./interface.js";
import type { CollectionFile, CollectionInfo, RegistryCollectionRef, RegistryFile, RegistryInfo } from "../types.js";
import {
  parseCollection, serializeCollection,
  parseRegistryFile, serializeRegistryFile,
  COLLECTION_FILENAME, LEGACY_COLLECTION_FILENAME, REGISTRY_FILENAME,
} from "../registry.js";
import { CONFIG_DIR } from "../config.js";

const COLLECTIONS_DIR = path.join(CONFIG_DIR, "collections");
const LOCAL_REGISTRY_PATH = path.join(CONFIG_DIR, "registry.yaml");

/**
 * Local filesystem backend — stores collections and the registry under ~/.skillsmanager/.
 * Works with zero setup, no auth, no internet. This is the default backend.
 */
export class LocalBackend implements StorageBackend {
  // ── Identity ─────────────────────────────────────────────────────────────

  async getOwner(): Promise<string> {
    // Try to read from existing registry first
    if (fs.existsSync(LOCAL_REGISTRY_PATH)) {
      const data = parseRegistryFile(fs.readFileSync(LOCAL_REGISTRY_PATH, "utf-8"));
      if (data.owner) return data.owner;
    }
    return process.env.USER ?? process.env.USERNAME ?? "unknown";
  }

  // ── Collection operations ────────────────────────────────────────────────

  async discoverCollections(): Promise<Omit<CollectionInfo, "id">[]> {
    if (!fs.existsSync(COLLECTIONS_DIR)) return [];

    const collections: Omit<CollectionInfo, "id">[] = [];
    for (const entry of fs.readdirSync(COLLECTIONS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(COLLECTIONS_DIR, entry.name);
      const hasNew = fs.existsSync(path.join(dir, COLLECTION_FILENAME));
      const hasLegacy = fs.existsSync(path.join(dir, LEGACY_COLLECTION_FILENAME));
      if (hasNew || hasLegacy) {
        collections.push({
          name: entry.name,
          backend: "local",
          folderId: dir,
        });
      }
    }
    return collections;
  }

  async readCollection(collection: CollectionInfo): Promise<CollectionFile> {
    const dir = collection.folderId;
    for (const filename of [COLLECTION_FILENAME, LEGACY_COLLECTION_FILENAME]) {
      const filePath = path.join(dir, filename);
      if (fs.existsSync(filePath)) {
        return parseCollection(fs.readFileSync(filePath, "utf-8"));
      }
    }
    throw new Error(`Collection file not found in "${collection.name}"`);
  }

  async writeCollection(collection: CollectionInfo, data: CollectionFile): Promise<void> {
    const dir = collection.folderId;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, COLLECTION_FILENAME), serializeCollection(data));
  }

  async downloadSkill(
    collection: CollectionInfo,
    skillName: string,
    destDir: string
  ): Promise<void> {
    const src = path.join(collection.folderId, skillName);
    if (!fs.existsSync(src)) {
      throw new Error(`Skill "${skillName}" not found in local collection "${collection.name}"`);
    }
    // If source and dest are the same, no-op
    if (path.resolve(src) === path.resolve(destDir)) return;
    copyDirSync(src, destDir);
  }

  async uploadSkill(
    collection: CollectionInfo,
    localPath: string,
    skillName: string
  ): Promise<void> {
    const dest = path.join(collection.folderId, skillName);
    // If source and dest are the same, no-op
    if (path.resolve(localPath) === path.resolve(dest)) return;
    copyDirSync(localPath, dest);
  }

  async deleteCollection(collection: CollectionInfo): Promise<void> {
    if (fs.existsSync(collection.folderId)) {
      fs.rmSync(collection.folderId, { recursive: true, force: true });
    }
  }

  async deleteSkill(collection: CollectionInfo, skillName: string): Promise<void> {
    const skillPath = path.join(collection.folderId, skillName);
    if (fs.existsSync(skillPath)) {
      fs.rmSync(skillPath, { recursive: true, force: true });
    }
  }

  // ── Registry operations ──────────────────────────────────────────────────

  async discoverRegistries(): Promise<Omit<RegistryInfo, "id">[]> {
    if (!fs.existsSync(LOCAL_REGISTRY_PATH)) return [];
    return [{
      name: "local",
      backend: "local",
      folderId: CONFIG_DIR,
      fileId: LOCAL_REGISTRY_PATH,
    }];
  }

  async readRegistry(registry: RegistryInfo): Promise<RegistryFile> {
    const filePath = registry.fileId ?? LOCAL_REGISTRY_PATH;
    if (!fs.existsSync(filePath)) {
      throw new Error("Local registry not found");
    }
    return parseRegistryFile(fs.readFileSync(filePath, "utf-8"));
  }

  async writeRegistry(registry: RegistryInfo, data: RegistryFile): Promise<void> {
    const filePath = registry.fileId ?? LOCAL_REGISTRY_PATH;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, serializeRegistryFile(data));
  }

  async resolveCollectionRef(ref: RegistryCollectionRef): Promise<Omit<CollectionInfo, "id"> | null> {
    if (ref.backend !== "local") return null;
    const dir = path.join(COLLECTIONS_DIR, ref.ref);
    const hasNew = fs.existsSync(path.join(dir, COLLECTION_FILENAME));
    const hasLegacy = fs.existsSync(path.join(dir, LEGACY_COLLECTION_FILENAME));
    if (!hasNew && !hasLegacy) return null;
    return {
      name: ref.name,
      backend: "local",
      folderId: dir,
    };
  }

  async createRegistry(name?: string): Promise<RegistryInfo> {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const owner = await this.getOwner();
    const data: RegistryFile = {
      name: name ?? "local",
      owner,
      source: "local",
      collections: [],
    };
    fs.writeFileSync(LOCAL_REGISTRY_PATH, serializeRegistryFile(data));
    return {
      id: randomUUID(),
      name: name ?? "local",
      backend: "local",
      folderId: CONFIG_DIR,
      fileId: LOCAL_REGISTRY_PATH,
    };
  }

  // ── Convenience: create a local collection ───────────────────────────────

  async createCollection({ name }: import("./interface.js").CreateCollectionOptions): Promise<CollectionInfo> {
    const dir = path.join(COLLECTIONS_DIR, name);
    fs.mkdirSync(dir, { recursive: true });
    const owner = await this.getOwner();
    const data: CollectionFile = { name, owner, skills: [] };
    fs.writeFileSync(path.join(dir, COLLECTION_FILENAME), serializeCollection(data));
    return {
      id: randomUUID(),
      name,
      backend: "local",
      folderId: dir,
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
