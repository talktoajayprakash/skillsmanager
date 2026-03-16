import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skillsmanager-test-"));
}

function makeSkillDir(root: string, name: string, description = "A test skill"): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
  );
  fs.writeFileSync(path.join(dir, "prompt.md"), `You are an agent that does: ${name}`);
  return dir;
}

// ── mock backend ──────────────────────────────────────────────────────────────

/**
 * A fake StorageBackend that stores skills as real files in a temp directory.
 * downloadSkill copies from fakeStore/<skill>/ → destDir
 * uploadSkill copies from localPath/ → fakeStore/<skill>/
 */
function makeMockBackend(storeDir: string) {
  const collections: { name: string; folderId: string }[] = [];

  return {
    _storeDir: storeDir,
    discoverCollections: vi.fn(async () => collections),
    readCollection: vi.fn(async (_col: { name: string }) => ({
      name: _col.name,
      owner: "test@example.com",
      skills: fs.existsSync(path.join(storeDir, "index.json"))
        ? JSON.parse(fs.readFileSync(path.join(storeDir, "index.json"), "utf-8"))
        : [],
    })),
    writeCollection: vi.fn(async (_col: { name: string }, data: { skills: unknown[] }) => {
      fs.writeFileSync(path.join(storeDir, "index.json"), JSON.stringify(data.skills, null, 2));
    }),
    downloadSkill: vi.fn(async (_col: unknown, skillName: string, destDir: string) => {
      const src = path.join(storeDir, skillName);
      if (!fs.existsSync(src)) throw new Error(`Skill "${skillName}" not in fake store`);
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of fs.readdirSync(src)) {
        fs.copyFileSync(path.join(src, file), path.join(destDir, file));
      }
    }),
    uploadSkill: vi.fn(async (_col: unknown, localPath: string, skillName: string) => {
      const dest = path.join(storeDir, skillName);
      fs.mkdirSync(dest, { recursive: true });
      for (const file of fs.readdirSync(localPath)) {
        fs.copyFileSync(path.join(localPath, file), path.join(dest, file));
      }
    }),
  };
}

// ── module mocking ───────────────────────────────────────────────────────────

// We intercept the config module so tests use isolated temp dirs instead of
// ~/.skillsmanager, and intercept ready.ts to inject the mock backend.

let tmpConfigDir: string;
let tmpCacheDir: string;
let tmpAgentDir: string;
let tmpSkillsDir: string;
let mockBackend: ReturnType<typeof makeMockBackend>;
let fakeCollection: { id: string; name: string; folderId: string };

// We use vi.mock at module scope with a factory that reads from closure vars
// that are set up per-test in beforeEach.

vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  return {
    ...actual,
    get CONFIG_DIR() { return tmpConfigDir; },
    get CONFIG_PATH() { return path.join(tmpConfigDir, "config.json"); },
    get CACHE_DIR() { return tmpCacheDir; },
    readConfig: () => {
      const p = path.join(tmpConfigDir, "config.json");
      if (!fs.existsSync(p)) throw new Error("No config found.");
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    },
    writeConfig: (cfg: unknown) => {
      fs.mkdirSync(tmpConfigDir, { recursive: true });
      fs.writeFileSync(path.join(tmpConfigDir, "config.json"), JSON.stringify(cfg, null, 2));
    },
    trackSkill: (skillName: string, collectionId: string, installedPath?: string) => {
      const p = path.join(tmpConfigDir, "config.json");
      const cfg = fs.existsSync(p)
        ? JSON.parse(fs.readFileSync(p, "utf-8"))
        : { collections: [fakeCollection], skills: {}, discoveredAt: new Date().toISOString() };
      if (!cfg.skills) cfg.skills = {};
      const entries: { collectionId: string; installedAt: string[] }[] = cfg.skills[skillName] ?? [];
      const existing = entries.find((e: { collectionId: string }) => e.collectionId === collectionId);
      if (existing) {
        if (installedPath && !existing.installedAt.includes(installedPath)) {
          existing.installedAt.push(installedPath);
        }
      } else {
        entries.push({ collectionId, installedAt: installedPath ? [installedPath] : [] });
      }
      cfg.skills[skillName] = entries;
      fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
    },
    ensureConfigDir: () => fs.mkdirSync(tmpConfigDir, { recursive: true }),
    ensureCacheDir: () => fs.mkdirSync(tmpCacheDir, { recursive: true }),
  };
});

vi.mock("../ready.js", () => ({
  ensureReady: async () => ({
    config: JSON.parse(fs.readFileSync(path.join(tmpConfigDir, "config.json"), "utf-8")),
    backend: mockBackend,
  }),
}));

vi.mock("../types.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../types.js")>();
  return {
    ...actual,
    get AGENT_PATHS() {
      return { claude: tmpAgentDir };
    },
  };
});

// ── test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  tmpConfigDir = makeTmpDir();
  tmpCacheDir = makeTmpDir();
  tmpAgentDir = makeTmpDir();
  tmpSkillsDir = makeTmpDir();

  fakeCollection = { id: "test-uuid-1234", name: "my_skills", folderId: "gdrive-folder-id" };

  mockBackend = makeMockBackend(makeTmpDir());

  // Write initial config
  fs.writeFileSync(
    path.join(tmpConfigDir, "config.json"),
    JSON.stringify({
      collections: [fakeCollection],
      skills: {},
      discoveredAt: new Date().toISOString(),
    }, null, 2)
  );
});

afterEach(() => {
  [tmpConfigDir, tmpCacheDir, tmpAgentDir, tmpSkillsDir].forEach((d) => {
    fs.rmSync(d, { recursive: true, force: true });
  });
  vi.clearAllMocks();
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("add command", () => {
  it("uploads skill files to the backend", async () => {
    const skillDir = makeSkillDir(tmpSkillsDir, "write_linkedin_post");
    const { addCommand } = await import("../commands/add.js");

    await addCommand(skillDir, {});

    expect(mockBackend.uploadSkill).toHaveBeenCalledOnce();
    const [, calledPath, calledName] = mockBackend.uploadSkill.mock.calls[0];
    expect(calledPath).toBe(skillDir);
    expect(calledName).toBe("write_linkedin_post");
  });

  it("records the skill in the config skills index", async () => {
    const skillDir = makeSkillDir(tmpSkillsDir, "write_linkedin_post");
    const { addCommand } = await import("../commands/add.js");

    await addCommand(skillDir, {});

    const cfg = JSON.parse(fs.readFileSync(path.join(tmpConfigDir, "config.json"), "utf-8"));
    expect(cfg.skills["write_linkedin_post"]).toBeDefined();
    const entry = cfg.skills["write_linkedin_post"][0];
    expect(entry.collectionId).toBe(fakeCollection.id);
    expect(entry.installedAt).toContain(skillDir);
  });

  it("fails if directory has no SKILL.md", async () => {
    const emptyDir = makeTmpDir();
    const { addCommand } = await import("../commands/add.js");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await addCommand(emptyDir, {});

    expect(mockBackend.uploadSkill).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No SKILL.md"));
    consoleSpy.mockRestore();
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it("fails if SKILL.md is missing the name field", async () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "SKILL.md"), `---\ndescription: no name here\n---\n`);
    const { addCommand } = await import("../commands/add.js");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await addCommand(dir, {});

    expect(mockBackend.uploadSkill).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("missing 'name'"));
    consoleSpy.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("fetch command", () => {
  beforeEach(() => {
    // Pre-populate the fake store so downloadSkill has something to copy
    const storeSkillDir = path.join(mockBackend._storeDir, "write_linkedin_post");
    fs.mkdirSync(storeSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(storeSkillDir, "SKILL.md"),
      `---\nname: write_linkedin_post\ndescription: Writes LinkedIn posts\n---\n`
    );
    // Seed the collection index
    fs.writeFileSync(
      path.join(mockBackend._storeDir, "index.json"),
      JSON.stringify([{ name: "write_linkedin_post", path: "write_linkedin_post/", description: "Writes LinkedIn posts" }])
    );
  });

  it("downloads skill files to the cache", async () => {
    const { fetchCommand } = await import("../commands/fetch.js");
    await fetchCommand(["write_linkedin_post"], { agent: "claude", scope: "global" });

    const expectedCache = path.join(tmpCacheDir, fakeCollection.id, "write_linkedin_post");
    expect(fs.existsSync(expectedCache)).toBe(true);
    expect(fs.existsSync(path.join(expectedCache, "SKILL.md"))).toBe(true);
  });

  it("creates a symlink in the agent skills directory", async () => {
    const { fetchCommand } = await import("../commands/fetch.js");
    await fetchCommand(["write_linkedin_post"], { agent: "claude", scope: "global" });

    const linkPath = path.join(tmpAgentDir, "write_linkedin_post");
    expect(fs.existsSync(linkPath)).toBe(true);
    expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);

    const target = fs.realpathSync(linkPath);
    const expectedTarget = fs.realpathSync(path.join(tmpCacheDir, fakeCollection.id, "write_linkedin_post"));
    expect(target).toBe(expectedTarget);
  });

  it("records the installed path in the skills index", async () => {
    const { fetchCommand } = await import("../commands/fetch.js");
    await fetchCommand(["write_linkedin_post"], { agent: "claude", scope: "global" });

    const cfg = JSON.parse(fs.readFileSync(path.join(tmpConfigDir, "config.json"), "utf-8"));
    const entry = cfg.skills["write_linkedin_post"]?.[0];
    expect(entry).toBeDefined();
    expect(entry.installedAt).toContain(path.join(tmpAgentDir, "write_linkedin_post"));
  });

  it("fails gracefully for an unknown skill name", async () => {
    const { fetchCommand } = await import("../commands/fetch.js");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await fetchCommand(["nonexistent_skill"], { agent: "claude", scope: "global" });

    expect(mockBackend.downloadSkill).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("not found"));
    consoleSpy.mockRestore();
  });
});

describe("update command", () => {
  let localSkillDir: string;

  beforeEach(async () => {
    // Simulate a prior fetch: populate cache and record in skills index
    const cacheSkillDir = path.join(tmpCacheDir, fakeCollection.id, "write_linkedin_post");
    fs.mkdirSync(cacheSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheSkillDir, "SKILL.md"),
      `---\nname: write_linkedin_post\ndescription: Writes LinkedIn posts\n---\n`
    );

    // Local skill dir (what the agent edits)
    localSkillDir = makeSkillDir(tmpSkillsDir, "write_linkedin_post");

    // Record in skills index as if fetch was run
    const cfg = JSON.parse(fs.readFileSync(path.join(tmpConfigDir, "config.json"), "utf-8"));
    cfg.skills["write_linkedin_post"] = [
      { collectionId: fakeCollection.id, installedAt: [localSkillDir] },
    ];
    fs.writeFileSync(path.join(tmpConfigDir, "config.json"), JSON.stringify(cfg, null, 2));

    // Seed store index for readCollection
    fs.writeFileSync(
      path.join(mockBackend._storeDir, "index.json"),
      JSON.stringify([{ name: "write_linkedin_post", path: "write_linkedin_post/", description: "Writes LinkedIn posts" }])
    );
  });

  it("uploads the skill to the backend", async () => {
    const { updateCommand } = await import("../commands/update.js");
    await updateCommand(localSkillDir, {});

    expect(mockBackend.uploadSkill).toHaveBeenCalledOnce();
    const [, calledPath, calledName] = mockBackend.uploadSkill.mock.calls[0];
    expect(calledPath).toBe(localSkillDir);
    expect(calledName).toBe("write_linkedin_post");
  });

  it("re-downloads to cache after upload so symlinks reflect the change", async () => {
    // Edit the local skill
    fs.writeFileSync(path.join(localSkillDir, "SKILL.md"),
      `---\nname: write_linkedin_post\ndescription: Updated description\n---\n\n# Updated\n`
    );
    // Also update the fake store so downloadSkill returns the new content
    const storeDir = path.join(mockBackend._storeDir, "write_linkedin_post");
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(path.join(storeDir, "SKILL.md"),
      `---\nname: write_linkedin_post\ndescription: Updated description\n---\n\n# Updated\n`
    );

    const { updateCommand } = await import("../commands/update.js");
    await updateCommand(localSkillDir, {});

    expect(mockBackend.downloadSkill).toHaveBeenCalledOnce();

    // Cache should now have the updated content
    const cachedMd = fs.readFileSync(
      path.join(tmpCacheDir, fakeCollection.id, "write_linkedin_post", "SKILL.md"),
      "utf-8"
    );
    expect(cachedMd).toContain("Updated description");
  });

  it("resolves collection from installedAt path match", async () => {
    // Add a second collection to the config to make resolution non-trivial
    const cfg = JSON.parse(fs.readFileSync(path.join(tmpConfigDir, "config.json"), "utf-8"));
    cfg.collections.push({ id: "other-uuid", name: "other_collection", folderId: "other-folder" });
    cfg.skills["write_linkedin_post"].push({ collectionId: "other-uuid", installedAt: ["/some/other/path"] });
    fs.writeFileSync(path.join(tmpConfigDir, "config.json"), JSON.stringify(cfg, null, 2));

    const { updateCommand } = await import("../commands/update.js");
    await updateCommand(localSkillDir, {});

    // Should upload to the collection whose installedAt matched localSkillDir
    const [calledCol] = mockBackend.uploadSkill.mock.calls[0] as [{ id: string }, ...unknown[]];
    expect(calledCol.id).toBe(fakeCollection.id);
  });

  it("fails with a clear message when the skill is not in the index", async () => {
    // Remove skill from index
    const cfg = JSON.parse(fs.readFileSync(path.join(tmpConfigDir, "config.json"), "utf-8"));
    cfg.skills = {};
    fs.writeFileSync(path.join(tmpConfigDir, "config.json"), JSON.stringify(cfg, null, 2));

    const untrackedDir = makeSkillDir(tmpSkillsDir, "write_linkedin_post_copy");
    const { updateCommand } = await import("../commands/update.js");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await updateCommand(untrackedDir, {});

    expect(mockBackend.uploadSkill).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("not tracked"));
    consoleSpy.mockRestore();
    fs.rmSync(untrackedDir, { recursive: true, force: true });
  });
});

describe("symlink behavior", () => {
  it("symlink reads from cache — editing cache content is visible via symlink", () => {
    const cacheSkillDir = path.join(tmpCacheDir, fakeCollection.id, "my_skill");
    fs.mkdirSync(cacheSkillDir, { recursive: true });
    fs.writeFileSync(path.join(cacheSkillDir, "prompt.md"), "original content");

    const linkPath = path.join(tmpAgentDir, "my_skill");
    fs.symlinkSync(cacheSkillDir, linkPath);

    // Update cache content (simulates what update re-download does)
    fs.writeFileSync(path.join(cacheSkillDir, "prompt.md"), "updated content");

    const readViaLink = fs.readFileSync(path.join(linkPath, "prompt.md"), "utf-8");
    expect(readViaLink).toBe("updated content");
  });

  it("two symlinks pointing to the same cache both reflect an update", () => {
    const cacheSkillDir = path.join(tmpCacheDir, fakeCollection.id, "my_skill");
    fs.mkdirSync(cacheSkillDir, { recursive: true });
    fs.writeFileSync(path.join(cacheSkillDir, "prompt.md"), "v1");

    const link1 = path.join(tmpAgentDir, "my_skill");
    const link2Dir = makeTmpDir();
    const link2 = path.join(link2Dir, "my_skill");
    fs.symlinkSync(cacheSkillDir, link1);
    fs.symlinkSync(cacheSkillDir, link2);

    // Simulate cache refresh after update
    fs.writeFileSync(path.join(cacheSkillDir, "prompt.md"), "v2");

    expect(fs.readFileSync(path.join(link1, "prompt.md"), "utf-8")).toBe("v2");
    expect(fs.readFileSync(path.join(link2, "prompt.md"), "utf-8")).toBe("v2");

    fs.rmSync(link2Dir, { recursive: true, force: true });
  });
});
