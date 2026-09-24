# 习惯、账本、宠物与奖励 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为已具备独立儿童会话和听写完成事件的应用加入习惯管理、不可重复结算的成长值与星币账本、正向宠物养成、虚拟物品和家庭奖励兑换。

**Architecture:** 所有奖励、消费、冻结和退款统一进入`ledger`模块；听写、习惯、宠物和家庭奖励不能直接更新余额。宠物等级只读取累计成长值，虚拟物品只产生库存、装扮和互动效果，不改变成长速度。

**Tech Stack:** 阶段1与阶段2技术栈、PostgreSQL事务和行锁、Vitest、Playwright、经Tom批准后使用ImageGen制作宠物位图资产

**Spec:** `docs/superpowers/specs/2026-09-01-family-learning-mvp-design.md`

## Global Constraints

- 成长值只增加、不消费、不衰减；星币可以增加、冻结、扣除和退款。
- 听写完成只结算一次；重听、错误轮数和正确率不增加奖励。
- 每个孩子最多5个活跃习惯。
- 习惯可选自主完成或家长审核；照片在两种模式下都可选。
- 家长审核只能由完整家长会话执行；儿童不能自行批准。
- 一只宠物、三个成长阶段；未学习不生病、不死亡、不降级。
- 一次性物品使用后消失；永久物品可重复装备。
- 任何虚拟物品都不能加速成长。
- 家庭奖励先冻结星币；批准后扣除，拒绝后释放，兑现后标记完成。
- 家长手动调整数值必须填写原因。
- 宠物形象、颜色和首批正式物品资产必须先由Tom审批再生成。

---

### Task 1: 宠物视觉方向与资产清单审批

**Files:**
- Create: `docs/product/pet-visual-brief.md`
- Create: `public/pet/manifest.json`
- Create after approval: `public/pet/stage-1.png`
- Create after approval: `public/pet/stage-2.png`
- Create after approval: `public/pet/stage-3.png`
- Create after approval: `public/pet/items/*.png`
- Test: `tests/unit/pet-assets.test.ts`

**Interfaces:**
- Produces: asset keys `pet.stage.1`、`pet.stage.2`、`pet.stage.3`
- Produces: item keys `food.apple`、`food.biscuit`、`food.cake`、`wear.red-scarf`、`wear.blue-hat`、`toy.ball`、`decor.cushion`、`background.starry-room`

- [ ] **Step 1: 写视觉简报**

```markdown
# MVP宠物视觉简报

- 受众：幼儿园至小学五年级，不幼稚到只适合学龄前儿童。
- 性格：温暖、好奇、有活力，不卖惨，不出现饥饿或生病表情。
- 阶段：同一角色的幼年、成长、成熟三个阶段，轮廓连续可识别。
- 构图：透明背景、正面或四分之三视角、适合256×256像素显示。
- 禁止：文字、商标、学校标识、真实儿童形象、惩罚性状态。
- 物品：食物与装扮分层，装扮位置在三个阶段保持一致。
```

- [ ] **Step 2: 向Tom展示三个宠物方向并等待明确选择**

三个方向只改变物种和画风，不改变功能：圆润小狗、森林小熊、幻想小精灵。使用可视化或ImageGen生成概念图前先说明将调用图像生成；Tom未选择时停止本任务，不生成正式资产。

- [ ] **Step 3: 生成获批方向的正式资产**

Tom选定方向后，使用`imagegen`技能，固定同一角色设定和调色板，分别生成三个成长阶段与八个物品的透明PNG。每个文件输出为1024×1024源图，再生成256×256网页版本；不得用脚本重新绘制主体。

- [ ] **Step 4: 写资产清单测试**

```ts
import { expect, test } from "vitest";
import manifest from "../../public/pet/manifest.json";

test("宠物三个阶段和首批物品都有唯一资产", () => {
  expect(manifest.stages.map((item) => item.key)).toEqual([
    "pet.stage.1", "pet.stage.2", "pet.stage.3",
  ]);
  expect(new Set(manifest.items.map((item) => item.key)).size).toBe(8);
  expect(manifest.items.every((item) => item.acceleratesGrowth === false)).toBe(true);
});
```

Run: `pnpm test -- tests/unit/pet-assets.test.ts`

Expected: PASS。人工检查三个阶段为同一角色、透明背景无杂边、没有文字和负面状态。

- [ ] **Step 5: 提交**

```bash
git add docs/product/pet-visual-brief.md public/pet tests/unit/pet-assets.test.ts
git commit -m "assets: add approved mvp pet set"
```

### Task 2: 成长值、星币、冻结与幂等账本

**Files:**
- Create: `src/modules/ledger/schema.ts`
- Create: `src/modules/ledger/types.ts`
- Create: `src/modules/ledger/service.ts`
- Create: `src/modules/ledger/reward-policy.ts`
- Create: `src/modules/ledger/dictation-consumer.ts`
- Modify: `src/db/schema.ts`
- Test: `tests/unit/reward-policy.test.ts`
- Test: `tests/integration/ledger.test.ts`
- Create: `drizzle/0007_ledger.sql`

**Interfaces:**
- Produces: `grantRewards(request: LedgerGrantRequest): Promise<LedgerBalance>`
- Produces: `spendCoins(input: SpendCoinsInput): Promise<LedgerBalance>`
- Produces: `createCoinHold(input: CoinHoldInput): Promise<CoinHold>`
- Produces: `captureCoinHold(holdId: string, idempotencyKey: string): Promise<LedgerBalance>`
- Produces: `releaseCoinHold(holdId: string, idempotencyKey: string): Promise<LedgerBalance>`
- Produces: `getBalance(actor: Actor, childId: string): Promise<LedgerBalance>`

```ts
export type SpendCoinsInput = { familyId: string; childId: string; amount: number; sourceType: "shop_purchase"; sourceId: string; idempotencyKey: string };
export type CoinHoldInput = { familyId: string; childId: string; amount: number; sourceType: "family_reward"; sourceId: string; idempotencyKey: string };
export type CoinHold = { id: string; childId: string; amount: number; status: "active" | "captured" | "released" };
```

- [ ] **Step 1: 写奖励策略失败测试**

```ts
import { expect, test } from "vitest";
import { rewardForLearningTask } from "@/modules/ledger/reward-policy";

test("听写奖励与正确率和错题轮数无关", () => {
  expect(rewardForLearningTask({ uniqueCardCount: 10, firstPassCorrectCount: 10, retryRounds: 0 }))
    .toEqual({ growthXp: 10, starCoins: 5 });
  expect(rewardForLearningTask({ uniqueCardCount: 10, firstPassCorrectCount: 2, retryRounds: 4 }))
    .toEqual({ growthXp: 10, starCoins: 5 });
});
```

初始平衡参数固定为：完成一组听写10成长值、5星币；习惯默认3成长值、2星币，家长可为单个习惯调整为0至20之间的整数。参数集中存放，不散落在页面。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- tests/unit/reward-policy.test.ts`

Expected: FAIL，奖励策略不存在。

- [ ] **Step 3: 实现追加式账本**

```ts
export type LedgerGrantRequest = {
  familyId: string;
  childId: string;
  growthXp: number;
  starCoins: number;
  sourceType: "dictation" | "habit" | "manual_adjustment";
  sourceId: string;
  idempotencyKey: string;
};

export type LedgerBalance = {
  growthXp: number;
  starCoins: number;
  heldStarCoins: number;
  availableStarCoins: number;
};
```

表包含`ledgerEntries`、`ledgerBalances`和`coinHolds`。`ledgerEntries`对`familyId + idempotencyKey`建立唯一索引。每次写入在事务内锁定余额行，追加流水并更新快照；成长值负数写入被数据库检查约束拒绝。

- [ ] **Step 4: 写并发幂等集成测试**

```ts
test("十个并发重复发奖只入账一次", async () => {
  const request = fixture.dictationGrant({ idempotencyKey: "dictation:session-1" });
  await Promise.all(Array.from({ length: 10 }, () => grantRewards(request)));
  expect(await getBalance(actor, request.childId)).toMatchObject({ growthXp: 10, starCoins: 5 });
  expect(await countLedgerEntries(request.idempotencyKey)).toBe(1);
});
```

另写测试覆盖余额不足不能消费、冻结后可用余额下降、释放恢复、捕获只扣一次、家长手动调整缺少原因被拒绝。

- [ ] **Step 5: 连接听写完成事件**

`dictation-consumer.ts`消费`LearningTaskCompleted`，使用`dictation:{sessionId}`作为幂等键。只有会话状态为`completed`且所有题最终正确时发奖。

Run: `pnpm test -- tests/unit/reward-policy.test.ts`

Expected: PASS。

Run: `pnpm test:integration -- tests/integration/ledger.test.ts`

Expected: PASS，所有并发场景通过。

- [ ] **Step 6: 提交**

```bash
git add src/modules/ledger src/db/schema.ts tests/unit/reward-policy.test.ts tests/integration/ledger.test.ts drizzle
git commit -m "feat: add idempotent growth and coin ledger"
```

### Task 3: 习惯任务、可选照片与家长审核

**Files:**
- Create: `src/modules/habits/schema.ts`
- Create: `src/modules/habits/types.ts`
- Create: `src/modules/habits/service.ts`
- Create: `src/modules/habits/review-service.ts`
- Modify: `src/db/schema.ts`
- Create: `src/app/(parent)/parent/habits/page.tsx`
- Create: `src/app/(parent)/parent/habits/review/page.tsx`
- Create: `src/app/(child)/child/habits/page.tsx`
- Create: `src/app/api/parent/habits/route.ts`
- Create: `src/app/api/parent/habits/submissions/[submissionId]/route.ts`
- Create: `src/app/api/child/habits/[habitId]/complete/route.ts`
- Test: `tests/unit/habit-limit.test.ts`
- Test: `tests/integration/habits.test.ts`
- Create: `drizzle/0008_habits.sql`

**Interfaces:**
- Produces: `createHabit(actor: GuardianActor, input: CreateHabitInput): Promise<Habit>`
- Produces: `submitHabit(actor: ChildActor, input: SubmitHabitInput): Promise<HabitSubmission>`
- Produces: `reviewHabitSubmission(actor: GuardianActor, submissionId: string, decision: "approve" | "reject"): Promise<HabitSubmission>`

```ts
export type Habit = { id: string; familyId: string; childId: string; title: string; verificationMode: "self" | "guardian"; growthXp: number; starCoins: number; active: boolean };
export type HabitSubmission = { id: string; habitId: string; childId: string; occurrenceKey: string; photoMediaId: string | null; status: "pending" | "approved" | "rejected" };
```

- [ ] **Step 1: 写五个活跃习惯限制失败测试**

```ts
import { expect, test } from "vitest";
import { assertActiveHabitLimit } from "@/modules/habits/service";

test("第六个活跃习惯被拒绝", () => {
  expect(() => assertActiveHabitLimit(5)).toThrow("ACTIVE_HABIT_LIMIT_REACHED");
  expect(() => assertActiveHabitLimit(4)).not.toThrow();
});
```

- [ ] **Step 2: 实现习惯模型与周期唯一键**

```ts
export type CreateHabitInput = {
  childId: string;
  title: string;
  verificationMode: "self" | "guardian";
  cadence: { type: "daily" } | { type: "weekdays"; weekdays: number[] };
  growthXp: number;
  starCoins: number;
};

export type SubmitHabitInput = {
  habitId: string;
  occurrenceKey: string;
  photoMediaId?: string;
  commandId: string;
};
```

表包含`habits`、`habitSubmissions`和`habitReviews`。`habitSubmissions`对`habitId + childId + occurrenceKey`唯一。照片字段允许为空；服务必须验证照片类型为`habit_photo`且属于同一家庭和孩子。

- [ ] **Step 3: 实现两种结算流程**

自主模式提交后立即调用`grantRewards`，幂等键为`habit:{submissionId}`。家长审核模式保持`pending`，批准后才发奖；拒绝不发奖。批准或拒绝时把照片`expiresAt`设为审核完成时间加30天。

```ts
test("孩子不能审核且重复批准只发一次奖励", async () => {
  const submission = await fixture.pendingHabitSubmission();
  await expect(reviewAsChild(submission.childActor, submission.id)).rejects.toThrow("GUARDIAN_REQUIRED");
  await reviewHabitSubmission(submission.guardianActor, submission.id, "approve");
  await reviewHabitSubmission(submission.guardianActor, submission.id, "approve");
  expect(await countLedgerEntries(`habit:${submission.id}`)).toBe(1);
});
```

- [ ] **Step 4: 运行测试并完成页面**

Run: `pnpm test -- tests/unit/habit-limit.test.ts`

Expected: PASS。

Run: `pnpm test:integration -- tests/integration/habits.test.ts`

Expected: PASS，自主、审核、拒绝、无照片、带照片、重复提交和越权场景全部通过。

儿童页面最多显示5个大卡片，照片上传按钮标注“可选”。家长审核页同时允许查看无照片提交，不把照片当作批准的必要条件。

- [ ] **Step 5: 提交**

```bash
git add src/modules/habits src/db/schema.ts src/app/\(parent\)/parent/habits src/app/\(child\)/child/habits src/app/api/parent/habits src/app/api/child/habits tests/unit/habit-limit.test.ts tests/integration/habits.test.ts drizzle
git commit -m "feat: add configurable family habits"
```

### Task 4: 宠物阶段、商品、库存与互动

**Files:**
- Create: `src/modules/pets/schema.ts`
- Create: `src/modules/pets/catalog.ts`
- Create: `src/modules/pets/service.ts`
- Modify: `src/db/schema.ts`
- Create: `src/app/(child)/child/pet/page.tsx`
- Create: `src/app/(child)/child/shop/page.tsx`
- Create: `src/app/api/child/pet/route.ts`
- Create: `src/app/api/child/shop/purchase/route.ts`
- Create: `src/app/api/child/inventory/[inventoryId]/use/route.ts`
- Test: `tests/unit/pet-growth.test.ts`
- Test: `tests/integration/pet-shop.test.ts`
- Create: `drizzle/0009_pets.sql`

**Interfaces:**
- Produces: `petStageForGrowthXp(growthXp: number): 1 | 2 | 3`
- Produces: `purchaseItem(actor: ChildActor, itemKey: string, commandId: string): Promise<InventoryState>`
- Produces: `useConsumable(actor: ChildActor, inventoryId: string, commandId: string): Promise<PetInteraction>`
- Produces: `equipPermanent(actor: ChildActor, inventoryId: string, slot: PetSlot, commandId: string): Promise<PetState>`

```ts
export type PetSlot = "head" | "neck" | "toy" | "decor" | "background";
export type InventoryState = { inventoryId: string; itemKey: string; kind: "consumable" | "permanent"; quantity: number };
export type PetInteraction = { id: string; itemKey: string; animationKey: string; growthXpDelta: 0 };
export type PetState = { childId: string; stage: 1 | 2 | 3; equipped: Partial<Record<PetSlot, string>> };
```

- [ ] **Step 1: 写成长与商品规则失败测试**

```ts
import { expect, test } from "vitest";
import { petStageForGrowthXp, catalog } from "@/modules/pets/catalog";

test("宠物只按成长值跨越三个阶段", () => {
  expect(petStageForGrowthXp(0)).toBe(1);
  expect(petStageForGrowthXp(99)).toBe(1);
  expect(petStageForGrowthXp(100)).toBe(2);
  expect(petStageForGrowthXp(349)).toBe(2);
  expect(petStageForGrowthXp(350)).toBe(3);
  expect(catalog.every((item) => item.growthMultiplier === 1)).toBe(true);
});
```

- [ ] **Step 2: 实现初始商品目录**

```ts
export const PET_STAGE_THRESHOLDS = [0, 100, 350] as const;

export const catalog = [
  { key: "food.apple", kind: "consumable", price: 5, growthMultiplier: 1 },
  { key: "food.biscuit", kind: "consumable", price: 8, growthMultiplier: 1 },
  { key: "food.cake", kind: "consumable", price: 12, growthMultiplier: 1 },
  { key: "wear.red-scarf", kind: "permanent", slot: "neck", price: 40, growthMultiplier: 1 },
  { key: "wear.blue-hat", kind: "permanent", slot: "head", price: 60, growthMultiplier: 1 },
  { key: "toy.ball", kind: "permanent", slot: "toy", price: 50, growthMultiplier: 1 },
  { key: "decor.cushion", kind: "permanent", slot: "decor", price: 80, growthMultiplier: 1 },
  { key: "background.starry-room", kind: "permanent", slot: "background", price: 120, growthMultiplier: 1 },
] as const;
```

表包含`pets`、`catalogItems`、`inventoryItems`和`petInteractions`。一次性库存保存数量，使用时在事务内减1并追加互动；永久商品第一次购买后始终保留，再次购买被拒绝。

- [ ] **Step 3: 写购买和使用集成测试**

```ts
test("食物消耗但不增加成长值，永久物品可重复装备", async () => {
  await fixture.grantCoins(child, 100);
  const before = await getBalance(child, child.childId);
  const food = await purchaseItem(child, "food.apple", "buy-1");
  await useConsumable(child, food.inventoryId, "use-1");
  const after = await getBalance(child, child.childId);
  expect(after.growthXp).toBe(before.growthXp);
  expect(after.starCoins).toBe(before.starCoins - 5);

  const scarf = await purchaseItem(child, "wear.red-scarf", "buy-2");
  await equipPermanent(child, scarf.inventoryId, "neck", "equip-1");
  await equipPermanent(child, scarf.inventoryId, "neck", "equip-2");
  expect((await getInventory(child)).find((item) => item.key === "wear.red-scarf")).toBeTruthy();
});
```

- [ ] **Step 4: 运行测试和完成页面**

Run: `pnpm test -- tests/unit/pet-growth.test.ts`

Expected: PASS。

Run: `pnpm test:integration -- tests/integration/pet-shop.test.ts`

Expected: PASS，余额不足、重复购买、重复使用和并发消费测试通过。

宠物页显示成长阶段、成长进度、当前装扮和互动入口，不显示饥饿、生命或倒计时。商店明确区分“一次使用”和“永久拥有”。

- [ ] **Step 5: 提交**

```bash
git add src/modules/pets src/db/schema.ts src/app/\(child\)/child/pet src/app/\(child\)/child/shop src/app/api/child/pet src/app/api/child/shop src/app/api/child/inventory tests/unit/pet-growth.test.ts tests/integration/pet-shop.test.ts drizzle
git commit -m "feat: add positive pet and virtual shop"
```

### Task 5: 家庭奖励冻结、批准、拒绝与兑现

**Files:**
- Create: `src/modules/family-rewards/schema.ts`
- Create: `src/modules/family-rewards/service.ts`
- Modify: `src/db/schema.ts`
- Create: `src/app/(parent)/parent/rewards/page.tsx`
- Create: `src/app/(child)/child/rewards/page.tsx`
- Create: `src/app/api/parent/rewards/route.ts`
- Create: `src/app/api/child/rewards/[rewardId]/request/route.ts`
- Create: `src/app/api/parent/reward-redemptions/[redemptionId]/route.ts`
- Test: `tests/integration/family-rewards.test.ts`
- Create: `drizzle/0010_family_rewards.sql`

**Interfaces:**
- Produces: `createFamilyReward(actor: GuardianActor, input: CreateFamilyRewardInput): Promise<FamilyReward>`
- Produces: `requestRedemption(actor: ChildActor, rewardId: string, commandId: string): Promise<Redemption>`
- Produces: `decideRedemption(actor: GuardianActor, redemptionId: string, decision: "approve" | "reject", commandId: string): Promise<Redemption>`
- Produces: `markRedemptionFulfilled(actor: GuardianActor, redemptionId: string, commandId: string): Promise<Redemption>`

```ts
export type CreateFamilyRewardInput = { title: string; description?: string; starCoinPrice: number };
export type FamilyReward = { id: string; familyId: string; title: string; description: string | null; starCoinPrice: number; active: boolean };
export type Redemption = { id: string; rewardId: string; childId: string; holdId: string; status: "requested" | "approved_pending_fulfillment" | "rejected" | "fulfilled" };
```

- [ ] **Step 1: 写状态转换失败测试**

```ts
import { expect, test } from "vitest";
import { nextRedemptionStatus } from "@/modules/family-rewards/service";

test("家庭奖励只允许既定状态转换", () => {
  expect(nextRedemptionStatus("requested", "approve")).toBe("approved_pending_fulfillment");
  expect(nextRedemptionStatus("requested", "reject")).toBe("rejected");
  expect(nextRedemptionStatus("approved_pending_fulfillment", "fulfill")).toBe("fulfilled");
  expect(() => nextRedemptionStatus("rejected", "approve")).toThrow("INVALID_REDEMPTION_TRANSITION");
});
```

- [ ] **Step 2: 实现事务流程**

申请时调用`createCoinHold`；批准时调用`captureCoinHold`；拒绝时调用`releaseCoinHold`；兑现只改变业务状态，不再次扣币。所有调用的幂等键分别使用`redemption:{id}:request`、`:approve`、`:reject`和`:fulfill`。

```ts
test("申请冻结、拒绝释放、批准扣除且兑现不再扣币", async () => {
  await fixture.grantCoins(child, 100);
  const first = await requestRedemption(child, reward.id, "request-1");
  expect((await getBalance(child, child.childId)).availableStarCoins).toBe(100 - reward.price);
  await decideRedemption(parent, first.id, "reject", "reject-1");
  expect((await getBalance(child, child.childId)).availableStarCoins).toBe(100);

  const second = await requestRedemption(child, reward.id, "request-2");
  await decideRedemption(parent, second.id, "approve", "approve-1");
  const approvedBalance = await getBalance(child, child.childId);
  await markRedemptionFulfilled(parent, second.id, "fulfill-1");
  expect(await getBalance(child, child.childId)).toEqual(approvedBalance);
});
```

- [ ] **Step 3: 运行集成测试和完成页面**

Run: `pnpm test:integration -- tests/integration/family-rewards.test.ts`

Expected: PASS，并发双击、余额不足、越权审批、删除奖励后待处理申请等场景通过。

家长页面分“待决定”和“待兑现”；儿童页面分“可兑换”“申请中”“等待兑现”和“历史”。拒绝文案说明星币已退回。

- [ ] **Step 4: 提交**

```bash
git add src/modules/family-rewards src/db/schema.ts src/app/\(parent\)/parent/rewards src/app/\(child\)/child/rewards src/app/api/parent/rewards src/app/api/child/rewards src/app/api/parent/reward-redemptions tests/integration/family-rewards.test.ts drizzle
git commit -m "feat: add family reward redemption workflow"
```

### Task 6: 儿童首页、家长待办与激励端到端验收

**Files:**
- Modify: `src/app/(child)/child/page.tsx`
- Modify: `src/app/(parent)/parent/page.tsx`
- Create: `src/modules/ledger/summary.ts`
- Create: `src/modules/habits/summary.ts`
- Create: `src/modules/family-rewards/summary.ts`
- Test: `e2e/engagement.spec.ts`

**Interfaces:**
- Consumes: 学习完成事件、习惯、账本、宠物、家庭奖励服务
- Produces: `getChildHomeSummary(actor: ChildActor): Promise<ChildHomeSummary>`
- Produces: `getParentActionSummary(actor: GuardianActor): Promise<ParentActionSummary>`

```ts
export type ChildHomeSummary = { childId: string; growthXp: number; starCoins: number; petStage: 1 | 2 | 3; dueTaskCount: number; dueHabitCount: number; pendingRewardCount: number };
export type ParentActionSummary = { pendingHabitReviews: number; pendingRewardDecisions: number; pendingRewardFulfillments: number };
```

- [ ] **Step 1: 写端到端失败测试**

```ts
test("完成听写和习惯后可购买物品并申请家庭奖励", async ({ page }) => {
  await loginAsPairedChild(page, "小雨");
  await completePreparedDictation(page);
  await page.getByRole("button", { name: "整理书包，完成" }).click();
  await expect(page.getByText("成长值 13")).toBeVisible();
  await expect(page.getByText("星币 7")).toBeVisible();
  await purchase(page, "苹果");
  await requestFamilyReward(page, "周末亲子游戏");
  await expect(page.getByText("等待家长确认")).toBeVisible();
});
```

- [ ] **Step 2: 实现首页摘要**

儿童首页顺序为宠物、今日听写、今日习惯、成长值与星币、可用奖励；动画只在任务整体结算后播放一次。家长首页显示待审核习惯、待决定兑换和待兑现奖励数量。

- [ ] **Step 3: 运行E2E和全量验证**

Run: `pnpm test:e2e -- e2e/engagement.spec.ts`

Expected: Chromium与WebKit均PASS。

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm test:e2e`

Expected: 所有命令退出0，0 failed。

- [ ] **Step 4: 提交**

```bash
git add src/app/\(child\)/child/page.tsx src/app/\(parent\)/parent/page.tsx src/modules/ledger/summary.ts src/modules/habits/summary.ts src/modules/family-rewards/summary.ts e2e/engagement.spec.ts
git commit -m "feat: connect learning habits pets and rewards"
```

## 阶段3完成门槛

- 宠物正式资产已经Tom明确批准；未批准时只能使用标注为临时的测试图形。
- 成长值永不减少，商品不会改变成长速度。
- 所有奖励、消费、冻结、捕获和退款具有唯一流水与幂等键。
- 自主和家长审核习惯均通过；照片始终可选。
- 家庭奖励状态和星币变化一致。
- 多设备并发测试无重复发奖、重复扣币或负余额。
