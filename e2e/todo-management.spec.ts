import { expect, type BrowserContext, type Page, test } from "@playwright/test";

import { uniqueTestIp } from "./test-config";

test.use({ extraHTTPHeaders: { "x-forwarded-for": uniqueTestIp() } });

process.env.DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://app:app@127.0.0.1:5433/family_learning_test";
process.env.APP_URL = "http://127.0.0.1:3105";
process.env.BETTER_AUTH_SECRET = "test-only-secret-123456789012345678901234567890";
process.env.FAMILY_LEARNING_TEST_MODE = "e2e";

let fixtureEmail = "";

async function createFamily(page: Page) {
  fixtureEmail = `todo-management-${crypto.randomUUID()}@example.test`;
  await page.goto("/sign-up");
  await page.getByLabel("称呼").fill("待办测试家长");
  await page.getByLabel("邮箱").fill(fixtureEmail);
  await page.getByLabel("密码", { exact: true }).fill("Todo-Management-Test-Password-1");
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page).toHaveURL(/\/parent\/onboarding$/);
  await page.getByLabel("家庭名称").fill("待办测试家庭");
  await page.getByLabel("家长显示名").fill("测试家长");
  await page.getByRole("button", { name: "下一步：设置家长 PIN" }).click();
  await page.getByLabel("6 位家长 PIN").fill("482731");
  await page.getByRole("button", { name: "下一步：创建孩子" }).click();
  await page.getByLabel("孩子昵称").fill("小雨");
  await page.getByRole("button", { name: "创建孩子并完成" }).click();
  await expect(page).toHaveURL(/\/parent\/children$/);
  await page.goto("/parent/todos");
  await expect(page.getByText("这一天还没有待办任务。")).toBeVisible();
  await page.locator(".todo-filters").getByLabel("日期").fill("2026-09-23");
  await expect(page.locator(".todo-filters").getByLabel("日期")).toHaveValue("2026-09-23");
  await expect(page.getByText("这一天还没有待办任务。")).toBeVisible();
}

async function addTodo(page: Page, title: string) {
  const form = page.locator(".todo-create");
  await form.getByLabel("待办任务").fill(title);
  await form.getByRole("button", { name: "添加到清单" }).click();
  await expect(page.getByRole("row").filter({ hasText: title })).toBeVisible();
}

async function createChildPage(parentPage: Page, context: BrowserContext) {
  const pairingCode = await parentPage.evaluate(async () => {
    const childrenResponse = await fetch("/api/parent/children");
    const payload = await childrenResponse.json() as { children: Array<{ id: string }> };
    const response = await fetch("/api/parent/devices/pairing-code", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ childIds: [payload.children[0]!.id] }),
    });
    if (!response.ok) throw new Error(`pairing code ${response.status}`);
    return ((await response.json()) as { code: string }).code;
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto("/pair");
  await page.getByLabel("配对码").fill(pairingCode);
  await page.getByLabel("设备名称").fill("待办测试平板");
  await page.getByRole("button", { name: "连接设备" }).click();
  // A device paired to one child opens that child's page automatically.
  await expect(page).toHaveURL(/\/child$/);
  await expect(page.getByText("这一天还没有待办任务。")).toBeVisible();
  await page.locator(".todo-filters").getByLabel("日期").fill("2026-09-23");
  await expect(page.locator(".todo-filters").getByLabel("日期")).toHaveValue("2026-09-23");
  return page;
}

test.afterEach(async () => {
  if (!fixtureEmail) return;
  const [{ db }, authSchema, familySchema, todoSchema, orm] = await Promise.all([
    import("@/db/client"), import("@/modules/auth/schema"), import("@/modules/families/schema"),
    import("@/modules/todos/schema"), import("drizzle-orm"),
  ]);
  const [authUser] = await db.select({ id: authSchema.user.id }).from(authSchema.user)
    .where(orm.eq(authSchema.user.email, fixtureEmail)).limit(1);
  const [guardian] = authUser ? await db.select({ familyId: familySchema.guardians.familyId })
    .from(familySchema.guardians).where(orm.eq(familySchema.guardians.authUserId, authUser.id)).limit(1) : [];
  if (guardian) {
    const todoIds = (await db.select({ id: todoSchema.todoTasks.id }).from(todoSchema.todoTasks)
      .where(orm.eq(todoSchema.todoTasks.familyId, guardian.familyId))).map(todo => todo.id);
    if (todoIds.length) {
      await db.delete(todoSchema.todoSubmissions).where(orm.inArray(todoSchema.todoSubmissions.todoId, todoIds));
      await db.delete(todoSchema.todoTasks).where(orm.inArray(todoSchema.todoTasks.id, todoIds));
    }
    await db.delete(familySchema.families).where(orm.eq(familySchema.families.id, guardian.familyId));
  }
  if (authUser) await db.delete(authSchema.user).where(orm.eq(authSchema.user.id, authUser.id));
  fixtureEmail = "";
});

test("家长编辑未提交的普通待办后，任务出现在新日期", async ({ page }) => {
  test.setTimeout(90_000);
  await createFamily(page);
  await addTodo(page, "阅读20分钟");
  const originalRow = page.getByRole("row").filter({ hasText: "阅读20分钟" });
  await originalRow.getByRole("button", { name: "编辑" }).click({ timeout: 5_000 });
  const editForm = page.getByRole("form", { name: "阅读20分钟的编辑表单" });
  await editForm.getByLabel("待办任务").fill("阅读30分钟");
  await editForm.getByLabel("任务要求").fill("读完一章");
  await editForm.getByLabel("日期").fill("2026-09-24");
  await editForm.getByRole("button", { name: "保存修改" }).click();
  await expect(originalRow).toHaveCount(0);
  await page.locator(".todo-filters").getByLabel("日期").fill("2026-09-24");
  const movedRow = page.getByRole("row").filter({ hasText: "阅读30分钟" });
  await expect(movedRow).toBeVisible();
  await expect(movedRow).toContainText("读完一章");
});

test("编辑期间另一页面修改任务后，旧草稿不能取得新版本并覆盖修改", async ({ page }) => {
  test.setTimeout(90_000);
  await createFamily(page);
  await addTodo(page, "阅读20分钟");
  const otherPage = await page.context().newPage();
  try {
    await otherPage.goto("/parent/todos");
    await expect(otherPage.getByText("这一天还没有待办任务。")).toBeVisible();
    await otherPage.locator(".todo-filters").getByLabel("日期").fill("2026-09-23");
    await expect(otherPage.locator(".todo-filters").getByLabel("日期")).toHaveValue("2026-09-23");
    const otherRow = otherPage.getByRole("row").filter({ hasText: "阅读20分钟" });
    await expect(otherRow).toBeVisible();

    const row = page.getByRole("row").filter({ hasText: "阅读20分钟" });
    await row.getByRole("button", { name: "编辑" }).click();
    const draft = page.locator(".todo-edit");
    await draft.getByLabel("待办任务").fill("我的旧草稿");

    await otherRow.getByRole("button", { name: "编辑" }).click();
    const otherForm = otherPage.locator(".todo-edit");
    await otherForm.getByLabel("待办任务").fill("另一页面的新内容");
    await otherForm.getByRole("button", { name: "保存修改" }).click();
    await expect(otherPage.getByRole("row").filter({ hasText: "另一页面的新内容" })).toBeVisible();

    await page.getByRole("button", { name: "刷新" }).click();
    const refreshedRow = page.getByRole("row").filter({ hasText: "另一页面的新内容" });
    await expect(refreshedRow).toBeVisible();
    await expect(draft.getByLabel("待办任务")).toHaveValue("我的旧草稿");
    await expect(refreshedRow.getByRole("button", { name: "编辑", exact: true })).toBeDisabled();

    await draft.getByRole("button", { name: "保存修改" }).click();
    await expect(page.locator(".todo-error")).toContainText("任务状态已更新，请刷新清单，取消编辑后重新打开。");
    await expect(refreshedRow).toBeVisible();
    await otherPage.getByRole("button", { name: "刷新" }).click();
    await expect(otherPage.getByRole("row").filter({ hasText: "另一页面的新内容" })).toBeVisible();
    await expect(otherPage.getByRole("row").filter({ hasText: "我的旧草稿" })).toHaveCount(0);
    await draft.getByRole("button", { name: "取消编辑" }).click();
    await refreshedRow.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page.locator(".todo-edit").getByLabel("待办任务")).toHaveValue("另一页面的新内容");
  } finally {
    await otherPage.close();
  }
});

test("家长确认撤回后孩子看不到任务，已提交任务没有编辑入口", async ({ browser, page }) => {
  test.setTimeout(90_000);
  await createFamily(page);
  await addTodo(page, "误建的任务");
  await addTodo(page, "整理书桌");
  const childContext = await browser.newContext();
  try {
    const mistakenRow = page.getByRole("row").filter({ hasText: "误建的任务" });
    await mistakenRow.getByRole("button", { name: "撤回" }).click({ timeout: 5_000 });
    await expect(mistakenRow.getByRole("button", { name: "保留任务" })).toBeVisible();
    await expect(mistakenRow.getByRole("button", { name: "确定撤回" })).toBeVisible();
    await mistakenRow.getByRole("button", { name: "保留任务" }).click();
    await expect(mistakenRow.getByRole("button", { name: "确定撤回" })).toHaveCount(0);
    await mistakenRow.getByRole("button", { name: "撤回" }).click();
    await mistakenRow.getByRole("button", { name: "确定撤回" }).click();
    await expect(mistakenRow).toContainText("已撤回");
    const childPage = await createChildPage(page, childContext);
    await childPage.getByRole("button", { name: "刷新" }).click();
    await expect(childPage.getByText("误建的任务")).toHaveCount(0);

    const childRow = childPage.getByRole("row").filter({ hasText: "整理书桌" });
    await childRow.getByRole("button", { name: "不上传" }).click();
    await childRow.getByRole("button", { name: "完成并提交" }).click();
    await expect(childRow).toContainText("等待家长审核");
    await page.getByRole("button", { name: "刷新" }).click();
    const submittedRow = page.getByRole("row").filter({ hasText: "整理书桌" });
    await expect(submittedRow).toContainText("待审核");
    await expect(submittedRow.getByRole("button", { name: "编辑" })).toHaveCount(0);
    await expect(submittedRow.getByRole("button", { name: "撤回" })).toBeVisible();
  } finally {
    await childContext.close();
  }
});
