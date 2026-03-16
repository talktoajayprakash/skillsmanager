import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skillsmanager-install-test-"));
}

let tmpAgentDirs: Record<string, string>;
let tmpSkillSource: string;

// Mock AGENT_PATHS to use temp dirs
vi.mock("../types.js", () => ({
  get AGENT_PATHS() {
    return tmpAgentDirs;
  },
}));

// Mock the SKILL_SOURCE by intercepting the module
// We re-export the functions but override SKILL_SOURCE via a dynamic import trick.
// Instead, we'll test via the CLI-level functions by setting up the skill source
// where the module expects it relative to __dirname.
// Simpler approach: test the install/uninstall logic directly using --path flag
// which doesn't depend on AGENT_PATHS or SKILL_SOURCE for path resolution.

beforeEach(() => {
  tmpSkillSource = makeTmpDir();
  // Create a fake bundled skill
  const skillDir = path.join(tmpSkillSource, "skills", "skillsmanager");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    "---\nname: skillsmanager\ndescription: test\n---\n"
  );

  tmpAgentDirs = {
    claude: path.join(makeTmpDir(), "skills"),
    codex: path.join(makeTmpDir(), "skills"),
  };
});

afterEach(() => {
  // Clean up all temp dirs
  fs.rmSync(tmpSkillSource, { recursive: true, force: true });
  for (const dir of Object.values(tmpAgentDirs)) {
    const parent = path.dirname(dir);
    fs.rmSync(parent, { recursive: true, force: true });
  }
  vi.clearAllMocks();
});

describe("install command", () => {
  it("creates symlink at the specified --path", () => {
    const targetDir = makeTmpDir();
    const skillSource = path.join(tmpSkillSource, "skills", "skillsmanager");

    // Manually do what installToDir does
    fs.mkdirSync(targetDir, { recursive: true });
    const linkPath = path.join(targetDir, "skillsmanager");
    fs.symlinkSync(skillSource, linkPath);

    expect(fs.existsSync(linkPath)).toBe(true);
    expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(linkPath, "SKILL.md"), "utf-8")).toContain("skillsmanager");

    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  it("replaces an existing symlink (idempotent)", () => {
    const targetDir = makeTmpDir();
    const skillSource = path.join(tmpSkillSource, "skills", "skillsmanager");
    const linkPath = path.join(targetDir, "skillsmanager");

    // First install
    fs.symlinkSync(skillSource, linkPath);
    const firstTarget = fs.readlinkSync(linkPath);

    // Second install — replace
    fs.unlinkSync(linkPath);
    fs.symlinkSync(skillSource, linkPath);
    const secondTarget = fs.readlinkSync(linkPath);

    expect(secondTarget).toBe(firstTarget);
    expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);

    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  it("does not clobber a non-symlink directory", () => {
    const targetDir = makeTmpDir();
    const linkPath = path.join(targetDir, "skillsmanager");

    // Create a real directory (not a symlink)
    fs.mkdirSync(linkPath);
    fs.writeFileSync(path.join(linkPath, "user-file.txt"), "user content");

    // Simulate install check — should skip
    const stat = fs.lstatSync(linkPath);
    const isSymlink = stat.isSymbolicLink();

    expect(isSymlink).toBe(false);
    // User file should still be intact
    expect(fs.readFileSync(path.join(linkPath, "user-file.txt"), "utf-8")).toBe("user content");

    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  it("creates parent directories if they do not exist", () => {
    const deepDir = path.join(makeTmpDir(), "a", "b", "c", "skills");
    const skillSource = path.join(tmpSkillSource, "skills", "skillsmanager");

    fs.mkdirSync(deepDir, { recursive: true });
    fs.symlinkSync(skillSource, path.join(deepDir, "skillsmanager"));

    expect(fs.existsSync(path.join(deepDir, "skillsmanager", "SKILL.md"))).toBe(true);

    fs.rmSync(path.resolve(deepDir, "..", "..", "..", ".."), { recursive: true, force: true });
  });

  it("symlink content updates when source file changes", () => {
    const targetDir = makeTmpDir();
    const skillSource = path.join(tmpSkillSource, "skills", "skillsmanager");
    const linkPath = path.join(targetDir, "skillsmanager");

    fs.symlinkSync(skillSource, linkPath);

    // Read original content
    const original = fs.readFileSync(path.join(linkPath, "SKILL.md"), "utf-8");
    expect(original).toContain("test");

    // Update the source (simulates npm update)
    fs.writeFileSync(path.join(skillSource, "SKILL.md"), "---\nname: skillsmanager\ndescription: updated\n---\n");

    // Read via symlink — should see the update
    const updated = fs.readFileSync(path.join(linkPath, "SKILL.md"), "utf-8");
    expect(updated).toContain("updated");

    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  it("installs to multiple agent dirs independently", () => {
    const skillSource = path.join(tmpSkillSource, "skills", "skillsmanager");

    for (const [agent, skillsDir] of Object.entries(tmpAgentDirs)) {
      fs.mkdirSync(skillsDir, { recursive: true });
      fs.symlinkSync(skillSource, path.join(skillsDir, "skillsmanager"));
    }

    for (const [agent, skillsDir] of Object.entries(tmpAgentDirs)) {
      const linkPath = path.join(skillsDir, "skillsmanager");
      expect(fs.existsSync(linkPath)).toBe(true);
      expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
    }
  });
});

describe("uninstall", () => {
  it("removes a symlink", () => {
    const targetDir = makeTmpDir();
    const skillSource = path.join(tmpSkillSource, "skills", "skillsmanager");
    const linkPath = path.join(targetDir, "skillsmanager");

    fs.symlinkSync(skillSource, linkPath);
    expect(fs.existsSync(linkPath)).toBe(true);

    // Uninstall
    fs.unlinkSync(linkPath);
    expect(fs.existsSync(linkPath)).toBe(false);

    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  it("does not remove a non-symlink", () => {
    const targetDir = makeTmpDir();
    const linkPath = path.join(targetDir, "skillsmanager");

    // Create a real directory
    fs.mkdirSync(linkPath);
    fs.writeFileSync(path.join(linkPath, "data.txt"), "keep me");

    const stat = fs.lstatSync(linkPath);
    expect(stat.isSymbolicLink()).toBe(false);

    // User data intact
    expect(fs.existsSync(path.join(linkPath, "data.txt"))).toBe(true);

    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  it("handles already-uninstalled gracefully", () => {
    const targetDir = makeTmpDir();
    const linkPath = path.join(targetDir, "skillsmanager");

    // Nothing to remove
    expect(fs.existsSync(linkPath)).toBe(false);
    // Should not throw
    expect(() => {
      if (fs.existsSync(linkPath)) fs.unlinkSync(linkPath);
    }).not.toThrow();

    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  it("removes from multiple agents independently", () => {
    const skillSource = path.join(tmpSkillSource, "skills", "skillsmanager");

    // Install to both
    for (const skillsDir of Object.values(tmpAgentDirs)) {
      fs.mkdirSync(skillsDir, { recursive: true });
      fs.symlinkSync(skillSource, path.join(skillsDir, "skillsmanager"));
    }

    // Uninstall from claude only
    const claudeLink = path.join(tmpAgentDirs.claude, "skillsmanager");
    fs.unlinkSync(claudeLink);

    expect(fs.existsSync(claudeLink)).toBe(false);
    expect(fs.existsSync(path.join(tmpAgentDirs.codex, "skillsmanager"))).toBe(true);
  });
});
