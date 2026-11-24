import { readFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { expect, test } from "vitest";
import { withDatabaseRollback } from "../helpers/database";
import { learningCards, textbookEditions } from "@/modules/learning-content/schema";
import { applySeedContents } from "@/modules/learning-content/seed-service";
import type { ChineseContentRequirements } from "@/modules/learning-content/content-audit";

const load = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const manifest = load("content/official-chinese-manifest.json") as { books: Array<{ seedFile: string; referenceFile: string }> };
const seeds = manifest.books.map(book => load(book.seedFile));
const references = manifest.books.map(book => load(book.referenceFile) as ChineseContentRequirements);

test("十二册完整导入可重复执行，卡片标识稳定且无关词库不变", async () => {
  await withDatabaseRollback(async tx => {
    await tx.insert(learningCards).values({ subject: "english", source: "builtin", builtinKey: "official-test-preserve", answerText: "keep", broadcastText: "keep" });
    const first = await applySeedContents(tx, seeds, references);
    expect(first.reduce((sum, item) => sum + item.insertedCards, 0)).toBe(3427);
    const keys = seeds.flatMap(seed => seed.units.flatMap((unit: { sections: Array<{ cards: Array<{ builtinKey: string }> }> }) => unit.sections.flatMap(section => section.cards.map(card => card.builtinKey))));
    const before = await tx.select({ id: learningCards.id, key: learningCards.builtinKey, answer: learningCards.answerText, audio: learningCards.broadcastText }).from(learningCards).where(inArray(learningCards.builtinKey, keys)).orderBy(learningCards.builtinKey);
    const second = await applySeedContents(tx, seeds, references);
    expect(second.reduce((sum, item) => sum + item.insertedCards, 0)).toBe(0);
    expect(second.reduce((sum, item) => sum + item.updatedCards, 0)).toBe(3427);
    const after = await tx.select({ id: learningCards.id, key: learningCards.builtinKey, answer: learningCards.answerText, audio: learningCards.broadcastText }).from(learningCards).where(inArray(learningCards.builtinKey, keys)).orderBy(learningCards.builtinKey);
    expect(after).toEqual(before);
    expect(await tx.select().from(textbookEditions)).toHaveLength(12);
    expect(await tx.select().from(learningCards).where(eq(learningCards.builtinKey, "official-test-preserve"))).toHaveLength(1);
  });
}, 120000);
