import type { CollectionFile, CollectionInfo, RegistryCollectionRef, RegistryFile, RegistryInfo } from "../types.js";

export interface CreateCollectionOptions {
  name: string;
  repo?: string;       // required for github; ignored by others
  skillsRepo?: string; // cross-repo skill source (all backends)
}

export interface StorageBackend {
  // ── Identity ───────────────────────────────────────────────────────────────
  getOwner(): Promise<string>; // identity of the authenticated user (email, username, etc.)

  // ── Collection operations (existing) ─────────────────────────────────────
  discoverCollections(): Promise<Omit<CollectionInfo, "id">[]>;
  readCollection(collection: CollectionInfo): Promise<CollectionFile>;
  writeCollection(collection: CollectionInfo, data: CollectionFile): Promise<void>;
  downloadSkill(collection: CollectionInfo, skillName: string, destDir: string): Promise<void>;
  uploadSkill(collection: CollectionInfo, localPath: string, skillName: string): Promise<void>;

  deleteCollection(collection: CollectionInfo): Promise<void>;
  deleteSkill(collection: CollectionInfo, skillName: string): Promise<void>;

  // ── Registry operations (new) ────────────────────────────────────────────
  discoverRegistries(): Promise<Omit<RegistryInfo, "id">[]>;
  readRegistry(registry: RegistryInfo): Promise<RegistryFile>;
  writeRegistry(registry: RegistryInfo, data: RegistryFile): Promise<void>;
  resolveCollectionRef(ref: RegistryCollectionRef): Promise<Omit<CollectionInfo, "id"> | null>;
  createRegistry(name?: string): Promise<RegistryInfo>;
  createCollection(options: CreateCollectionOptions): Promise<CollectionInfo>;
}
