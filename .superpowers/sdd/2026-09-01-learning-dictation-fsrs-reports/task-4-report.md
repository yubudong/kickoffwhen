# Task 4 report — resumable dictation session engine

## Scope and status

Implemented the Task 4 backend/session domain only: a pure two-mode dictation state machine, durable resumable sessions, append-only playback/answer/completion facts, versioned idempotent commands, transactional FSRS updates, and database isolation/immutability constraints.

This is implemented and verified locally. It is not deployed. No Task 5 child UI/API, Task 6 rewards/reporting, live Azure call, credential, production database, reset, seed, or clean operation is included.

## TDD evidence

- RED: `tests/unit/dictation-machine.test.ts` initially failed because `@/modules/dictation/session-machine` did not exist.
- GREEN focused unit: 5/5 tests passed for continuous batch and item-by-item modes.
- Focused integration: 9/9 tests passed after implementing persistence, isolation, rollback, idempotency, lifecycle, and independent-connection concurrency.
- The only intermediate integration failure was fixture teardown ordering after the functional assertions passed; teardown was corrected to delete only the committed test fixture's task before its family.

## Migration and persistence

- Added sequential migration `0016_freezing_network.sql` and Drizzle snapshot/journal update.
- Added `dictation_sessions`, `dictation_rounds`, `dictation_session_items`, `dictation_commands`, `dictation_playback_events`, `dictation_answer_events`, and `dictation_completion_events`.
- Family/child/task/session scope is enforced with composite foreign keys and scope validation triggers.
- Command fingerprints and stored result snapshots contain identifiers/progress only; answer or broadcast text is not stored there.
- Database triggers protect first-pass/session-item/round facts and reject updates to command, playback, answer, and completion facts. Direct whole-family cascade deletion was not verified: the existing `learning_task_items` to `learning_cards` restrict relationship still requires an ordered privacy-deletion workflow.
- `0016` was applied only to explicit `family_learning_test` under `FAMILY_LEARNING_TEST_MODE=integration`. The test database was not reset, seeded, or cleaned; tests roll back or delete only their exact committed fixture.
- Final `pnpm db:generate`: `No schema changes, nothing to migrate`.

## Transactions, idempotency, and concurrency

- Every playback/grading mutation locks its session row and checks command replay before lifecycle/version rejection.
- Same command ID plus the same fingerprint returns its original stored snapshot; a different payload conflicts.
- `expectedVersion` and `roundNumber` prevent stale multi-device mutation.
- Real two-independent-connection tests verify concurrent `startSession` calls return one logical session and concurrent same-version mutations allow exactly one winner.
- Review advisory locks are acquired in stable `cardId` order.
- Added `createTransactionalReviewService(tx)` so first-pass/relearning review events and FSRS state join the dictation service's outer transaction without a nested transaction boundary.
- Per-item review command IDs are deterministically derived from grading command ID, task item ID, and event role.
- Answer events, FSRS changes, next-round/session state, learning-task completion, and one `LearningTaskCompleted` fact commit atomically. A forced second-card review failure rolls everything back.
- Review timestamps are made strictly monotonic per card even under a fixed test clock.

## Behavior verified

- Both `continuous_batch` and `item_by_item` modes.
- Playback required before grading; wrong round/order, incomplete/duplicate/foreign marks, and post-completion mutation are rejected.
- Exact playback progress and replay counts survive resume; repeated network commands do not inflate counts.
- First-pass facts remain immutable; later mistakes remain append-only; one final correction creates one linked `same_session_relearning` event.
- New and due task items map to `new_first` and `scheduled_first` respectively, and final child FSRS state is retained.
- Audio-not-ready, completed, and cancelled tasks cannot start; cancelled/completed task/session lifecycle blocks new mutation.
- Completing the session marks the learning task completed, which removes the active-task condition used by child TTS media authorization.
- Resume and mutation stay within the verified child/family/task scope.
- No reward/ledger mutation occurs in Task 4.

## Files

- `src/modules/dictation/session-types.ts`
- `src/modules/dictation/session-machine.ts`
- `src/modules/dictation/session-schema.ts`
- `src/modules/dictation/session-service.ts`
- `src/modules/dictation/events.ts`
- `src/modules/review/service.ts`
- `src/db/schema.ts`
- `drizzle/0016_freezing_network.sql`
- `drizzle/meta/0016_snapshot.json`
- `drizzle/meta/_journal.json`
- `tests/unit/dictation-machine.test.ts`
- `tests/integration/dictation-session.test.ts`

## Final verification

- Node: `24.15.0`
- Focused unit: 1 file, 5 tests PASS
- Focused integration: 1 file, 9 tests PASS
- Full unit: 26 files, 72 tests PASS
- Full integration: 15 files, 99 tests PASS
- `pnpm lint`: PASS, zero warnings
- `pnpm typecheck`: PASS
- `pnpm db:generate`: PASS, no drift
- `git diff --check`: PASS

## Commit hashes

- Task start: `38e2dffdfbabd938c60a5f708daa1d9bfa5411a7`
- Implementation: `4e7ee18b2114a29d332f9742154682c5e7cba48c`

## Boundaries and remaining work

- Task 5 must expose these services through child-authenticated routes/UI without revealing answers before the grading phase.
- Task 6 must consume `LearningTaskCompleted` idempotently to award XP/coins and build reports; Task 4 intentionally awards nothing.
- Live Azure providers, deployment, production migration, and manual browser acceptance were not exercised here.

## Fix round 1 — independent review findings

### Findings addressed

1. **Database business-chain closure**
   - Kept migration `0016` byte-for-byte unchanged.
   - Added incremental migration `0017_thankful_mystique.sql` and its Drizzle snapshot.
   - Added `dictation_round_items` as explicit round membership. Its primary key includes the round, so the same wrong item can validly appear in later rounds.
   - Added composite links from session items to both their session/task and scoped learning-task item.
   - Added composite playback/answer links to round membership and a completion link to the exact session task.
   - `0017` backfills membership from existing immutable round item arrays before adding event foreign keys.
   - Independent-savepoint tests reject a same-child item from another task, missing round, item outside the round, wrong completion task, and cross-family/child event scope while leaving the outer transaction usable. A normal relearning round still completes.

2. **Monotonic fact and completion time**
   - Each grading batch starts after the session's latest stored answer timestamp and advances a strict timestamp cursor.
   - A stored scheduled due time is only a lower bound for that card's first `scheduled_first` event.
   - Same-session correction uses the preceding review time, not the FSRS card's future next-due date.
   - Round, session, task, and completion times use the maximum actual timestamp written by the batch.
   - A fixed-clock, multi-card integration test verifies strict answer/review ordering, completion not earlier than any fact, and no artificial jump to a future FSRS due date.

3. **Strict continuous playback order**
   - First playback only advances the next contiguous prefix of `currentRoundItemIds`.
   - Skips, reversals, and mixed noncontiguous segments are rejected.
   - A replay is explicitly one replay of the current reached item. It appends a playback fact/count but does not advance `playedItemIds`; task settings can disable manual replay.
   - Command retry returns the stored snapshot and does not add another playback fact or replay count.

### Requirements-gap coverage added

- Full item-by-item integration path: first error, remaining first-pass item, later round, linked `same_session_relearning`, single completion event, and completion-command replay.
- Explicit stale-version and cross-child/cross-family playback/grading rejection.
- Snapshot assertions that answer/broadcast text and first/latest answer maps are absent.
- Real private-media write/read before completion and verified child read denial after task completion.
- Existing outer-transaction rollback, stable advisory-lock ordering, derived per-item command IDs, real two-connection start/mutation concurrency, immutable Task 3 review events, and media read verification all pass in the full suite.

### Fix round 1 RED/GREEN evidence

- Continuous-order RED: new unit test accepted a skipped/out-of-order item before the state-machine fix.
- Database-chain RED: a playback fact for a nonexistent round was accepted before `0017`.
- Time RED: fixed-clock same-session corrections were not globally monotonic and could use future FSRS `dueAt`.
- GREEN focused unit: 1 file, 6 tests PASS.
- GREEN focused integration: 1 file, 12 tests PASS.

### Fix round 1 final verification

- Node: `24.15.0`
- Full unit: 26 files, 73 tests PASS
- Full integration: 15 files, 102 tests PASS against explicit `family_learning_test`
- `pnpm lint`: PASS, zero warnings
- `pnpm typecheck`: PASS
- `pnpm db:generate`: PASS, no drift
- `git diff --check`: PASS
- `0016` diff from pre-fix commit: empty
- No reset, seed, clean, existing-data deletion, live Azure call, or deployment

### Fix round 1 commit

- Fix implementation: `830ed00a9e2e3c37dfa3d4a33b730e74ab97d855`

## Fix round 2 — membership immutability and command chronology

### Findings addressed

1. **Round membership is complete, immutable, and consistent with `rounds.item_ids`**
   - Kept migrations `0016` and `0017` unchanged.
   - Added incremental migration `0018_shallow_gressill.sql` and its Drizzle snapshot.
   - Every membership insert now validates the zero-based `position` and `taskItemId` against the parent round's immutable JSON array.
   - Membership updates are rejected.
   - A direct membership delete is rejected while the parent round still exists. Cascades initiated through the parent round/session/task chain are distinguished safely and remain possible.
   - Playback/answer foreign keys from membership now use `ON DELETE RESTRICT`; deleting a membership cannot silently erase immutable answer or playback facts.
   - Deferred constraint triggers on both the parent round and membership rows verify the complete member set at transaction end. Services still insert the round and full membership set atomically in one transaction; a subset is rejected when constraints are forced or the transaction commits.
   - Independent savepoint tests cover extra member, wrong position, wrong item, update, direct delete with and without events, incomplete subset, and same-child other-task session item. Each expected database error leaves the outer transaction usable.
   - Ordered parent cleanup is exercised at both session and task level: facts are removed explicitly first, then the parent cascade removes round membership. Deferred checks are forced before continuing. This does not claim that direct whole-family deletion is available.

2. **One monotonic business-time cursor spans every dictation command**
   - Playback time is `max(now, session.updatedAt + 1ms)`.
   - Grading begins after `now`, the session timestamp, the latest answer, and the latest relevant review event.
   - Per-answer/review timestamps advance strictly; round/session state is timestamped one millisecond after the final fact in the command.
   - Next-round creation, task completion, and the completion fact use that causal state timestamp.
   - Command rows use the resulting session timestamp instead of an unrelated database default time.
   - A fixed-clock multi-round test verifies `playback1 < answer1/review1 < playback2 < answer2/review2 < completion`, monotonic `session.updatedAt`, and no jump to a future FSRS due date during same-session correction.
   - Idempotent replay returns the stored snapshot without advancing time. Stale/failed commands leave session time, version, events, and counts unchanged.

### Requirements-gap coverage added

- `allowManualReplay=false` now has integration coverage: the current-item replay is rejected without a playback fact, count change, version change, or timestamp change.
- Same-child, different-task session-item insertion has an explicit database-bypass assertion.
- Parent session/task ordered deletion verifies the membership delete trigger and deferred completeness checks together.
- Existing continuous-prefix, full item-by-item correction, outer rollback, post-completion real media read denial, real two-connection start/mutation concurrency, and Task 3 immutable review tests all remain green.

### Fix round 2 RED/GREEN evidence

- Time RED: with a fixed clock, the first playback and first answer had the same timestamp.
- Membership RED: an additional/wrongly positioned member was accepted before `0018`.
- GREEN focused integration: 1 file, 15 tests PASS.

### Fix round 2 final verification

- Node: `24.15.0`
- Full unit: 26 files, 73 tests PASS
- Full integration: 15 files, 105 tests PASS against explicit `family_learning_test`
- `pnpm lint`: PASS, zero warnings
- `pnpm typecheck`: PASS
- `pnpm db:generate`: PASS, no drift
- `git diff --check`: PASS
- `0016` and `0017` diff from the pre-fix commit: empty
- `0018` was applied only to `family_learning_test`
- No reset, seed, clean, existing-data deletion, live Azure call, production migration, or deployment

### Fix round 2 commit

- Fix implementation: `9a7c2ef082c581ff398d87bd017cb5941ad9e49c`
