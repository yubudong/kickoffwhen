import { expect, test } from "@playwright/test";

import { uniqueTestIp } from "./test-config";

test.use({ extraHTTPHeaders: { "x-forwarded-for": uniqueTestIp() } });

process.env.DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://app:app@127.0.0.1:5433/family_learning_test";
process.env.APP_URL = "http://127.0.0.1:3105";
process.env.BETTER_AUTH_SECRET = "test-only-secret-123456789012345678901234567890";
process.env.FAMILY_LEARNING_TEST_MODE = "e2e";

let fixtureEmail = "";
let fixtureEditionId = "";

test.afterEach(async () => {
  if (!fixtureEmail) return;
  const [{ db }, authSchema, familySchema, contentSchema, taskSchema, todoSchema, jobSchema, orm] = await Promise.all([
    import("@/db/client"), import("@/modules/auth/schema"), import("@/modules/families/schema"),
    import("@/modules/learning-content/schema"), import("@/modules/dictation/task-schema"),
    import("@/modules/todos/schema"), import("@/modules/jobs/schema"), import("drizzle-orm"),
  ]);
  const [authUser] = await db.select({ id: authSchema.user.id }).from(authSchema.user)
    .where(orm.eq(authSchema.user.email, fixtureEmail)).limit(1);
  const [guardian] = authUser ? await db.select({ familyId: familySchema.guardians.familyId })
    .from(familySchema.guardians).where(orm.eq(familySchema.guardians.authUserId, authUser.id)).limit(1) : [];
  if (guardian) {
    const taskIds = (await db.select({ id: taskSchema.learningTasks.id }).from(taskSchema.learningTasks)
      .where(orm.eq(taskSchema.learningTasks.familyId, guardian.familyId))).map((task) => task.id);
    if (taskIds.length > 0) {
      const jobKeys = (await db.select({ key: taskSchema.learningTaskItems.ttsDedupeKey })
        .from(taskSchema.learningTaskItems).where(orm.inArray(taskSchema.learningTaskItems.taskId, taskIds)))
        .map((item) => item.key);
      if (jobKeys.length > 0) await db.delete(jobSchema.jobs).where(orm.inArray(jobSchema.jobs.dedupeKey, jobKeys));
    }
    await db.delete(todoSchema.todoTasks).where(orm.eq(todoSchema.todoTasks.familyId, guardian.familyId));
    await db.delete(taskSchema.learningTasks).where(orm.eq(taskSchema.learningTasks.familyId, guardian.familyId));
    await db.delete(familySchema.families).where(orm.eq(familySchema.families.id, guardian.familyId));
  }
  if (fixtureEditionId) await db.delete(contentSchema.learningCards)
    .where(orm.eq(contentSchema.learningCards.textbookEditionId, fixtureEditionId));
  if (fixtureEditionId) await db.delete(contentSchema.textbookEditions)
    .where(orm.eq(contentSchema.textbookEditions.id, fixtureEditionId));
  if (authUser) await db.delete(authSchema.user).where(orm.eq(authSchema.user.id, authUser.id));
  fixtureEmail = "";
  fixtureEditionId = "";
});

test("家长展开教材、勾选整个单元后按课下发", async ({ page }) => {
  fixtureEmail = `curriculum-${crypto.randomUUID()}@example.test`;
  await page.goto("/sign-up");
  await page.getByLabel("称呼").fill("单元家长");
  await page.getByLabel("邮箱").fill(fixtureEmail);
  await page.getByLabel("密码", { exact: true }).fill("Curriculum-Test-Password-1");
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page).toHaveURL(/\/parent\/onboarding$/);
  await page.getByLabel("家庭名称").fill("单元听写家庭");
  await page.getByLabel("家长显示名").fill("单元家长");
  await page.getByRole("button", { name: "下一步：设置家长 PIN" }).click();
  await page.getByLabel("6 位家长 PIN").fill("482731");
  await page.getByRole("button", { name: "下一步：创建孩子" }).click();
  await page.getByLabel("孩子昵称").fill("小雨");
  await page.getByRole("button", { name: "创建孩子并完成" }).click();
  await expect(page).toHaveURL(/\/parent\/children$/);

  const { db } = await import("@/db/client");
  const { learningCards, textbookEditions, textbookSections, textbookUnits } = await import("@/modules/learning-content/schema");
  const [edition] = await db.insert(textbookEditions).values({ publisher: "统编", series: "语文",
    subject: "chinese", grade: 5, volume: "上册", editionText: `测试版-${crypto.randomUUID()}` }).returning();
  fixtureEditionId = edition.id;
  const [unit] = await db.insert(textbookUnits).values({ textbookEditionId: edition.id,
    unitOrder: 1, title: "第一单元" }).returning();
  const sections = await db.insert(textbookSections).values([
    { unitId: unit.id, sectionKey: "lesson-1", sectionOrder: 1, title: "第1课", sectionType: "lesson" },
    { unitId: unit.id, sectionKey: "lesson-2", sectionOrder: 2, title: "第2课", sectionType: "lesson" },
  ]).returning();
  await db.insert(learningCards).values(sections.map((section, index) => ({
    subject: "chinese", answerText: index ? "故乡" : "桂花", broadcastText: index ? "故乡" : "桂花",
    source: "builtin", builtinKey: `e2e-curriculum-${edition.id}-${index}`,
    textbookEditionId: edition.id, unitId: unit.id, sectionId: section.id, sourceOrder: 1,
  })));

  await page.goto("/parent/tasks/new");
  const editionDetails = page.locator("details.curriculum-edition").filter({ hasText: "第一单元" });
  await expect(editionDetails).toHaveCount(1);
  await expect(editionDetails).not.toHaveAttribute("open", "");
  await editionDetails.locator("summary").first().click();
  const unitDetails = editionDetails.locator("details").first();
  await unitDetails.locator("summary").click();
  await expect(editionDetails.getByText("第1课")).toBeVisible();
  await expect(editionDetails.getByText("第2课")).toBeVisible();
  await editionDetails.getByRole("checkbox", { name: "选择第一单元全部课次" }).check();
  await expect(page.getByText("将创建 2 项任务：2 课、2 个教材新词。")).toBeVisible();
  await page.getByRole("button", { name: "下发所选任务" }).click();
  await expect(page.getByRole("status")).toContainText("已创建 2 项任务、共 2 词");
  await page.getByRole("link", { name: "今日待办清单" }).click();
  await expect(page).toHaveURL(/\/parent\/todos$/);
  await expect(page.getByText("语文 · 第一单元 · 第1课（1词）")).toBeVisible();
  await expect(page.getByText("语文 · 第一单元 · 第2课（1词）")).toBeVisible();
});
