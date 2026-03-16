#!/usr/bin/env node
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { program } from "commander";
import { AGENT_PATHS } from "./types.js";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { searchCommand } from "./commands/search.js";
import { fetchCommand } from "./commands/fetch.js";
import { addCommand } from "./commands/add.js";
import { updateCommand } from "./commands/update.js";
import { refreshCommand } from "./commands/refresh.js";
import { setupGoogleCommand } from "./commands/setup/google.js";
import { setupGithubCommand } from "./commands/setup/github.js";
import { collectionCreateCommand } from "./commands/collection.js";
import { installCommand, uninstallCommand } from "./commands/install.js";
import {
  registryCreateCommand, registryListCommand, registryDiscoverCommand,
  registryAddCollectionCommand, registryRemoveCollectionCommand, registryPushCommand,
} from "./commands/registry.js";

const supportedAgents = Object.keys(AGENT_PATHS).join(", ");

// Read the bundled SKILL.md as the CLI help — single source of truth
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillMdPath = path.resolve(__dirname, "..", "skills", "skillsmanager", "SKILL.md");
let helpText = "Discover, fetch, and manage agent skills from local or remote storage.";
try {
  const raw = fs.readFileSync(skillMdPath, "utf-8");
  // Strip YAML frontmatter
  helpText = raw.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
} catch { /* use fallback */ }

program
  .name("skillsmanager")
  .description(helpText)
  .version("0.0.1");

// ── Setup ────────────────────────────────────────────────────────────────────

const setup = program
  .command("setup")
  .description("Set up storage backends");

setup
  .command("google")
  .description("One-time Google Drive setup (human-facing, not for agents)")
  .action(setupGoogleCommand);

setup
  .command("github")
  .description("One-time GitHub setup — checks gh CLI and runs gh auth login")
  .action(setupGithubCommand);

// ── Core commands ────────────────────────────────────────────────────────────

program
  .command("init")
  .description("Authenticate and discover collections (runs automatically when needed)")
  .action(initCommand);

program
  .command("list")
  .description("List all available skills across all collections")
  .action(listCommand);

program
  .command("search <query>")
  .description("Search skills by name or description (BM25 ranked)")
  .action(searchCommand);

program
  .command("fetch <names...>")
  .description("Download and install a skill via symlink")
  .requiredOption("--agent <agent>", `Agent to install for (${supportedAgents})`)
  .option("--scope <scope>", "global (~/.agent/skills/) or project (./.agent/skills/)", "global")
  .action((names: string[], options: { agent: string; scope: "global" | "project" }) =>
    fetchCommand(names, options)
  );

program
  .command("add <path>")
  .description("Upload a local skill directory to a collection")
  .option("--collection <name>", "Target collection (default: first available)")
  .action((skillPath: string, options: { collection?: string }) =>
    addCommand(skillPath, options)
  );

program
  .command("update <path>")
  .description("Push local edits to a skill back to storage and refresh cache")
  .option("--collection <name>", "Override target collection")
  .action((skillPath: string, options: { collection?: string }) =>
    updateCommand(skillPath, options)
  );

program
  .command("refresh")
  .description("Re-discover collections from storage")
  .action(refreshCommand);

// ── Collection ───────────────────────────────────────────────────────────────

const collection = program
  .command("collection")
  .description("Manage collections");

collection
  .command("create [name]")
  .description("Create a new collection (defaults to SKILLS_MY_SKILLS)")
  .option("--backend <backend>", "gdrive (default) or github", "gdrive")
  .option("--repo <owner/repo>", "GitHub repo to use (required for --backend github)")
  .action((name: string | undefined, options: { backend?: string; repo?: string }) =>
    collectionCreateCommand(name, options)
  );

// ── Registry ─────────────────────────────────────────────────────────────────

const registry = program
  .command("registry")
  .description("Manage registries (root indexes pointing to collections)");

registry
  .command("create")
  .description("Create a new registry (default: local, --backend gdrive or --backend github)")
  .option("--backend <backend>", "local (default), gdrive, or github", "local")
  .option("--repo <owner/repo>", "GitHub repo to use (required for --backend github)")
  .action((options: { backend?: string; repo?: string }) => registryCreateCommand(options));

registry
  .command("list")
  .description("Show all registries and their collection references")
  .action(registryListCommand);

registry
  .command("discover")
  .description("Search a backend for registries owned by the current user")
  .option("--backend <backend>", "local (default), gdrive, or github", "local")
  .action((options: { backend?: string }) => registryDiscoverCommand(options));

registry
  .command("add-collection <name>")
  .description("Add a collection reference to the registry")
  .option("--backend <backend>", "Backend where the collection lives")
  .option("--ref <ref>", "Backend-specific reference (folder name, repo path)")
  .action((name: string, options: { backend?: string; ref?: string }) =>
    registryAddCollectionCommand(name, options)
  );

registry
  .command("remove-collection <name>")
  .description("Remove a collection reference from the registry")
  .option("--delete", "Also delete the collection and all its skills from the backend")
  .action((name: string, options: { delete?: boolean }) =>
    registryRemoveCollectionCommand(name, options)
  );

registry
  .command("push")
  .description("Push local registry and collections to a remote backend")
  .option("--backend <backend>", "Target backend: gdrive (default) or github", "gdrive")
  .option("--repo <owner/repo>", "GitHub repo to push into (required when --backend github)")
  .action((options: { backend?: string; repo?: string }) => registryPushCommand(options));

// ── Install/Uninstall ────────────────────────────────────────────────────────

program
  .command("install")
  .description("Install the skillsmanager skill to agent directories")
  .option("--agent <agents>", "Comma-separated agents (default: all)")
  .option("--path <dir>", "Custom directory to install to")
  .action((options: { agent?: string; path?: string }) =>
    installCommand(options)
  );

program
  .command("uninstall")
  .description("Remove the skillsmanager skill from agent directories")
  .option("--agent <agents>", "Comma-separated agents (default: all)")
  .option("--path <dir>", "Custom directory to remove from")
  .action((options: { agent?: string; path?: string }) =>
    uninstallCommand(options)
  );

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(chalk.red("Error:"), err.message);
  process.exit(1);
});
