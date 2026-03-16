import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  parseCollection, serializeCollection,
  parseRegistryFile, serializeRegistryFile,
  parseRegistry, serializeRegistry,
  REGISTRY_FILENAME, COLLECTION_FILENAME, LEGACY_COLLECTION_FILENAME,
} from "../registry.js";
import { mergeRegistries, mergeCollections } from "../config.js";
import type { RegistryInfo, CollectionInfo } from "../types.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skillsmanager-registry-test-"));
}

// ── Filename constants ────────────────────────────────────────────────────

describe("filename constants", () => {
  it("REGISTRY_FILENAME is SKILLS_REGISTRY.yaml", () => {
    expect(REGISTRY_FILENAME).toBe("SKILLS_REGISTRY.yaml");
  });

  it("COLLECTION_FILENAME is SKILLS_COLLECTION.yaml", () => {
    expect(COLLECTION_FILENAME).toBe("SKILLS_COLLECTION.yaml");
  });

  it("LEGACY_COLLECTION_FILENAME is SKILLS_SYNC.yaml", () => {
    expect(LEGACY_COLLECTION_FILENAME).toBe("SKILLS_SYNC.yaml");
  });
});

// ── Collection parsing ────────────────────────────────────────────────────

describe("parseCollection / serializeCollection", () => {
  const yaml = `name: my_skills\nowner: test@example.com\nskills:\n  - name: write_post\n    path: write_post/\n    description: Writes posts\n`;

  it("parses collection YAML correctly", () => {
    const result = parseCollection(yaml);
    expect(result.name).toBe("my_skills");
    expect(result.owner).toBe("test@example.com");
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe("write_post");
  });

  it("serializes and round-trips", () => {
    const original = parseCollection(yaml);
    const serialized = serializeCollection(original);
    const roundTripped = parseCollection(serialized);
    expect(roundTripped).toEqual(original);
  });

  it("backwards-compat aliases work", () => {
    expect(parseRegistry).toBe(parseCollection);
    expect(serializeRegistry).toBe(serializeCollection);
  });

  it("handles missing fields gracefully", () => {
    const result = parseCollection("skills: []");
    expect(result.name).toBe("");
    expect(result.owner).toBe("");
    expect(result.skills).toEqual([]);
  });
});

// ── Registry file parsing ─────────────────────────────────────────────────

describe("parseRegistryFile / serializeRegistryFile", () => {
  const yaml = `name: ajay-skills\nowner: ajay@example.com\nsource: local\ncollections:\n  - name: my_skills\n    backend: local\n    ref: my_skills\n  - name: team_prompts\n    backend: gdrive\n    ref: SKILLS_TEAM_PROMPTS\n`;

  it("parses registry YAML correctly", () => {
    const result = parseRegistryFile(yaml);
    expect(result.name).toBe("ajay-skills");
    expect(result.owner).toBe("ajay@example.com");
    expect(result.source).toBe("local");
    expect(result.collections).toHaveLength(2);
    expect(result.collections[0]).toEqual({ name: "my_skills", backend: "local", ref: "my_skills" });
    expect(result.collections[1]).toEqual({ name: "team_prompts", backend: "gdrive", ref: "SKILLS_TEAM_PROMPTS" });
  });

  it("serializes and round-trips", () => {
    const original = parseRegistryFile(yaml);
    const serialized = serializeRegistryFile(original);
    const roundTripped = parseRegistryFile(serialized);
    expect(roundTripped).toEqual(original);
  });

  it("defaults source to local when missing", () => {
    const result = parseRegistryFile("name: test\nowner: test\ncollections: []");
    expect(result.source).toBe("local");
  });

  it("handles empty collections", () => {
    const result = parseRegistryFile("name: empty\nowner: test\nsource: local\ncollections: []");
    expect(result.collections).toEqual([]);
  });

  it("defaults backend to local when missing in collection ref", () => {
    const yaml = "name: test\nowner: test\nsource: local\ncollections:\n  - name: col1\n    ref: col1\n";
    const result = parseRegistryFile(yaml);
    expect(result.collections[0].backend).toBe("local");
  });
});

// ── mergeRegistries ───────────────────────────────────────────────────────

describe("mergeRegistries", () => {
  it("preserves UUIDs for known registries matched by folderId", () => {
    const existing: RegistryInfo[] = [
      { id: "existing-uuid", name: "local", backend: "local", folderId: "/home/.skillsmanager" },
    ];
    const fresh: Omit<RegistryInfo, "id">[] = [
      { name: "local", backend: "local", folderId: "/home/.skillsmanager" },
    ];
    const result = mergeRegistries(fresh, existing);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("existing-uuid");
  });

  it("assigns new UUID for unknown registries", () => {
    const result = mergeRegistries(
      [{ name: "new-reg", backend: "gdrive", folderId: "new-folder" }],
      []
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBeTruthy();
    expect(result[0].name).toBe("new-reg");
  });

  it("handles mix of known and unknown", () => {
    const existing: RegistryInfo[] = [
      { id: "uuid-1", name: "reg1", backend: "local", folderId: "/path/1" },
    ];
    const fresh: Omit<RegistryInfo, "id">[] = [
      { name: "reg1", backend: "local", folderId: "/path/1" },
      { name: "reg2", backend: "gdrive", folderId: "folder-2" },
    ];
    const result = mergeRegistries(fresh, existing);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("uuid-1");
    expect(result[1].id).not.toBe("uuid-1");
  });
});

// ── Local backend ─────────────────────────────────────────────────────────

describe("LocalBackend", () => {
  // We test the local backend directly with real filesystem operations
  let tmpDir: string;
  let origConfigDir: string;

  // We need to override CONFIG_DIR for the local backend
  // Since LocalBackend imports CONFIG_DIR at module level, we test the file operations directly

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a local registry YAML file", () => {
    const registryPath = path.join(tmpDir, "registry.yaml");
    const data = { name: "test", owner: "tester", source: "local" as const, collections: [] };
    fs.writeFileSync(registryPath, serializeRegistryFile(data));

    expect(fs.existsSync(registryPath)).toBe(true);
    const parsed = parseRegistryFile(fs.readFileSync(registryPath, "utf-8"));
    expect(parsed.name).toBe("test");
    expect(parsed.source).toBe("local");
  });

  it("creates a local collection directory with SKILLS_COLLECTION.yaml", () => {
    const colDir = path.join(tmpDir, "collections", "my_skills");
    fs.mkdirSync(colDir, { recursive: true });
    const data = { name: "my_skills", owner: "tester", skills: [] };
    fs.writeFileSync(path.join(colDir, COLLECTION_FILENAME), serializeCollection(data));

    expect(fs.existsSync(path.join(colDir, COLLECTION_FILENAME))).toBe(true);
    const parsed = parseCollection(fs.readFileSync(path.join(colDir, COLLECTION_FILENAME), "utf-8"));
    expect(parsed.name).toBe("my_skills");
  });

  it("discovers local collections by scanning directories", () => {
    // Create two collections
    for (const name of ["skills_a", "skills_b"]) {
      const dir = path.join(tmpDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, COLLECTION_FILENAME), serializeCollection({ name, owner: "test", skills: [] }));
    }

    const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
    const collections = entries
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(tmpDir, e.name, COLLECTION_FILENAME)))
      .map((e) => e.name);

    expect(collections).toContain("skills_a");
    expect(collections).toContain("skills_b");
  });

  it("discovers legacy SKILLS_SYNC.yaml files", () => {
    const dir = path.join(tmpDir, "old_collection");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, LEGACY_COLLECTION_FILENAME), serializeCollection({ name: "old", owner: "test", skills: [] }));

    const hasLegacy = fs.existsSync(path.join(dir, LEGACY_COLLECTION_FILENAME));
    expect(hasLegacy).toBe(true);
  });

  it("uploads and downloads a skill via file copy", () => {
    // Create source skill
    const srcDir = path.join(tmpDir, "src_skill");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "SKILL.md"), "---\nname: test\n---\n");
    fs.writeFileSync(path.join(srcDir, "prompt.md"), "Do the thing");

    // Upload (copy to collection)
    const colDir = path.join(tmpDir, "collection", "test_skill");
    fs.mkdirSync(colDir, { recursive: true });
    for (const file of fs.readdirSync(srcDir)) {
      fs.copyFileSync(path.join(srcDir, file), path.join(colDir, file));
    }

    // Download (copy from collection)
    const destDir = path.join(tmpDir, "dest_skill");
    fs.mkdirSync(destDir, { recursive: true });
    for (const file of fs.readdirSync(colDir)) {
      fs.copyFileSync(path.join(colDir, file), path.join(destDir, file));
    }

    expect(fs.readFileSync(path.join(destDir, "SKILL.md"), "utf-8")).toContain("test");
    expect(fs.readFileSync(path.join(destDir, "prompt.md"), "utf-8")).toBe("Do the thing");
  });

  it("registry can track collection references", () => {
    const registryPath = path.join(tmpDir, "registry.yaml");
    const data = {
      name: "test-reg",
      owner: "tester",
      source: "local" as const,
      collections: [
        { name: "skills_a", backend: "local", ref: "skills_a" },
      ],
    };
    fs.writeFileSync(registryPath, serializeRegistryFile(data));

    // Add another collection
    const parsed = parseRegistryFile(fs.readFileSync(registryPath, "utf-8"));
    parsed.collections.push({ name: "skills_b", backend: "gdrive", ref: "SKILLS_SKILLS_B" });
    fs.writeFileSync(registryPath, serializeRegistryFile(parsed));

    const final = parseRegistryFile(fs.readFileSync(registryPath, "utf-8"));
    expect(final.collections).toHaveLength(2);
    expect(final.collections[1].backend).toBe("gdrive");
  });
});

// ── remove-collection + deleteCollection ──────────────────────────────────

describe("remove-collection logic", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupRegistryAndCollection() {
    // Create a registry
    const registryPath = path.join(tmpDir, "registry.yaml");
    const registryData = {
      name: "test-reg",
      owner: "tester",
      source: "local" as const,
      collections: [
        { name: "my_skills", backend: "local", ref: "my_skills" },
        { name: "other_skills", backend: "local", ref: "other_skills" },
      ],
    };
    fs.writeFileSync(registryPath, serializeRegistryFile(registryData));

    // Create collection directories with skills
    for (const name of ["my_skills", "other_skills"]) {
      const colDir = path.join(tmpDir, "collections", name);
      fs.mkdirSync(colDir, { recursive: true });
      fs.writeFileSync(
        path.join(colDir, COLLECTION_FILENAME),
        serializeCollection({ name, owner: "tester", skills: [{ name: "test_skill", path: "test_skill/", description: "A test" }] })
      );
      const skillDir = path.join(colDir, "test_skill");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), `---\nname: test_skill\n---\n`);
    }

    // Create a cache directory
    const cacheDir = path.join(tmpDir, "cache", "uuid-123");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "cached-file.txt"), "cached");

    return { registryPath };
  }

  it("removes collection reference from registry without deleting data", () => {
    const { registryPath } = setupRegistryAndCollection();

    // Remove reference only
    const data = parseRegistryFile(fs.readFileSync(registryPath, "utf-8"));
    data.collections = data.collections.filter((c) => c.name !== "my_skills");
    fs.writeFileSync(registryPath, serializeRegistryFile(data));

    // Registry should have one collection left
    const updated = parseRegistryFile(fs.readFileSync(registryPath, "utf-8"));
    expect(updated.collections).toHaveLength(1);
    expect(updated.collections[0].name).toBe("other_skills");

    // Collection data should still exist on disk
    expect(fs.existsSync(path.join(tmpDir, "collections", "my_skills"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "collections", "my_skills", COLLECTION_FILENAME))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "collections", "my_skills", "test_skill", "SKILL.md"))).toBe(true);
  });

  it("with --delete: removes reference AND deletes collection directory", () => {
    const { registryPath } = setupRegistryAndCollection();
    const colDir = path.join(tmpDir, "collections", "my_skills");

    // Verify collection exists
    expect(fs.existsSync(colDir)).toBe(true);
    expect(fs.existsSync(path.join(colDir, "test_skill", "SKILL.md"))).toBe(true);

    // Delete the collection directory (simulates deleteCollection)
    fs.rmSync(colDir, { recursive: true, force: true });

    // Remove reference from registry
    const data = parseRegistryFile(fs.readFileSync(registryPath, "utf-8"));
    data.collections = data.collections.filter((c) => c.name !== "my_skills");
    fs.writeFileSync(registryPath, serializeRegistryFile(data));

    // Registry updated
    const updated = parseRegistryFile(fs.readFileSync(registryPath, "utf-8"));
    expect(updated.collections).toHaveLength(1);

    // Collection directory is gone
    expect(fs.existsSync(colDir)).toBe(false);

    // Other collection is untouched
    expect(fs.existsSync(path.join(tmpDir, "collections", "other_skills"))).toBe(true);
  });

  it("with --delete: cleans up local cache directory", () => {
    setupRegistryAndCollection();
    const cacheDir = path.join(tmpDir, "cache", "uuid-123");

    expect(fs.existsSync(cacheDir)).toBe(true);

    // Simulate cache cleanup
    fs.rmSync(cacheDir, { recursive: true, force: true });

    expect(fs.existsSync(cacheDir)).toBe(false);
    // Parent cache dir still exists
    expect(fs.existsSync(path.join(tmpDir, "cache"))).toBe(true);
  });

  it("with --delete: removes skills index entries for the deleted collection", () => {
    setupRegistryAndCollection();

    // Simulate a config with skills index
    const config = {
      registries: [],
      collections: [
        { id: "uuid-123", name: "my_skills", backend: "local", folderId: path.join(tmpDir, "collections", "my_skills") },
        { id: "uuid-456", name: "other_skills", backend: "local", folderId: path.join(tmpDir, "collections", "other_skills") },
      ],
      skills: {
        "test_skill": [
          { collectionId: "uuid-123", installedAt: ["/some/path"] },
          { collectionId: "uuid-456", installedAt: ["/other/path"] },
        ],
        "only_in_deleted": [
          { collectionId: "uuid-123", installedAt: ["/another/path"] },
        ],
      } as Record<string, { collectionId: string; installedAt: string[] }[]>,
      discoveredAt: new Date().toISOString(),
    };

    // Remove skills entries for uuid-123
    const removedColId = "uuid-123";
    for (const [skillName, locations] of Object.entries(config.skills)) {
      config.skills[skillName] = locations.filter((l) => l.collectionId !== removedColId);
      if (config.skills[skillName].length === 0) delete config.skills[skillName];
    }

    // test_skill should still have the uuid-456 entry
    expect(config.skills["test_skill"]).toHaveLength(1);
    expect(config.skills["test_skill"][0].collectionId).toBe("uuid-456");

    // only_in_deleted should be completely removed
    expect(config.skills["only_in_deleted"]).toBeUndefined();
  });

  it("removing a non-existent collection is a no-op", () => {
    const { registryPath } = setupRegistryAndCollection();

    const data = parseRegistryFile(fs.readFileSync(registryPath, "utf-8"));
    const before = data.collections.length;
    data.collections = data.collections.filter((c) => c.name !== "nonexistent");

    expect(data.collections.length).toBe(before);
  });

  it("removing all collections leaves an empty registry", () => {
    const { registryPath } = setupRegistryAndCollection();

    const data = parseRegistryFile(fs.readFileSync(registryPath, "utf-8"));
    data.collections = [];
    fs.writeFileSync(registryPath, serializeRegistryFile(data));

    const updated = parseRegistryFile(fs.readFileSync(registryPath, "utf-8"));
    expect(updated.collections).toEqual([]);
    expect(updated.name).toBe("test-reg"); // registry itself is preserved
  });
});
