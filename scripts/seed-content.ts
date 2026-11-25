import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { seedContentSummary, validateSeedContents, type SeedContent } from "@/modules/learning-content/seed-validator";
import { assertMultiEnglishAudit, type MultiEnglishReference } from '@/modules/learning-content/english-multi-audit';
import { multiEnglishManifest } from '@/modules/learning-content/english-multi-catalog';
import { assertChineseSeedAudit, type ChineseContentRequirements } from "@/modules/learning-content/content-audit";
import { assertEnglishSeedAudit, type EnglishContentRequirements } from "@/modules/learning-content/english-content-audit";

const legacySeedFiles = ["content/seed/chinese-grade5-volume1.json", "content/seed/english-pep-grade5-volume1.json"];
const load = async (filename: string) => JSON.parse(await readFile(resolve(process.cwd(), filename), "utf8")) as unknown;
type OfficialManifest = { teachingProfile: string; books: Array<{ grade: number; volume: number; seedFile: string; referenceFile: string; wordCount: number; writingCharacterCount: number; cardCount: number }> };
type EnglishManifest = { revision: string; books: Array<{grade:number;volume:number;seedFile:string;referenceFile:string;cardCount:number}> };

async function main() {
  const args = process.argv.slice(2);
  const officialOnly = args.includes("--official-only");
  const englishOnly = args.includes("--english-only");
  const extendedOnly = args.includes("--extended-english-only");
  const modes = args.filter(arg => arg === "--validate-only" || arg === "--apply");
  if ([officialOnly,englishOnly,extendedOnly].filter(Boolean).length>1 || modes.length !== 1 || args.length !== (officialOnly || englishOnly || extendedOnly ? 2 : 1)) throw new Error("Exactly one mode is required: --validate-only or --apply; optional --official-only (Chinese), --english-only, or --extended-english-only");
  const filenames: string[] = [];
  const inputs: SeedContent[] = [];
  const requirements: ChineseContentRequirements[] = [];
  const englishRequirements: EnglishContentRequirements[] = [];
  const multiRequirements: MultiEnglishReference[] = [];
  if (!officialOnly && !englishOnly && !extendedOnly) {
    const legacy = validateSeedContents(await Promise.all(legacySeedFiles.map(load)));
    const reference = await load("content/reference/chinese-grade5-volume1.json") as ChineseContentRequirements;
    for (const content of legacy) if (content.subject === "chinese") assertChineseSeedAudit(content, reference);
    filenames.push(...legacySeedFiles); inputs.push(...legacy); requirements.push(reference);
  }
  if (!englishOnly && !extendedOnly) {
    const manifest = await load("content/official-chinese-manifest.json") as OfficialManifest;
    if (manifest.teachingProfile !== "grade_aware_v2") throw new Error("OFFICIAL_MANIFEST_REVISION_MISMATCH");
    if (!Array.isArray(manifest.books) || manifest.books.length !== 12 || new Set(manifest.books.map(book => `${book.grade}:${book.volume}`)).size !== 12
      || manifest.books.some(book => book.grade < 1 || book.grade > 6 || ![1, 2].includes(book.volume)
        || book.seedFile !== `content/seed/chinese-official-grade${book.grade}-volume${book.volume}.json`
        || book.referenceFile !== `content/reference/chinese-official-grade${book.grade}-volume${book.volume}.json`)) throw new Error("OFFICIAL_MANIFEST_INCOMPLETE");
    for (const book of manifest.books) {
      const [raw, reference] = await Promise.all([load(book.seedFile), load(book.referenceFile)]);
      const [content] = validateSeedContents([raw]);
      if (!content || content.grade !== book.grade || content.volume !== (book.volume === 1 ? "上册" : "下册") || content.auditProfile !== "official_textbook") throw new Error("OFFICIAL_MANIFEST_CONTENT_MISMATCH");
      const ref = reference as ChineseContentRequirements; assertChineseSeedAudit(content, ref);
      const summary = seedContentSummary(content);
      if (summary.cards !== book.cardCount || ref.requiredVocabulary.reduce((sum, item) => sum + item.words.length, 0) !== book.wordCount
        || ref.requiredCharacters.reduce((sum, item) => sum + item.characters.length, 0) !== book.writingCharacterCount) throw new Error("OFFICIAL_MANIFEST_TOTAL_MISMATCH");
      inputs.push(content); requirements.push(ref); filenames.push(book.seedFile);
    }
  }
  if (!officialOnly && !extendedOnly) {
    const manifest = await load("content/official-english-manifest.json") as EnglishManifest;
    if (manifest.revision !== "english_pep_v1" || manifest.books.length !== 8 || new Set(manifest.books.map(book=>`${book.grade}:${book.volume}`)).size !== 8
      || manifest.books.some(book => book.grade < 3 || book.grade > 6 || ![1,2].includes(book.volume)
        || book.seedFile !== `content/seed/english-official-grade${book.grade}-volume${book.volume}.json`
        || book.referenceFile !== `content/reference/english-official-grade${book.grade}-volume${book.volume}.json`)) throw new Error("ENGLISH_MANIFEST_INCOMPLETE");
    for (const book of manifest.books) {
      const [raw, reference] = await Promise.all([load(book.seedFile),load(book.referenceFile)]);
      const [content] = validateSeedContents([raw]); const ref = reference as EnglishContentRequirements;
      if (!content || content.subject !== "english" || content.grade !== book.grade || content.volume !== (book.volume===1?"上册":"下册")) throw new Error("ENGLISH_MANIFEST_CONTENT_MISMATCH");
      const audit = assertEnglishSeedAudit(content,ref);
      if (audit.cards !== book.cardCount) throw new Error("ENGLISH_MANIFEST_TOTAL_MISMATCH");
      inputs.push(content); englishRequirements.push(ref); filenames.push(book.seedFile);
    }
  }
  if (!officialOnly) {
    const manifest=multiEnglishManifest;
    if(manifest.revision!=='english_multi_v1'||!manifest.books.length)throw new Error('MULTI_ENGLISH_MANIFEST_INCOMPLETE');
    const identities=new Set<string>();
    for(const book of manifest.books){
      if(!/^[a-z0-9-]+$/.test(book.seriesKey)||book.grade<1||book.grade>6||![1,2].includes(book.volume))throw new Error('MULTI_ENGLISH_MANIFEST_IDENTITY_INVALID');
      const stem=`${book.seriesKey}-g${book.grade}-v${book.volume}`;
      if(identities.has(stem)||book.seedFile!==`content/english-multi/seed/${stem}.json`||book.referenceFile!==`content/english-multi/reference/${stem}.json`)throw new Error('MULTI_ENGLISH_MANIFEST_FILE_INVALID');
      identities.add(stem);
      const [raw,ref]=await Promise.all([load(book.seedFile),load(book.referenceFile)]);const [content]=validateSeedContents([raw]);
      const reference=ref as MultiEnglishReference;const audit=assertMultiEnglishAudit(content,reference);
      if(content.grade!==book.grade||content.volume!==book.volumeText||content.publisher!==book.publisher||content.series!==book.series||content.editionText!==book.editionText||reference.source.resourceId!==book.resourceId||audit.cards!==book.cardCount)throw new Error('MULTI_ENGLISH_MANIFEST_MISMATCH');
      inputs.push(content);multiRequirements.push(reference);filenames.push(book.seedFile);
    }
  }
  const contents = validateSeedContents(inputs);
  for (const [index, content] of contents.entries()) {
    const summary = seedContentSummary(content);
    console.log(`${filenames[index]}: ${summary.edition}; units=${summary.units}; sections=${summary.sections}; cards=${summary.cards}`);
  }
  console.log("validation: PASS");
  if (modes[0] === "--apply") {
    const [{ db }, { applySeedContents }] = await Promise.all([import("@/db/client"), import("@/modules/learning-content/seed-service")]);
    const summaries = await applySeedContents(db, contents, requirements, englishRequirements, multiRequirements);
    for (const summary of summaries) console.log(`${summary.edition}: inserted=${summary.insertedCards}; updated=${summary.updatedCards}`);
  }
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
