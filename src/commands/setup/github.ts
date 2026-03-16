import { spawnSync } from "child_process";
import chalk from "chalk";

// ── helpers ───────────────────────────────────────────────────────────────────

function ghInstalled(): boolean {
  return spawnSync("gh", ["--version"], { stdio: "pipe" }).status === 0;
}

function ghAuthed(): boolean {
  return spawnSync("gh", ["auth", "status"], { stdio: "pipe" }).status === 0;
}

async function installGh(): Promise<boolean> {
  if (process.platform !== "darwin") {
    console.log(chalk.yellow("  Auto-install is only supported on macOS."));
    console.log(chalk.dim("  Install manually: https://cli.github.com/manual/installation"));
    return false;
  }

  const brewCheck = spawnSync("brew", ["--version"], { stdio: "pipe" });
  if (brewCheck.status !== 0) {
    console.log(chalk.yellow("  Homebrew not found. Install it from https://brew.sh then re-run."));
    return false;
  }

  console.log(chalk.dim("  Installing gh via Homebrew..."));
  const r = spawnSync("brew", ["install", "gh"], { stdio: "inherit" });
  if (r.status !== 0) {
    console.log(chalk.red("  Install failed. Try manually: brew install gh"));
    return false;
  }
  return ghInstalled();
}

// ── main command ──────────────────────────────────────────────────────────────

export async function setupGithubCommand(): Promise<void> {
  console.log(chalk.bold("\nSkills Manager — GitHub Setup\n"));

  // Step 1: Check gh CLI
  console.log(chalk.bold("Step 1 — gh CLI\n"));

  if (!ghInstalled()) {
    console.log(chalk.yellow("  gh CLI is not installed."));

    const readline = await import("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await new Promise<string>((resolve) => {
      rl.question(`  Install it now via Homebrew? ${chalk.dim("[y/n]")} `, (a) => {
        rl.close();
        resolve(a.trim().toLowerCase());
      });
    });

    if (!ans.startsWith("y")) {
      console.log(chalk.dim("  Install manually: https://cli.github.com/manual/installation"));
      console.log(chalk.dim("  Then re-run: skillsmanager setup github"));
      return;
    }

    const ok = await installGh();
    if (!ok) return;
    console.log(chalk.green("  ✓ gh installed"));
  } else {
    console.log(chalk.green("  ✓ gh is installed"));
  }

  // Step 2: Check auth
  console.log(chalk.bold("\nStep 2 — GitHub Authentication\n"));

  if (ghAuthed()) {
    const r = spawnSync("gh", ["api", "user", "--jq", ".login"], {
      encoding: "utf-8", stdio: "pipe",
    });
    const login = r.stdout?.trim() ?? "";
    console.log(chalk.green(`  ✓ Already authenticated${login ? ` as ${chalk.white(login)}` : ""}`));
  } else {
    console.log(chalk.dim("  Running gh auth login..."));
    const r = spawnSync("gh", ["auth", "login"], { stdio: "inherit" });
    if (r.status !== 0) {
      console.log(chalk.red("  Authentication failed. Please try manually: gh auth login"));
      return;
    }

    const r2 = spawnSync("gh", ["api", "user", "--jq", ".login"], {
      encoding: "utf-8", stdio: "pipe",
    });
    const login = r2.stdout?.trim() ?? "";
    if (!login) {
      console.log(chalk.red("  Could not verify authentication."));
      return;
    }
    console.log(chalk.green(`  ✓ Authenticated as ${chalk.white(login)}`));
  }

  console.log(chalk.green("\n  ✓ GitHub setup complete!"));
  console.log(`\nRun ${chalk.bold("skillsmanager collection create --backend github")} to create a collection.\n`);
}
