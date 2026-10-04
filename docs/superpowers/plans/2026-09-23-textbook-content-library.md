# Textbook-First Dictation Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dense flat card wall with an accessible textbook → unit → lesson/garden → words browser, while keeping family-owned content easy to find.

**Architecture:** Query the existing textbook catalog and family-visible learning cards, group them in a pure function with explicit order/count rules, and render nested native disclosure controls. Keep the page server-rendered; no new persistence, client state store, or card mutation API is required.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle/PostgreSQL, Vitest, Playwright, CSS.

**Spec:** `docs/superpowers/specs/2026-09-23-dictation-evidence-todo-library-design.md`

## Global Constraints

- Default view shows textbook summaries, not all words; expanding a textbook shows units, expanding a unit shows lessons/gardens, expanding a lesson shows its word list.
- Preserve every visible built-in word and family-owned card. Cards with incomplete textbook placement must appear in an explicit “教材未分课” group, not disappear.
- Keep “我的自建内容” separate by subject. Empty English/textbooks get honest empty states; do not fabricate English content.
- Use existing catalog and card tables; no database migration. Keep keyboard focus, responsive layout, and clear counts.
- Before code edits, follow `AGENTS.md` and relevant Next.js 16 docs in `node_modules/next/dist/docs/`. Do not deploy without Tom's separate confirmation.

## File Map

- `src/modules/learning-content/library-tree.ts`: pure grouping, order, totals, and missing-placement handling.
- `src/modules/learning-content/service.ts`: one authorized `listContentLibrary(actor)` service method gathering catalog and cards.
- `src/components/content/content-library-tree.tsx`: native `<details>` display for教材/单元/课次 and an undense word list.
- `src/app/(parent)/parent/tasks/content/page.tsx`: use library data instead of `listCards` flat card list.
- `src/app/globals.css`: disclosure/list and small-screen styles.
- `tests/unit/content-library-tree.test.ts`, `tests/integration/learning-content.test.ts`, `e2e/curriculum-batch.spec.ts`: exact order, counts, scope, empty state, and browser behavior.

### Task 1: Build a complete, correctly ordered library tree

**Files:** Create `src/modules/learning-content/library-tree.ts`, `tests/unit/content-library-tree.test.ts`; modify `src/modules/learning-content/service.ts`, `tests/integration/learning-content.test.ts`.

**Interfaces:** Consumes `LearningCard[]` from existing `listCards(actor,{})` and catalog rows from `textbookEditions`, `textbookUnits`, `textbookSections`. Produces:

```ts
type LibrarySection = { id: string; title: string; order: number; cards: LearningCard[] };
type LibraryUnit = { id: string; title: string; order: number; sections: LibrarySection[]; unplaced: LearningCard[]; count: number };
type LibraryEdition = { id: string; label: string; subject: Subject; grade: number; volume: string; units: LibraryUnit[]; unplaced: LearningCard[]; count: number };
type ContentLibrary = { editions: LibraryEdition[]; personal: Record<Subject, LearningCard[]>; total: number };
function buildContentLibrary(catalog: CatalogEdition[], cards: LearningCard[]): ContentLibrary;
function createLearningContentService(database).listContentLibrary(actor: GuardianActor): Promise<ContentLibrary>;
```

`CatalogEdition` is defined in `library-tree.ts` as `{ id, publisher, series, editionText, subject, grade, volume, units: { id, title, order, sections: { id, title, order }[] }[] }`.

- [ ] **Step 1: Write failing pure tests with literal expectations.** Fixture: one Chinese fifth-grade volume with two units and three sections; pass cards in reverse creation order: `桂花` at lesson 1 order 2, `故乡` at lesson 1 order 1, `花生` at lesson 2, one edition-only card, one family manual English card. Assert top-level total 5, textbook count 4, unit count 3, lesson 1 words `['故乡','桂花']`, edition-only card under `unplaced`, and English personal group `['hello']`. Add empty-catalog test with empty English list and personal Chinese card.

```ts
expect(tree.editions[0]!.units[0]!.sections[0]!.cards.map(c => c.answerText)).toEqual(["故乡", "桂花"]);
expect(tree.editions[0]!.count).toBe(4);
expect(tree.personal.english.map(c => c.answerText)).toEqual(["hello"]);
```

- [ ] **Step 2: Observe RED.** Run `pnpm exec vitest run tests/unit/content-library-tree.test.ts`; expected: the module/function does not yet exist.

- [ ] **Step 3: Implement pure grouping.** Sort editions by subject/grade/volume/publisher, units by `order`, sections by `order`, and cards by `sourceOrder ?? Number.MAX_SAFE_INTEGER` then `answerText`/id. Count actual cards, not declared catalog slots. Place a card only when its edition, unit, and section IDs form a valid catalog path; otherwise use the nearest edition/unit `unplaced` group, or the `personal[subject]` group if it has no valid edition. Never mutate the input arrays. Add `listContentLibrary` to the existing service: read catalog rows ordered by edition/unit/section using Drizzle joins, reuse `listCards(actor,{})` for family-visible cards, construct `CatalogEdition[]`, and call `buildContentLibrary`.

```ts
const compareCards = (a: LearningCard, b: LearningCard) =>
  (a.sourceOrder ?? Number.MAX_SAFE_INTEGER) - (b.sourceOrder ?? Number.MAX_SAFE_INTEGER)
  || a.answerText.localeCompare(b.answerText) || a.id.localeCompare(b.id);
const editionsById = new Map(editions.map(edition => [edition.id, edition]));
for (const card of cards) {
  const edition = editionsById.get(card.textbookEditionId ?? "");
  const unit = edition?.units.find(item => item.id === card.unitId);
  const section = unit?.sections.find(item => item.id === card.sectionId);
  if (section) section.cards.push(card);
  else if (unit) unit.unplaced.push(card);
  else if (edition) edition.unplaced.push(card);
  else personal[card.subject].push(card);
}
for (const edition of editions) {
  for (const unit of edition.units) {
    for (const section of unit.sections) section.cards.sort(compareCards);
    unit.count = unit.unplaced.length + unit.sections.reduce((n, section) => n + section.cards.length, 0);
  }
  edition.count = edition.unplaced.length + edition.units.reduce((n, unit) => n + unit.count, 0);
}
personal.chinese.sort(compareCards);
personal.english.sort(compareCards);
```

- [ ] **Step 4: Add and pass integration coverage.** In `learning-content.test.ts`, insert a small catalog with one builtin card and two family-owned cards from different families. Assert the requesting actor sees the builtin plus only their own card, with correct counts and no cross-family title. Run focused unit/integration tests and `pnpm typecheck`; commit Task 1 files with message `Group dictation library by textbook structure`.

### Task 2: Render the textbook-first browser

**Files:** Create `src/components/content/content-library-tree.tsx`; modify `src/app/(parent)/parent/tasks/content/page.tsx`, `src/app/globals.css`, `e2e/curriculum-batch.spec.ts`.

**Interfaces:** Consumes `ContentLibrary` from Task 1. Produces a server-rendered `ContentLibraryTree` with native `<details>`/`<summary>`; no default-open textbook, unit, or section and no flat `.card-list` on the library page.

- [ ] **Step 1: Write failing browser expectations.** Reuse the existing parent/catalog fixture in `e2e/curriculum-batch.spec.ts`. After the parent account is created but before inserting the fixture textbook, open `/parent/tasks/content` and assert “还没有听写内容”. Then insert the fixture textbook, reopen the page, assert the test textbook summary and “1 个单元 · 2 个词” are visible while `桂花` is hidden; click textbook summary, then unit summary, then lesson summary; assert `桂花` and its lesson label become visible in that order. Assert `article.card-row` has count zero.

```ts
await page.goto("/parent/tasks/content");
await expect(page.getByText("桂花", { exact: true })).toBeHidden();
await page.locator("details.library-edition > summary").filter({ hasText: "测试版" }).click();
await page.locator("details.library-unit > summary").first().click();
await page.locator("details.library-section > summary").first().click();
await expect(page.getByText("桂花", { exact: true })).toBeVisible();
```

- [ ] **Step 2: Observe RED.** Run the focused Chromium E2E using the isolated `E2E_DATABASE_URL`; expected: current flat card page exposes `桂花` immediately and has no library disclosure controls.

- [ ] **Step 3: Implement the page and display.** Replace `listCards(actor,{})` with `createLearningContentService().listContentLibrary(actor)` in the page. `ContentLibraryTree` renders textbook summaries with subject/grade/volume/publisher/edition label and unit/word totals; nested unit and section summaries carry exact counts; a section contains a simple `<ul>` of words, with pinyin and context as secondary text. Render both edition- and unit-level `unplaced` under “教材未分课” at their nearest valid level, and personal Chinese/English groups under “我的自建内容”. Empty data renders “还没有听写内容”; empty English catalog says “英语教材词库尚未导入”. Keep the existing “添加听写内容库” link. CSS styles indentation, boundaries, `:focus-visible`, disclosure marker, and narrow-screen wrapping; do not style each word as a card.

```tsx
<details className="library-edition">
  <summary>{edition.label}<span>{edition.units.length} 个单元 · {edition.count} 个词</span></summary>
  {edition.units.map(unit => <details className="library-unit" key={unit.id}>
    <summary>{unit.title}<span>{unit.sections.length} 课 · {unit.count} 个词</span></summary>
    {unit.sections.map(section => <details className="library-section" key={section.id}>
      <summary>{section.title}<span>{section.cards.length} 个词</span></summary>
      <ul>{section.cards.map(card => <li key={card.id}>{card.answerText}</li>)}</ul>
    </details>)}
  </details>)}
</details>
```

- [ ] **Step 4: Observe GREEN and commit.** Run focused Chromium/WebKit E2E, unit/integration tests, lint, typecheck, and build; commit Task 2 files with message `Browse dictation content by textbook and lesson`.

### Task 3: Full verification and handoff

**Files:** Only targeted fixes if verification reveals a defect; preserve unrelated files.

**Interfaces:** Consumes Tasks 1-2. Produces a clean local branch and evidence for review. This plan does not authorize GitHub push or production deployment.

- [ ] **Step 1: Run the full suite.** Against dedicated test databases run `pnpm test`, `pnpm test:integration`, `pnpm exec playwright test --workers=2`, `pnpm lint`, `pnpm typecheck`, `pnpm build`. Record actual counts and warnings; restore Next-generated test-directory churn only with `apply_patch`.
- [ ] **Step 2: Review the diff.** Use `git diff --check`, `git status --short`, and compare tree output with all 312 builtin cards to ensure no word is hidden or dropped; test keyboard disclosure and a mobile viewport in Playwright.
- [ ] **Step 3: Commit only test-driven corrections.** Report changed files, test evidence, and remaining manual device checks. Ask Tom separately before pushing or deploying.
