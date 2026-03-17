import { describe, it, expect, vi, beforeEach } from "vitest";
import { RoutingBackend } from "../backends/routing.js";
import { parseCollection, serializeCollection } from "../registry.js";
import type { StorageBackend } from "../backends/interface.js";
import type {
  CollectionFile, CollectionInfo,
  RegistryCollectionRef, RegistryFile, RegistryInfo,
} from "../types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCollection(overrides: Partial<CollectionInfo> = {}): CollectionInfo {
  return {
    id: "test-uuid",
    name: "test-col",
    backend: "gdrive",
    folderId: "drive-folder-id",
    ...overrides,
  };
}

function makeCollectionFile(overrides: Partial<CollectionFile> = {}): CollectionFile {
  return {
    name: "test-col",
    owner: "test@example.com",
    skills: [{ name: "my-skill", path: "skills/my-skill/", description: "A skill" }],
    ...overrides,
  };
}

/** Build a mock StorageBackend. readCollection returns the given CollectionFile. */
function mockInner(col: CollectionFile): StorageBackend {
  return {
    getOwner: vi.fn().mockResolvedValue("owner"),
    discoverCollections: vi.fn().mockResolvedValue([]),
    readCollection: vi.fn().mockResolvedValue(col),
    writeCollection: vi.fn().mockResolvedValue(undefined),
    downloadSkill: vi.fn().mockResolvedValue(undefined),
    uploadSkill: vi.fn().mockResolvedValue(undefined),
    deleteCollection: vi.fn().mockResolvedValue(undefined),
    deleteSkill: vi.fn().mockResolvedValue(undefined),
    discoverRegistries: vi.fn().mockResolvedValue([]),
    readRegistry: vi.fn().mockResolvedValue({} as RegistryFile),
    writeRegistry: vi.fn().mockResolvedValue(undefined),
    resolveCollectionRef: vi.fn().mockResolvedValue(null),
    createRegistry: vi.fn().mockResolvedValue({} as RegistryInfo),
    createCollection: vi.fn().mockResolvedValue({} as CollectionInfo),
  };
}

// ── CollectionFile type + metadata round-trip ─────────────────────────────────

describe("CollectionFile type + metadata round-trip", () => {
  it("parses type field from YAML", () => {
    const yaml = `name: curated\nowner: test\ntype: github\nskills: []\nmetadata:\n  repo: owner/skills-repo\n`;
    const col = parseCollection(yaml);
    expect(col.type).toBe("github");
    expect(col.metadata?.repo).toBe("owner/skills-repo");
  });

  it("serializes type before skills", () => {
    const col = makeCollectionFile({ type: "github", metadata: { repo: "owner/repo" } });
    const yaml = serializeCollection(col);
    const typeIdx = yaml.indexOf("type:");
    const skillsIdx = yaml.indexOf("skills:");
    expect(typeIdx).toBeGreaterThanOrEqual(0);
    expect(typeIdx).toBeLessThan(skillsIdx);
  });

  it("omits type from serialization when absent", () => {
    const col = makeCollectionFile();
    const yaml = serializeCollection(col);
    expect(yaml).not.toContain("type:");
  });

  it("omits metadata from serialization when absent", () => {
    const col = makeCollectionFile();
    const yaml = serializeCollection(col);
    expect(yaml).not.toContain("metadata:");
  });

  it("round-trips type and metadata", () => {
    const original = makeCollectionFile({ type: "github", metadata: { repo: "a/b" } });
    const roundTripped = parseCollection(serializeCollection(original));
    expect(roundTripped.type).toBe("github");
    expect(roundTripped.metadata?.repo).toBe("a/b");
    expect(roundTripped.skills).toEqual(original.skills);
  });

  it("collection without type or metadata round-trips cleanly", () => {
    const original = makeCollectionFile();
    const roundTripped = parseCollection(serializeCollection(original));
    expect(roundTripped.type).toBeUndefined();
    expect(roundTripped.metadata).toBeUndefined();
    expect(roundTripped.name).toBe(original.name);
  });
});

// ── RoutingBackend: pass-through methods ──────────────────────────────────────

describe("RoutingBackend pass-through", () => {
  it("readCollection delegates to inner", async () => {
    const col = makeCollectionFile();
    const inner = mockInner(col);
    const routing = new RoutingBackend(inner);
    const collection = makeCollection();
    const result = await routing.readCollection(collection);
    expect(inner.readCollection).toHaveBeenCalledWith(collection);
    expect(result).toEqual(col);
  });

  it("writeCollection delegates to inner", async () => {
    const col = makeCollectionFile();
    const inner = mockInner(col);
    const routing = new RoutingBackend(inner);
    const collection = makeCollection();
    await routing.writeCollection(collection, col);
    expect(inner.writeCollection).toHaveBeenCalledWith(collection, col);
  });

  it("getOwner delegates to inner", async () => {
    const inner = mockInner(makeCollectionFile());
    const result = await new RoutingBackend(inner).getOwner();
    expect(inner.getOwner).toHaveBeenCalled();
    expect(result).toBe("owner");
  });
});

// ── RoutingBackend: downloadSkill routing ─────────────────────────────────────

describe("RoutingBackend downloadSkill", () => {
  it("falls through to inner when no type (pure GDrive collection)", async () => {
    const col = makeCollectionFile(); // no type
    const inner = mockInner(col);
    const routing = new RoutingBackend(inner);
    const collection = makeCollection({ backend: "gdrive" });
    await routing.downloadSkill(collection, "my-skill", "/dest");
    expect(inner.downloadSkill).toHaveBeenCalledWith(collection, "my-skill", "/dest");
  });

  it("falls through to inner when backend is github (GithubBackend handles routing internally)", async () => {
    // GitHub-native collection: col.type absent, backend=github → falls through so
    // GithubBackend.downloadSkill can apply its own skillsRepo() logic.
    const col = makeCollectionFile(); // no type, no metadata
    const inner = mockInner(col);
    const routing = new RoutingBackend(inner);
    const collection = makeCollection({ backend: "github", folderId: "owner/repo:.skillsmanager/col" });
    await routing.downloadSkill(collection, "my-skill", "/dest");
    expect(inner.downloadSkill).toHaveBeenCalledWith(collection, "my-skill", "/dest");
  });

  it("routes to GithubBackend when col.type=github on a gdrive collection", async () => {
    const col = makeCollectionFile({
      type: "github",
      metadata: { repo: "foreign/skills-repo" },
    });
    const inner = mockInner(col);
    const routing = new RoutingBackend(inner);
    const collection = makeCollection({ backend: "gdrive" });

    // Mock GithubBackend.downloadSkillFromRepo
    const { GithubBackend } = await import("../backends/github.js");
    const downloadSkillFromRepo = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(GithubBackend.prototype, "downloadSkillFromRepo").mockImplementation(downloadSkillFromRepo);

    await routing.downloadSkill(collection, "my-skill", "/dest");

    expect(inner.downloadSkill).not.toHaveBeenCalled();
    expect(downloadSkillFromRepo).toHaveBeenCalledWith("foreign/skills-repo", "skills/my-skill/", "/dest");
  });

  it("throws when skill not found in collection", async () => {
    const col = makeCollectionFile({ type: "github", metadata: { repo: "foreign/repo" } });
    const inner = mockInner(col);
    const routing = new RoutingBackend(inner);
    const collection = makeCollection({ backend: "gdrive" });
    await expect(routing.downloadSkill(collection, "nonexistent", "/dest"))
      .rejects.toThrow('Skill "nonexistent" not found in collection "test-col"');
  });

  it("throws when type=github but metadata.repo is missing", async () => {
    const col = makeCollectionFile({ type: "github" }); // no metadata
    const inner = mockInner(col);
    const routing = new RoutingBackend(inner);
    const collection = makeCollection({ backend: "gdrive" });
    await expect(routing.downloadSkill(collection, "my-skill", "/dest"))
      .rejects.toThrow('missing metadata.repo');
  });
});

// ── RoutingBackend: uploadSkill routing ───────────────────────────────────────

describe("RoutingBackend uploadSkill", () => {
  it("falls through to inner when no type", async () => {
    const col = makeCollectionFile();
    const inner = mockInner(col);
    const routing = new RoutingBackend(inner);
    const collection = makeCollection({ backend: "gdrive" });
    await routing.uploadSkill(collection, "/local/path", "my-skill");
    expect(inner.uploadSkill).toHaveBeenCalledWith(collection, "/local/path", "my-skill");
  });

  it("throws when col.type is a foreign backend (case 1: type differs from backend)", async () => {
    const col = makeCollectionFile({ type: "github", metadata: { repo: "foreign/repo" } });
    const inner = mockInner(col);
    const routing = new RoutingBackend(inner);
    const collection = makeCollection({ backend: "gdrive" });
    await expect(routing.uploadSkill(collection, "/local/path", "my-skill"))
      .rejects.toThrow('skills source type is "github"');
    expect(inner.uploadSkill).not.toHaveBeenCalled();
  });

  it("throws for GitHub collection whose metadata.repo is a different repo (case 2)", async () => {
    // GitHub-hosted collection YAML but skills in a foreign repo (no type field)
    const col = makeCollectionFile({ metadata: { repo: "other-owner/their-repo" } });
    const inner = mockInner(col);
    const routing = new RoutingBackend(inner);
    const collection = makeCollection({
      backend: "github",
      folderId: "my-owner/my-repo:.skillsmanager/col",
    });
    await expect(routing.uploadSkill(collection, "/local/path", "my-skill"))
      .rejects.toThrow('skills source is "other-owner/their-repo"');
    expect(inner.uploadSkill).not.toHaveBeenCalled();
  });

  it("does NOT throw for GitHub collection whose metadata.repo matches host repo", async () => {
    const col = makeCollectionFile({ metadata: { repo: "my-owner/my-repo" } });
    const inner = mockInner(col);
    const routing = new RoutingBackend(inner);
    const collection = makeCollection({
      backend: "github",
      folderId: "my-owner/my-repo:.skillsmanager/col",
    });
    await routing.uploadSkill(collection, "/local/path", "my-skill");
    expect(inner.uploadSkill).toHaveBeenCalled();
  });

  it("error message includes --remote-path hint", async () => {
    const col = makeCollectionFile({ type: "github", metadata: { repo: "foreign/repo" } });
    const inner = mockInner(col);
    const routing = new RoutingBackend(inner);
    const collection = makeCollection({ backend: "gdrive" });
    await expect(routing.uploadSkill(collection, "/local/path", "my-skill"))
      .rejects.toThrow("--remote-path");
  });
});

// ── RoutingBackend: deleteSkill routing ───────────────────────────────────────

describe("RoutingBackend deleteSkill", () => {
  it("falls through to inner when no type", async () => {
    const col = makeCollectionFile();
    const inner = mockInner(col);
    const routing = new RoutingBackend(inner);
    const collection = makeCollection({ backend: "gdrive" });
    await routing.deleteSkill(collection, "my-skill");
    expect(inner.deleteSkill).toHaveBeenCalledWith(collection, "my-skill");
  });

  it("routes to GithubBackend when col.type=github on a gdrive collection", async () => {
    const col = makeCollectionFile({
      type: "github",
      metadata: { repo: "foreign/skills-repo" },
    });
    const inner = mockInner(col);
    const routing = new RoutingBackend(inner);
    const collection = makeCollection({ backend: "gdrive" });

    const { GithubBackend } = await import("../backends/github.js");
    const deleteSkillFromRepo = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(GithubBackend.prototype, "deleteSkillFromRepo").mockImplementation(deleteSkillFromRepo);

    await routing.deleteSkill(collection, "my-skill");

    expect(inner.deleteSkill).not.toHaveBeenCalled();
    expect(deleteSkillFromRepo).toHaveBeenCalledWith("foreign/skills-repo", "skills/my-skill/");
  });

  it("is a no-op when skill not found in collection", async () => {
    const col = makeCollectionFile({ type: "github", metadata: { repo: "foreign/repo" } });
    const inner = mockInner(col);
    const routing = new RoutingBackend(inner);
    const collection = makeCollection({ backend: "gdrive" });

    const { GithubBackend } = await import("../backends/github.js");
    const deleteSkillFromRepo = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(GithubBackend.prototype, "deleteSkillFromRepo").mockImplementation(deleteSkillFromRepo);

    // "nonexistent" is not in col.skills → should not call deleteSkillFromRepo
    await routing.deleteSkill(collection, "nonexistent");
    expect(deleteSkillFromRepo).not.toHaveBeenCalled();
    expect(inner.deleteSkill).not.toHaveBeenCalled();
  });
});

// ── RoutingBackend: GitHub-native collections with metadata.repo ──────────────

describe("RoutingBackend with GitHub-native collection + metadata.repo (no type field)", () => {
  it("downloadSkill falls through to inner (GithubBackend handles skillsRepo internally)", async () => {
    // GitHub collections with metadata.repo but no type field: RoutingBackend falls through,
    // GithubBackend.downloadSkill uses skillsRepo() helper to resolve the source repo.
    const col = makeCollectionFile({ metadata: { repo: "foreign/repo" } }); // no type
    const inner = mockInner(col);
    const routing = new RoutingBackend(inner);
    const collection = makeCollection({ backend: "github", folderId: "my/repo:.skillsmanager/col" });
    await routing.downloadSkill(collection, "my-skill", "/dest");
    // skillType = col.type ?? "github" = "github" = collection.backend → falls through
    expect(inner.downloadSkill).toHaveBeenCalledWith(collection, "my-skill", "/dest");
  });
});
