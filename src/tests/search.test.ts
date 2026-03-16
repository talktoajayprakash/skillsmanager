import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { bm25Search } from "../bm25.js";

// ── BM25 unit tests ───────────────────────────────────────────────────────────

describe("bm25Search", () => {
  const docs = [
    { id: "write_linkedin_post", text: "write_linkedin_post write_linkedin_post write_linkedin_post Writes LinkedIn posts for professional networking" },
    { id: "send_email",          text: "send_email send_email send_email Sends an email with a subject and body" },
    { id: "draft_social_post",   text: "draft_social_post draft_social_post draft_social_post Drafts a social media post for any platform" },
    { id: "schedule_tweet",      text: "schedule_tweet schedule_tweet schedule_tweet Schedules a tweet on Twitter" },
    { id: "summarize_document",  text: "summarize_document summarize_document summarize_document Summarizes a long document into bullet points" },
  ];

  it("returns exact name match as top result", () => {
    const results = bm25Search(docs, "linkedin");
    expect(results[0].id).toBe("write_linkedin_post");
  });

  it("matches multi-token query across name and description", () => {
    const results = bm25Search(docs, "linkedin post");
    const ids = results.map((r) => r.id);
    expect(ids[0]).toBe("write_linkedin_post");
    // draft_social_post also contains "post" so it may appear
    expect(ids).toContain("write_linkedin_post");
  });

  it("handles underscore-separated skill names — write_linkedin_post matches 'linkedin post'", () => {
    const results = bm25Search(docs, "linkedin post");
    expect(results[0].id).toBe("write_linkedin_post");
  });

  it("ranks by IDF — rare token outweighs common token", () => {
    // "linkedin" appears in 1 doc, "post" appears in 3 docs
    // write_linkedin_post matches both; draft_social_post only matches "post"
    const results = bm25Search(docs, "linkedin post");
    const linkedinIdx = results.findIndex((r) => r.id === "write_linkedin_post");
    const draftIdx = results.findIndex((r) => r.id === "draft_social_post");
    expect(linkedinIdx).toBeLessThan(draftIdx);
  });

  it("returns no results for a completely unrelated query", () => {
    const results = bm25Search(docs, "quantum physics");
    expect(results).toHaveLength(0);
  });

  it("returns empty array for empty query", () => {
    const results = bm25Search(docs, "");
    expect(results).toHaveLength(0);
  });

  it("returns empty array for empty corpus", () => {
    const results = bm25Search([], "linkedin");
    expect(results).toHaveLength(0);
  });

  it("is case insensitive", () => {
    const lower = bm25Search(docs, "linkedin");
    const upper = bm25Search(docs, "LINKEDIN");
    const mixed = bm25Search(docs, "LinkedIn");
    expect(lower[0].id).toBe(upper[0].id);
    expect(lower[0].id).toBe(mixed[0].id);
  });

  it("respects topK limit", () => {
    // "post" appears in write_linkedin_post, draft_social_post, schedule_tweet (as a token)
    const results = bm25Search(docs, "post", 1);
    expect(results).toHaveLength(1);
  });

  it("all returned scores are positive", () => {
    const results = bm25Search(docs, "email document");
    expect(results.every((r) => r.score > 0)).toBe(true);
  });

  it("results are sorted by descending score", () => {
    const results = bm25Search(docs, "post social");
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("single-token query matches description terms too", () => {
    // "networking" only appears in write_linkedin_post description
    const results = bm25Search(docs, "networking");
    expect(results[0].id).toBe("write_linkedin_post");
  });

  it("hyphenated terms are treated as separate tokens", () => {
    const hyphenDocs = [
      { id: "skill-a", text: "skill-a skill-a skill-a A skill for writing" },
      { id: "skill-b", text: "skill-b skill-b skill-b A skill for reading" },
    ];
    const results = bm25Search(hyphenDocs, "writing");
    expect(results[0].id).toBe("skill-a");
  });
});

// ── search command integration tests ─────────────────────────────────────────

let tmpConfigDir: string;
let tmpCacheDir: string;
let fakeCollection: { id: string; name: string; folderId: string };

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skillsmanager-search-test-"));
}

const mockSkills = [
  { name: "write_linkedin_post", path: "write_linkedin_post/", description: "Writes LinkedIn posts for professional networking" },
  { name: "send_email",          path: "send_email/",          description: "Sends an email with a subject and body" },
  { name: "draft_social_post",   path: "draft_social_post/",   description: "Drafts a social media post for any platform" },
];

vi.mock("../ready.js", () => ({
  ensureReady: async () => ({
    config: JSON.parse(fs.readFileSync(path.join(tmpConfigDir, "config.json"), "utf-8")),
    backend: {
      readCollection: vi.fn(async () => ({ name: "my_skills", owner: "test@example.com", skills: mockSkills })),
    },
  }),
}));

vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  return { ...actual, get CACHE_DIR() { return tmpCacheDir; } };
});

beforeEach(() => {
  tmpConfigDir = makeTmpDir();
  tmpCacheDir = makeTmpDir();
  fakeCollection = { id: "test-uuid", name: "my_skills", folderId: "gdrive-id" };
  fs.writeFileSync(
    path.join(tmpConfigDir, "config.json"),
    JSON.stringify({ collections: [fakeCollection], skills: {}, discoveredAt: new Date().toISOString() }, null, 2)
  );
});

afterEach(() => {
  [tmpConfigDir, tmpCacheDir].forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  vi.clearAllMocks();
});

describe("searchCommand", () => {
  it("prints results for a matching query", async () => {
    const { searchCommand } = await import("../commands/search.js");
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.join(" "));
    });

    await searchCommand("linkedin");

    const output = lines.join("\n");
    expect(output).toContain("write_linkedin_post");
    consoleSpy.mockRestore();
  });

  it("prints no-match message for unrelated query", async () => {
    const { searchCommand } = await import("../commands/search.js");
    const lines: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.join(" "));
    });

    await searchCommand("quantum physics");

    expect(lines.join("\n")).toContain("No skills matching");
    consoleSpy.mockRestore();
  });

  it("returns results ranked — linkedin match ranked above social-only match", async () => {
    const { searchCommand } = await import("../commands/search.js");
    const lines: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.join(" "));
    });

    await searchCommand("linkedin post");

    const output = lines.join("\n");
    const linkedinIdx = output.indexOf("write_linkedin_post");
    const draftIdx = output.indexOf("draft_social_post");
    // write_linkedin_post should appear before draft_social_post
    expect(linkedinIdx).toBeGreaterThan(-1);
    expect(linkedinIdx).toBeLessThan(draftIdx === -1 ? Infinity : draftIdx);
    consoleSpy.mockRestore();
  });

  it("includes the collection source in output", async () => {
    const { searchCommand } = await import("../commands/search.js");
    const lines: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.join(" "));
    });

    await searchCommand("email");

    expect(lines.join("\n")).toContain("gdrive:my_skills");
    consoleSpy.mockRestore();
  });
});
