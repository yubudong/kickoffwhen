# Optional Dictation Evidence and Manual Todo Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a child explicitly submit completed dictation with an optional photo, and let a parent edit or withdraw mistaken manual todos without damaging review or point history.

**Architecture:** Keep dictation learning completion separate from the linked todo submission. Reuse the existing `/api/child/todos` upload/review pipeline, add completed-session todo metadata for a direct completion-page form, and add guarded manual-todo mutations in the existing parent todo service/API.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle/PostgreSQL, Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-23-dictation-evidence-todo-library-design.md`

## Global Constraints

- A completed dictation photo is optional: zero or one JPG/PNG/WebP, maximum 8 MB; no OCR, audio, or video for dictation evidence.
- Preserve already submitted/approved/rejected dictation todos, existing reviews, rewards, attachments, and family/child authorization boundaries.
- A manual todo can be edited only while `open`; it can be withdrawn while `open`, `submitted`, or `rejected` if no reward exists; never hard-delete or reassign its child.
- Reuse current tables and protected media volume; no database migration is expected. No production deployment or real-account mutation without Tom's separate confirmation.
- Before code edits, follow `AGENTS.md` and read the relevant Next.js 16 guides in `node_modules/next/dist/docs/`.

## File Map

- `src/modules/todos/dictation.ts`: create dictation todo wording; remove auto-submission helper after callers/tests move.
- `src/modules/dictation/session-service.ts`: keep learning completion atomic, but leave linked todo open.
- `src/modules/todos/service.ts`, `validation.ts`, `http.ts`: child evidence policy and parent manual edit/withdraw transactions/API dispatch.
- `src/modules/dictation/child-view-types.ts`, `child-view-service.ts`: completed-session submission metadata, authorized by child/family.
- `src/components/dictation/dictation-evidence-submit.tsx`: one optional-photo submit form shared by completed session and child todo list.
- `src/components/dictation/dictation-experience.tsx`, `src/components/todos/todo-board.tsx`: completion and list states; parent edit/withdraw controls.
- Existing `tests/integration/dictation-session.test.ts`, `tests/integration/child-dictation-view.test.ts`, `tests/integration/todos.test.ts`, `tests/unit/todos.test.ts`, and `e2e/dictation.spec.ts`: regression coverage.

### Task 1: Separate dictation completion from todo submission

**Files:** Modify `src/modules/todos/dictation.ts`, `src/modules/dictation/session-service.ts`, `src/modules/todos/service.ts`, `tests/integration/dictation-session.test.ts`, `tests/integration/todos.test.ts`.

**Interfaces:** Consumes `createTodoService.submit(actor, id, number, attachment?)` and `learningTasks.status`. Produces a completed learning task whose linked `todo_tasks.status` remains `open` until explicit child submit; `submit` accepts zero or one image attachment for dictation.

- [ ] **Step 1: Write failing integration assertions.** In the existing completion test, replace the auto-submitted assertion with:

```ts
expect(todo).toMatchObject({ status: "open", submissionNumber: 0 });
expect(await tx.select().from(todoSubmissions).where(eq(todoSubmissions.todoId, todo.id))).toHaveLength(0);
await createTodoService(tx).submit(family.actor, todo.id, 0);
expect((await tx.select().from(todoTasks).where(eq(todoTasks.id, todo.id)))[0]!.status).toBe("submitted");
```

Add a `todos.test.ts` case where a completed dictation todo accepts `undefined` and `image/png` attachments but rejects `{ id, mimeType: "audio/mpeg", byteSize: 100 }` with `DICTATION_IMAGE_ONLY`; a non-completed dictation still throws `DICTATION_INCOMPLETE`. Use real rows and an authorized child actor, not a mocked service.

- [ ] **Step 2: Observe RED.** Run the two integration files against a dedicated local test database:

```bash
DATABASE_URL=postgres://app:app@127.0.0.1:55432/grade5_dictation_fresh_0923_test pnpm exec vitest run --config vitest.integration.config.ts tests/integration/dictation-session.test.ts tests/integration/todos.test.ts
```

Expected: current auto-submission makes `status === "open"` fail; current submit accepts the audio metadata.

- [ ] **Step 3: Implement only this contract.** Remove the `submitDictationTodo(tx, session.taskId, at)` call/import from the `completed` branch in `session-service.ts`. In `createTodoService.submit`, after checking the linked `learningTasks.status`, enforce:

```ts
if (attachment && !["image/jpeg", "image/png", "image/webp"].includes(attachment.mimeType)) {
  throw new Error("DICTATION_IMAGE_ONLY");
}
```

Leave the common submission insert/update unchanged; update `addDictationTodo` requirements to explain optional photo and explicit submission. Remove unused `submitDictationTodo` only after `rg` confirms no remaining caller.

- [ ] **Step 4: Observe GREEN and commit.** Run the focused integration files and `pnpm typecheck`; commit only Task 1 files with message `Separate dictation completion from todo submission`.

### Task 2: Expose authorized submission state on completed sessions

**Files:** Modify `src/modules/dictation/child-view-types.ts`, `src/modules/dictation/child-view-service.ts`, `tests/integration/child-dictation-view.test.ts`, `tests/unit/child-dictation-api.test.ts`.

**Interfaces:** Consumes completed `dictationSessions` and linked `todoTasks`. Produces `completedSessionViewSchema` with `todoSubmission: { id: string; date: string; number: number; status: "open" | "submitted" | "approved" | "rejected" | "cancelled" } | null`; listening/grading views remain unchanged.

- [ ] **Step 1: Write failing tests.** Extend the completed-session fixture to assert a same-family linked todo yields exact `id`, `date`, `number`, and `status`, while a legacy task without a linked todo yields `null`. Keep existing answer-leak assertions and assert `JSON.stringify(completedView)` contains neither `answerText` nor `broadcastText`.

```ts
expect(completed.todoSubmission).toEqual({
  id: todo.id, date: "2026-09-23", number: 0, status: "open",
});
expect(JSON.stringify(completed)).not.toContain("answerText");
```

- [ ] **Step 2: Observe RED.** Run:

```bash
DATABASE_URL=postgres://app:app@127.0.0.1:55432/grade5_dictation_fresh_0923_test pnpm exec vitest run --config vitest.integration.config.ts tests/integration/child-dictation-view.test.ts
```

Expected: `todoSubmission` is absent.

- [ ] **Step 3: Implement the narrow projection.** Add a strict `todoSubmission` schema to `completedSessionViewSchema`. In `getSession`, only inside `snapshot.phase === "completed"`, query `todoTasks` by `dictationTaskId`, `familyId`, and `childId`; project only `id`, `date`, `submissionNumber`, `status`. Parse status with Zod and return `todoSubmission: row ? { id, date, number: submissionNumber, status } : null`. Do not add this field to listening or grading views.

```ts
const todoStatusSchema = z.enum(["open", "submitted", "approved", "rejected", "cancelled"]);
const [todo] = await database.select({ id: todoTasks.id, date: todoTasks.date,
  number: todoTasks.submissionNumber, status: todoTasks.status })
  .from(todoTasks).where(and(eq(todoTasks.dictationTaskId, row.task.id),
    eq(todoTasks.familyId, actor.familyId), eq(todoTasks.childId, actor.childId))).limit(1);
return childSessionViewSchema.parse({ ...base, phase: "completed", items: [],
  todoSubmission: todo ? { ...todo, status: todoStatusSchema.parse(todo.status) } : null });
```

- [ ] **Step 4: Observe GREEN and commit.** Run focused integration/unit tests and `pnpm typecheck`; commit Task 2 files with message `Expose completed dictation submission state`.

### Task 3: Give children an optional-photo submit entry in both places

**Files:** Create `src/components/dictation/dictation-evidence-submit.tsx`; modify `src/components/dictation/dictation-experience.tsx`, `src/components/todos/todo-board.tsx`, `src/modules/todos/http.ts`, `src/app/globals.css`, `e2e/dictation.spec.ts`.

**Interfaces:** Consumes Task 2 `todoSubmission` and existing `POST /api/child/todos` FormData fields `id`, `date`, `number`, optional `file`. Produces one accessible form and `onSubmitted?: () => void`; current `TodoBoard` uses it when `kind === "dictation"`, linked session is completed, and todo is `open` or `rejected`.

- [ ] **Step 1: Write failing browser/API checks.** Extend the existing dictation E2E after final grading: expect “听写已完成，待提交” and “上传照片（可选）”; submit once with no file, then assert child “等待家长审核” and parent review available. Add a separate E2E test using `setInputFiles({ name: "dictation.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X6uoAAAAASUVORK5CYII=", "base64") })`; assert the authorized parent can open its evidence. Add a route test that a dictation audio file returns 409 and does not create a submission or leave an orphaned file.

```ts
await expect(childPage.getByText("听写已完成，待提交")).toBeVisible();
await childPage.getByRole("button", { name: "提交家长审核" }).click();
await expect(childPage.getByText("等待家长审核")).toBeVisible();
```

- [ ] **Step 2: Observe RED.** Run the focused Chromium E2E with `E2E_DATABASE_URL` pointed at the isolated test database. Expected: the completion page has no submit form and auto-submits.

- [ ] **Step 3: Implement form and server guard.** `DictationEvidenceSubmit` renders a file input with `accept="image/jpeg,image/png,image/webp"`, `capture="environment"` where supported, and a submit button that remains enabled without a file; it builds FormData with the exact fields above, blocks double submit, shows a live error, and calls `onSubmitted` after success. Render it in completed `DictationExperience` for `open`/`rejected`; show read-only status for `submitted`/`approved`. In `TodoBoard`, when completed session + open/rejected todo, render the same component instead of “开始听写”; keep the existing generic `TodoSubmission` for manual todos. In `http.ts`, map `DICTATION_IMAGE_ONLY` to a clear image-only message and retain saved-file cleanup on service failure.

```tsx
const formData = new FormData(form);
formData.set("id", todo.id);
formData.set("date", todo.date);
formData.set("number", String(todo.number));
const response = await fetch("/api/child/todos", { method: "POST", body: formData });
if (!response.ok) throw new Error((await response.json()).error ?? "提交失败，请重试。");
onSubmitted?.();
```

- [ ] **Step 4: Observe GREEN and commit.** Run the focused E2E in Chromium and WebKit, then focused unit/integration tests, lint, and typecheck; commit Task 3 files with message `Add optional photo submission after dictation`.

### Task 4: Guard manual todo editing and soft withdrawal

**Files:** Modify `src/modules/todos/validation.ts`, `src/modules/todos/service.ts`, `src/modules/todos/http.ts`, `tests/integration/todos.test.ts`, `tests/unit/todos.test.ts`.

**Interfaces:** Produces `createTodoService.updateManual(actor, id, input)` where input has `title`, `requirements`, `date`, `expectedUpdatedAt` (ISO string), and `createTodoService.cancelManual(actor, id)`. Parent `POST /api/parent/todos` dispatches `action: "update" | "cancel" | "review" | absent`.

- [ ] **Step 1: Write failing integration tests.** For a parent and real family rows, assert `updateManual` changes an `open` manual todo's title, requirements, and date; old-date `list` omits it and new-date `list` contains it. Assert `submitted`/`approved` edits fail, a different family gets `TODO_NOT_FOUND`, and a dictation todo gets `TODO_KIND`. Assert `cancelManual` hides open/submitted/rejected todos from the child list but retains their submission/review rows; approved/rewarded todos fail with `TODO_REWARDED`. Add an actual concurrent `review`/`cancelManual` test to prove only one final state and no duplicated points.

```ts
await service.updateManual(parent, task.id, {
  title: "阅读30分钟", requirements: "记录两句感想", date: "2026-09-24",
  expectedUpdatedAt: task.updatedAt.toISOString(),
});
expect((await service.list(child, "2026-09-22")).tasks).toHaveLength(0);
expect((await service.list(child, "2026-09-24")).tasks[0]!.title).toBe("阅读30分钟");
```

- [ ] **Step 2: Observe RED.** Run `tests/integration/todos.test.ts`; expected: `updateManual` and `cancelManual` are undefined.

- [ ] **Step 3: Implement guarded service/API.** Add a Zod schema for the update fields (reuse `dateSchema`, title/requirements lengths from `taskInputSchema`). For both methods, use `database.transaction`, select the todo by `familyId` + id with `.for("update")`, then check `kind === "manual"`. `updateManual` checks `status === "open"` and `updatedAt.toISOString() === expectedUpdatedAt`, writes fields and a strictly later timestamp `new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1))`, and returns the row. `cancelManual` is idempotent for already-cancelled rows; otherwise checks `status !== "approved"`, no row in `todoRewards`, then writes `status: "cancelled"`. In `http.ts`, dispatch the explicit action values only for authenticated parents after the existing origin check; map `TODO_KIND`, `TODO_REWARDED`, `TODO_STALE` to distinct user messages.

```ts
const [row] = await tx.select().from(todoTasks)
  .where(and(eq(todoTasks.familyId, actor.familyId), eq(todoTasks.id, id)))
  .for("update");
if (!row) throw new Error("TODO_NOT_FOUND");
if (row.kind !== "manual") throw new Error("TODO_KIND");
if (row.status !== "open" || row.updatedAt.toISOString() !== input.expectedUpdatedAt)
  throw new Error("TODO_STALE");
await tx.update(todoTasks).set({ title: input.title, requirements: input.requirements,
  date: input.date, updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)) })
  .where(eq(todoTasks.id, id));
```

- [ ] **Step 4: Observe GREEN and commit.** Run focused integration/unit tests and typecheck; commit Task 4 files with message `Support guarded manual todo edit and withdrawal`.

### Task 5: Add parent edit and withdrawal controls

**Files:** Modify `src/components/todos/todo-board.tsx`, `src/app/globals.css`, `e2e/dictation.spec.ts`; create `e2e/todo-management.spec.ts` if a focused fixture is clearer than extending the dictation E2E.

**Interfaces:** Consumes Task 4 parent API actions. Produces inline “编辑” only for `kind === "manual" && status === "open"`, and a two-step “撤回” confirmation for unapproved manual todos; leaves dictation `TaskManagementControls` unchanged.

- [ ] **Step 1: Write failing browser checks.** A parent creates “阅读20分钟”, edits it to “阅读30分钟” and a new date, then sees it under that date. Create a mistaken manual todo, choose “撤回” and “确定撤回”, then assert the parent sees “已撤回” while the child no longer sees it. Assert no edit button on a submitted or dictation todo.

```ts
await parentPage.getByRole("button", { name: "编辑" }).click();
const editForm = parentPage.getByRole("form", { name: "阅读20分钟的编辑表单" });
await editForm.getByLabel("待办任务").fill("阅读30分钟");
await editForm.getByLabel("日期").fill("2026-09-24");
await editForm.getByRole("button", { name: "保存修改" }).click();
await parentPage.getByLabel("日期").fill("2026-09-24");
await expect(parentPage.getByText("阅读30分钟")).toBeVisible();
```

- [ ] **Step 2: Observe RED.** Run the focused Chromium E2E; expected: no “编辑” or “撤回” controls on manual rows.

- [ ] **Step 3: Implement controls.** Extend the `Task` type with `updatedAt`, use existing `send`/`refresh` for `{ action: "update", id, title, requirements, date, expectedUpdatedAt }` and `{ action: "cancel", id }`. Give the inline form an `aria-label` composed of the current title plus “的编辑表单”. Keep only one open edit form and one open confirmation at a time; expose “保留任务” and “确定撤回”, disable actions while pending, and show server stale errors in the board alert. Refresh after mutation; moving dates naturally removes the row from the old date.

```tsx
const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
{role === "parent" && t.kind === "manual" && t.status === "open" &&
  <button type="button" onClick={() => setEditingTodoId(t.id)}>编辑</button>}
{role === "parent" && t.kind === "manual" &&
  ["open", "submitted", "rejected"].includes(t.status) &&
  <button type="button" onClick={() => setConfirmCancelId(t.id)}>撤回</button>}
```

- [ ] **Step 4: Observe GREEN and commit.** Run focused Chromium/WebKit E2E, tests, lint, and typecheck; commit Task 5 files with message `Add parent manual todo edit and withdraw controls`.

### Task 6: Full local verification and safe handoff

**Files:** Only test or documentation files if a failing verification exposes a real defect; never alter unrelated user changes.

**Interfaces:** Consumes Tasks 1-5. Produces a clean local branch and a verification record. Production release is outside this plan until Tom separately authorizes it.

- [ ] **Step 1: Run all suites.** With isolated DB URLs, run `pnpm test`, `pnpm test:integration`, `pnpm exec playwright test --workers=2`, `pnpm lint`, `pnpm typecheck`, and `pnpm build`. Record counts and failures. Restore any Next-generated `next-env.d.ts`/`tsconfig.json` churn via `apply_patch`, preserving intentional edits.
- [ ] **Step 2: Inspect the diff.** Run `git diff --check`, `git status --short`, and review the branch against its base for answer leakage, attachment permissions, reward history, race behavior, and accessible controls.
- [ ] **Step 3: Commit only any test-driven fixes.** Use a scoped message and report the exact local commit, tests, unverified real-device behavior, and whether push/deployment remains unapproved.
