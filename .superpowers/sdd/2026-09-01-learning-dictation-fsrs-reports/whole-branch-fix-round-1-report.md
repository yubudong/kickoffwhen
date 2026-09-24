# Whole-branch review — Fix Round 1 report

## Scope and status

- Product and regression-test fixes are implemented locally in commit `2c205f3` on `feat/family-learning-phase1`.
- This report records local evidence only. Nothing is deployed, and no production database or external provider was accessed.
- The pre-existing uncommitted `next-env.d.ts` development type-path change remains outside every commit.

## Four Important findings and closure

### 1. Active learning cards could be selected again

**RED:** sequential active-task reuse, two genuinely overlapping distinct commands, and task-builder count/started-child consistency tests exposed that an active card could be selected again for the same child.

**GREEN:** one shared family/child-scoped active-card query now drives both task creation and the parent builder view. Task creation remains serialized by the existing child row lock, excludes active due/new cards, preserves same-command idempotency, and rolls back an empty task attempt.

### 2. OCR had no usable parent confirmation loop

**RED:** tests failed for the missing file input and GET/PUT handlers; a disabled provider still created a permanently queued job; repeated confirmation was not idempotent; successful zero-line OCR had no terminal state; worker output had no 500-line bound.

**GREEN:** the parent can upload a private JPG/PNG, poll a family-bound draft/job, inspect and edit each line, reject unwanted lines, confirm selected lines, and retry the same decision without duplicate cards. Empty, failed, finalized, queued, running, ready, and provider-disabled states are explicit. Production provider status remains deliberately disabled, so current production wiring returns `503 OCR_PROVIDER_DISABLED` before storing an image or creating a job. The complete backend flow is exercised only with injected fake/mock providers.

### 3. Weekly/card-history reports did not validate all answer/review facts

**RED:** pure and integration mismatch cases showed that answer correctness/timestamp/source/kind could disagree with its review event without both report readers failing closed.

**GREEN:** a shared validator now checks Task 4 role, round, item kind, review-event ID, correctness, timestamp, event type, and relearning source semantics. Weekly and card-history readers return `REPORT_INCONSISTENT` rather than publishing contradictory metrics.

### 4. E2E cleanup left `generate_tts` jobs

**RED:** exact fixture verification showed that test-owned TTS jobs survived family cleanup because the jobs table has no family foreign key.

**GREEN:** each E2E fixture records the exact job IDs created from its task item dedupe keys, deletes only those IDs during teardown, and verifies none remain. It does not truncate, reset, seed, or broadly delete unrelated test data.

## Final local verification

- Runtime: Node 24.15.0.
- Targeted RED/GREEN verification: unit 19/19 and integration 27/27 passed after the fixes.
- Full unit suite: 34 files, 119/119 tests passed.
- Full integration suite: 18 files, 128/128 tests passed with explicit `DATABASE_URL=postgres://app:app@127.0.0.1:5433/family_learning_test` and `FAMILY_LEARNING_TEST_MODE=integration`.
- Lint: passed.
- TypeScript/Next route type generation: passed.
- Production build: passed with dummy local SMTP/test configuration and no external connection.
- Schema drift: `pnpm db:generate` reported “No schema changes, nothing to migrate”.
- Browser E2E: a fresh server (`reuseExistingServer=false`), one worker, Chromium plus WebKit; 16/16 passed. Teardown deleted and then verified only its exact fixture job IDs.
- Whitespace check: `git diff --check` passed.
- Generated-file restoration: `tsconfig.json` is unchanged; `next-env.d.ts` is restored to the pre-existing `.next/dev/types/{routes,root-params}.d.ts` uncommitted state.

## Verification warnings

- The first full integration run passed 127/128; one pre-existing pairing-rate retention test observed 7 expired rows instead of 5 under the complete parallel suite. The exact isolated test immediately passed 1/1, and the next full suite passed 128/128. No assertion was weakened and no production code was changed; this remains a test-stability warning around shared-suite lock timing.
- The successful production build emitted eight known Turbopack warnings that dynamic filesystem traversal in `src/modules/media/store.ts` can trace the whole project into the artifact. Deployment artifact scope/size still needs a release preflight.
- Better Auth warned that the intentionally fixed dummy build secret has low entropy. No real secret was used or stored.
- Playwright/Next emitted repeated `NO_COLOR`/`FORCE_COLOR` warnings, and the negative reset-password privacy test logged the expected “User not found” warning without exposing it to the browser.

## Boundaries and remaining limitations

- No real Azure Speech/Vision call, credentials, account, billing, or provider activation.
- No Hetzner access, deployment, production write, or non-test database access.
- Textbook seed containers remain accurate and empty; no unverified textbook content was added.
- Stage 3 rewards, star coins, pet growth, habits, and family rewards remain outside this Stage 2 branch.
- Existing Turbopack dynamic-file tracing warnings for the private media store remain a release-preflight concern; a successful local build does not prove deployment artifact correctness.

## Whole-branch review — Fix Round 2

### Important 1: task builder retained a stale server snapshot

**RED:** after a successful task POST, the form cleared its local selection but retained the original server-provided cards and due counts. The same active cards could therefore remain visible until a manual navigation or refresh. The regression test also proves a failed POST must not refresh or hide the error.

**GREEN:** successful creation now calls `router.refresh()` after clearing selection, so the server reruns the active-card query and sends current card/count options. Failed creation keeps the existing screen and message. Implemented locally in `556ea5b`.

### Important 2: partial E2E setup could lose its exact TTS job cleanup keys

**RED:** the previous setup recorded job IDs only after asserting that all expected jobs were present. If that assertion failed after task creation, `afterEach` had neither IDs nor keys and could leave those fixture jobs behind.

**GREEN:** exact item dedupe keys enter fixture state immediately after task creation and before the first database/assertion boundary. Teardown merges any already-known IDs with jobs found by those exact keys, deletes only the resolved fixture IDs, then verifies neither the IDs nor keys remain. Helper tests cover partial discovery, deduplication, missing keys, and foreign keys.

### Round 2 local verification

- Node 24.15.0.
- Targeted regression tests: 2 files, 4/4 passed.
- Full unit suite: 36 files, 123/123 passed.
- Full integration suite: 18 files, 128/128 passed with explicit `family_learning_test` and `FAMILY_LEARNING_TEST_MODE=integration`.
- Lint and typecheck: passed.
- Production build: passed with dummy SMTP/test values and no external connection; the same eight Turbopack media-store tracing warnings and dummy-secret warnings remain.
- Browser E2E: fresh server, `reuseExistingServer=false`, one worker, Chromium plus WebKit, 16/16 passed. Fixture teardown used exact IDs/dedupe keys rather than a broad job delete.
- Schema: Round 2 changes no schema, Drizzle, or migration file; the commit range was rechecked, so Round 1's explicit no-drift result remains applicable.
- `git diff --check`: passed. `tsconfig.json` restored unchanged; `next-env.d.ts` restored to its preserved uncommitted `.next/dev/types` state.

### Minor still open

- OCR in-page interruption can be retried while component state remains mounted, but a full browser refresh loses the draft/job identifiers because they are not yet persisted in the URL or local recovery storage. This recovery improvement remains deferred and is not represented as complete.

## Final verification retry — E2E stability fix

The initial verification harness attempts that omitted a required environment value or failed to open the sandbox-restricted `tsx` IPC pipe with `EPERM` did not execute a product test and are recorded as environment failures. A later fresh-server, one-worker Chromium/WebKit run did execute all tests and exposed two genuine failures (14/16):

- Chromium's dictation history test called `page.evaluate` from `expect.poll` while `window.location.replace` was destroying that document's execution context.
- WebKit's device-switching test supplied a non-IP `x-forwarded-for` value. Better Auth rejected it, fell back to a shared client bucket, and returned 429 from sign-up after prior runs consumed the three-request authentication limit.

The test-only repair does not change product behavior or weaken assertions. Dictation navigation now waits for the expected URL and DOM to settle, then verifies the newly initialized document ID differs from the prior document. Device switching now derives three per-run valid addresses from the reserved `198.18.0.0/15` benchmark range, so the parent and device contexts are distinct from the project default and from other runs. Its teardown deletes and verifies only the exact generated family and auth user; it does not reset or delete Better Auth rate-limit rows, historical fixtures, or unrelated test data.

Node 24.15.0 focused verification with a fresh server and one worker passed all six generated cases: both device switching and both dictation cases across Chromium and WebKit, including dictation's partial-setup cleanup case. The first sandboxed command again hit the known `tsx` IPC `EPERM`; the approved local rerun completed 6/6 in about one minute. ESLint on both changed E2E files and `tsc --noEmit` also passed. The root verification step must still rerun the complete 16-test browser suite before final completion is claimed.
