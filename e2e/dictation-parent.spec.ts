import { cleanupEngagement } from './engagement-cleanup';
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

import { uniqueTestIp } from "./test-config";

test.use({ extraHTTPHeaders: { "x-forwarded-for": uniqueTestIp() } });

process.env.DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://app:app@127.0.0.1:5433/family_learning_test";
process.env.APP_URL = "http://127.0.0.1:3105";
process.env.BETTER_AUTH_SECRET = "test-only-secret-123456789012345678901234567890";
process.env.FAMILY_LEARNING_TEST_MODE = "e2e";

// All data and media stay in the guarded local test database/media directory.
test("回听、从头听写、照片家长逐词批改、错词订正完成", async ({ page, browser }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  const [{ db }, { createFamilyService }, tables, { eq, inArray, and, isNotNull }, { createPrivateMediaStore }, { jobs }, { removeAttachment }] = await Promise.all([
    import("@/db/client"), import("@/modules/families/service"), import("@/db/schema"), import("drizzle-orm"),
    import("@/modules/media/store"), import("@/modules/jobs/schema"), import("@/modules/todos/attachments"),
  ]);
  const email = `parent-dictation-${crypto.randomUUID()}@example.test`;
  const response = await page.request.post("/api/auth/sign-up/email", { data: { name: "批改测试家长", email, password: "Local-Test-Password-123" } });
  expect(response.ok()).toBe(true);
  const authUserId = (await response.json()).user.id as string;
  let familyId: string | undefined;
  const mediaIds: string[] = [];
  const photoIds: string[] = [];
  const jobKeys: string[] = [];
  const store = createPrivateMediaStore();
  const childContext = await browser.newContext();
  try {
    const familyService = createFamilyService();
    const parent = await familyService.createFamilyOwner(authUserId, { familyName: "家长听写测试", ownerName: "测试家长" });
    familyId = parent.familyId;
    await familyService.setParentPin(parent, "482731");
    const child = await familyService.createChild(parent, { nickname: "听写孩子", avatarKey: "child-1", grade: 5, textbookEditionIds: [] });
    await db.insert(tables.learningCards).values([
      { familyId, subject: "chinese", answerText: "晨光", broadcastText: "晨光", source: "manual" },
      { familyId, subject: "chinese", answerText: "阳光", broadcastText: "阳光", source: "manual" },
    ]);
    await page.goto("/parent/tasks/new");
    await page.locator("details.extra-practice-picker > summary").click();
    await page.getByLabel("搜索词语").fill("晨光");
    await page.getByRole("checkbox", { name: /晨光/ }).check();
    await page.getByLabel("搜索词语").fill("阳光");
    await page.getByRole("checkbox", { name: /阳光/ }).check();
    await page.getByLabel("题间隔（秒）").fill("2");
    await page.getByLabel("提交给家长批改", { exact: true }).check();
    const [createdResponse] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith("/api/parent/task-batches") && r.request().method() === "POST"),
      page.getByRole("button", { name: "下发所选任务" }).click(),
    ]);
    expect(createdResponse.status()).toBe(201);
    const task = (await createdResponse.json()).tasks[0] as { id: string; gradingMode: string; items: Array<{ ttsDedupeKey: string }> };
    expect(task.gradingMode).toBe("parent");
    const audio = new Uint8Array(await readFile(new URL("./fixtures/short-silence.mp3", import.meta.url)));
    for (const item of task.items) {
      jobKeys.push(item.ttsDedupeKey);
      const media = await store.put({ familyId, childId: child.id, kind: "tts_audio", bytes: audio, mimeType: "audio/mpeg", expiresAt: null, dedupeKey: item.ttsDedupeKey });
      mediaIds.push(media.id);
    }
    const pairing = await page.request.post("/api/parent/devices/pairing-code", { data: { childIds: [child.id] } });
    expect(pairing.ok()).toBe(true);
    const childPage = await childContext.newPage();
    childPage.setDefaultTimeout(15_000);
    childPage.on("dialog", dialog => void dialog.accept());
    await childPage.goto("/pair");
    await childPage.getByLabel("配对码").fill((await pairing.json()).code);
    await childPage.getByLabel("设备名称").fill("听写测试设备");
    await childPage.getByRole("button", { name: "连接设备" }).click();
    await expect(childPage).toHaveURL(/\/child$/);
    await childPage.goto("/child/tasks");
    await childPage.getByRole("button", { name: "开始听写" }).click();
    await expect(childPage).toHaveURL(/\/child\/dictation\//);
    await expect(childPage.getByRole("button", { name: "开始听写" })).toBeEnabled();
    await childPage.getByRole("button", { name: "开始听写" }).click();
    await childPage.getByRole("button", { name: "从头重新听写" }).click();
    await expect(childPage.getByRole("dialog")).toBeVisible();
    await childPage.getByRole("button", { name: "确认重新开始" }).click();
    await expect(childPage.getByRole("button", { name: "开始听写" })).toBeEnabled();
    await childPage.reload();
    await expect(childPage.getByRole("button", { name: "开始听写" })).toBeEnabled();
    await childPage.getByRole("button", { name: "开始听写" }).click();
    const previous = childPage.getByRole("button", { name: "回听上一个词" });
    await expect(previous).toBeEnabled();
    await previous.click();
    await expect(childPage.getByRole("button", { name: "继续听写" })).toBeEnabled();
    await childPage.getByRole("button", { name: "继续听写" }).click();
    await expect(childPage.getByRole("heading", { name: "拍下听写，交给家长" })).toBeVisible();
    await expect(childPage.getByText("晨光", { exact: true })).toHaveCount(0);
    const photo = { name: "dictation.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") };
    await childPage.getByLabel("听写照片").setInputFiles(photo);
    await childPage.getByRole("button", { name: "提交给家长批改", exact: true }).click();
    await expect(childPage.getByRole("heading", { name: "等待家长批改" })).toBeVisible();
    await page.getByRole("link", { name: "听写批改", exact: true }).click();
    await expect(page.getByRole("heading", { name: /听写孩子 · 第 1 轮听写/ })).toBeVisible();
    await page.screenshot({ path: `/tmp/kickoffwhen-parent-review-${test.info().project.name}.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `/tmp/kickoffwhen-parent-review-mobile-${test.info().project.name}.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    const photoSrc = await page.getByRole("img", { name: "听写孩子的听写照片 1" }).getAttribute("src");
    photoIds.push(photoSrc!.split("/").at(-1)!);
    expect((await page.request.get(photoSrc!)).ok()).toBe(true);
    await page.getByRole("group", { name: /第 1 题/ }).getByRole("button", { name: "正确", exact: true }).click();
    await page.getByRole("group", { name: /第 2 题/ }).getByRole("button", { name: "错了", exact: true }).click();
    await page.getByRole("button", { name: "保存逐词批改" }).click();
    await expect(page.getByText("暂无待批听写。孩子提交照片后会显示在这里。" )).toBeVisible();
    await childPage.getByRole("button", { name: "查看批改进度" }).click();
    await expect(childPage.getByRole("button", { name: "开始听写" })).toBeEnabled();
    await childPage.getByRole("button", { name: "开始听写" }).click();
    await expect(childPage.getByRole("heading", { name: "拍下听写，交给家长" })).toBeVisible();
    await childPage.getByLabel("听写照片").setInputFiles(photo);
    await childPage.getByRole("button", { name: "提交给家长批改", exact: true }).click();
    await expect(childPage.getByRole("heading", { name: "等待家长批改" })).toBeVisible();
    await page.getByRole("button", { name: "刷新待批听写" }).click();
    await expect(page.getByRole("heading", { name: /听写孩子 · 第 2 轮听写/ })).toBeVisible();
    photoIds.push((await page.getByRole("img", { name: "听写孩子的听写照片 1" }).getAttribute("src"))!.split("/").at(-1)!);
    await page.getByRole("button", { name: "正确", exact: true }).click();
    await page.getByRole("button", { name: "保存逐词批改" }).click();
    await expect(page.getByText("暂无待批听写。孩子提交照片后会显示在这里。")).toBeVisible();
    await childPage.getByRole("button", { name: "查看批改进度" }).click();
    await expect(childPage.getByRole("heading", { name: "本次听写已完成" })).toBeVisible();
    const [stored] = await db.select().from(tables.dictationSessions).where(eq(tables.dictationSessions.taskId, task.id));
    await page.goto(`/parent/reports/sessions/${stored.id}`);
    await expect(page.getByText("由家长对照上传照片逐词批改")).toBeVisible();
    await page.screenshot({ path: `/tmp/kickoffwhen-parent-report-${test.info().project.name}.png`, fullPage: true });
  } finally {
    await childContext.close().catch(() => undefined);
    if (familyId) {
      const submissions = await db.select({ photos: tables.dictationSubmissions.photos }).from(tables.dictationSubmissions).where(eq(tables.dictationSubmissions.familyId, familyId));
      for (const id of new Set([...photoIds, ...submissions.flatMap(s => s.photos.map(p => p.id))])) await removeAttachment(id);
      for (const id of mediaIds) await store.remove(familyId, id);
      await db.transaction(async tx => {
        const todos = await tx.select({ id: tables.todoTasks.id }).from(tables.todoTasks).where(eq(tables.todoTasks.familyId, familyId!));
        if (todos.length) {
          const ids = todos.map(t => t.id);
          await tx.delete(tables.todoRewards).where(inArray(tables.todoRewards.todoId, ids));
          await tx.delete(tables.todoReviews).where(inArray(tables.todoReviews.todoId, ids));
          await tx.delete(tables.todoSubmissions).where(inArray(tables.todoSubmissions.todoId, ids));
          await tx.delete(tables.todoTasks).where(inArray(tables.todoTasks.id, ids));
        }
        await tx.delete(tables.dictationCompletionEvents).where(eq(tables.dictationCompletionEvents.familyId, familyId!));
        await tx.delete(tables.dictationAnswerEvents).where(eq(tables.dictationAnswerEvents.familyId, familyId!));
        await tx.delete(tables.dictationPlaybackEvents).where(eq(tables.dictationPlaybackEvents.familyId, familyId!));
        await tx.delete(tables.dictationCommands).where(eq(tables.dictationCommands.familyId, familyId!));
        await tx.delete(tables.learningTasks).where(eq(tables.learningTasks.familyId, familyId!));
        await tx.delete(tables.reviewEvents).where(and(eq(tables.reviewEvents.familyId, familyId!), isNotNull(tables.reviewEvents.sourceReviewEventId)));
        await tx.delete(tables.reviewEvents).where(eq(tables.reviewEvents.familyId, familyId!));
        await tx.delete(tables.childCardStates).where(eq(tables.childCardStates.familyId, familyId!));
        if (jobKeys.length) await tx.delete(jobs).where(inArray(jobs.dedupeKey, jobKeys));
        await tx.delete(tables.learningCards).where(eq(tables.learningCards.familyId, familyId!));
        await cleanupEngagement(tx, familyId!);
        await tx.delete(tables.families).where(eq(tables.families.id, familyId!));
      });
    }
    await db.delete(tables.user).where(eq(tables.user.id, authUserId));
  }
});
