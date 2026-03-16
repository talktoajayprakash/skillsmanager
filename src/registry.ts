import YAML from "yaml";
import type { CollectionFile, RegistryFile } from "./types.js";

// ── Filename constants ───────────────────────────────────────────────────────

export const REGISTRY_FILENAME = "SKILLS_REGISTRY.yaml";
export const COLLECTION_FILENAME = "SKILLS_COLLECTION.yaml";
export const LEGACY_COLLECTION_FILENAME = "SKILLS_SYNC.yaml";

// ── Collection (formerly "registry") parsing ─────────────────────────────────

export function parseCollection(content: string): CollectionFile {
  const data = YAML.parse(content);
  return {
    name: data.name ?? "",
    owner: data.owner ?? "",
    skills: (data.skills ?? []).map((s: Record<string, string>) => ({
      name: s.name,
      path: s.path ?? `${s.name}/`,
      description: s.description ?? "",
    })),
  };
}

export function serializeCollection(collection: CollectionFile): string {
  return YAML.stringify({
    name: collection.name,
    owner: collection.owner,
    skills: collection.skills.map((s) => ({
      name: s.name,
      path: s.path,
      description: s.description,
    })),
  });
}

// Backwards-compat aliases
export const parseRegistry = parseCollection;
export const serializeRegistry = serializeCollection;

// ── Registry file parsing ────────────────────────────────────────────────────

export function parseRegistryFile(content: string): RegistryFile {
  const data = YAML.parse(content);
  return {
    name: data.name ?? "",
    owner: data.owner ?? "",
    source: data.source ?? "local",
    collections: (data.collections ?? []).map(
      (c: Record<string, string>) => ({
        name: c.name,
        backend: c.backend ?? "local",
        ref: c.ref ?? c.name,
      })
    ),
  };
}

export function serializeRegistryFile(registry: RegistryFile): string {
  return YAML.stringify({
    name: registry.name,
    owner: registry.owner,
    source: registry.source,
    collections: registry.collections.map((c) => ({
      name: c.name,
      backend: c.backend,
      ref: c.ref,
    })),
  });
}
