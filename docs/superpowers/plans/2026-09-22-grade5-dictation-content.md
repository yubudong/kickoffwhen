# Grade 5 Built-in Dictation Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a verified Grade 5 Chinese volume-one dictation library with pinyin and original contexts, then let parents filter by subject, unit, and textbook section while children can view context/pinyin and pause or replay word-only audio.

**Architecture:** Extend the existing textbook hierarchy with normalized sections and add pinyin, curriculum provenance, and source order to learning cards. Validate and idempotently upsert the built-in JSON seed, project only safe hint metadata during listening, and keep answer disclosure confined to grading. Preserve the existing TTS/media and dictation state machines, changing only their content inputs and presentation.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript 5.9, Drizzle ORM/PostgreSQL, Zod 4, Vitest, Playwright, existing Azure TTS adapter.

**Spec:** `docs/superpowers/specs/2026-09-22-grade5-dictation-content-design.md`

## Global Constraints

- Read the relevant Next.js guides under `node_modules/next/dist/docs/` before editing App Router or Client Component code; this repository does not assume older Next.js behavior.
- Follow strict TDD for every production behavior: write one failing test, run it and confirm the expected failure, implement the minimum change, then rerun.
- Every official vocabulary-table word from `IMG_3569.jpeg` and `IMG_3570.jpeg` must remain present.
- Every required character from `IMG_3568.jpeg` must be covered by at least one final dictation entry.
- Replace only 20%–40% of non-vocabulary-table writing-practice entries.
- Context sentences must be original, age-appropriate, contain exactly one `（　　）` blank, and never be sent to TTS.
- Listening responses may contain pinyin and blanked context but must not contain `answerText` or `broadcastText`.
- Audio generation continues to use only `broadcastText`, which must equal the target word for built-in Chinese cards.
- English sections use their textbook-native titles; do not force Chinese lesson naming onto English content.
- Do not deploy, migrate production, buy services, or enable external credentials in this plan.
- Preserve unrelated dirty-worktree files and changes; stage and commit only files listed in the active task.

---

### Task 1: Add textbook sections and card metadata to the database

**Files:**
- Modify: `src/modules/learning-content/schema.ts`
- Modify: `src/modules/learning-content/types.ts`
- Modify: `src/modules/learning-content/service.ts`
- Create: `drizzle/0019_textbook_sections_and_card_metadata.sql`
- Create: `drizzle/meta/0019_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Test: `tests/integration/learning-content.test.ts`

**Interfaces:**
- Produces `textbookSections` with `unitId`, `sectionKey`, `sectionOrder`, `title`, and `sectionType`.
- Extends `learningCards` with `sectionId`, `pinyinText`, `curriculumSource`, and `sourceOrder`.
- Extends `LearningCard` and `CreateCardInput` with nullable/optional equivalents.

- [ ] **Step 1: Write a failing integration test for section ordering and card metadata**

Add a test that inserts one edition, unit, and two sections, then creates a built-in Chinese card and verifies the database round-trip:

```ts
test("教材卡片保存小节、拼音、课程来源和原始顺序", async () => {
  const [section] = await tx.insert(textbookSections).values({
    unitId: unit.id,
    sectionKey: "lesson-1",
    sectionOrder: 1,
    title: "第1课",
    sectionType: "lesson",
  }).returning();
  const [card] = await tx.insert(learningCards).values({
    familyId: null,
    subject: "chinese",
    answerText: "桂花",
    broadcastText: "桂花",
    hintText: "院子里的（　　）散发着清香。",
    pinyinText: "guì huā",
    curriculumSource: "required_vocabulary",
    sourceOrder: 1,
    textbookEditionId: edition.id,
    unitId: unit.id,
    sectionId: section.id,
    source: "builtin",
    builtinKey: "cn-g5-v1-u1-l1-001",
  }).returning();
  expect(card).toMatchObject({
    pinyinText: "guì huā",
    curriculumSource: "required_vocabulary",
    sourceOrder: 1,
    sectionId: section.id,
  });
});
```

- [ ] **Step 2: Run the focused integration test and verify RED**

Run: `pnpm exec vitest run --config vitest.integration.config.ts tests/integration/learning-content.test.ts`

Expected: TypeScript/database failure because `textbookSections` and the new card columns do not exist.

- [ ] **Step 3: Define the schema and type contracts**

Implement the table and columns with these constraints:

```ts
export const textbookSections = pgTable("textbook_sections", {
  id: uuid("id").primaryKey().defaultRandom(),
  unitId: uuid("unit_id").notNull().references(() => textbookUnits.id, { onDelete: "cascade" }),
  sectionKey: text("section_key").notNull(),
  sectionOrder: integer("section_order").notNull(),
  title: text("title").notNull(),
  sectionType: text("section_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("textbook_sections_type_check", sql`${table.sectionType} in ('lesson', 'language_garden', 'other')`),
  unique("textbook_sections_unit_key_unique").on(table.unitId, table.sectionKey),
  unique("textbook_sections_unit_order_unique").on(table.unitId, table.sectionOrder),
]);
```

Add `sectionId`, `pinyinText`, `curriculumSource`, and `sourceOrder` to `learningCards`. Enforce `curriculumSource in ('required_vocabulary', 'writing_practice')` when non-null and make `sectionId` reference `textbookSections` with `onDelete: "set null"`.

- [ ] **Step 4: Generate and inspect the migration**

Run: `pnpm db:generate --name textbook_sections_and_card_metadata`

Expected: `drizzle/0019_textbook_sections_and_card_metadata.sql`, a matching snapshot, and one journal entry. Inspect the SQL to confirm it only creates `textbook_sections`, adds the four card columns, constraints, indexes, and foreign keys.

- [ ] **Step 5: Update service mappings and validation**

Extend `toLearningCard`, `createCardInputSchema`, `confirmedCardInputSchema`, and insert mappings. Manual/bulk/OCR cards may leave the new fields null; built-in seed import will require them later.

- [ ] **Step 6: Run the focused integration test and verify GREEN**

Run: `pnpm exec vitest run --config vitest.integration.config.ts tests/integration/learning-content.test.ts`

Expected: PASS with the card metadata round-trip and uniqueness constraints enforced.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/modules/learning-content/schema.ts src/modules/learning-content/types.ts src/modules/learning-content/service.ts tests/integration/learning-content.test.ts drizzle/0019_textbook_sections_and_card_metadata.sql drizzle/meta/0019_snapshot.json drizzle/meta/_journal.json
git commit -m "feat: add textbook sections and card metadata"
```

---

### Task 2: Define the nested seed contract and content audit

**Files:**
- Modify: `src/modules/learning-content/seed-validator.ts`
- Create: `src/modules/learning-content/content-audit.ts`
- Modify: `content/seed/schema.json`
- Create: `content/reference/chinese-grade5-volume1.json`
- Modify: `tests/unit/seed-validator.test.ts`
- Create: `tests/unit/content-audit.test.ts`

**Interfaces:**
- Produces `SeedSection`, `SeedCard`, and nested `SeedContent.units[].sections[]`.
- Produces `auditChineseSeed(content, requirements): ChineseContentAudit`.
- `ChineseContentAudit` contains literal arrays for missing vocabulary, uncovered characters, duplicate section answers, plus writing-practice counts and replacement ratio.

- [ ] **Step 1: Write failing validator tests for sections and Chinese metadata**

Add a valid literal fixture containing `第1课` and verify these invalid mutations fail independently: duplicate section order, missing pinyin, context without one `（　　）`, context containing the answer, unequal `broadcastText`, and `writing_practice` without `adaptation`.

```ts
const chineseCard = {
  answerText: "桂花",
  broadcastText: "桂花",
  pinyinText: "guì huā",
  hintText: "院子里的（　　）开了。",
  curriculumSource: "required_vocabulary",
  builtinKey: "cn-g5-v1-u1-l1-001",
};

test("内置语文词条拒绝朗读语境或在语境中泄露答案", () => {
  expect(() => validateSeedContent(seedWith({ ...chineseCard, broadcastText: chineseCard.hintText })))
    .toThrow();
  expect(() => validateSeedContent(seedWith({ ...chineseCard, hintText: "桂花开了。" })))
    .toThrow();
});
```

- [ ] **Step 2: Run the validator tests and verify RED**

Run: `pnpm exec vitest run tests/unit/seed-validator.test.ts`

Expected: FAIL because sections and the new card fields are not accepted or validated.

- [ ] **Step 3: Implement the nested Zod and JSON Schema contracts**

Use this seed shape:

```ts
type SeedCard = {
  answerText: string;
  broadcastText: string;
  pinyinText?: string;
  hintText?: string;
  curriculumSource?: "required_vocabulary" | "writing_practice";
  adaptation?: "retained" | "replaced";
  builtinKey: string;
};

type SeedSection = {
  key: string;
  order: number;
  title: string;
  type: "lesson" | "language_garden" | "other";
  cards: SeedCard[];
};
```

Require all Chinese cards to have `pinyinText`, `hintText`, and `curriculumSource`; require `adaptation` only for `writing_practice`; reject `adaptation` on required vocabulary cards.

- [ ] **Step 4: Write a failing audit test with hand-derived expectations**

Create a small requirements fixture with official words `桂花` and `故乡`, required characters `桂、花、故、乡、浇`, and a seed missing `故乡` and the character `浇`. Assert literal output:

```ts
expect(auditChineseSeed(seed, requirements)).toEqual({
  missingVocabulary: ["lesson-1:故乡"],
  uncoveredCharacters: ["lesson-2:浇"],
  duplicateSectionAnswers: [],
  writingPracticeCount: 2,
  replacedWritingPracticeCount: 1,
  replacementRatio: 0.5,
});
```

- [ ] **Step 5: Run the audit test and verify RED**

Run: `pnpm exec vitest run tests/unit/content-audit.test.ts`

Expected: FAIL because `auditChineseSeed` does not exist.

- [ ] **Step 6: Implement the audit and official-requirements schema**

Define `content/reference/chinese-grade5-volume1.json` as:

```json
{
  "requiredVocabulary": [{ "sectionKey": "lesson-1", "words": ["桂花", "故乡"] }],
  "requiredCharacters": [{ "sectionKey": "lesson-1", "characters": ["欣", "赏"] }]
}
```

The real file will be completed in Task 4. Compute coverage globally by Unicode character occurrence in final `answerText`; report the original section key in uncovered-character messages. Round only for display—return the exact numeric division from integer counts.

- [ ] **Step 7: Run validator and audit tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/seed-validator.test.ts tests/unit/content-audit.test.ts`

Expected: PASS for nested validation, answer secrecy, word-only broadcast, duplicates, coverage, and ratio math.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/modules/learning-content/seed-validator.ts src/modules/learning-content/content-audit.ts content/seed/schema.json content/reference/chinese-grade5-volume1.json tests/unit/seed-validator.test.ts tests/unit/content-audit.test.ts
git commit -m "feat: validate and audit textbook seed content"
```

---

### Task 3: Implement idempotent built-in seed import

**Files:**
- Create: `src/modules/learning-content/seed-service.ts`
- Modify: `scripts/seed-content.ts`
- Modify: `package.json`
- Create: `tests/integration/seed-content.test.ts`
- Modify: `tests/unit/seed-validator.test.ts`

**Interfaces:**
- Produces `applySeedContents(database, contents): Promise<SeedApplySummary[]>`.
- Produces CLI modes `pnpm seed:content --validate-only` and `pnpm seed:content --apply`.
- Upserts by edition identity, `(editionId, unitOrder)`, `(unitId, sectionKey)`, and `builtinKey`.

- [ ] **Step 1: Write a failing integration test for repeatable import**

Apply the same one-unit/two-card seed twice, then assert one edition, one unit, one section, two cards, updated pinyin/context on the second apply, and preservation of an unrelated built-in card:

```ts
const first = await applySeedContents(tx, [seed]);
const second = await applySeedContents(tx, [changedSeed]);
expect(first[0]).toMatchObject({ insertedCards: 2, updatedCards: 0 });
expect(second[0]).toMatchObject({ insertedCards: 0, updatedCards: 2 });
expect(await tx.select().from(learningCards).where(eq(learningCards.builtinKey, unrelatedKey)))
  .toHaveLength(1);
```

- [ ] **Step 2: Run the import test and verify RED**

Run: `pnpm exec vitest run --config vitest.integration.config.ts tests/integration/seed-content.test.ts`

Expected: FAIL because `seed-service.ts` and `applySeedContents` do not exist.

- [ ] **Step 3: Implement transactional upserts**

For each validated edition:

1. insert-or-select the edition identity;
2. upsert each unit title by edition/order;
3. upsert each section by unit/key and update order/title/type;
4. upsert cards by `builtinKey`, setting subject, answer, broadcast, hint, pinyin, curriculum source, source order, edition, unit, and section;
5. never delete a card absent from the incoming file;
6. return inserted/updated counts.

Keep the entire edition import inside one transaction so a rejected card cannot leave partial textbook structure.

- [ ] **Step 4: Expand the CLI without weakening validation-only mode**

Accept exactly one flag. Both modes load and validate all seed files; `--validate-only` prints summaries and performs no database writes, while `--apply` invokes `applySeedContents`. Add:

```json
"seed:content": "tsx scripts/seed-content.ts"
```

- [ ] **Step 5: Run the import test and CLI validator and verify GREEN**

Run:

```bash
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/seed-content.test.ts
pnpm seed:content --validate-only
```

Expected: integration PASS; CLI prints both textbook summaries and `validation: PASS` without connecting for writes.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/modules/learning-content/seed-service.ts scripts/seed-content.ts package.json tests/integration/seed-content.test.ts tests/unit/seed-validator.test.ts
git commit -m "feat: add idempotent textbook seed import"
```

---

### Task 4: Build and audit the complete Grade 5 Chinese seed

**Files:**
- Modify: `content/reference/chinese-grade5-volume1.json`
- Modify: `content/seed/chinese-grade5-volume1.json`
- Create: `docs/五年级语文上册词库审计报告.md`
- Modify: `docs/五年级语文上册词语听写-图片转录核对稿.md`
- Create: `tests/unit/chinese-grade5-content.test.ts`

**Interfaces:**
- Produces eight populated Chinese units with lesson/language-garden sections.
- Produces an executable audit test and a human-readable report derived from the same audit output.
- Every card has stable key `cn-g5-v1-u{unit}-{sectionKey}-{NNN}` and array order equal to `sourceOrder` during import.

- [ ] **Step 1: Transcribe the official requirements into the reference JSON**

Enter every word from `IMG_3569.jpeg` and `IMG_3570.jpeg` grouped by section key, and every character from `IMG_3568.jpeg` grouped by its printed lesson or language-garden section. Double-enter totals independently: one count from the image rows and one count from parsed JSON; reconcile before continuing.

- [ ] **Step 2: Write a failing full-content test**

Load the real seed and requirements JSON through `validateSeedContent` and `auditChineseSeed`, then assert behavior rather than source text:

```ts
expect(audit.missingVocabulary).toEqual([]);
expect(audit.uncoveredCharacters).toEqual([]);
expect(audit.duplicateSectionAnswers).toEqual([]);
expect(audit.writingPracticeCount).toBeGreaterThan(0);
expect(audit.replacementRatio).toBeGreaterThanOrEqual(0.2);
expect(audit.replacementRatio).toBeLessThanOrEqual(0.4);
for (const card of chinese.units.flatMap((unit) => unit.sections.flatMap((section) => section.cards))) {
  expect(card.broadcastText).toBe(card.answerText);
  expect(card.pinyinText).toMatch(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüa-z]/u);
  expect(card.hintText.match(/（　　）/gu)).toHaveLength(1);
  expect(card.hintText).not.toContain(card.answerText);
}
```

- [ ] **Step 3: Run the content test and verify RED**

Run: `pnpm exec vitest run tests/unit/chinese-grade5-content.test.ts`

Expected: FAIL because the Chinese seed still has no units/cards and the requirements are incomplete.

- [ ] **Step 4: Reconcile the existing 289-entry working draft**

For each draft entry:

1. match exact official vocabulary and mark it `required_vocabulary`;
2. classify the remaining entry as `writing_practice` only when it covers at least one required character;
3. remove accidental transcription errors from the working set;
4. preserve confirmed corrections including `皱纹（zhòu wén）`, `笙箫管笛（shēng xiāo guǎn dí）`, and the four confirmed tone-sandhi spellings;
5. keep section and source order from the images.

- [ ] **Step 5: Replace 20%–40% of writing-practice entries one-for-one**

Choose common Grade 5 words that preserve required-character coverage. Mark unchanged helper entries `adaptation: "retained"` and changed entries `adaptation: "replaced"`. Re-run the audit after every unit; do not solve a coverage gap by altering a required vocabulary word.

- [ ] **Step 6: Write original blanked contexts for every final card**

Use one short sentence per card, put exactly one `（　　）` where the target belongs, avoid the target elsewhere in the sentence, and ensure the sentence selects the intended meaning of polyphonic words. Set `broadcastText` to the target only.

- [ ] **Step 7: Run the content test and seed validator and verify GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/chinese-grade5-content.test.ts tests/unit/content-audit.test.ts tests/unit/seed-validator.test.ts
pnpm seed:content --validate-only
```

Expected: zero missing official words, zero uncovered required characters, zero duplicate section answers, and replacement ratio within 0.20–0.40.

- [ ] **Step 8: Generate the audit report from the verified result**

Record per-unit card totals, required-vocabulary totals, writing-practice totals, replaced count, exact ratio, missing words, uncovered characters, duplicate answers, and the validation commands/output. Do not copy textbook-helper prose into the report.

- [ ] **Step 9: Commit Task 4**

```bash
git add content/reference/chinese-grade5-volume1.json content/seed/chinese-grade5-volume1.json docs/五年级语文上册词库审计报告.md docs/五年级语文上册词语听写-图片转录核对稿.md tests/unit/chinese-grade5-content.test.ts
git commit -m "content: add verified grade five Chinese dictation library"
```

---

### Task 5: Add subject, unit, and textbook-section filtering

**Files:**
- Modify: `src/modules/dictation/task-card-filter.ts`
- Modify: `src/modules/dictation/task-builder-query.ts`
- Modify: `src/app/(parent)/parent/tasks/new/task-builder-form.tsx`
- Modify: `tests/unit/task-card-filter.test.ts`
- Modify: `tests/unit/task-builder-form.test.tsx`
- Modify: `tests/integration/task-planner.test.ts`

**Interfaces:**
- Extends `TaskCardOption` with `unitOrder`, `sectionId`, `sectionTitle`, and `sectionOrder`.
- Extends `TaskCardFilters` with `subject`, `unitId`, and `sectionId`.
- Query ordering becomes subject, edition, unit order, section order, card source order.

- [ ] **Step 1: Write failing pure-filter tests**

Use literal Chinese and English cards across two units and sections. Assert:

```ts
expect(filterTaskCardOptions(cards, {
  childId,
  sourceView: "textbook",
  subject: "chinese",
  unitId: chineseUnitId,
  sectionId: chineseLessonId,
  query: "",
}).map((card) => card.answerText)).toEqual(["桂花"]);
```

Also assert changing to English returns only English cards and that `sectionId: "all"` returns every section in the selected unit.

- [ ] **Step 2: Run the filter test and verify RED**

Run: `pnpm exec vitest run tests/unit/task-card-filter.test.ts`

Expected: FAIL because subject and section filters/fields do not exist.

- [ ] **Step 3: Extend query data and stable ordering**

Join `textbookSections` and project section metadata. Order built-in cards by textbook identity, unit order, section order, and `learningCards.sourceOrder`; leave custom cards after textbook cards using the existing source grouping.

- [ ] **Step 4: Implement the pure filters and verify GREEN**

Run: `pnpm exec vitest run tests/unit/task-card-filter.test.ts && pnpm exec vitest run --config vitest.integration.config.ts tests/integration/task-planner.test.ts`

Expected: PASS for subject/unit/section filtering and database ordering.

- [ ] **Step 5: Write a failing TaskBuilderForm interaction test**

Extend the existing hook-state harness with subject and section state. Render options and invoke the select handlers. Assert a subject change sets subject, resets unit and section to `"all"`, and clears selected card IDs; assert a unit change resets section and selected cards.

- [ ] **Step 6: Run the form test and verify RED**

Run: `pnpm exec vitest run tests/unit/task-builder-form.test.tsx`

Expected: FAIL because the subject and textbook-section controls are absent.

- [ ] **Step 7: Implement the cascading controls**

Add labelled selects in this order:

```tsx
<select aria-label="科目" value={subject} ...>
  <option value="chinese">语文</option>
  <option value="english">英语</option>
</select>
<select aria-label="教材单元" value={unitId} ... />
<select aria-label="课次或教材小节" value={sectionId} ... />
```

For Chinese, display section titles such as `第1课` and `语文园地一`; for English, display stored textbook-native titles. Each card label must include subject, unit title, and section title.

- [ ] **Step 8: Run form, filter, and planner tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/task-builder-form.test.tsx tests/unit/task-card-filter.test.ts && pnpm exec vitest run --config vitest.integration.config.ts tests/integration/task-planner.test.ts`

Expected: all focused tests PASS.

- [ ] **Step 9: Commit Task 5**

```bash
git add src/modules/dictation/task-card-filter.ts src/modules/dictation/task-builder-query.ts 'src/app/(parent)/parent/tasks/new/task-builder-form.tsx' tests/unit/task-card-filter.test.ts tests/unit/task-builder-form.test.tsx tests/integration/task-planner.test.ts
git commit -m "feat: filter dictation cards by subject unit and section"
```

---

### Task 6: Safely expose pinyin and context during listening

**Files:**
- Modify: `src/modules/dictation/child-view-types.ts`
- Modify: `src/modules/dictation/child-view-service.ts`
- Modify: `tests/integration/child-dictation-view.test.ts`
- Modify: `tests/unit/child-dictation-api.test.ts`
- Modify: `tests/unit/child-isolation.test.ts`

**Interfaces:**
- Extends listening items with `pinyinText: string | null` and `contextText: string | null`.
- Keeps grading items unchanged with `answerText` available only after listening.

- [ ] **Step 1: Write a failing integration test for safe listening projection**

Create a card with answer `桂花`, pinyin `guì huā`, context `院子里的（　　）开了。`, and broadcast `桂花`. Assert the listening view equals:

```ts
expect(view.items[0]).toEqual({
  itemId,
  position: 0,
  audioUrl: `/api/private-media/${mediaId}`,
  pinyinText: "guì huā",
  contextText: "院子里的（　　）开了。",
});
expect(JSON.stringify(view)).not.toMatch(/桂花|answerText|broadcastText/);
```

- [ ] **Step 2: Run the child-view tests and verify RED**

Run: `pnpm exec vitest run --config vitest.integration.config.ts tests/integration/child-dictation-view.test.ts`

Expected: FAIL because listening items do not include pinyin/context.

- [ ] **Step 3: Extend the listening schema and query projection**

Join `learningCards` in the listening query using the already scoped `dictationSessionItems.cardId`. Select only `pinyinText` and `hintText`; map `hintText` to `contextText`. Do not select answer or broadcast columns in the listening branch.

- [ ] **Step 4: Strengthen API and isolation tests**

Update the unit listening fixture to include the two new fields. Assert serialized listening JSON contains the pinyin/context but not the answer, broadcast, or a secret-answer sentinel. Keep source-projection isolation checks so future refactors cannot select forbidden columns.

- [ ] **Step 5: Run child-view, API, and isolation tests and verify GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/child-dictation-api.test.ts tests/unit/child-isolation.test.ts
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/child-dictation-view.test.ts
```

Expected: PASS; pinyin/context are visible and answers remain absent during listening.

- [ ] **Step 6: Commit Task 6**

```bash
git add src/modules/dictation/child-view-types.ts src/modules/dictation/child-view-service.ts tests/integration/child-dictation-view.test.ts tests/unit/child-dictation-api.test.ts tests/unit/child-isolation.test.ts
git commit -m "feat: show safe context metadata during dictation"
```

---

### Task 7: Present pinyin/context and verify replay and pause behavior

**Files:**
- Modify: `src/components/dictation/audio-sequence.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/unit/audio-sequence.test.ts`
- Modify: `e2e/dictation.spec.ts`

**Interfaces:**
- `AudioSequence` presents the current listening item's `pinyinText` and `contextText`.
- The visible audio block reuses the current private-media URL and existing replay command semantics.
- Pause/resume remains local playback control and does not create an extra completed-play event.

- [ ] **Step 1: Add a failing E2E expectation for safe learning cues**

Update the E2E fixture card with pinyin/context, then after entering the session assert:

```ts
await expect(childPage.getByText("guì huā", { exact: true })).toBeVisible();
await expect(childPage.getByText("语境：院子里的（　　）开了。", { exact: true })).toBeVisible();
await expect(childPage.getByText("桂花", { exact: true })).toHaveCount(0);
```

Expected production change caught: removing safe cues or leaking the answer makes the test fail.

- [ ] **Step 2: Run the focused E2E test and verify RED**

Run: `pnpm test:e2e -- e2e/dictation.spec.ts --grep "连续听写"`

Expected: FAIL because pinyin and context are not rendered.

- [ ] **Step 3: Render the current cue card**

Before the action controls, render a stable region for the current item:

```tsx
<div className="dictation-cue" aria-live="polite">
  {currentItem.pinyinText ? <p className="dictation-pinyin">{currentItem.pinyinText}</p> : null}
  {currentItem.contextText ? <p>💡 语境：{currentItem.contextText}</p> : null}
</div>
```

Derive `currentItem` from the active local playback index, not from answer data. Never render `answerText` in this component.

- [ ] **Step 4: Make replay a visible audio block without changing server facts**

Style the existing manual-replay action as a circular play block labelled `重听当前词语`. It may call `replayCurrent`, but must still record replay through the existing `onPlayback(itemId, false, version)` path. Disable it while a save is pending or before the current word has completed its first playback.

- [ ] **Step 5: Expand audio helper tests for pause-safe primitives**

Keep `playAudioToEnd` tests against a real event-emitting fake audio element. Add assertions that abort pauses audio exactly once and removes listeners, and that replay rejection returns `AUDIO_PLAY_FAILED`. These protect the primitive used by both auto-play and replay without asserting on a mock component.

- [ ] **Step 6: Extend E2E pause coverage**

Instrument `HTMLMediaElement.play/pause` as the existing E2E fixture already does. Assert:

1. clicking `暂停` during playback increments pause observations and shows `继续`;
2. no additional playback completion command is sent while paused;
3. clicking `继续` resumes the same element;
4. pausing during the word interval prevents the next audio play until continued;
5. `重听当前词语` adds one replay without moving to the next item.

- [ ] **Step 7: Run unit and E2E tests and verify GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/audio-sequence.test.ts
pnpm test:e2e -- e2e/dictation.spec.ts --grep "连续听写"
```

Expected: cue rendering, answer secrecy, repeat playback, playback pause, interval pause, and resume all PASS.

- [ ] **Step 8: Commit Task 7**

```bash
git add src/components/dictation/audio-sequence.tsx src/app/globals.css tests/unit/audio-sequence.test.ts e2e/dictation.spec.ts
git commit -m "feat: add dictation cues replay and pause coverage"
```

---

### Task 8: Run the complete verification and document the result

**Files:**
- Modify: `docs/五年级语文上册词库审计报告.md`
- Modify only if facts changed: `docs/PROJECT_STATUS.md`

**Interfaces:**
- Produces a final evidence record for content completeness and application verification.
- Does not deploy or apply production migrations.

- [ ] **Step 1: Validate seed and audit results from scratch**

Run:

```bash
pnpm seed:content --validate-only
pnpm exec vitest run tests/unit/chinese-grade5-content.test.ts tests/unit/content-audit.test.ts tests/unit/seed-validator.test.ts
```

Expected: both textbook files validate; Chinese audit reports zero missing words, zero uncovered characters, zero duplicates, and replacement ratio 0.20–0.40.

- [ ] **Step 2: Run all unit tests**

Run: `pnpm test`

Expected: all unit tests PASS with zero failures.

- [ ] **Step 3: Run all integration tests against the isolated test database**

Run: `pnpm test:integration`

Expected: all integration tests PASS; no production database is used.

- [ ] **Step 4: Run type and lint checks**

Run:

```bash
pnpm typecheck
pnpm lint
```

Expected: both commands exit 0 without TypeScript or ESLint errors.

- [ ] **Step 5: Run the production build**

Run: `pnpm build`

Expected: Next.js build exits 0. Record any non-failing dynamic filesystem tracing warning separately; do not describe a warned build as clean.

- [ ] **Step 6: Run the complete dictation browser test**

Run: `pnpm test:e2e -- e2e/dictation.spec.ts`

Expected: the full dictation lifecycle, cues, replay, pause/resume, refresh recovery, grading, and wrong-answer loop PASS.

- [ ] **Step 7: Update the audit report with exact fresh evidence**

Record command names, test counts, exit results, content audit counts, replacement ratio, and any remaining external dependency such as unavailable production TTS credentials. Do not claim real audio generation or deployment unless separately verified.

- [ ] **Step 8: Inspect the final diff and dirty worktree**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD
```

Confirm no unrelated `.DS_Store`, `.pnpm-store`, existing roadmap edits, or other user files are staged.

- [ ] **Step 9: Commit Task 8 documentation only**

```bash
git add docs/五年级语文上册词库审计报告.md
git commit -m "docs: record dictation content verification"
```

If `docs/PROJECT_STATUS.md` was updated with fresh verified facts, stage it explicitly in the same commit; otherwise leave the existing untracked/modified file untouched.
