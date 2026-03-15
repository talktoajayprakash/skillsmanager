#!/usr/bin/env node
import chalk from "chalk";
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
import { collectionCreateCommand } from "./commands/collection.js";
import { installCommand, uninstallCommand } from "./commands/install.js";
import {
  registryCreateCommand, registryListCommand, registryDiscoverCommand,
  registryAddCollectionCommand, registryPushCommand,
} from "./commands/registry.js";

const supportedAgents = Object.keys(AGENT_PATHS).join(", ");

program
  .name("skillsync")
  .description(
    "Discover, fetch, and manage agent skills from local or remote storage.\n\n" +
    "  skillsync search <query>                        Search skills by name or description\n" +
    "  skillsync fetch <name> --agent <agent>          Download and install a skill\n" +
    "  skillsync add <path>                            Upload a local skill to a collection\n" +
    "  skillsync update <path>                         Push local edits back to storage\n" +
    "  skillsync list                                  List all available skills\n" +
    "  skillsync registry list                         Show registries and collections\n" +
    "  skillsync registry push --backend gdrive        Push local data to Google Drive\n" +
    "  skillsync install                               Install skillsync skill for all agents\n\n" +
    "  Agents: " + supportedAgents + "\n" +
    "  Scope:  --scope global (default) | --scope project\n\n" +
    "  Run 'skillsync install' to install the full skillsync guide for your agents.\n" +
    "  Run 'skillsync <command> --help' for details on any command."
  )
  .version("0.1.0");

// ── Setup ────────────────────────────────────────────────────────────────────

const setup = program
  .command("setup")
  .description("Set up storage backends");

setup
  .command("google")
  .description("One-time Google Drive setup (human-facing, not for agents)")
  .action(setupGoogleCommand);

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
  .description("Create a new collection (defaults to SKILLSYNC_MY_SKILLS)")
  .action(collectionCreateCommand);

// ── Registry ─────────────────────────────────────────────────────────────────

const registry = program
  .command("registry")
  .description("Manage registries (root indexes pointing to collections)");

registry
  .command("create")
  .description("Create a new registry (default: local, --backend gdrive for Drive)")
  .option("--backend <backend>", "local (default) or gdrive", "local")
  .action((options: { backend?: string }) => registryCreateCommand(options));

registry
  .command("list")
  .description("Show all registries and their collection references")
  .action(registryListCommand);

registry
  .command("discover")
  .description("Search a backend for registries owned by the current user")
  .option("--backend <backend>", "local (default) or gdrive", "local")
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
  .command("push")
  .description("Push local registry and collections to a remote backend")
  .option("--backend <backend>", "Target backend (default: gdrive)", "gdrive")
  .action((options: { backend?: string }) => registryPushCommand(options));

// ── Install/Uninstall ────────────────────────────────────────────────────────

program
  .command("install")
  .description("Install the skillsync skill to agent directories")
  .option("--agent <agents>", "Comma-separated agents (default: all)")
  .option("--path <dir>", "Custom directory to install to")
  .action((options: { agent?: string; path?: string }) =>
    installCommand(options)
  );

program
  .command("uninstall")
  .description("Remove the skillsync skill from agent directories")
  .option("--agent <agents>", "Comma-separated agents (default: all)")
  .option("--path <dir>", "Custom directory to remove from")
  .action((options: { agent?: string; path?: string }) =>
    uninstallCommand(options)
  );

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(chalk.red("Error:"), err.message);
  process.exit(1);
});
