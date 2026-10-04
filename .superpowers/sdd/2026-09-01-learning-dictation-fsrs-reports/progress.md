# SDD ledger — plan: docs/superpowers/plans/2026-09-01-learning-dictation-fsrs-reports.md

## Baseline

### Main checkout follow-up — 2026-09-03

- Local `main` was fast-forwarded to `db5f78b`; no push or deployment. The original linked worktree and its uncommitted `next-env.d.ts` remain preserved.
- Root checkout test discovery previously included `.worktrees` and `.pnpm-store` copies. Two behavioral discovery regression cases failed before the fix: both Vitest configurations discovered unrelated suites/copies instead of only their own suite.
- The unit and integration configurations now use root-relative suite include patterns. The default `pnpm test` passes 37 files / 125 tests; `pnpm test:integration` passes 18 files / 128 tests with explicit local `family_learning_test` configuration. The regression lists files only and does not import database test setup.
- Changed-file ESLint and `git diff --check` passed on Node 24.15.0. No browser E2E, build, production code, migration, provider activation, reset, seed, or data cleanup was needed for this test-discovery-only change. Existing cache and linked worktree were not removed.

- Worktree: `/Users/yubudong/code/学习管理网站/.worktrees/phase1`
- Branch: `feat/family-learning-phase1`
- Start HEAD: `74daa2eebcd8eda0808dedf5f37673af627ff0a6`
- Preserved user/dev-server change: `next-env.d.ts` points at `.next/dev/types`; do not stage or overwrite it.
- Node 24.15.0: unit 35/35 PASS; integration 52/52 PASS; lint PASS; typecheck PASS.
- Integration first sandbox attempt failed only with local socket `EPERM`; approved local test-database rerun passed.

## Pre-flight interface scan

| Producer task | Consumer task | Shared file/interface | Finding and ruling |
|---|---|---|---|
| Task 1 | Task 2 | `learningCards`, OCR drafts, learning-content module, `src/db/schema.ts` | Clean dependency. Task 1 owns confirmed-card visibility; Task 2 only adds OCR ingestion and providers. |
| Task 1 | Task 3 | `LearningCard`, card queries, textbook/unit IDs | Clean dependency. Task 3 must consume Task 1 services and not bypass family isolation. |
| Task 2 | Task 3 | cached TTS media and job status | Clean dependency. Task creation may require audio readiness but must not make live Azure calls. |
| Task 2 | Task 5 | private TTS URLs and preloaded audio | Clean dependency. Child routes must authorize media to the active child task. |
| Task 3 | Task 4 | FSRS scheduler, learning tasks, review events, `src/db/schema.ts` | Sample test in Task 3 omits required `eventType`. Ruling: preserve the declared interface and pass `new_first` or `scheduled_first` explicitly; cost if wrong is a small test/API adjustment. |
| Task 4 | Task 5 | `DictationSnapshot`, commands, resume behavior | Clean dependency. Task 5 is a UI/API consumer of the Task 4 state machine. |
| Task 4 | Task 6 | immutable answer events and completion facts | Clean dependency. Reports must not rewrite facts or treat relearning as first-pass retention. |
| Task 3 | Task 6 | review event types and `dueAt` | Clean dependency. Weekly retention only consumes `scheduled_first`. |
| Task 1-4 | Later migrations | migration filenames and Drizzle journal/snapshots | Plan names `0003`-`0006`, but Phase 1 already ends at `0009`. Ruling: generate sequential migrations beginning at `0010`; cost if wrong is migration renaming before release. |
| Task 1 | Seed content completion gate | empty verified metadata vs textbook entries | Tom selected editions but has not supplied owned photos or a verified word list. Ruling: commit schema and accurate empty seed containers only; do not claim the textbook library is populated. |
| Task 2 | Azure external services | Speech and Vision credentials/calls | Tom approved Azure international Speech provider and voices, not account creation, billing, credentials, or Azure Vision calls. Ruling: implement adapters and fake-provider tests, keep all real calls disabled; cost if wrong is delayed end-to-end provider verification. |
| Task 3 | Dependency lock | `ts-fsrs` exact version | Plan uses an unpinned install command while roadmap requires exact versions. Ruling: resolve and install an exact published version into `package.json` and lockfile. |

- Dependency resolution (2026-09-02): npm registry reports `ts-fsrs@5.4.2`; Task 3 must pin exactly `5.4.2` and adapt to its actual exported API rather than assuming the plan snippet still compiles.

## Per-task consistency scan

| Task | Internal check |
|---|---|
| Task 1 | Four-entry UI is consistent with OCR being a pending/disabled handoff to Task 2. Seed files remain empty until verified source material exists. |
| Task 2 | Azure adapters are implemented but real calls remain disabled without credentials and explicit service activation. Media authorization and job deduplication are mandatory. |
| Task 3 | Use the declared `eventType` requirement despite the abbreviated sample test. Defaults omitted in examples must be filled from the interface and design. |
| Task 4 | Pure state-machine tests precede transactional service work. First-pass facts remain immutable and completion is idempotent. |
| Task 5 | UI must not reveal answers before grading and must isolate local recovery by family, child, and session. |
| Task 6 | Metrics separate first pass, final completion, and scheduled retention. Full-suite completion cannot imply deployment. |

Task 1: minor (deferred): GET invalid `subject` is silently treated as no filter instead of a 400 response.
Task 1: minor (deferred): content entry form does not recover cleanly from network errors or invalid JSON.
Task 1: minor (deferred): broaden API/auth and negative-path coverage if not already required by Important fixes.
Task 1: fix round 1/5 (4 addressed, 0 open — database invariants; atomic bulk insert; cross-file seed keys; API setup gate; commits 5fafd21..42065a8)
Task 1: minor (deferred): constraint test triggers multiple expected PostgreSQL errors inside one transaction, so later assertions can pass from aborted transaction state.
Task 1: minor (deferred): actor-scoped `createCard` still accepts `source: "builtin"` even though the new scope constraint rejects that shape.
Task 1: resolved during fix: invalid `subject` now returns 400 and negative-path API coverage was broadened.
Task 1: complete (commits 74daa2e..42065a8, review clean)
Task 2: initial implementation commit 823f3ef (private media, PostgreSQL jobs, Azure TTS/OCR adapters; real providers disabled; unit 54/54, integration 62/62, lint/typecheck PASS).
Task 2: fix round 1/5 in progress (6 Important: enforce TTS dedupe invariant; lease fencing/provider timeout; verified no-follow file reads; cache/job regeneration; private runtime Git ignore; crash-orphan reconciliation).
Task 2: minor (deferred): OCR draft does not persist an exact `sourceMediaId` binding.
Task 2: minor (deferred): queued-job claim query lacks a status/type/availableAt index.
Task 2: fix round 1/5 reviewed (4 addressed, 2 partial — successful-job enqueue regression and non-TTS requeue scope; orphan reconciler runtime wiring/minimum grace).
Task 2: fix round 2/5 in progress (preserve healthy succeeded TTS jobs; explicit family-scoped TTS regeneration only; wire low-frequency orphan maintenance with >=1h grace).
Task 2: fix round 2/5 reviewed (all findings addressed; no new Critical/Important; commit 6277278).
Task 2: complete (commits 42065a8..6277278; unit 57/57, integration 71/71, lint/typecheck PASS; real Azure providers remain disabled; no deployment).
Task 3: in progress (migration starts at 0013; exact `ts-fsrs@5.4.2`; request_retention=0.9; eventType interface ruling applies).
Task 3: initial implementation commits 7aefe8d..de4785d (unit 63/63, integration 76/76, lint/typecheck PASS; migration 0013 test-only).
Task 3: fix round 1/5 in progress (review-event concurrency/idempotency and source DB invariants; stable browser commandId; true source ordering; unit/source/search selection UI; migration 0014 required).
Task 3: minor (requested opportunistic fix): audio readiness should share media expiry rules.
Task 3: minor (requested opportunistic fix): API tests should exercise the production schema instead of a copied schema.
Task 3: fix round 1/5 reviewed (source ordering, UI filtering, concurrency/idempotency core and source constraints addressed; 3 Important remain: immutable review facts, malformed-success response command reuse, expired TTS regeneration).
Task 3: fix round 2/5 in progress (migration 0015 for immutable review facts; strict success-response validation; end-to-end expired TTS replacement/recovery).
Task 3: minor (deferred release preflight): migration 0014 should preflight any legacy duplicate `source_review_event_id` rows before production rollout; Task 3 is not deployed.
Task 3: fix round 2/5 reviewed (all findings addressed; no new Critical/Important; commits aea8fbd..38e2dff).
Task 3: complete (commits 6277278..38e2dff; unit 67/67, integration 90/90, lint/typecheck PASS; migrations 0013-0015 test-only; no deployment/Azure calls).
Task 4: in progress (next migration 0016; immutable dictation facts, resumable session state, per-item derived review command IDs, completion event only — rewards remain Task 6).
Task 4: initial implementation commits 4e7ee18..cad49da (unit 72/72, integration 99/99, lint/typecheck PASS; migration 0016 test-only).
Task 4: fix round 1/5 in progress (migration 0017: close session/task/item/round/completion DB chain; monotonic completion timestamps; ordered continuous playback; expand item-by-item/isolation/media lifecycle tests).
Task 4: minor (deferred privacy deletion boundary): direct family cascade is currently blocked by an existing learning-task-item/card restrict relationship; Task 4 report must not claim direct family cascade deletion, and deletion orchestration belongs to later privacy hardening.
Task 4: fix round 1/5 reviewed (continuous order addressed; DB chain and completion timestamps partial; commits 830ed00..26f5189).
Task 4: fix round 2/5 in progress (migration 0018 to make round membership exact/immutable without erasing facts; shared monotonic timestamp cursor for playback and grading; explicit cross-task/manual-replay tests).
Task 4: fix round 2/5 reviewed (all blocking findings addressed; minor empty-round DB hardening deferred; commits 9a7c2ef..cd7b0ca).
Task 4: complete (commits 38e2dff..cd7b0ca; unit 73/73, integration 105/105, lint/typecheck PASS; migrations 0016-0018 test-only; no deployment).
Task 4: minor (deferred hardening): database bypass can create an empty `dictation_rounds.item_ids` array; service/state machine never creates empty rounds and no events can attach.
Task 5: in progress (child-authenticated UI/API, answer secrecy, preloaded private audio, safe local recovery, switch-child protection, Chromium/WebKit E2E; no migration expected).
Task 5: initial implementation commits cbc491f..46a5b72 (unit 87/87, integration 108/108, Chromium/WebKit 2/2, lint/typecheck/build PASS; no migration/deployment).
Task 5: authorized test cleanup completed: only failed E2E family `f47a309c-724b-4474-a324-cf6e28c261d5` and its exact generated records were removed from `family_learning_test`; non-recoverable but reproducible; other data untouched.
Task 5: fix round 1/5 in progress (Critical shared-device browser-history/RSC isolation; stored command snapshot response; stable pending payload; cancelled-task secrecy; recoverable/abortable audio; partial E2E fixture cleanup; component/back-forward coverage).
Task 5: minor (deferred deployment risk): production build has existing Turbopack dynamic-filesystem tracing warnings in `src/modules/media/store.ts`; verify deployment artifact size/path before release.
Task 5: fix round 1/5 reviewed (stored snapshot, exact pending payload, cancelled-task secrecy, audio recovery and partial fixture cleanup addressed; shared-device isolation partial).
Task 5: fix round 2/5 in progress (global child header/history/BFCache isolation; full command-operation settle before switch; one-shot beforeunload bypass after confirmed switch; listening query must not select answers; per-attempt audio generation token).
Task 5: fix round 2/5 reviewed (pending settle, one-shot beforeunload, listening query secrecy and audio generation addressed; history isolation still partial).
Task 5: fix round 3/5 in progress (button-only Header switch with no new-tab fallback; truth-bearing A→B Back/Forward assertions; authoritative completed reconciliation for replayed nonterminal commands; strengthen query-secrecy test markers).
Task 5: fix round 3/5 reviewed (Header/BFCache and truthful history evidence addressed; stored-command completed reconciliation addressed; one terminal retry route gap remains).
Task 5: fix round 4/5 in progress (unstored retry after another device completes must reconcile to authoritative completed; cancelled/inconsistent lifecycle command must return uniform 404).
Task 5: fix round 4/5 reviewed (all blocking findings addressed; no new Critical/Important; commits 07bf87f..2dfb538).
Task 5: complete (commits cd7b0ca..2dfb538; unit 97/97, integration 114/114, Chromium/WebKit 4/4 from final UI round, lint/typecheck/build PASS; no migration/deployment/Azure calls).
Task 6: in progress (reports only per Stage 2 boundary; ledger/coins/pet/family rewards remain Stage 3 and consume `LearningTaskCompleted`).
Task 6: complete (implementation `e785ceb73e320e91efa5582aff2f9b8d894dbc6e`; unit 110/110, integration 121/121, Chromium/WebKit full E2E 16/16 with fresh server and one worker, lint/typecheck/build PASS; no migration/deployment/Azure calls; Stage 3 remains unimplemented).
Task 6: fix round 1 complete (`e152fc0e22f5f95059b9fb713ba9c7fc3b8f962b`; active task takes dashboard precedence; session membership/answer facts are bijective and Task 4 ordered; unit 111/111, integration 122/122, lint/typecheck/build PASS; UI unchanged so E2E not rerun; `next-env.d.ts` restored to `.next/dev/types` and uncommitted).
Whole-branch review: fix round 1/5 in progress (4 Important: active-task card reuse across sequential/concurrent commands and task-builder counts; missing parent OCR upload/status/edit/reject/confirm/retry closure; report answer/review fact mismatch not consistently fail-closed; E2E teardown left exact `generate_tts` jobs without a family FK).
Whole-branch review: fix round 1 RED evidence — active sequential, distinct-command concurrency, and task-builder consistency tests failed before the exclusion helper; OCR tests failed for the missing file input/GET/PUT handlers, disabled provider still creating a permanent queued job, non-idempotent repeated confirmation, missing terminal `empty` state, and absent 500-line bound; report pure/integration mismatch tests failed before shared fact validation; E2E fixture verification proved its own `generate_tts` jobs survived family cleanup because those rows have no family FK.
Whole-branch review: fix round 1 GREEN implementation committed as `2c205f3` (shared active-card exclusion under the existing child lock; complete family-scoped parent OCR draft workflow with production provider still disabled; shared fail-closed report fact validator; E2E records and deletes only its own job IDs). Targeted unit 19/19 and integration 27/27 PASS on Node 24.15.0 with explicit `family_learning_test`/transaction rollback. No migration, deployment, real Azure/Hetzner access, non-test database access, seed/reset, or broad cleanup.
Whole-branch review: fix round 1 complete — Node 24.15.0 unit 119/119 PASS; integration 128/128 PASS on the second full run with explicit `family_learning_test` and `FAMILY_LEARNING_TEST_MODE=integration`; lint PASS; typecheck PASS; dummy-SMTP production build PASS without an external connection; `pnpm db:generate` reported no schema changes; fresh `reuseExistingServer=false`, one-worker Chromium+WebKit E2E 16/16 PASS; `git diff --check` PASS. First full integration run had one existing pairing-rate retention test observe 7 rather than 5 rows under full-suite concurrency; the isolated test passed 1/1 and the immediate complete suite passed 128/128, recorded as a test-stability warning rather than weakening the assertion. Build retained eight known Turbopack dynamic-filesystem tracing warnings plus dummy-secret warnings. `next-env.d.ts` was restored to `.next/dev/types` and remains the only uncommitted file; `tsconfig.json` was restored exactly.
Whole-branch review: fix round 2/5 identified 2 Important — after successful task creation the client retained stale server-provided active-card/due-count options, and an E2E setup assertion could throw before generated TTS job IDs reached fixture state, leaving exact test jobs behind. RED tests covered success-only `router.refresh`, no refresh on failure, exact dedupe-key completeness, and merging job IDs discovered before/after partial setup.
Whole-branch review: fix round 2 complete (`556ea5b`) — successful task creation refreshes the server snapshot after clearing selection; E2E fixture state records exact dedupe keys before the first completeness assertion and teardown resolves/deletes/verifies only matching IDs or keys. Node 24.15.0 unit 123/123 PASS; integration 128/128 PASS with explicit `family_learning_test` and transaction rollback mode; lint/typecheck/dummy-SMTP production build PASS; fresh one-worker Chromium+WebKit E2E 16/16 PASS; `git diff --check` PASS. Round 2 changed no schema or migration files, so Round 1's no-drift result remains applicable and the range was rechecked. Existing eight Turbopack dynamic-filesystem warnings and dummy-secret/Playwright color warnings remain. OCR draft/job identifiers are still not persisted across a full browser refresh; this Minor recovery limitation remains deferred. No deployment, real provider, Hetzner, non-test database, reset, seed, or broad cleanup.
Final verification retry: the first harness attempts that omitted a required environment value or hit sandbox-only `tsx` IPC `EPERM` were environment failures, not product failures. The subsequent fresh one-worker full E2E run exposed 2 genuine test-stability failures (14/16): Chromium evaluated `__e2eDocumentId` while `location.replace` destroyed the execution context; WebKit device switching supplied a non-IP `x-forwarded-for`, so Better Auth fell back to a shared rate-limit bucket and sign-up returned 429. Minimal test-only fix waits for the target URL/DOM before reading the new document ID, assigns per-run valid `198.18.0.0/15` addresses, and precisely removes/verifies only the switching fixture's family and auth user without deleting rate-limit or historical rows. Focused fresh-server Chromium+WebKit verification passed 6/6 on Node 24.15.0; full 16-test rerun remains pending at the root verification step.
