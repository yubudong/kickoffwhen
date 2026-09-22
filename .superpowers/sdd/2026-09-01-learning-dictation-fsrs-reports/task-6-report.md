# Task 6 report — guardian learning reports

Status: **implemented, locally verified and committed.** This is a Stage 2 local candidate only. Nothing was deployed, no production database was accessed, no real Azure provider/network call was made, and no schema migration was needed.

## Scope implemented

- Guardian report home at `/parent/reports`, single-session report at `/parent/reports/sessions/[sessionId]`, card history at `/parent/reports/cards/[cardId]`, and strict weekly JSON at `/api/parent/reports/weekly`.
- Today-first dashboard for every active child: task state, latest completed session link, weak cards from today's completed sessions, and tomorrow's due count.
- Session metrics from immutable Task 4 facts: unique item count, first-pass accuracy, final completion rate, retry count, correction-round count, and manual replay count.
- Completed-only weekly report with fixed `Asia/Shanghai` Monday `[start, start + 7 days)` boundaries, study days, completed tasks, nullable accuracy, seven-day trend, scheduled-review retention, and stable top-ten weak-card ranking.
- Family/child/card-scoped current due state and chronological latest-100 answer history. `continued_error` stays visible as an error fact with `eventType: null` and never becomes an FSRS or retention success.
- Parent navigation, supportive report UI, self-grading disclosure, and unavailable Stage 3 habit/reward placeholders.

No coin ledger, pet, virtual item, reward, or habit mutation/read model was added.

## Metric and fact contract

- A session report exists only when the immutable completion event, session, task, item snapshots, answer events, round memberships and playback facts form one consistent family/child/task/session chain. Missing or foreign records are uniform not-found; inconsistent completed aggregates fail closed.
- First pass is exactly one `first_pass` answer per immutable session item. Final completion is the latest answer fact per item. Retries are all answer facts after the first. Correction rounds are distinct recorded rounds greater than one.
- Manual replay is derived per immutable `(round, task item)` membership: `sum(max(playback fact count - 1, 0))`. The one required first playback for each membership is removed. Task `repeatCount` audio repetition is not counted as manual replay.
- Weekly reports include only sessions with immutable completion events in the Shanghai week. Study days use distinct Shanghai calendar dates. Accuracy remains `null` when there is no denominator.
- Retention consumes only first-pass review events whose event type is `scheduled_first`. `new_first`, `continued_error`, and same-session relearning do not inflate scheduled retention.
- Weak-card ranking consumes only incorrect first-pass facts and sorts by error count descending, latest error descending, then card ID ascending before limiting to ten.
- Report services are read-only and do not update Task 3/4 facts or review state.

## Query, authorization and API design

- All identities come from the verified guardian actor. Request bodies and query strings cannot choose `familyId`.
- Page and API entry points require parent access plus completed family setup; device parent mode therefore also requires a currently valid PIN unlock. Child routes were not added.
- Session, weekly, dashboard and card queries carry family/child/task/session/card joins through the immutable database chain, including family-owned or built-in-card visibility.
- Dashboard fan-out is set based: four selects total for any child count (children, tasks/completions, weak facts, due states). An integration query-count guard verifies four children still use exactly four selects. No child/card N+1 query was introduced.
- Weekly API accepts exactly one UUID `childId` and one real Monday `YYYY-MM-DD` `weekStart`; duplicate, missing, extra, malformed, non-Monday and impossible dates return 400. Cross-family and absent records return 404; inconsistent facts return 503. The response is strict and serializes all timestamps as ISO strings.
- Next 16 route handlers are dynamic through authenticated request headers; no cache opt-in or stale report cache was added.

## TDD evidence

Observed RED cases:

1. Pure metric tests initially failed because the report metric/time/ranking modules did not exist.
2. Integration tests initially failed because session, weekly, card-history and dashboard services did not exist; early test construction also exposed exact Task 4 FK/round/playback requirements and was corrected without weakening production constraints.
3. Page/API tests initially failed because the report components and weekly handler did not exist.
4. Card-history semantics RED showed `continued_error` was represented as `same_session_relearning`; GREEN retains the answer fact with a null review-event type and null retention result.
5. The new browser assertion initially assumed a fixed weak word. The real source-order fixture showed the immutable wrong card can differ; the test now captures the actual weak-card link and proves the overview, session report and card history agree on that identity.

Browser-suite diagnostics also found two inherited fixture races, fixed only in test code:

- Client-only child-switch buttons were clicked before hydration in two existing tests. Waiting for the fresh document's `networkidle` state made the same production behavior deterministic in Chromium and WebKit.
- Multiple WebKit tests shared the project IP and the fourth `/sign-up/email` received HTTP 429. The database showed the exact rate-limit key at count three. Dictation fixtures now use a unique `x-forwarded-for` per test, so fixtures do not consume each other's sign-up allowance.

## Final verification

Environment: Node `v24.15.0`; PostgreSQL database explicitly `family_learning_test`; integration transactions always rolled back; Playwright used `.next-e2e`, port 3105, `FAMILY_LEARNING_TEST_MODE=e2e`, and `reuseExistingServer: false`.

- Pure report metrics: 6/6 PASS.
- Report page/API unit set: 13/13 PASS.
- Report integration set: 7/7 PASS, including family isolation, Shanghai week boundaries, completed-only weekly facts, card latest-100 semantics and constant dashboard query count.
- Full unit: 33 files / 110 tests PASS.
- Full integration: 17 files / 121 tests PASS against `family_learning_test`.
- ESLint: PASS.
- `pnpm typecheck`: PASS.
- Production build: PASS with local test-only DB/auth and dummy SMTP configuration; it did not connect to SMTP or any external provider.
- Focused report browser chain: Chromium + WebKit, 4/4 PASS.
- Default parallel full E2E after fixture fixes: 15/16 PASS; the sole failure was an inherited WebKit password-reset status/navigation hydration race outside Task 6, while both report flows passed.
- Final full E2E with one worker: Chromium + WebKit, 16/16 PASS on a fresh server.
- `git diff --check` and staged diff check: PASS.

E2E teardown deleted only resources recorded by each generated dictation fixture. No reset, seed, clean, broad deletion, pre-existing/manual-data cleanup or non-test database operation occurred.

## Files and commit

- Report domain: `src/modules/reports/*`.
- Pages/API: `src/app/(parent)/parent/reports/*`, `src/app/api/parent/reports/weekly/route.ts`.
- UI/navigation: `src/app/globals.css`, `src/components/parent/parent-nav.tsx`.
- Tests: `tests/unit/report-*.test.*`, `tests/integration/report-queries.test.ts`, and the report assertions in `e2e/dictation.spec.ts`.

Starting HEAD: `2dfb538fad8f3fd7d2aff7eb56469c1dfbc646bb`.

Implementation commit: `e785ceb73e320e91efa5582aff2f9b8d894dbc6e` (`feat: add family learning reports`).

The final working-tree `next-env.d.ts` is restored to the user's dev-server imports under `.next/dev/types` and remains deliberately uncommitted. During Task 6 verification, Next type generation/build rewrote those imports to `.next/types`; the initial report incorrectly described the file as untouched. Fix Round 1 restores the actual pre-task user state and excludes it from every commit.

## Limits and release boundary

- This is not deployed and has not been exercised on Hetzner or against production data.
- Real Azure TTS/OCR providers remain disabled and unverified; no real provider/network request was made.
- The verified textbook seed library remains empty, so this report work does not claim populated 人教版五年级上册 content.
- Stage 3 coin ledger, pet growth, virtual inventory, family rewards and habits are not implemented. The disabled report placeholders do not imply otherwise.
- Physical-device, real-family load, accessibility assistive-technology and production-volume performance testing remain future acceptance work.
- Production build still reports the eight inherited Turbopack dynamic-filesystem tracing warnings from `src/modules/media/store.ts`; they predate Task 6 and remain a deployment artifact-size/path risk.

## Fix Round 1 — dashboard precedence and fail-closed session facts

Status: **implemented, locally verified and committed.** No migration, deployment, Azure call, non-test database access, seed/reset/clean, or manual-data cleanup occurred. The report UI markup and API response schema did not change.

### Review findings corrected

- A child with both a completed session and another active task now reports `in_progress`. The previous completed-first ternary incorrectly implied all of today's work was finished. The latest completed-session link, today's weak facts and tomorrow's due count remain available.
- Session metrics now require a bijection between immutable round memberships and answer facts: every `(round, task item)` membership has exactly one answer and every answer resolves to one membership.
- Round 1 accepts only `first_pass`. Later rounds reject `first_pass`; incorrect later facts must be `continued_error`, correct later facts must be `same_session_relearning`.
- Each item's round sequence starts at one, is contiguous, preserves card/answer identity, and stops after its first correct fact. Answer timestamps must advance between rounds, matching the monotonic Task 4 writer.
- Missing, duplicate, out-of-order or role-inconsistent facts raise `REPORT_INCONSISTENT`; the service does not compute a plausible-looking metric from partial history.

### RED → GREEN evidence

- Pure RED: a three-round membership set with the round-two answer removed returned metrics instead of throwing. The same test also covers duplicate membership answers, a non-first-pass round-one role, a repeated first-pass role in round two, and non-increasing round timestamps. Focused GREEN: 7/7.
- Integration RED: deleting the exact round-two answer from a completed rollback fixture returned a report with `retryCount: 1` and only one recorded error. GREEN returns `REPORT_INCONSISTENT`; report integration is 8/8.
- Dashboard RED: one child with a completed task and a second active task returned `completed`. GREEN returns `in_progress` while retaining `latestCompletedSessionId` for the completed session.
- The card-history component fixture was corrected to keep `continued_error.eventType` null, matching the stored-fact contract. Focused page/component tests: 3/3.

### Final Fix Round 1 verification

Environment remains Node `v24.15.0` with explicit `family_learning_test` and rollback-only integration fixtures.

- Full unit: 33 files / 111 tests PASS.
- Full integration: 17 files / 122 tests PASS.
- ESLint: PASS.
- `pnpm typecheck`: PASS.
- Production build: PASS with the same local-only DB/auth/dummy-SMTP configuration and the same eight inherited media tracing warnings.
- `git diff --check` and staged diff check: PASS.

Chromium/WebKit E2E was not rerun in this fix round because no page markup, client behavior, route or response schema changed. The read-model precedence change is covered by a database integration fixture containing simultaneous completed and active tasks; the existing browser fixture does not contain that state. The prior Task 6 full fresh-server 16/16 result remains baseline evidence, not post-fix browser evidence.

Fix Round 1 commit: `e152fc0e22f5f95059b9fb713ba9c7fc3b8f962b` (`fix: fail closed on incomplete report facts`).

The local candidate is still not deployed. Real Azure providers remain disabled, verified textbook seeds remain empty, and Stage 3 ledger/coin/pet/reward/habit work remains unimplemented.
