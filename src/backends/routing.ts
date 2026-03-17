import type { CreateCollectionOptions, StorageBackend } from "./interface.js";
import type { CollectionFile, CollectionInfo, RegistryCollectionRef, RegistryFile, RegistryInfo } from "../types.js";
import { GithubBackend } from "./github.js";

/**
 * RoutingBackend — a transparent decorator over any StorageBackend.
 *
 * Collection-metadata operations (readCollection, writeCollection, registry ops, etc.)
 * pass straight through to the inner backend — the YAML always lives where the
 * collection was declared.
 *
 * Skill-file operations (downloadSkill, uploadSkill, deleteSkill) inspect col.type
 * and dispatch to the appropriate handler:
 *   - col.type === "github"  → GithubBackend helpers (clone/pull the skills repo)
 *   - col.type absent/same  → inner backend (normal behaviour, no change)
 *
 * This means every backend gets cross-backend routing for free without any
 * per-backend col.type checks.
 */
export class RoutingBackend implements StorageBackend {
  constructor(private readonly inner: StorageBackend) {}

  // ── Pass-through: identity + collection metadata ───────────────────────────

  getOwner(): Promise<string> {
    return this.inner.getOwner();
  }

  discoverCollections(): Promise<Omit<CollectionInfo, "id">[]> {
    return this.inner.discoverCollections();
  }

  readCollection(collection: CollectionInfo): Promise<CollectionFile> {
    return this.inner.readCollection(collection);
  }

  writeCollection(collection: CollectionInfo, data: CollectionFile): Promise<void> {
    return this.inner.writeCollection(collection, data);
  }

  deleteCollection(collection: CollectionInfo): Promise<void> {
    return this.inner.deleteCollection(collection);
  }

  // ── Pass-through: registry operations ─────────────────────────────────────

  discoverRegistries(): Promise<Omit<RegistryInfo, "id">[]> {
    return this.inner.discoverRegistries();
  }

  readRegistry(registry: RegistryInfo): Promise<RegistryFile> {
    return this.inner.readRegistry(registry);
  }

  writeRegistry(registry: RegistryInfo, data: RegistryFile): Promise<void> {
    return this.inner.writeRegistry(registry, data);
  }

  resolveCollectionRef(ref: RegistryCollectionRef): Promise<Omit<CollectionInfo, "id"> | null> {
    return this.inner.resolveCollectionRef(ref);
  }

  createRegistry(name?: string): Promise<RegistryInfo> {
    return this.inner.createRegistry(name);
  }

  createCollection(options: CreateCollectionOptions): Promise<CollectionInfo> {
    return this.inner.createCollection(options);
  }

  // ── Routed: dispatch on col.type for skill-file operations ─────────────────

  async downloadSkill(collection: CollectionInfo, skillName: string, destDir: string): Promise<void> {
    const col = await this.inner.readCollection(collection);
    const skillType = col.type ?? collection.backend;

    // Only cross-dispatch when the skill source differs from the collection's own backend.
    // Same-backend collections (e.g. GitHub-native) handle routing internally.
    if (skillType === "github" && collection.backend !== "github") {
      const repo = this.requireRepo(col, collection.name);
      const entry = this.requireEntry(col, skillName, collection.name);
      await new GithubBackend().downloadSkillFromRepo(repo, entry.path, destDir);
      return;
    }

    return this.inner.downloadSkill(collection, skillName, destDir);
  }

  async uploadSkill(collection: CollectionInfo, localPath: string, skillName: string): Promise<void> {
    const col = await this.inner.readCollection(collection);
    const skillType = col.type ?? collection.backend;

    // Case 1: collection YAML in one backend, skills declared in another (col.type set)
    if (skillType !== collection.backend) {
      throw new Error(
        `Cannot upload skill to collection "${collection.name}": ` +
        `its skills source type is "${skillType}". ` +
        `Use --remote-path to register a skill path instead.`
      );
    }

    // Case 2: GitHub-native collection whose metadata.repo points to a foreign repo
    if (skillType === "github" && col.metadata?.repo) {
      const hostRepo = collection.folderId.split(":")[0];
      const foreign = col.metadata.repo as string;
      if (foreign !== hostRepo) {
        throw new Error(
          `Cannot upload skill to collection "${collection.name}": ` +
          `its skills source is "${foreign}" (a repo you may not own). ` +
          `Use --remote-path to register a skill path instead.`
        );
      }
    }

    return this.inner.uploadSkill(collection, localPath, skillName);
  }

  async deleteSkill(collection: CollectionInfo, skillName: string): Promise<void> {
    const col = await this.inner.readCollection(collection);
    const skillType = col.type ?? collection.backend;

    // Only cross-dispatch when the skill source differs from the collection's own backend.
    if (skillType === "github" && collection.backend !== "github") {
      const repo = this.requireRepo(col, collection.name);
      const entry = col.skills.find((s) => s.name === skillName);
      if (!entry) return;
      await new GithubBackend().deleteSkillFromRepo(repo, entry.path);
      return;
    }

    return this.inner.deleteSkill(collection, skillName);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private requireRepo(col: CollectionFile, collectionName: string): string {
    const repo = col.metadata?.repo as string | undefined;
    if (!repo) {
      throw new Error(
        `Collection "${collectionName}" has type "github" but is missing metadata.repo`
      );
    }
    return repo;
  }

  private requireEntry(col: CollectionFile, skillName: string, collectionName: string) {
    const entry = col.skills.find((s) => s.name === skillName);
    if (!entry) {
      throw new Error(`Skill "${skillName}" not found in collection "${collectionName}"`);
    }
    return entry;
  }
}
