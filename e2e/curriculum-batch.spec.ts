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

  await page.goto("/parent/tasks/content");
  await expect(page.getByRole("heading", { name: "听写内容库" })).toBeVisible();

  const { db } = await import("@/db/client");
  const { learningCards, textbookEditions, textbookSections, textbookUnits } = await import("@/modules/learning-content/schema");
  const editionText = `测试版-${crypto.randomUUID()}`;
  const [edition] = await db.insert(textbookEditions).values({ publisher: "统编", series: "语文",
    subject: "chinese", grade: 5, volume: "上册", editionText }).returning();
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

  await page.goto("/parent/tasks/content");
  const libraryEdition = page.locator("details.library-edition").filter({ hasText: editionText });
  await expect(libraryEdition.locator("summary").first()).toContainText("1 个单元 · 2 个词");
  await expect(libraryEdition.getByText("桂花", { exact: true })).toBeHidden();
  await expect(page.locator("article.card-row")).toHaveCount(0);
  await libraryEdition.locator("summary").first().click();
  const libraryUnit = libraryEdition.locator("details.library-unit").first();
  await expect(libraryUnit.locator(":scope > summary")).toBeVisible();
  await expect(libraryEdition.getByText("第1课", { exact: true })).toBeHidden();
  await libraryUnit.locator(":scope > summary").click();
  const librarySection = libraryUnit.locator("details.library-section").first();
  await expect(librarySection.locator(":scope > summary")).toBeVisible();
  await expect(libraryEdition.getByText("桂花", { exact: true })).toBeHidden();
  await librarySection.locator(":scope > summary").click();
  await expect(libraryEdition.getByText("第1课", { exact: true })).toBeVisible();
  await expect(libraryEdition.getByText("桂花", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(libraryEdition.locator(":scope > summary")).toBeVisible();
  await expect(libraryUnit.locator(":scope > summary")).toBeVisible();
  await expect(librarySection.locator(":scope > summary")).toBeVisible();
  await expect(libraryEdition.getByText("桂花", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  const sectionSummary = librarySection.locator(":scope > summary");
  await sectionSummary.focus();
  await expect(sectionSummary).toBeFocused();
  await sectionSummary.press("Enter");
  await expect(libraryEdition.getByText("桂花", { exact: true })).toBeHidden();
  await sectionSummary.press("Space");
  await expect(libraryEdition.getByText("桂花", { exact: true })).toBeVisible();

  await page.goto("/parent/tasks/new");
  const editionDetails = page.locator("details.curriculum-edition").filter({ hasText: editionText });
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

  const { user } = await import("@/modules/auth/schema");
  const { guardians } = await import("@/modules/families/schema");
  const { eq } = await import("drizzle-orm");
  const [account] = await db.select({ id: user.id }).from(user).where(eq(user.email, fixtureEmail)).limit(1);
  const [guardian] = await db.select({ familyId: guardians.familyId }).from(guardians)
    .where(eq(guardians.authUserId, account!.id)).limit(1);
  await db.insert(learningCards).values([
    { familyId: guardian!.familyId, subject: "chinese", answerText: "单元散词", broadcastText: "单元散词",
      source: "manual", textbookEditionId: edition.id, unitId: unit.id },
    { familyId: guardian!.familyId, subject: "chinese", answerText: "教材散词", broadcastText: "教材散词",
      source: "manual", textbookEditionId: edition.id },
    { familyId: guardian!.familyId, subject: "english", answerText: "hello", broadcastText: "hello", source: "manual" },
  ]);

  await page.goto("/parent/tasks/content");
  await expect(libraryEdition.locator(":scope > summary")).toContainText("1 个单元 · 4 个词");
  await libraryEdition.locator(":scope > summary").click();
  await expect(libraryEdition.locator(":scope > .library-edition-content > .library-unplaced")).toContainText("教材散词");
  await expect(libraryUnit.locator(":scope > summary")).toContainText("2 课 · 3 个词");
  await libraryUnit.locator(":scope > summary").click();
  await expect(libraryUnit.locator(":scope > .library-unit-content > .library-unplaced")).toContainText("单元散词");
  const personalEnglish = page.locator("details.library-personal").filter({ hasText: "英语" });
  await expect(personalEnglish.locator(":scope > summary")).toContainText("1 个词");
  await personalEnglish.locator(":scope > summary").click();
  await expect(personalEnglish.getByText("hello", { exact: true })).toBeVisible();
});
