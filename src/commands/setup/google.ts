import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";
import { execSync, spawnSync } from "child_process";
import chalk from "chalk";
import { CREDENTIALS_PATH, TOKEN_PATH, ensureConfigDir, CONFIG_PATH, readConfig } from "../../config.js";
import { runAuthFlow, hasToken, getAuthedEmail } from "../../auth.js";
import { credentialsExist } from "../../config.js";
import { LocalBackend } from "../../backends/local.js";

// ─── Prompt helpers ──────────────────────────────────────────────────────────

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); });
  });
}

async function confirm(question: string): Promise<boolean> {
  const ans = await ask(`${question} ${chalk.dim("[y/n]")} `);
  return ans.toLowerCase().startsWith("y");
}

// ─── gcloud helpers ──────────────────────────────────────────────────────────

function gcloudInstalled(): boolean {
  const r = spawnSync("gcloud", ["version"], { stdio: "pipe" });
  return r.status === 0;
}

function gcloudExec(args: string[], opts?: { input?: string }): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync("gcloud", args, {
    stdio: opts?.input ? ["pipe", "pipe", "pipe"] : ["inherit", "pipe", "pipe"],
    input: opts?.input,
    encoding: "utf-8",
  });
  return { ok: r.status === 0, stdout: (r.stdout ?? "").trim(), stderr: (r.stderr ?? "").trim() };
}

function getActiveGcloudAccount(): string | null {
  const r = gcloudExec(["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"]);
  return r.ok && r.stdout ? r.stdout.split("\n")[0].trim() : null;
}

interface GcloudProject { projectId: string; name: string; }

function listProjects(): GcloudProject[] {
  const r = gcloudExec(["projects", "list", "--format=value(projectId,name)"]);
  if (!r.ok || !r.stdout) return [];
  return r.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [projectId, ...nameParts] = line.split(/\s+/);
      return { projectId, name: nameParts.join(" ") || projectId };
    });
}

function apiEnabled(projectId: string, api: string): boolean {
  const r = gcloudExec([
    "services", "list",
    `--project=${projectId}`,
    "--enabled",
    `--filter=config.name:${api}`,
    "--format=value(config.name)",
  ]);
  return r.ok && r.stdout.includes(api);
}

function enableApi(projectId: string, api: string): boolean {
  console.log(chalk.dim(`  Enabling ${api}...`));
  const r = gcloudExec(["services", "enable", api, `--project=${projectId}`]);
  return r.ok;
}

// ─── Install gcloud ───────────────────────────────────────────────────────────

async function installGcloud(): Promise<boolean> {
  const isMac = process.platform === "darwin";
  if (!isMac) {
    console.log(chalk.yellow("  Auto-install is only supported on macOS."));
    console.log(chalk.dim("  Install gcloud manually: https://cloud.google.com/sdk/docs/install"));
    return false;
  }

  // Check homebrew
  const brewCheck = spawnSync("brew", ["--version"], { stdio: "pipe" });
  if (brewCheck.status !== 0) {
    console.log(chalk.yellow("  Homebrew not found. Install it from https://brew.sh then re-run."));
    return false;
  }

  console.log(chalk.dim("  Installing google-cloud-sdk via Homebrew (this may take a minute)..."));
  const r = spawnSync("brew", ["install", "--cask", "google-cloud-sdk"], { stdio: "inherit" });
  if (r.status !== 0) {
    console.log(chalk.red("  Install failed. Try manually: brew install --cask google-cloud-sdk"));
    return false;
  }

  // After cask install, gcloud lives in /usr/local/Caskroom path; add to PATH hint
  console.log(chalk.dim("  You may need to open a new terminal or source your shell profile for gcloud to be in PATH."));
  console.log(chalk.dim("  Trying to continue..."));
  return gcloudInstalled();
}

// ─── Project selection ────────────────────────────────────────────────────────

async function selectOrCreateProject(): Promise<string | null> {
  const projects = listProjects();

  if (projects.length > 0) {
    console.log(chalk.bold("\nExisting projects:"));
    projects.forEach((p, i) => console.log(`  ${chalk.cyan(i + 1)}. ${p.name} ${chalk.dim(`(${p.projectId})`)}`));
    console.log(`  ${chalk.cyan(projects.length + 1)}. Create a new project`);

    const ans = await ask(`\nSelect a project [1-${projects.length + 1}]: `);
    const idx = parseInt(ans, 10);

    if (idx >= 1 && idx <= projects.length) {
      return projects[idx - 1].projectId;
    }
  }

  // Create new
  const rawName = await ask(`\nProject name ${chalk.dim('(leave blank for "Skills Manager")')}: `);
  const name = rawName || "Skills Manager";
  const projectId = name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
    + "-" + Date.now().toString().slice(-6);

  console.log(chalk.dim(`\n  Creating project ${projectId}...`));
  const r = gcloudExec(["projects", "create", projectId, `--name=${name}`]);
  if (!r.ok) {
    console.log(chalk.red(`  Failed to create project: ${r.stderr}`));
    return null;
  }
  console.log(chalk.green(`  ✓ Project "${name}" created (${projectId})`));
  return projectId;
}

// ─── Open browser helper ──────────────────────────────────────────────────────

function openUrl(url: string): void {
  const cmd = process.platform === "darwin" ? "open" :
               process.platform === "win32" ? "start" : "xdg-open";
  try { execSync(`${cmd} "${url}"`, { stdio: "ignore" }); } catch { /* ignore */ }
}

// ─── Post-auth nudge ─────────────────────────────────────────────────────────

async function printPushNudgeIfNeeded(): Promise<void> {
  if (!fs.existsSync(CONFIG_PATH)) return;
  try {
    const config = readConfig();
    const localReg = config.registries.find((r) => r.backend === "local");
    if (!localReg) return;
    const local = new LocalBackend();
    const localData = await local.readRegistry(localReg);
    const localCollections = localData.collections.filter((c) => c.backend === "local");
    if (localCollections.length === 0) return;
    const names = localCollections.map((c) => chalk.cyan(c.name)).join(", ");
    console.log(chalk.yellow(`\n  Found local registry with ${localCollections.length} collection(s): ${names}`));
    console.log(chalk.dim(`  Run ${chalk.white("skillsmanager registry push --backend gdrive")} to back them up to Google Drive.\n`));
  } catch { /* unreadable config, skip hint */ }
}

// ─── Main command ─────────────────────────────────────────────────────────────

export async function setupGoogleCommand(): Promise<void> {
  console.log(chalk.bold("\nSkills Manager — Google Drive Setup\n"));

  // ── Case 1: credentials.json already present ──────────────────────────────
  if (credentialsExist()) {
    console.log(chalk.green("  ✓ credentials.json found"));
    if (hasToken()) {
      console.log(chalk.green("  ✓ Already authenticated — nothing to do."));
      await printPushNudgeIfNeeded();
      console.log(`Run ${chalk.bold("skillsmanager refresh")} to discover registries.\n`);
      return;
    }
    console.log(chalk.yellow("  ✗ Not yet authenticated — starting OAuth flow...\n"));
    const client = await runAuthFlow();
    const authedEmail = await getAuthedEmail(client);
    console.log(chalk.green(`\n  ✓ Authenticated successfully${authedEmail ? ` as ${chalk.white(authedEmail)}` : ""}.`));
    await printPushNudgeIfNeeded();
    console.log(`Run ${chalk.bold("skillsmanager refresh")} to discover registries.\n`);
    return;
  }

  // ── Case 2: No credentials.json ───────────────────────────────────────────
  console.log(chalk.yellow("  ✗ No credentials.json found at ~/.skillsmanager/credentials.json\n"));

  const wantHelp = await confirm("Would you like Skills Manager to help you set up a Google Cloud project?");

  if (!wantHelp) {
    printManualInstructions();
    return;
  }

  // ── Automated setup ───────────────────────────────────────────────────────
  console.log(chalk.bold("\nStep 1 — gcloud CLI\n"));

  if (!gcloudInstalled()) {
    console.log(chalk.yellow("  gcloud CLI is not installed."));
    const install = await confirm("  Install it now via Homebrew?");
    if (!install) {
      console.log(chalk.dim("  Install manually: https://cloud.google.com/sdk/docs/install"));
      console.log(chalk.dim("  Then re-run: skillsmanager setup google"));
      return;
    }
    const ok = await installGcloud();
    if (!ok) return;
  } else {
    console.log(chalk.green("  ✓ gcloud is installed"));
  }

  // ── gcloud auth ───────────────────────────────────────────────────────────
  console.log(chalk.bold("\nStep 2 — Google Account\n"));

  let account = getActiveGcloudAccount();
  if (account) {
    console.log(chalk.green(`  ✓ Signed in as ${account}`));
  } else {
    console.log(chalk.dim("  Opening browser for gcloud login..."));
    const r = spawnSync("gcloud", ["auth", "login"], { stdio: "inherit" });
    if (r.status !== 0) {
      console.log(chalk.red("  gcloud auth login failed. Please try manually."));
      return;
    }
    account = getActiveGcloudAccount();
    if (!account) {
      console.log(chalk.red("  Could not determine active account after login."));
      return;
    }
    console.log(chalk.green(`  ✓ Signed in as ${account}`));
  }

  // ── Project ───────────────────────────────────────────────────────────────
  console.log(chalk.bold("\nStep 3 — Google Cloud Project\n"));

  const projectId = await selectOrCreateProject();
  if (!projectId) return;

  // ── Enable APIs ───────────────────────────────────────────────────────────
  console.log(chalk.bold("\nStep 4 — Enable Required APIs\n"));

  const REQUIRED_APIS: { api: string; label: string }[] = [
    { api: "drive.googleapis.com", label: "Google Drive API" },
  ];

  for (const { api, label } of REQUIRED_APIS) {
    if (apiEnabled(projectId, api)) {
      console.log(chalk.green(`  ✓ ${label} already enabled`));
    } else {
      const ok = enableApi(projectId, api);
      if (ok) {
        console.log(chalk.green(`  ✓ ${label} enabled`));
      } else {
        console.log(chalk.red(`  Failed to enable ${label}. Check that billing is set up for the project.`));
        return;
      }
    }
  }

  // ── Configure OAuth Consent Screen ────────────────────────────────────────
  console.log(chalk.bold("\nStep 5 — Configure OAuth Consent Screen\n"));
  console.log("  Before creating credentials, Google requires you to configure the");
  console.log("  OAuth consent screen (the login screen your users will see).\n");
  console.log(`  ${chalk.yellow("Note:")} Personal Google accounts can only create ${chalk.white("External")} apps.`);
  console.log(`  External apps start in Testing mode — only test users you add can sign in.\n`);

  const consentUrl = `https://console.cloud.google.com/apis/credentials/consent?project=${projectId}`;
  console.log(`  URL: ${chalk.cyan(consentUrl)}\n`);
  console.log(chalk.dim("  Instructions:"));
  console.log(chalk.dim(`    1. Audience → select ${chalk.white("External")} (required for personal accounts)`));
  console.log(chalk.dim(`    2. App name → ${chalk.white("Skills Manager")}`));
  console.log(chalk.dim(`    3. User support email → ${chalk.white(account)}`));
  console.log(chalk.dim(`    4. Contact email → ${chalk.white(account)}`));
  console.log(chalk.dim(`    5. Click "Create"`));
  console.log(chalk.dim(`    6. Scroll to "Test users" → "Add users" → enter ${chalk.white(account)} → Save\n`));

  openUrl(consentUrl);

  await ask("Press Enter once you have configured the consent screen and added yourself as a test user...");

  // ── OAuth credentials (browser) ───────────────────────────────────────────
  console.log(chalk.bold("\nStep 6 — Create OAuth 2.0 Credentials\n"));
  console.log("  Now create the OAuth client ID that Skills Manager will use to authenticate.");
  console.log("  Opening the Google Cloud Console...\n");

  const credentialsUrl =
    `https://console.cloud.google.com/apis/credentials/oauthclient?project=${projectId}`;

  console.log(`  URL: ${chalk.cyan(credentialsUrl)}\n`);
  console.log(chalk.dim("  Instructions:"));
  console.log(chalk.dim(`    1. Application type → ${chalk.white("Desktop app")}`));
  console.log(chalk.dim(`    2. Name → ${chalk.white("Skills Manager")} (or anything)`));
  console.log(chalk.dim(`    3. Click "Create" → then "Download JSON"`));
  console.log(chalk.dim(`    4. Save the file (it will land in your Downloads folder)\n`));

  openUrl(credentialsUrl);

  await ask("Press Enter once you have downloaded the credentials JSON file...");

  // ── Locate and copy the file ──────────────────────────────────────────────
  console.log();
  const defaultDownload = path.join(os.homedir(), "Downloads");
  const downloadsFiles = fs.existsSync(defaultDownload)
    ? fs.readdirSync(defaultDownload).filter((f) => f.startsWith("client_secret") && f.endsWith(".json"))
    : [];

  let credSrc: string | null = null;

  if (downloadsFiles.length > 0) {
    // Most recently modified one
    const sorted = downloadsFiles
      .map((f) => ({ f, mtime: fs.statSync(path.join(defaultDownload, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    const candidate = path.join(defaultDownload, sorted[0].f);
    console.log(chalk.dim(`  Found: ${candidate}`));
    const use = await confirm("  Use this file?");
    if (use) credSrc = candidate;
  }

  if (!credSrc) {
    const entered = await ask("  Enter full path to the downloaded credentials JSON: ");
    credSrc = entered.replace(/^~/, os.homedir());
  }

  if (!credSrc || !fs.existsSync(credSrc)) {
    console.log(chalk.red(`  File not found: ${credSrc}`));
    console.log(chalk.dim(`  Copy it manually: cp <path> ~/.skillsmanager/credentials.json`));
    return;
  }

  ensureConfigDir();
  fs.copyFileSync(credSrc, CREDENTIALS_PATH);
  console.log(chalk.green(`\n  ✓ Credentials saved to ~/.skillsmanager/credentials.json`));

  // ── OAuth flow ────────────────────────────────────────────────────────────
  console.log(chalk.bold("\nStep 7 — Authorize Skills Manager\n"));
  const client = await runAuthFlow();
  const authedEmail = await getAuthedEmail(client);
  console.log(chalk.green(`\n  ✓ Setup complete! Authenticated as ${chalk.white(authedEmail ?? account)}`));
  await printPushNudgeIfNeeded();
  console.log(`Run ${chalk.bold("skillsmanager refresh")} to discover your registries.\n`);
}

function printManualInstructions(): void {
  console.log(chalk.bold("\nManual Setup Instructions\n"));
  console.log("  1. Go to https://console.cloud.google.com/");
  console.log("  2. Create a project (or select an existing one)");
  console.log("  3. Enable the Google Drive API:");
  console.log("       APIs & Services → Library → search \"Google Drive API\" → Enable");
  console.log("  4. Configure the OAuth consent screen:");
  console.log("       APIs & Services → OAuth consent screen");
  console.log("       Audience: External (required for personal Google accounts)");
  console.log("       Fill in App name, support email, and contact email");
  console.log("       Under \"Test users\", add your own Google account email");
  console.log("  5. Create OAuth credentials:");
  console.log("       APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID");
  console.log("       Application type: Desktop app");
  console.log("  6. Download the JSON and save it:");
  console.log(chalk.cyan(`       ~/.skillsmanager/credentials.json`));
  console.log(`\n  Then run: ${chalk.bold("skillsmanager setup google")}\n`);
}
