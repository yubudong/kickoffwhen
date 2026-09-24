import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  seedContentSummary,
  validateSeedContents,
} from "@/modules/learning-content/seed-validator";
import { assertChineseSeedAudit, type ChineseContentRequirements } from "@/modules/learning-content/content-audit";

const seedFiles = [
  "content/seed/chinese-grade5-volume1.json",
  "content/seed/english-pep-grade5-volume1.json",
];
const requirementsFile = "content/reference/chinese-grade5-volume1.json";

async function main() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length !== 1 || !["--validate-only", "--apply"].includes(arguments_[0])) {
    throw new Error("Exactly one mode is required: --validate-only or --apply");
  }

  const contents = validateSeedContents(
    await Promise.all(
      seedFiles.map(async (filename) =>
        JSON.parse(await readFile(resolve(process.cwd(), filename), "utf8")),
      ),
    ),
  );
  const requirements = JSON.parse(await readFile(resolve(process.cwd(), requirementsFile), "utf8")) as ChineseContentRequirements;
  for (const content of contents) if (content.subject === "chinese") assertChineseSeedAudit(content, requirements);
  for (const [index, content] of contents.entries()) {
    const filename = seedFiles[index];
    const summary = seedContentSummary(content);
    console.log(`${filename}: ${summary.edition}; units=${summary.units}; sections=${summary.sections}; cards=${summary.cards}`);
  }
  console.log("validation: PASS");
  if (arguments_[0] === "--apply") {
    const [{ db }, { applySeedContents }] = await Promise.all([import("@/db/client"), import("@/modules/learning-content/seed-service")]);
    const summaries = await applySeedContents(db, contents, [requirements]);
    for (const summary of summaries) console.log(`${summary.edition}: inserted=${summary.insertedCards}; updated=${summary.updatedCards}`);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
