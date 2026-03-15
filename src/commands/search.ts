import chalk from "chalk";
import ora from "ora";
import { getAllSkills } from "./list.js";
import { bm25Search } from "../bm25.js";
import type { ResolvedSkill } from "../types.js";

export async function searchCommand(query: string): Promise<void> {
  const spinner = ora("Searching skills...").start();

  try {
    const skills = await getAllSkills();
    spinner.stop();

    // Build BM25 documents — name is weighted 3x by repeating it
    // so a name match outranks a description-only match
    const docs = skills.map((s) => ({
      id: s.entry.name,
      text: `${s.entry.name} ${s.entry.name} ${s.entry.name} ${s.entry.description}`,
    }));

    const results = bm25Search(docs, query);

    if (results.length === 0) {
      console.log(chalk.yellow(`No skills matching "${query}".`));
      return;
    }

    const ranked: ResolvedSkill[] = results
      .map((r) => skills.find((s) => s.entry.name === r.id)!)
      .filter(Boolean);

    const maxName = Math.max(...ranked.map((s) => s.entry.name.length), 4);
    const maxDesc = Math.max(...ranked.map((s) => s.entry.description.length), 11);

    console.log(
      `\n  ${chalk.dim("NAME".padEnd(maxName + 2))}${chalk.dim("DESCRIPTION".padEnd(maxDesc + 2))}${chalk.dim("SOURCE")}`
    );
    console.log(`  ${chalk.dim("-".repeat(maxName + maxDesc + 30))}`);

    for (const s of ranked) {
      console.log(
        `  ${chalk.cyan(s.entry.name.padEnd(maxName + 2))}${s.entry.description.padEnd(maxDesc + 2)}${chalk.dim(`gdrive:${s.collection.name}`)}`
      );
    }

    console.log();
  } catch (err) {
    spinner.stop();
    throw err;
  }
}
