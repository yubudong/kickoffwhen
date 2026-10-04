# Daily Todos Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline to implement this plan task-by-task. User has authorized implementation; no additional workflow selection needed.

**Goal:** Unified daily checklist with optional evidence, parental review and exactly-once points.
**Architecture:** Transactional todo module, private attachment endpoint, existing dictation integration, shared client checklist for parent/child.
**Tech Stack:** Next.js 16.3.3, React 19, PostgreSQL 17, Drizzle, Vitest.
**Spec:** docs/superpowers/specs/2026-09-22-daily-todos-design.md

## Global Constraints
Preserve existing uncommitted deployment fixes and live data. Never print secrets. Base points 1; bonus nonnegative integer. File maximum 8MB. Dates Asia/Shanghai. No commits until requested.

### 1. Domain and database
Files: src/modules/todos/{schema,validation,service}.ts, src/db/schema.ts, drizzle/*, tests/unit/todos.test.ts, tests/integration/todos.test.ts.
- [x] Test lifecycle, counts, score and file validation before implementation: reject negative/fractional bonus; pending counts done; rejected counts remaining.
- [x] Create tables with family-child-task constraints, unique dictationTaskId and reward todoId; submission version and reviewer guarded by locked task.
- [x] Implement create/list/submit/review using actor scope and transactional row locks. Review consumes expected submission number, so stale review cannot approve resubmission. Returns full task + attachments + points view.
- [x] Integration test submit→reject→resubmit→approve and duplicate approval; cross-child access.

### 2. Attachment API and task endpoints
Files: src/modules/todos/{attachments,http}.ts, src/app/api/{parent,child}/todos/**.
- [x] Test allowed file signatures, reject fake MIME and >8MB before disk writes.
- [x] Write files under generated UUID path; delete unused new file if transaction rejects. File reads authorize against persisted submission scope. Support HTTP byte ranges for audio/video.
- [x] Expose scoped GET/POST actions. Invalid actor 401, invalid input 400, stale state 409; errors never include private payload.

### 3. Dictation integration and interfaces
Files: src/modules/dictation/{task-service,session-service}.ts; src/components/todos/*; parent content/tasks pages; child homepage; parent nav; global CSS.
- [x] Link dictation creation/completion inside existing transactions. Migration backfills existing dictation records without issuing rewards.
- [x] Parent table and creation form; child unified table, completion counts, strike-through and review status; optional file preview. Refresh review state with polling.
- [x] Move library pages below /parent/tasks/content and retain redirects for old entry paths; embed content and task links under 今日听写.
- [x] Child dictation start reuses existing start API; parent approves with base+bonus preview. Buttons use pending state; completion only after server success.

### 4. Verification and rollout
- [x] Run lint/typecheck/unit tests, scoped integration tests against isolated database, production build and browser walkthrough.
- [x] Backup live database/media metadata; build unique release, apply additive migration, switch web/worker, verify health and authorization. Record rollback including migration compatibility; preserve old releases.

## Execution result
Implemented and verified locally and in isolated server preview. 157 unit tests, 27 targeted integration tests, lint/typecheck and production build pass. Browser manual lifecycle and mobile display checked. Independent review resolved stale filter-response issue. Tom confirmed production rollout. Release 20260922-todos1 is live, migration/backups/health checks complete; see docs/runbooks/daily-todos-release.md.
