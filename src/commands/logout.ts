import fs from "fs";
import chalk from "chalk";
import { CREDENTIALS_PATH, TOKEN_PATH } from "../config.js";
import { spawnSync } from "child_process";

export async function logoutGoogleCommand(options: { all?: boolean }): Promise<void> {
  const removeAll = options.all;
  let removed = false;

  if (fs.existsSync(TOKEN_PATH)) {
    fs.unlinkSync(TOKEN_PATH);
    console.log(chalk.green("  ✓ Removed token.json (OAuth session cleared)"));
    removed = true;
  } else {
    console.log(chalk.dim("  – token.json not found (already logged out)"));
  }

  if (removeAll) {
    if (fs.existsSync(CREDENTIALS_PATH)) {
      fs.unlinkSync(CREDENTIALS_PATH);
      console.log(chalk.green("  ✓ Removed credentials.json (OAuth client cleared)"));
      removed = true;
    } else {
      console.log(chalk.dim("  – credentials.json not found"));
    }
  }

  if (removed) {
    console.log(chalk.dim("\n  Run sm setup google to set up again."));
  }
}

export function logoutGithubCommand(): void {
  const r = spawnSync("gh", ["auth", "logout"], { stdio: "inherit" });
  if (r.status !== 0) {
    console.log(chalk.red("  gh auth logout failed. Try manually: gh auth logout"));
  }
}
