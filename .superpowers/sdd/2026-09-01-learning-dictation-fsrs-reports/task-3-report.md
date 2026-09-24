# Task 3 report — 学习任务与 FSRS 调度

## Delivered scope

- 精确锁定 `ts-fsrs@5.4.2`，按实际 5.4.2 API 封装 `createEmptyCard` / `fsrs().next()`。
- FSRS 参数固定 `request_retention: 0.9`；首轮正确/错误分别映射 `Good` / `Again`。
- 强制显式事件类型 `new_first` / `scheduled_first`；同场订正单独保存为 `same_session_relearning`，并关联原首轮错误事件。
- 每个孩子/卡片持久化完整 FSRS card JSON 与可查询 `dueAt`；事件记录不覆盖。
- 任务创建是事务化且以 `familyId + commandId` 幂等；同一 command 不同输入返回冲突。
- 规划顺序为到期复习优先、`maxReviewCards` 截断、再加家长显式选择的新卡；超出上限的到期卡不被改写。
- 设置完整校验：模式、顺序、题间隔、播报次数、语速、手动重听、复习上限。
- 跨家庭孩子/卡片、重复卡片、已开始的“新卡”和无效设置均拒绝；服务层与数据库复合外键/触发器双重限定。
- 任务只使用 Task 2 的 canonical TTS dedupe builder 查缓存/入队；中文用 `zh-CN-XiaoxiaoNeural`，英文用 `en-US-JennyNeural`。未命中缓存时显示 `preparing/queued`，不调用 live Azure。
- 儿童私密媒体读取已收紧为：同家庭、同孩子、TTS、未删除、且能通过 active task item + TTS dedupe key 证明关联。OCR 对儿童始终拒绝。
- 完成家长新建听写页和 POST API 最小闭环：家长/session、设置/PIN gate，到期数、新卡选择、全部任务设置、音频就绪反馈；请求严格拒绝伪造 `familyId`。

## TDD evidence

### RED

- `pnpm test -- tests/unit/fsrs-scheduler.test.ts`
  - FAIL: `Cannot find package '@/modules/review/scheduler'`。
- `pnpm exec vitest run --config vitest.integration.config.ts tests/integration/task-planner.test.ts`
  - FAIL: `Cannot find package '@/modules/dictation/task-service'`。

### GREEN

- FSRS 聚焦单测：2/2 PASS（后续加入 API 后聚焦单测 5/5 PASS）。
- Task planner 聚焦集成：5/5 PASS，覆盖 due-first/cap、幂等、家庭隔离、设置/卡片负向、中英文语音映射、audio readiness、child task-scoped media auth、事件持久化与 DB trigger。

## Migration

- 新迁移：`drizzle/0013_sharp_masque.sql`。
- 新表：`learning_tasks`、`learning_task_items`、`child_card_states`、`review_events`。
- 新约束：家庭/孩子/监护人复合外键，任务 command 唯一约束，任务顺序/卡片唯一约束，设置枚举/数值检查，复习事件类型/评分/来源检查，学习卡家庭范围触发器。
- 仅对显式测试库 `postgres://app:app@127.0.0.1:5433/family_learning_test` 以 `FAMILY_LEARNING_TEST_MODE=integration` 应用。
- 首次应用暴露生成 SQL 的复合 FK 早于被引用 unique constraint；已调整 0013 内的约束创建顺序，随后迁移 PASS。没有 reset/seed/clean 测试库。

## Files

- Dependency: `package.json`, `pnpm-lock.yaml`
- Migration: `drizzle/0013_sharp_masque.sql`, `drizzle/meta/0013_snapshot.json`, `drizzle/meta/_journal.json`
- Schema: `src/db/schema.ts`, `src/modules/review/db-schema.ts`, `src/modules/dictation/task-schema.ts`, `src/modules/learning-content/schema.ts`, `src/modules/media/schema.ts`
- FSRS: `src/modules/review/schema.ts`, `src/modules/review/scheduler.ts`, `src/modules/review/service.ts`
- Task planning: `src/modules/dictation/task-service.ts`
- Media authorization: `src/modules/media/service.ts`, `src/modules/media/store.ts`
- Parent UI/API: `src/app/(parent)/parent/tasks/new/page.tsx`, `src/app/(parent)/parent/tasks/new/task-builder-form.tsx`, `src/app/api/parent/tasks/route.ts`, `src/components/parent/parent-nav.tsx`
- Tests: `tests/unit/fsrs-scheduler.test.ts`, `tests/unit/task-api-access.test.ts`, `tests/unit/media-path.test.ts`, `tests/integration/task-planner.test.ts`

## Final verification

- Node: `v24.15.0`
- `pnpm test`: 23 files, 63 tests PASS
- `pnpm test:integration` with explicit integration env/test DB: 10 files, 76 tests PASS
- `pnpm lint`: PASS
- `pnpm typecheck`: PASS; Next 16 route types generated successfully
- `pnpm db:generate`: `No schema changes, nothing to migrate`
- `git diff --check`: PASS
- Implementation commit: `7aefe8dd7256f18692893bfa9f2898b5733ae94c`

## Remaining boundaries

- 这是本地候选实现，没有部署。
- 没有创建/保存真实 Azure key，没有调用真实 Azure Speech/Vision。音频只有在 Task 2 worker 使用已授权 provider 成功处理队列后才会变为 ready。
- Task 4 的听写 session/轮次/作答命令未实现；Task 5 儿童听写页未实现；本任务未越界提前开发。
- 家长创建页已通过类型、lint 与服务/API 测试；本任务未执行真实浏览器手工验收。
- 教材种子容器仍为空，未声称人教版内容库已录入。

## Fix round 1

### Delivered scope

- 复习写入增加 caller 稳定 `commandId` 和输入指纹；同 command 同 payload 重试返回原事件，不同 payload 返回冲突。
- 对 `family + child + card` 获取 PostgreSQL transaction advisory lock，无论 state 是否已存在都可串行化；已有 state 时不会 lost update。
- 同一首轮错误仅能订正一次；`reviewedAt` / `correctedAt` 必须严格晚于当前 state 和来源事件的合理时间。
- `0014` 增加复习事件的家庭/孩子/卡片复合来源外键、非空来源唯一约束、relearning 形状检查和来源 trigger；来源必须是同 scope 且 `correct=false` 的 `new_first` / `scheduled_first`。
- 建任务前端在一次逻辑提交中稳定复用 command ID；响应丢失/网络错误/5xx 后可以使用同 ID 重试，仅确定成功后轮换；同步 in-flight lock 拦截快速双击。
- `source` 顺序不再信任客户端点击顺序，服务端按教材/单元/来源/创建时间/ID 稳定排序；`random` 改为 Fisher-Yates 真随机并可注入 RNG 测试，due 始终优先。
- 家长建任务页提供教材单元、家长自建来源和搜索筛选，并按当前孩子排除已开始/已有 state 的卡。数据查询只返回本家庭和允许全局读的内置卡。
- 音频 readiness 和媒体 store 统一排除已过期媒体；儿童在任务 `completed` / `cancelled` 后立即失去该 TTS 读取权，OCR 仍永不可为 child read。
- API 测试直接使用生产 `buildTaskInputSchema` 和真实 handler，不再复制请求 schema。
- worker 集成测试通过 `claimDedupeKeys` 只领取本 fixture 的精确任务；环境中既有 queued job 未被领取、更新、删除或清理。

### TDD RED / GREEN

RED evidence:

- 新增 `review-idempotency` 时 2/2 失败：重试会再次推进或报错，等时间订正被接受。
- 新增 `task-submission` / `task-card-filter` 时因生产模块不存在而失败。
- 首次 full integration 为 80/86：两个独立复习连接实际均等待 advisory lock，但测试错误依赖 `pg_stat_activity.query` 文本；另有 5 个 worker 用例被环境既有 queued TTS 任务干扰。
- `worker限定去重键` 回归用例在实现前错误领取了队列中的第一个其他任务。

GREEN evidence:

- 复习幂等 2/2 PASS。
- DB 来源约束 1/1 PASS，每个拒绝都使用独立 savepoint，覆盖跨家庭/孩子/卡片、正确来源、relearning 来源、重复来源。
- 真实独立 PostgreSQL 连接并发：review 2/2 PASS，task 同 POST 1/1 PASS；阻塞条件按唯一 application name + advisory Lock 确认，不是顺序伪并发。
- task submission / card filter / API 聚焦单测 6/6 PASS。
- task planner 9/9 PASS，覆盖 source/random、due cap、家庭隔离、页面查询、媒体权限和过期状态。
- worker + review concurrency + task concurrency 聚焦集成 17/17 PASS。

### Migration and isolation

- 新迁移：`drizzle/0014_lush_fantastic_four.sql`；旧迁移 `0013` 及其 snapshot 未修改。
- 兼容旧事件：先增加 nullable 字段，用事件 ID 回填稳定 command/fingerprint，再改为 NOT NULL。
- `0014` 仅应用到显式 `family_learning_test`；Drizzle 登记 id 15 的 hash 为 `d51b8e164c438de7d34be9e28de335fb90891bcd7f69e5a2c68cb36ffe962224`，与 SQL 文件 SHA-256 一致。
- 本轮没有 reset/seed/clean 数据库，没有删除或改写既有测试数据。并发测试仅在 `finally` 中 teardown 本次自己创建的精确 fixture 记录。

### Files

- Migration/schema: `drizzle/0014_lush_fantastic_four.sql`, `drizzle/meta/0014_snapshot.json`, `drizzle/meta/_journal.json`, `src/modules/review/db-schema.ts`
- Review concurrency/idempotency: `src/modules/review/service.ts`, `tests/integration/review-idempotency.test.ts`, `tests/integration/review-concurrency.test.ts`, `tests/integration/review-db-constraints.test.ts`
- Task service/query/UI/API: `src/modules/dictation/task-service.ts`, `src/modules/dictation/task-types.ts`, `src/modules/dictation/task-builder-query.ts`, `src/modules/dictation/task-card-filter.ts`, `src/modules/dictation/task-submission.ts`, `src/app/(parent)/parent/tasks/new/page.tsx`, `src/app/(parent)/parent/tasks/new/task-builder-form.tsx`, `src/app/api/parent/tasks/route.ts`
- Tests/media isolation: `tests/integration/task-planner.test.ts`, `tests/integration/task-concurrency.test.ts`, `tests/integration/job-worker.test.ts`, `tests/unit/task-api-access.test.ts`, `tests/unit/task-card-filter.test.ts`, `tests/unit/task-submission.test.ts`, `src/modules/jobs/worker.ts`

### Verification

- Runtime: Node `v24.15.0`。
- Focused integration: 3 files / 17 tests PASS。
- `pnpm test`: 25 files / 66 tests PASS。
- `pnpm test:integration` with explicit `DATABASE_URL=postgres://app:app@127.0.0.1:5433/family_learning_test` and `FAMILY_LEARNING_TEST_MODE=integration`: 14 files / 87 tests PASS。
- `pnpm lint`: PASS。
- `pnpm typecheck`: PASS，Next 16 route types generated。
- `pnpm db:generate`: `No schema changes, nothing to migrate`。
- `git diff --check`: PASS。
- Implementation commit: `8ffdbacfcc27967076557c8eb4b91e15c405437e`。

### Remaining boundaries

- 这是本地候选实现，未部署，未应用生产迁移。
- 没有创建/保存真实 Azure key，没有调用真实 Azure Speech/Vision。
- Task 4 听写 session/作答命令、Task 5 儿童听写页、Task 6 报告仍未实现，本轮没有提前扩展。
- 教材种子仍为空；页面可筛选教材数据，但未声称人教版内容已录入。

## Fix round 2

### Delivered scope

- 新增 `0015` 不可变规则：`review_events` 的已有事实行拒绝任何 `UPDATE`，覆盖 family/child/card scope、command、fingerprint、event type、correct、rating、reviewed/due time、card JSON 和 source event。家庭级 FK cascade `DELETE` 不受该 `BEFORE UPDATE` trigger 影响。
- 家长建任务只有在 HTTP 成功且 JSON 严格通过 production `parentTaskPostResponseSchema` 时才视为确定成功。201 坏 JSON、`{}`、缺失 task 或非 UUID task 均失败，并保留原 `commandId` 供重试；同步双击锁仍生效。
- 统一 active TTS cache 条件：必须是同 family/child/dedupe、`tts_audio`、未删除，且 `expiresAt` 为空或严格晚于当前时间。任务 readiness、job requeue、worker 和 media store 共用该语义。
- 过期 TTS 不再阻止已成功 job 受控重排。旧行在事务内 soft-delete 并清空 dedupe，fake worker 生成后原子写入唯一新 active media；旧媒体不可读，新媒体只能由对应孩子的 active task 读取。
- 两个并发 worker 对同一 expired/succeeded fixture 只调用 fake provider 一次。健康 cache 的重复 enqueue 仍保持 job `succeeded`，受控 requeue 仍拒绝 `JOB_TTS_CACHE_EXISTS`；不跨家庭复用。

### TDD RED / GREEN

RED evidence:

- review immutability 用例首先证明已有事实行可被修改，或只因其他 scope 约束失败，并未得到 `REVIEW_EVENT_IMMUTABLE`。
- 建任务响应用例在 production response helper 存在前无法通过；旧 UI 只检查 `response.ok`，无法拒绝 201 坏 shape。
- expired TTS 端到端用例首次在建任务阶段失败为 `JOB_TTS_CACHE_EXISTS`，succeeded job 无法重排。

GREEN evidence:

- review DB constraints + idempotency + 独立连接 concurrency：3 files / 7 tests PASS。不可变拒绝每次在独立 savepoint 中验证，外层事务仍可用。
- task submission + production API schema：2 files / 6 tests PASS；坏响应重试使用同一 command ID，仅严格合法响应轮换。
- expired TTS / media store / worker 聚焦回归：3 files / 27 tests PASS。端到端覆盖 preparing/requeue → 并发 worker fake 合成一次 → 新 media ready → child active-task 可读，并覆盖健康 cache、跨家庭、lease/fencing 回归。

### Migration and database isolation

- 新迁移：`drizzle/0015_immutable_review_events.sql`；`0013` / `0014` 及其 snapshot 未修改。
- `0015` 只应用到显式测试库 `family_learning_test`；Drizzle 登记 id 16 的 hash 为 `4757c42c467efc65dd7174d90686ee1ff7c602670c12828f7e3fc6a19a444fe9`，与 SQL 文件 SHA-256 一致。
- 本轮没有 reset/seed/clean 数据库，没有删除、清理或改写任何既有测试数据。回滚型用例只隔离本轮 fixture；并发用例只在 `finally` 处理本次创建的精确 fixture。

### Files

- Migration/tests: `drizzle/0015_immutable_review_events.sql`, `drizzle/meta/0015_snapshot.json`, `drizzle/meta/_journal.json`, `tests/integration/review-db-constraints.test.ts`
- Response schema/controller/UI: `src/modules/dictation/task-types.ts`, `src/modules/dictation/task-submission.ts`, `src/app/(parent)/parent/tasks/new/task-builder-form.tsx`, `tests/unit/task-submission.test.ts`
- TTS lifecycle: `src/modules/media/active-cache.ts`, `src/modules/media/store.ts`, `src/modules/jobs/service.ts`, `src/modules/jobs/worker.ts`, `src/modules/dictation/task-service.ts`, `tests/integration/media-store-hardening.test.ts`, `tests/integration/task-planner.test.ts`

### Verification

- Runtime: Node `v24.15.0`。
- Focused integration：3 files / 27 tests PASS。
- `pnpm test`: 25 files / 67 tests PASS。
- `pnpm test:integration` with explicit `DATABASE_URL=postgres://app:app@127.0.0.1:5433/family_learning_test` and `FAMILY_LEARNING_TEST_MODE=integration`: 14 files / 90 tests PASS。
- `pnpm lint`: PASS。
- `pnpm typecheck`: PASS，Next 16 route types generated。
- `pnpm db:generate`: `No schema changes, nothing to migrate`。
- `git diff --check`: PASS。
- Implementation commit: `aea8fbd88ac8350e0852c657ec35e29ae62baade`。

### Remaining boundaries / runbook

- 这是本地候选实现，未部署，未应用生产迁移，未创建或使用真实 Azure key。
- 生产执行 `0014` / `0015` 前的 runbook Minor：先检查既有非空 `source_review_event_id` 是否重复，避免 `0014` 唯一约束在历史脏数据上中断。
- 过期 TTS 旧行已 soft-delete 并不可读，磁盘文件的后续物理回收属于运维清理边界，不在本轮扩展。
- Task 4/5/6 仍未实现，教材种子仍为空。
