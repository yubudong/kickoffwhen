# 分层布置听写与自动复习 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 家长按教材单元与课次批量布置、自动安排到期复习、撤回误派任务，孩子可查看完整任务状态并安全返回清单。

**Architecture:** 教材树是前端呈现，批量创建由服务端重新解析教材和卡片并在一个事务中生成每课任务。已有 FSRS 决定复习到期时间，Worker 每天为每个孩子及科目汇总一项到期复习。任务撤回采用软取消，todo 与 learning task 同步更新。

**Tech Stack:** Next.js 16.3.3 App Router、React 19、TypeScript、Drizzle/PostgreSQL、Vitest、Playwright、ts-fsrs。

**Spec:** `docs/superpowers/specs/2026-09-23-dictation-task-tree-design.md`

## Global Constraints

- 已上线迁移 0020 保持字节不变；新增迁移编号 0021。
- 所有家庭数据按 familyId 与 childId 授权；原有任务、审核、积分、FSRS 历史继续可读。
- 每课一项任务；教材树默认隐藏词卡，单独加练可搜索词卡。
- 每天北京时间 06:00 后每个孩子、每个科目最多一项自动复习任务，最多 20 词。
- 只从未开始的任务移除单词；未审核通过的任务可软撤回，已到账积分不可直接撤销。
- 英语词库保持空白，不编造教材内容。

---

### Task 1: 数据模型与旧记录兼容

**Files:**
- Modify: `src/modules/dictation/task-schema.ts`, `src/modules/todos/schema.ts`, `src/db/schema.ts`
- Create: `drizzle/0021_*`, `drizzle/meta/0021_snapshot.json`
- Test: `tests/integration/dictation-task-tree-migration.test.ts`

**Interfaces:** `learningTasks.origin`, `learningTasks.sectionId`, `learningTasks.batchCommandId`; `todoTasks.status` 扩展 `cancelled`；任务旧记录的 `origin` 默认 `manual`。

- [ ] 先写迁移集成测试：升级 0020 后保留一个旧 task、todo、reward，执行 0021 后它们的 ID、状态、积分均不变。
- [ ] 运行该测试，确认新字段或迁移缺失导致失败。
- [ ] 只添加任务元数据列、索引与 todo 状态检查变更；不要复制或修改 0020。
- [ ] 重跑迁移测试及现有 schema 集成测试；通过后提交本任务。

### Task 2: 服务端批量布置

**Files:**
- Modify: `src/modules/dictation/task-service.ts`, `src/modules/dictation/task-types.ts`, `src/modules/dictation/task-builder-query.ts`
- Create: `src/modules/dictation/batch-service.ts`, `src/app/api/parent/task-batches/route.ts`
- Test: `tests/integration/dictation-batch-service.test.ts`, `tests/unit/dictation-batch-route.test.ts`

**Interfaces:** `buildTaskBatch(actor, {childId, subject, sectionIds, extraCardIds, commandId, settings}): Promise<LearningTask[]>`; 返回每课一任务，加练另成一任务。服务端负责解析小节卡片并判重。

- [ ] 先写三项可观察的失败用例：勾选第一单元返回两项课次任务；第二课无效时整组回滚；相同命令重试返回原任务而不重复 todo。
- [ ] 实现事务内单任务构建器，供旧单任务入口和批量入口共用；校验家庭、小节、科目及词卡归属。
- [ ] 批量入口按教材顺序选择未开始词卡，排除活跃重复；加练支持已学过词卡，活跃重复报清楚错误。每项任务关联明确标题的 todo。
- [ ] 跑聚焦集成与 API 测试，补越权、空选择、100 词上限；通过后提交本任务。

### Task 3: 折叠教材树和加练入口

**Files:**
- Modify: `src/app/(parent)/parent/tasks/new/task-builder-form.tsx`, `src/modules/dictation/task-card-filter.ts`, `src/app/globals.css`
- Create: `src/components/dictation/curriculum-tree.tsx`, `src/components/dictation/extra-practice-picker.tsx`
- Test: `tests/unit/curriculum-selection.test.ts`, `tests/e2e/parent-task-tree.spec.ts`

**Interfaces:** 树组件返回 `sectionIds: string[]`；加练选择器返回 `extraCardIds: string[]`。预览从所选小节及当前孩子可用卡片计算，显示任务数及词数。

- [ ] 先写第一单元父级全选、取消其中一课变半选、搜索加练词不展开其余卡片的失败测试。
- [ ] 实现默认闭合目录树、父子复选框、三态状态、预览和加练抽屉；新表单向批量 API 一次提交。
- [ ] 浏览器核对桌面与窄屏，不出现默认密集词卡墙；通过后提交本任务。

### Task 4: 自动到期复习

**Files:**
- Create: `src/modules/review/auto-review-task.ts`
- Modify: `src/worker/index.ts`, `src/modules/dictation/task-service.ts`, `src/modules/todos/dictation.ts`
- Test: `tests/integration/auto-review-task.test.ts`, `tests/unit/auto-review-clock.test.ts`

**Interfaces:** `ensureDailyReviewTasks(at: Date): Promise<number>`；按上海日期与 child/subject 派生稳定命令 ID，使用旧任务创建与 TTS 队列。

- [ ] 先写固定时钟失败测试：05:59 不创建；06:00 到期且无活跃词生成一项；重复执行仍一项；同日新增到期词不生成第二项；次日继续生成下一轮。
- [ ] Worker 定期调用检查，启动后补跑；失败记录为可重试故障，不阻塞 TTS 队列。每日每科上限 20。
- [ ] 验证 FSRS 答错→同次订正→下次 dueAt→新复习任务中使用 `due_review`，再答后继续计算下一次 dueAt；通过后提交本任务。

### Task 5: 误派撤回与单词移除

**Files:**
- Create: `src/modules/dictation/task-edit-service.ts`, `src/app/api/parent/tasks/[taskId]/route.ts`
- Modify: `src/modules/todos/service.ts`, `src/components/todos/todo-board.tsx`
- Test: `tests/integration/dictation-task-edit.test.ts`, `tests/unit/parent-task-edit-route.test.ts`

**Interfaces:** `removeUnstartedTaskItem(actor, taskId, cardId)` 和 `cancelTask(actor, taskId)`；取消时同步标记 todo `cancelled`，不硬删除历史。

- [ ] 先写失败测试：未开始移词后题数与 todo 名称更新；已开始移词拒绝；撤回进行中任务后孩子不能续听；审核通过带积分的任务不能撤回。
- [ ] 实现家庭权限、事务锁、连续 position 重排、最后词触发撤回；操作幂等且刷新后仍显示已撤回的家长历史。
- [ ] 核验已有提交与积分行不被删除，孩子待完成统计排除取消任务；通过后提交本任务。

### Task 6: 孩子清单、返回和审核状态

**Files:**
- Modify: `src/components/todos/todo-board.tsx`, `src/components/dictation/child-task-list.tsx`, `src/components/dictation/dictation-experience.tsx`, `src/modules/dictation/child-view-service.ts`, `src/modules/todos/validation.ts`, `src/app/(child)/child/tasks/page.tsx`
- Test: `tests/unit/child-task-summary.test.ts`, `tests/e2e/child-task-navigation.spec.ts`

**Interfaces:** 孩子看到每课标题、待完成/完成数量、音频准备、待审核、通过、积分；听写页提供明确返回，未提交批改选择时提醒。

- [ ] 先写失败测试：两项课次任务的标题与计数、提交后“待审核”、家长通过后“积分到账”、听写中返回再续听保留已提交进度。
- [ ] 扩充孩子列表投影与页面，并在听写组件等待正在保存的命令后返回；离开时销毁播放序列，批改临时选择有确认提示。
- [ ] 跑聚焦 E2E，检查孩子首页与 `/child/tasks` 状态一致；通过后提交本任务。

### Task 7: 发布前复核与交付

**Files:**
- Modify: `docs/runbooks/dictation-integration.md`, `docs/听写实施进度.md`
- Test: 全量单元、集成、lint、typecheck、Next build、Chromium/WebKit E2E。

- [ ] 在隔离数据库重放 0000→0020→0021，并与升级前家庭记录和积分逐项对比。
- [ ] 运行 `pnpm test`、`pnpm test:integration`、`pnpm lint`、`pnpm typecheck`、`pnpm build`，核对退出码和测试数；运行相关浏览器用例。
- [ ] 审核新迁移与任务取消对现有生产数据库的影响；记录回退、词库及媒体不变性。
- [ ] 更新 PR，提供部署前可核对的提交、测试及实际设备试听清单；生产发布按已确认的运维边界办理。
