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

const supportedAgents = Object.keys(AGENT_PATHS).join(", ");

program
  .name("skillsync")
  .description(
    "SkillSync — discover, fetch, and manage agent skills from remote storage\n\n" +
      "Skills are cached at ~/.skillssync/cache/ and symlinked to agent directories.\n" +
      "All skill names are unique — just use the name, no paths needed."
  )
  .version("0.1.0");

const setup = program
  .command("setup")
  .description("Set up storage backends");

setup
  .command("google")
  .description("Set up Google Drive (installs gcloud, creates project, configures credentials)")
  .action(setupGoogleCommand);

program
  .command("init")
  .description("Log into Google Drive and auto-discover collections")
  .action(initCommand);

program
  .command("list")
  .description("Show all available skills across all collections")
  .action(listCommand);

program
  .command("search <query>")
  .description("Search skills by name or description")
  .action(searchCommand);

program
  .command("fetch <names...>")
  .description("Download a skill and symlink to the agent's skills directory")
  .requiredOption(
    "--agent <agent>",
    `Agent to symlink for (${supportedAgents})`
  )
  .action((names: string[], options: { agent: string }) =>
    fetchCommand(names, options)
  );

program
  .command("add <path>")
  .description("Add a new local skill to a collection")
  .option("--collection <name>", "Target collection name (default: first)")
  .action((skillPath: string, options: { collection?: string }) =>
    addCommand(skillPath, options)
  );

program
  .command("update <name>")
  .description("Push changes to an existing skill back to remote")
  .action(updateCommand);

program
  .command("refresh")
  .description("Re-run collection discovery to pick up new collections")
  .action(refreshCommand);

const collection = program
  .command("collection")
  .description("Manage collections");

collection
  .command("create <name>")
  .description("Create a new collection (Google Drive folder + SKILLS_SYNC.yaml)")
  .action(collectionCreateCommand);

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(chalk.red("Error:"), err.message);
  process.exit(1);
});
