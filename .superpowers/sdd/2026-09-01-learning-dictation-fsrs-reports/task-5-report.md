# Task 5 report — child dictation experience and recovery

Status: **implemented, locally verified and committed.** This is a local candidate only. Nothing was deployed, no real Azure TTS request was made, and no production database was used.

## Scope implemented

- Child-authenticated actionable task list, idempotent start/resume, strict session snapshot and command routes.
- Continuous-batch and item-by-item compatible UI over the Task 4 session engine.
- Explicit start gesture, full current-round private-audio preload gate, repeat/rate/interval settings, pause/continue and optional current-item replay.
- Batch grading with all-marks-required validation, editable local marks, wrong-item rounds and neutral encouragement.
- Scoped local recovery, stable idempotent command retry and authoritative stale-version reconciliation.
- Pending-command-aware child switching confirmation, in-progress page-leave protection and exact return-to-original-child resume.
- Large controls, visible progress, keyboard focus states and concise child-facing Chinese labels.
- Fresh Playwright server on port 3105 with a dedicated `.next-e2e` output directory, `reuseExistingServer: false`, explicit test mode and `family_learning_test`.

Task 6 rewards/reports were not implemented. No schema or migration was added.

## Answer-secrecy and authorization design

- Every page and route resolves `ChildActor` from the verified child session. Request bodies cannot provide family or child identity.
- Task/session queries always scope by the actor family and child. Missing, sibling, cross-family and cancelled sessions return the same not-found result.
- Listening DTOs are strict and contain only current-round item IDs, positions and private media URLs. They contain no answer or broadcast text.
- Listening page props, React state, DOM and accessibility text therefore contain no answers. Browser acceptance explicitly checks that a known answer is absent before grading and after refresh.
- Grading DTOs are created only after the server-verified grading phase. Continuous mode returns only current-round answers; item-by-item mode returns only the current grading item.
- Missing, expired or unauthorized audio fails closed before playback.
- Recovery storage contains only schema version, family/child/session scope, server version, round and boolean marks. It rejects extra/secret fields, wrong scope/version/round, completed sessions and marks outside the current grading scope.
- No answer, broadcast text, token, PIN, media URL or raw API response is stored locally or logged.

## API and recovery behavior

- Start accepts only an empty strict body and a UUID task path. Commands use strict discriminated schemas.
- Unknown/network/invalid responses preserve the same command ID and payload for an idempotent retry. Confirmed success or authoritative stale-version reconciliation rotates the command ID.
- Listening refresh uses the server's exact played prefix. Grading refresh restores only validated local booleans for the exact family/child/session/round/version.
- Completion and any move back to listening clear the local draft. Marks are never auto-submitted.
- Switching waits for any in-flight command, then confirms without cancelling the task/session. Returning as the original child resumes the saved session.

## TDD evidence

RED cases observed:

- Recovery tests initially failed because `client-resume` did not exist.
- Browser instrumentation showed the configured API value `speechRate: 1.25` but actual Chromium/WebKit `play()` calls used rate `1`. Root cause: `audio.load()` reset `playbackRate` to the default. The fix sets `defaultPlaybackRate` and reapplies the configured rate before every normal/manual play.
- A strict-route test showed malformed `taskId` returned 200 through a mocked service. The route now parses the path UUID and returns 400 before calling the service.

GREEN verified locally with Node 24.19.0:

- Full unit: 28 files, 87 tests passed.
- Full integration: 16 files, 108 tests passed against explicit `family_learning_test`.
- Focused Task 5 child view: 3 tests passed, covering child/sibling isolation, listening DTO secrecy, grading-only answers, expired audio and item-by-item completion.
- ESLint: passed.
- `pnpm typecheck`: passed with isolated `.next-e2e` type generation.
- Production build: passed using local test-only configuration; no email or external TTS call was made.
- `git diff --check`: passed.

One pre-existing rate-limit integration test that counts the entire shared table fluctuated once during a parallel full-suite run (expected 23 rows, observed 21). Its focused file immediately passed 11/11, and the subsequent full suite passed 108/108. No unrelated production code was changed for that transient result.

The production build reports eight existing Turbopack dynamic-filesystem tracing warnings from `src/modules/media/store.ts`. They predate Task 5 and remain a deployment-size risk to address separately.

## Browser matrix

| Browser | Fresh isolated server | Result |
|---|---|---|
| Chromium | 127.0.0.1:3105, `.next-e2e`, `FAMILY_LEARNING_TEST_MODE=e2e`, `family_learning_test`, `reuseExistingServer: false` | PASS — full continuous flow, explicit gesture, all-audio preload, pause/continue, manual replay, refresh/resume, child switch/return, grading draft recovery, wrong-item loop and completion. Actual playback observations: at least 9 plays, all at 1.25 rate, with a measured interval of at least 1.5 seconds. |
| WebKit | Same fresh server and local private MP3 fixture | PASS — same assertions and full flow. |

No real network/audio provider was used. Both browsers used `e2e/fixtures/short-silence.mp3` through the normal private-media route.

## Exact E2E fixture cleanup

Tom authorized cleanup only in `family_learning_test` for the failed Task 5 family `f47a309c-724b-4474-a324-cf6e28c261d5` and exact after-each deletion of fixtures created by each Task 5 E2E.

Before cleanup, a read-only ownership check confirmed the exact family, generated test email/name and its related records. Cleanup then used the legal aggregate/dependency order and removed only that family:

- 1 completion event, 4 answer events, 4 playback events and 6 dictation commands;
- 1 learning-task aggregate (including its session, round and item dependants through the supported cascade);
- 1 relearning review followed by 3 original review events;
- 3 child-card states, 3 private-media rows, 3 learning cards and 3 generated jobs;
- 1 test family and 1 generated test auth user.

Post-cleanup read-only checks found zero remaining families, children, tasks, cards or jobs for that exact fixture. Its physical media had already been removed by the failed run. Database deletion is not recoverable, but all deleted records were uniquely generated test data and the E2E recreates them. No production, manual-test or other residual family was touched. Subsequent E2E teardown removes only each test's recorded family/media/user identifiers.

## Main files

- Child pages/routes: `src/app/(child)/child/tasks`, `src/app/(child)/child/dictation`, `src/app/api/child/tasks`, `src/app/api/child/dictation`.
- UI: `src/components/dictation/*`, child home and global child styles.
- DTO/query/recovery: `src/modules/dictation/child-view-types.ts`, `child-view-service.ts`, `client-resume.ts`.
- Tests: `tests/unit/client-resume.test.ts`, `tests/unit/child-dictation-api.test.ts`, `tests/integration/child-dictation-view.test.ts`, `e2e/dictation.spec.ts`, local short MP3 fixture.
- Test isolation: `playwright.config.ts`, `next.config.ts`, `.gitignore`, `eslint.config.mjs`.

## Limitations

- Real Azure TTS, real household devices, physical iOS/iPadOS autoplay behavior and real network interruption remain untested.
- The browser test covers the complete continuous path. Item-by-item authorization and phase behavior are covered at route/service integration level, not by a separate E2E.
- No deployment or production database operation was performed.

## Commit

Implementation commit: `cbc491ffa0e5ad8102e64d52d21ddc33a94c615c` (`feat: add continuous dictation child experience`).

Starting HEAD: `cd7b0cac43c4f0285f976879d7e824d1ec68a72e`.

## Fix round 1 — review hardening

Status: **implemented, locally verified and committed.** No migration, deployment, Azure request, production database access or cleanup of pre-existing/manual data occurred.

### Corrected findings

- Child switching now uses full-document `window.location.replace` both when leaving dictation and after selecting the next child. The confirmation dialog supports Escape, labelled modal semantics, keyboard focus containment and focus restoration on cancel. Chromium/WebKit verify new document identities and confirm browser back/forward cannot restore the prior child's nickname, task, answer or React state.
- Command routes render the mutation's returned stored snapshot instead of discarding it and querying mutable current state. Snapshot-aware views take phase/version/round/current membership from the stored result while still checking actor ownership, immutable metadata, media authorization and active/completed task-session lifecycle. Integration proves A succeeds, B advances, and replaying A still returns A's version and phase.
- Unknown network or invalid-JSON outcomes retain an actual `{ commandId, serializedPayload }`. The UI locks grading/audio mutations and child switching until the exact payload is retried. Confirmed success or authoritative `SESSION_CHANGED` reconciliation releases the lock.
- Active sessions whose task is cancelled now uniformly fail as not found before any grading answer is returned. Completed views require both task and session to be consistently completed.
- Audio preload now has a bounded timeout, abort-aware listener/timer cleanup and full recreation through “重新准备”. Playback and continue rejections enter a recoverable state; unmount aborts and pauses current audio. The session page distinguishes audio-not-ready from not-found.
- E2E fixture identity is registered as soon as the unique email is generated, then enriched after each resource is created. Cleanup can recover a partial identity by exact email, continues database cleanup after media removal errors, and always clears in-memory fixture state. A real browser case stops after account creation, invokes exact cleanup and verifies that email has zero database rows.
- Item-by-item multi-card integration verifies current-item-only answer disclosure and carries an incorrect second item into the next round.

### RED/GREEN evidence

- Full-document isolation RED: Escape left the dialog open under the prior implementation; the document-identity assertion also distinguished soft navigation from a reload. GREEN covers cancel/focus, confirm, second full-document selection and history traversal.
- Stored result RED: a successful command returned a later queried version 9 instead of its stored version 1. GREEN returns stored version 1; the database-backed A/B/A replay test passes.
- Cancelled-task RED: an active session exposed its grading answer after its task was cancelled. GREEN returns `DICTATION_SESSION_NOT_FOUND` and the task list is empty.
- Pending-payload RED: the serialized pending-command API did not exist. GREEN verifies exact payload equality and rejection of changed marks.
- Audio RED: timeout/abort/play-rejection helpers did not exist. GREEN verifies timeout, abort cleanup/pause and rejected play handling; browser tests additionally recover from an intercepted first private-media failure.

### Final local matrix (Node 24.19.0)

- Unit: 29 files, 91 tests passed.
- Integration: 16 files, 111 tests passed against explicit `family_learning_test`; focused Task 5 view/route lifecycle: 6 passed.
- ESLint: passed with no warnings.
- `pnpm typecheck`: passed.
- Production build: passed; the same eight pre-existing `src/modules/media/store.ts` Turbopack tracing warnings remain.
- Chromium + WebKit: 4/4 passed on a fresh port-3105 server with `reuseExistingServer: false`. Each browser ran the complete real AudioSequence/BatchGrader/Experience flow plus the partial-initialization cleanup case.
- `git diff --check`: passed.

Fix round 1 implementation commit: `30ebdf06751bfca3117de38aae300272ac304c5c` (`fix: harden child dictation isolation and recovery`).

Final retry-boundary follow-up commit: `d94831c21d66342aa9628e56d69015e65e0fa2e6` (`test: verify exact retry after invalid response`). It makes invalid JSON unknown regardless of HTTP status. The real BatchGrader/Experience browser flow verifies marks become disabled and the retry request body is byte-for-byte identical to the first request in both Chromium and WebKit.

The existing user/dev-server `next-env.d.ts` change remains deliberately uncommitted. Real Azure TTS, physical devices and real network conditions remain untested.

## Fix round 2 — history, pending settlement and query secrecy

Status: **implemented, locally verified and committed.** This remains a local candidate only. No migration, deployment, real Azure request, production database access or cleanup of existing/manual data occurred. Each browser case registered its own unique fixture identity and its `afterEach` removed only that fixture.

### Corrected findings

- Every interactive entry into `/child/switch` now uses a full-document `window.location.replace`, including the child header, dictation confirmation, successful device pairing and exit from device parent mode. Selecting the next child continues to replace the full document.
- The child layout installs a minimal `pageshow` guard. A BFCache-restored document (`persisted === true`) performs one server reload so the active child session is revalidated; normal page shows do nothing and the listener is removed on unmount.
- The dictation pending reference now owns the complete operation: fetch, response-body parsing, strict DTO schema parsing, snapshot application or retry-lock outcome. Switching awaits that operation. Only the identical operation may clear the reference in `finally`, so an older settlement cannot clear a newer pending operation.
- An unknown response keeps the stable `{ commandId, serializedPayload }`, locks edits and blocks switching until a byte-identical retry succeeds or authoritative stale reconciliation completes.
- Confirmed custom switching temporarily releases the `beforeunload` guard before full replacement; a bounded fallback restores the guard if navigation does not occur. Cancel/Escape retains the page, draft and switch-button focus. Browser instrumentation observed no second native dialog.
- Listening and grading now execute different production item queries. The listening branch selects only `itemId` and `mediaId` and never joins `learningCards`; only the grading branch selects `answerText`. Integration observes the chosen production projection, while the source-level guard rejects answer columns or joins in the listening branch.
- Audio preload attempts use generation identity in addition to abort/cleanup. A stale completion or rejection from a prior retry cannot overwrite the state of a newer attempt.

### TDD and failure evidence

- The new source secrecy test first failed after query-observer instrumentation because its slice boundary included the following grading projection. The boundary was corrected to isolate the listening branch; the test then passed while continuing to reject `answerText`, `broadcastText` or `learningCards` there.
- The first dual-browser run failed in both engines after the new full-document history sequence: the test clicked the client-only start handler before the newly replaced document had hydrated. Waiting for the real document to reach `networkidle` removed that test race; the unchanged product start flow then passed in Chromium and WebKit.
- The first full integration run had one pre-existing parallel shared-table counter fluctuation (`pairingRateLimits`, expected 23, observed 21). The focused test passed 1/1 and the immediate unchanged full rerun passed 111/111, confirming transaction concurrency rather than a Task 5 regression.
- The first production build attempt correctly failed with `SMTP_URL_REQUIRED`. Re-running with a local dummy SMTP URL, as required by the production startup contract, passed without connecting to SMTP. The same eight pre-existing Turbopack dynamic-media-path warnings remain.

### Final local verification (Node 24.19.0)

- Focused unit: 3 files, 16 tests passed.
- Full unit: 30 files, 93 tests passed.
- Focused child-view integration: 6/6 passed against explicit `family_learning_test`.
- Full integration: 16 files, 111/111 passed against explicit `family_learning_test` with `FAMILY_LEARNING_TEST_MODE=integration`.
- ESLint: passed.
- `pnpm typecheck`: passed.
- Production build: passed with a local dummy SMTP URL; no email, network audio or provider call was made.
- Final E2E: Chromium 2/2 and WebKit 2/2 passed on a fresh port-3105 server with `.next-e2e`, `reuseExistingServer: false`, explicit E2E mode and `family_learning_test`.
- `git diff --check`: passed before implementation commit.

The browser flow now proves both home-page and in-dictation isolation with distinct document IDs: child A enters the switch page, child B enters a new document, and Back/Forward cannot reveal A's nickname, task text, answer, session or React state. It also defers the grading command response, clicks switch while fetch/body settlement is outstanding, verifies no confirmation appears, returns invalid JSON, verifies retry lock and no switch, and finally confirms the retry body is byte-for-byte identical. Custom confirmation produced zero native browser dialogs in both engines.

### Commit and remaining limits

Fix round 2 implementation commit: `b757713232236f66db6e3c2803a13f8f4d6d9485` (`fix: isolate child history and pending saves`).

The existing user/dev-server `next-env.d.ts` change remains deliberately uncommitted. Real Azure TTS, real household devices, physical iOS/iPadOS autoplay/BFCache behavior and uncontrolled real-network failures remain untested. No deployment was performed.

## Fix round 3 — inert switch control, truthful history evidence and terminal reconciliation

Status: **implemented, locally verified and committed.** This is still a local candidate. No migration, deployment, Azure request, production database operation or cleanup of existing/manual data occurred. Task 5 E2E continued to create and precisely remove only each test's recorded fixture.

### Corrected findings and contract

- The child-header switch control is now `<button type="button">`, not an anchor or `Link`. It has no `href`, modified-click or new-tab semantics and cannot navigate before hydration. After hydration it performs the required full-document `window.location.replace`. Its existing pill styling is retained with a 44px minimum height, inherited font, pointer cursor and native focus behavior. Static regression coverage rejects any child-header anchor/Link switch entry.
- The BFCache handler is now independently injectable and tested: ordinary `pageshow` does nothing, while exactly one persisted restore invokes server revalidation. The production listener continues to clean up on unmount.
- Listening-query secrecy markers are asserted to exist and be ordered before slicing, so an empty source slice cannot create a false pass.
- The terminal replay contract is explicit: when the current task and session are both active, a replayed stored command is rendered from its stored snapshot; when both are consistently completed, a stored nonterminal snapshot yields the authoritative current `completed` DTO; cancelled or inconsistent lifecycle pairs remain uniform not-found.
- The authoritative terminal DTO contains `items: []` and no answer text, audio URL or private-media reference. The command route returns it as `409 SESSION_CHANGED`, rather than a misleading successful replay or a 404.
- The client treats authoritative completion as terminal reconciliation: the exact pending payload is discarded, retry lock and dirty marks are cleared, scoped recovery storage is removed and the completion view replaces grading/listening. It therefore cannot remain trapped retrying an old command after another operation completed the session.

### RED/GREEN evidence

- Header RED: the static semantic test showed `<a href="/child/switch">`; GREEN sees a no-href button and repository search finds no interactive child-switch anchor/Link entry.
- Terminal RED: the database-backed sequence stored command A, completed the session with command B, then replayed A and received 404. GREEN returns `409 SESSION_CHANGED` with authoritative version 2 `completed`, empty items and no answer/audio secrets.
- Client RED: the terminal settlement function was absent. GREEN supplies a real pending grading payload and proves authoritative completion returns `retryCommand: null`, `retryLocked: false`, `dirtyMarks: false` and `clearRecovery: true`; the production component applies those effects.
- BFCache RED: the injectable persisted-event handler was absent. GREEN proves only `persisted: true` invokes the revalidation callback once.
- The first strengthened Chromium browser run reached the correct child after the new grading switch but clicked a client-only mark before the replaced document had hydrated, so draft recovery remained false. Waiting for that real document to reach `networkidle` removed the test race; the unchanged mark/reload behavior then passed in Chromium and WebKit.

### Truthful browser history evidence

Both browsers first confirm child A's stable identity and content: `小雨的今日任务` and the unique `听写任务 1`. After full-document switching to child B, Back and Forward each wait for server revalidation, require the complete B heading `小川的今日任务`, reject A's heading and task label, reject the known answer, and observe document-identity changes.

The flow separately leaves an answer-bearing grading page, selects B, traverses Back and Forward, requires B's complete identity and proves the grading heading plus `sun`, `moon` and `star` are absent. It then switches back to A and resumes the same grading session. The assertions no longer rely on an exact standalone nickname that could be absent on both correct and incorrect pages.

### Final local verification (Node 24.19.0)

- Focused unit: 3 files, 20 tests passed.
- Full unit: 30 files, 95 tests passed.
- Focused child-view integration: 7/7 passed.
- Full integration: 16 files, 112/112 passed against explicit `family_learning_test` with transaction rollback.
- ESLint and `pnpm typecheck`: passed.
- Production build: passed with local configuration and a dummy SMTP URL; no SMTP/provider connection was made. The same eight pre-existing media-path Turbopack warnings remain.
- Final Task 5 E2E: Chromium 2/2 and WebKit 2/2, total 4/4 passed on a fresh port-3105 server with `.next-e2e`, explicit E2E mode, `family_learning_test` and `reuseExistingServer: false`.
- `git diff --check`: passed before implementation commit.

Fix round 3 implementation commit: `f128e1e0c7d04767b1e17cb8bdc5b312b6fb166d` (`fix: reconcile completed child sessions`).

The existing user/dev-server `next-env.d.ts` change remains deliberately uncommitted. Real Azure TTS, physical household devices, physical iOS/iPadOS autoplay/BFCache behavior and uncontrolled real-network conditions remain untested. No deployment was performed.

## Fix round 4 — unstored command terminal recovery

Status: **implemented, locally verified and committed.** This remains a local candidate only. No migration, deployment, Azure request, production database access, fixture cleanup or existing/manual-data mutation occurred. Integration cases ran inside rollback-only transactions against the explicit `family_learning_test` database.

### Corrected contract

- A retry whose exact command never reached the server can now converge after another device completes the same session. The command service first raises the real lifecycle error (`TASK_NOT_ACTIVE` when the task completed, or `DICTATION_SESSION_NOT_ACTIVE` for a non-active session); the route catches only those two codes and requests the actor-scoped authoritative view.
- Only a consistently completed task/session pair is returned as `409 SESSION_CHANGED`. It uses the strict completed view with `items: []` and contains no answer text, broadcast text, audio URL or private-media reference. The existing client terminal reconciliation then discards the pending payload, releases the retry/dirty locks and clears scoped recovery state.
- Cancelled tasks, cancelled sessions, inconsistent lifecycle pairs, missing sessions and cross-child actors all fail closed as the same `404 SESSION_NOT_FOUND`. If the authoritative query races and yields a nonterminal view or throws, the route also returns that uniform 404 instead of exposing a grading answer.
- Validation, version/round and idempotency errors retain their existing mappings; the new branch does not reinterpret unrelated errors. Existing stored-command contracts remain unchanged: active A/B/A replay returns A's stored snapshot, while stored nonterminal replay after consistent completion returns authoritative completed.

### RED/GREEN evidence

- RED unit: both `TASK_NOT_ACTIVE` and `DICTATION_SESSION_NOT_ACTIVE` produced `409 COMMAND_REJECTED`, including when the authoritative view was completed. GREEN returns `SESSION_CHANGED` only for completed and proves a racing grading view containing a sentinel secret is reduced to `SESSION_NOT_FOUND`.
- RED integration: an exact pending grading command ID absent from `dictation_commands`, followed by another device's successful completion, retried as `COMMAND_REJECTED`; a new command against a cancelled task returned 409. GREEN proves the absent command ID still converges to version 2 completed, while task cancellation, session cancellation and cross-child access all return uniform 404.
- The terminal response is inspected as raw JSON and rejects `answerText`, the private answer sentinel, `audioUrl` and `private-media`. Existing client terminal-cleanup regression coverage passed with the real stable pending payload.

### Final local verification (Node 24.19.0)

- Focused unit/client recovery: 2 files, 19/19 tests passed.
- Focused child-view/route integration: 9/9 passed.
- Full unit: 30 files, 97/97 passed.
- Full integration: 16 files, 114/114 passed against explicit `family_learning_test` with rollback-only fixtures.
- ESLint and `pnpm typecheck`: passed.
- Production build: passed with explicit local test configuration and a dummy SMTP URL; no SMTP, TTS provider or other external request was made. The first build invocation omitted required `DATABASE_URL`, `APP_URL` and `BETTER_AUTH_SECRET` and was correctly rejected by environment validation; the complete local-test invocation passed. The same eight pre-existing media-path Turbopack warnings remain.
- `git diff --check`: passed before the implementation commit.

No browser code or response shape changed: this route now emits the already-supported `409 SESSION_CHANGED` completed DTO. Therefore Task 5 E2E was not rerun for this route-only round; the immediately preceding fresh-server Chromium 2/2 plus WebKit 2/2 (4/4) evidence remains applicable to client terminal reconciliation and child isolation.

Fix round 4 implementation commit: `07bf87f5281f37e660dc522e70f5434e545f2d12` (`fix: reconcile unstored terminal commands`).

The existing user/dev-server `next-env.d.ts` change remains deliberately uncommitted. Real Azure TTS, physical household devices, physical iOS/iPadOS behavior and uncontrolled real-network failures remain untested. No deployment was performed.
