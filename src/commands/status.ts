import chalk from "chalk";
import { tryResolveBackend } from "../backends/resolve.js";

const BACKENDS = [
  { name: "local",  hint: "" },
  { name: "gdrive", hint: "run: sm setup google" },
  { name: "github", hint: "run: sm setup github" },
];

export async function statusCommand(): Promise<void> {
  const rows = await Promise.all(
    BACKENDS.map(async ({ name, hint }) => {
      const backend = await tryResolveBackend(name);
      if (!backend) return { name, loggedIn: false, identity: "", hint };
      return { name, ...(await backend.getStatus()) };
    })
  );

  const col1 = 8;
  const col2 = 24;

  const header = chalk.bold("Backend".padEnd(col1)) + "  " +
    chalk.bold("Status".padEnd(col2)) + "  " +
    chalk.bold("Identity");
  const divider = "─".repeat(col1) + "  " + "─".repeat(col2) + "  " + "─".repeat(30);

  console.log();
  console.log(header);
  console.log(chalk.dim(divider));

  for (const row of rows) {
    const statusLabel = row.loggedIn ? "✓ logged in" : "✗ not logged in";
    const status = row.loggedIn
      ? chalk.green(statusLabel)
      : chalk.red(statusLabel);
    const identity = row.loggedIn
      ? chalk.white(row.identity)
      : chalk.dim(row.hint ?? "");

    console.log(row.name.padEnd(col1) + "  " + status + " ".repeat(Math.max(0, col2 - statusLabel.length)) + "  " + identity);
  }

  console.log();
}
