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
    "SkillSync — discover, fetch, and manage agent skills from local or remote storage.\n\n" +
    "Common flows:\n\n" +
    "  Find and install a skill:\n" +
    "    skillsync search <query>                        # find skills by name or description\n" +
    "    skillsync fetch <name> --agent <agent>          # download and install for an agent\n\n" +
    "  Share a new skill:\n" +
    "    skillsync add <path>                            # upload a local skill directory\n\n" +
    "  Update a skill you have installed:\n" +
    "    skillsync update <path>                         # push edits back to storage\n" +
    "                                                    # (run skillsync fetch first on new machines)\n\n" +
    "  Registry and collections:\n" +
    "    skillsync registry list                         # show registries and collections\n" +
    "    skillsync registry create                       # create a local registry\n" +
    "    skillsync registry push --backend gdrive        # push local data to Google Drive\n" +
    "    skillsync collection create [name]              # create a new collection\n\n" +
    "  Supported agents: " + supportedAgents + "\n\n" +
    "  Skill scope:\n" +
    "    --scope global   install to ~/.agent/skills/    (default, all projects)\n" +
    "    --scope project  install to ./.agent/skills/    (this project only)\n\n" +
    "  Install the skillsync skill for agents:\n" +
    "    skillsync install                               # install to all agents\n" +
    "    skillsync install --agent claude,codex          # install to specific agents\n\n" +
    "  First-time setup (human only, needed for Google Drive):\n" +
    "    skillsync setup google                          # configure Google Drive credentials"
  )
  .version("0.1.0");

const setup = program
  .command("setup")
  .description("Set up storage backends");

setup
  .command("google")
  .description("One-time Google Drive setup — installs gcloud, creates a Cloud project, and configures OAuth credentials. Human-facing, not for agents.")
  .action(setupGoogleCommand);

program
  .command("init")
  .description("Authenticate with Google Drive and discover available collections. Runs automatically when needed.")
  .action(initCommand);

program
  .command("list")
  .description("List all available skills across all collections with name and description.")
  .action(listCommand);

program
  .command("search <query>")
  .description("Search skills by name or description. Use this to find the right skill name before fetching.")
  .action(searchCommand);

program
  .command("fetch <names...>")
  .description(
    "Download a skill and install it for an agent via symlink.\n" +
    "  The skill is cached at ~/.skillssync/cache/ — all symlinks share one copy.\n" +
    "  Run this on each machine before using or editing a skill.\n" +
    "  Example: skillsync fetch write_linkedin_post --agent claude"
  )
  .requiredOption("--agent <agent>", `Agent to install for (${supportedAgents})`)
  .option("--scope <scope>", "global = ~/.agent/skills/ (default), project = ./.agent/skills/", "global")
  .action((names: string[], options: { agent: string; scope: "global" | "project" }) =>
    fetchCommand(names, options)
  );

program
  .command("add <path>")
  .description(
    "Upload a local skill directory to a collection.\n" +
    "  The directory must contain a SKILL.md with name and description frontmatter.\n" +
    "  Example: skillsync add ./my_skill"
  )
  .option("--collection <name>", "Target collection (default: first available)")
  .action((skillPath: string, options: { collection?: string }) =>
    addCommand(skillPath, options)
  );

program
  .command("update <path>")
  .description(
    "Push local edits to a skill back to remote storage, then refresh the local cache.\n" +
    "  All symlinks on this machine reflect the change immediately.\n" +
    "  Requires the skill to have been fetched on this machine first.\n" +
    "  Example: skillsync update ~/.claude/skills/write_linkedin_post"
  )
  .option("--collection <name>", "Override target collection (needed if skill exists in multiple collections)")
  .action((skillPath: string, options: { collection?: string }) =>
    updateCommand(skillPath, options)
  );

program
  .command("refresh")
  .description("Re-discover collections from Google Drive. Run this if a new collection was created on another machine.")
  .action(refreshCommand);

const collection = program
  .command("collection")
  .description("Manage collections (Google Drive folders that store skills).");

collection
  .command("create [name]")
  .description("Create a new collection. Defaults to SKILLSYNC_MY_SKILLS if no name is given.")
  .action(collectionCreateCommand);

program
  .command("install")
  .description(
    "Install the bundled skillsync skill to agent directories.\n" +
    "  No flags: installs to all supported agents.\n" +
    "  --agent claude,codex: install to specific agents only.\n" +
    "  --path <dir>: install to a custom directory."
  )
  .option("--agent <agents>", "Comma-separated list of agents to install for")
  .option("--path <dir>", "Custom directory to install the skill to")
  .action((options: { agent?: string; path?: string }) =>
    installCommand(options)
  );

program
  .command("uninstall")
  .description(
    "Remove the skillsync skill from agent directories.\n" +
    "  No flags: removes from all agents.\n" +
    "  --agent claude: remove from specific agents only.\n" +
    "  --path <dir>: remove from a custom directory."
  )
  .option("--agent <agents>", "Comma-separated list of agents to remove from")
  .option("--path <dir>", "Custom directory to remove the skill from")
  .action((options: { agent?: string; path?: string }) =>
    uninstallCommand(options)
  );

const registry = program
  .command("registry")
  .description("Manage registries (root indexes that point to collections across backends).");

registry
  .command("create")
  .description("Create a new registry. Defaults to local storage.")
  .option("--backend <backend>", "Backend to create in: local (default) or gdrive", "local")
  .action((options: { backend?: string }) => registryCreateCommand(options));

registry
  .command("list")
  .description("Show all registries and their collection references.")
  .action(registryListCommand);

registry
  .command("discover")
  .description("Search a backend for registries owned by the current user.")
  .option("--backend <backend>", "Backend to search: local (default) or gdrive", "local")
  .action((options: { backend?: string }) => registryDiscoverCommand(options));

registry
  .command("add-collection <name>")
  .description("Add a collection reference to the first registry.")
  .option("--backend <backend>", "Backend where the collection lives")
  .option("--ref <ref>", "Backend-specific reference (folder name, repo path)")
  .action((name: string, options: { backend?: string; ref?: string }) =>
    registryAddCollectionCommand(name, options)
  );

registry
  .command("push")
  .description("Push local registry and collections to a remote backend.")
  .option("--backend <backend>", "Target backend: gdrive (default)", "gdrive")
  .action((options: { backend?: string }) => registryPushCommand(options));

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(chalk.red("Error:"), err.message);
  process.exit(1);
});
