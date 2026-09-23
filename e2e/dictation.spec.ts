import { readFile, readdir } from "node:fs/promises";

import { expect, type BrowserContext, type Page, test } from "@playwright/test";

import { hasExactFixtureJobKeys, mergeFixtureJobIds } from "./job-fixture";
import { uniqueTestIp } from "./test-config";

test.use({ extraHTTPHeaders: { "x-forwarded-for": uniqueTestIp() } });

process.env.DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  "postgres://app:app@127.0.0.1:5433/family_learning_test";
process.env.APP_URL = "http://127.0.0.1:3105";
process.env.BETTER_AUTH_SECRET = "test-only-secret-123456789012345678901234567890";
process.env.FAMILY_LEARNING_TEST_MODE = "e2e";

const password = "Dictation-Test-Password-1";
const parentPin = "482731";

type FixtureState = {
  email: string;
  familyId?: string;
  authUserId?: string;
  mediaIds: string[];
  jobIds: string[];
  jobDedupeKeys: string[];
  builtinCardIds?: string[];
};

let fixtureState: FixtureState | null = null;

async function createFamilyAndTask(page: Page) {
  const unique = `${Date.now()}-${test.info().project.name}-${crypto.randomUUID()}`;
  const email = `dictation-${unique}@example.test`;
  fixtureState = { email, mediaIds: [], jobIds: [], jobDedupeKeys: [] };
  await page.goto("/sign-up");
  await page.getByLabel("称呼").fill("听写测试家长");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  const [signUpResponse] = await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/sign-up/email"),
    ),
    page.getByRole("button", { name: "注册" }).click(),
  ]);
  expect(signUpResponse.status()).toBe(200);
  await expect(page).toHaveURL(/\/parent\/onboarding$/);
  await page.getByLabel("家庭名称").fill(`听写家庭-${unique}`);
  await page.getByLabel("家长显示名").fill("测试家长");
  await page.getByRole("button", { name: "下一步：设置家长 PIN" }).click();
  await page.getByLabel("6 位家长 PIN").fill(parentPin);
  await page.getByRole("button", { name: "下一步：创建孩子" }).click();
  await page.getByLabel("孩子昵称").fill("小雨");
  await page.getByRole("button", { name: "创建孩子并完成" }).click();
  await expect(page).toHaveURL(/\/parent\/children$/);

  const { db: fixtureDb } = await import("@/db/client");
  const { learningCards: fixtureCards } = await import("@/modules/learning-content/schema");
  const builtinCards = await fixtureDb.insert(fixtureCards).values([
    { answerText: "桂花", pinyinText: "guì huā", hintText: "院子里的（　　）开了。" },
    { answerText: "故乡", pinyinText: "gù xiāng", hintText: "他常常想念自己的（　　）。" },
    { answerText: "清晨", pinyinText: "qīng chén", hintText: "（　　）的空气很清新。" },
  ].map((card, index) => ({ ...card, broadcastText: card.answerText, subject: "chinese", source: "builtin", builtinKey: `e2e-${unique}-${index}`, curriculumSource: "required_vocabulary", sourceOrder: index + 1 }))).returning({ id: fixtureCards.id });
  fixtureState = { ...fixtureState, builtinCardIds: builtinCards.map(c => c.id) };
  const setup = await page.evaluate(async (cardIds) => {
    const second = await fetch("/api/parent/children", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nickname: "小川",
        avatarKey: "rocket-blue",
        grade: 5,
        textbookEditionIds: [],
      }),
    });
    if (!second.ok) throw new Error(`second child ${second.status}`);
    const childPayload = await (await fetch("/api/parent/children")).json() as {
      children: Array<{ id: string; nickname: string }>;
    };
    const first = childPayload.children.find((child) => child.nickname === "小雨")!;
    const taskResponse = await fetch("/api/parent/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        childId: first.id,
        subject: "chinese",
        newCardIds: cardIds,
        commandId: crypto.randomUUID(),
        maxReviewCards: 0,
        mode: "continuous_batch",
        order: "source",
        intervalSeconds: 2,
        repeatCount: 2,
        speechRate: 1.25,
        allowManualReplay: true,
      }),
    });
    const taskPayload = await taskResponse.json() as {
      task: { id: string; items: Array<{ ttsDedupeKey: string }> };
    };
    return {
      children: childPayload.children,
      task: taskPayload.task,
    };
  }, builtinCards.map(c => c.id));
  const ttsDedupeKeys = setup.task.items.map((item) => item.ttsDedupeKey);
  fixtureState = { ...fixtureState, jobDedupeKeys: [...ttsDedupeKeys] };

  const [{ db }, { children }, { user }, { jobs }, { createPrivateMediaStore }] = await Promise.all([
    import("@/db/client"),
    import("@/modules/families/schema"),
    import("@/modules/auth/schema"),
    import("@/modules/jobs/schema"),
    import("@/modules/media/store"),
  ]);
  const { eq, inArray } = await import("drizzle-orm");
  const createdJobs = await db.select({ id: jobs.id, dedupeKey: jobs.dedupeKey })
    .from(jobs)
    .where(inArray(jobs.dedupeKey, ttsDedupeKeys));
  fixtureState = {
    ...fixtureState,
    jobIds: mergeFixtureJobIds(fixtureState.jobIds, createdJobs),
  };
  expect(hasExactFixtureJobKeys(ttsDedupeKeys, createdJobs)).toBe(true);
  const firstChildId = setup.children.find((child) => child.nickname === "小雨")!.id;
  const [child] = await db.select().from(children).where(eq(children.id, firstChildId)).limit(1);
  const [authUser] = await db.select().from(user).where(eq(user.email, email)).limit(1);
  const bytes = new Uint8Array(await readFile("e2e/fixtures/short-silence.mp3"));
  const store = createPrivateMediaStore();
  const mediaIds: string[] = [];
  fixtureState = {
    ...fixtureState,
    familyId: child.familyId,
    authUserId: authUser.id,
    mediaIds,
  };
  for (const item of setup.task.items) {
    const media = await store.put({
      familyId: child.familyId,
      childId: firstChildId,
      kind: "tts_audio",
      bytes,
      mimeType: "audio/mpeg",
      expiresAt: null,
      dedupeKey: item.ttsDedupeKey,
    });
    mediaIds.push(media.id);
  }
  const pairingCode = await page.evaluate(async (childIds) => {
    const response = await fetch("/api/parent/devices/pairing-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ childIds }),
    });
    if (!response.ok) throw new Error(`pairing code ${response.status}`);
    const pairing = await response.json() as { code: string };
    return pairing.code;
  }, setup.children.map((child) => child.id));
  return { ...setup, pairingCode };
}

async function pairAndSelect(context: BrowserContext, code: string, nickname: string) {
  const page = await context.newPage();
  await page.goto("/pair");
  await page.getByLabel("配对码").fill(code);
  await page.getByLabel("设备名称").fill("听写测试平板");
  await page.getByRole("button", { name: "连接设备" }).click();
  await page.getByRole("button", { name: new RegExp(nickname) }).click();
  await expect(page).toHaveURL(/\/child$/);
  return page;
}

async function readDocumentId(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  return page.evaluate(
    () => (globalThis as typeof globalThis & { __e2eDocumentId: string }).__e2eDocumentId,
  );
}

async function expectDocumentReplaced(page: Page, previousDocumentId: string) {
  expect(await readDocumentId(page)).not.toBe(previousDocumentId);
}

async function cleanupFixture(state: FixtureState) {
  const [
    { db },
    sessionSchema,
    taskSchema,
    reviewSchema,
    mediaSchema,
    contentSchema,
    familySchema,
    authSchema,
    jobSchema,
    todoSchema,
    { createPrivateMediaStore },
    { removeAttachment },
    orm,
  ] = await Promise.all([
    import("@/db/client"),
    import("@/modules/dictation/session-schema"),
    import("@/modules/dictation/task-schema"),
    import("@/modules/review/db-schema"),
    import("@/modules/media/schema"),
    import("@/modules/learning-content/schema"),
    import("@/modules/families/schema"),
    import("@/modules/auth/schema"),
    import("@/modules/jobs/schema"),
    import("@/modules/todos/schema"),
    import("@/modules/media/store"),
    import("@/modules/todos/attachments"),
    import("drizzle-orm"),
  ]);
  const store = createPrivateMediaStore();
  const trackedJobPredicate = (jobIds: string[], jobDedupeKeys: string[]) => {
    const predicates = [
      ...(jobIds.length > 0 ? [orm.inArray(jobSchema.jobs.id, jobIds)] : []),
      ...(jobDedupeKeys.length > 0
        ? [orm.inArray(jobSchema.jobs.dedupeKey, jobDedupeKeys)]
        : []),
    ];
    return predicates.length === 1 ? predicates[0]! : orm.or(...predicates)!;
  };
  let familyId = state.familyId;
  let authUserId = state.authUserId;
  let cleanupJobIds = [...state.jobIds];
  let todoAttachmentIds: string[] = [];
  if (state.jobIds.length > 0 || state.jobDedupeKeys.length > 0) {
    const trackedJobs = await db.select({ id: jobSchema.jobs.id })
      .from(jobSchema.jobs)
      .where(trackedJobPredicate(state.jobIds, state.jobDedupeKeys));
    cleanupJobIds = mergeFixtureJobIds(cleanupJobIds, trackedJobs);
  }
  if (!authUserId) {
    const [foundUser] = await db.select({ id: authSchema.user.id }).from(authSchema.user)
      .where(orm.eq(authSchema.user.email, state.email)).limit(1);
    authUserId = foundUser?.id;
  }
  if (!familyId && authUserId) {
    const [membership] = await db.select({ familyId: familySchema.guardians.familyId })
      .from(familySchema.guardians).where(orm.eq(familySchema.guardians.authUserId, authUserId)).limit(1);
    familyId = membership?.familyId;
  }
  if (familyId) {
    for (const mediaId of state.mediaIds) {
      try { await store.remove(familyId, mediaId); } catch { /* DB cleanup must still run. */ }
    }
  }
  await db.transaction(async (tx) => {
    if (cleanupJobIds.length > 0) {
      await tx.delete(jobSchema.jobs).where(orm.inArray(jobSchema.jobs.id, cleanupJobIds));
    }
    if (familyId) {
    await tx.delete(sessionSchema.dictationCompletionEvents).where(orm.eq(sessionSchema.dictationCompletionEvents.familyId, familyId));
    await tx.delete(sessionSchema.dictationAnswerEvents).where(orm.eq(sessionSchema.dictationAnswerEvents.familyId, familyId));
    await tx.delete(sessionSchema.dictationPlaybackEvents).where(orm.eq(sessionSchema.dictationPlaybackEvents.familyId, familyId));
    await tx.delete(sessionSchema.dictationCommands).where(orm.eq(sessionSchema.dictationCommands.familyId, familyId));
    const todoIds = (await tx.select({ id: todoSchema.todoTasks.id })
      .from(todoSchema.todoTasks)
      .where(orm.eq(todoSchema.todoTasks.familyId, familyId)))
      .map((todo) => todo.id);
    if (todoIds.length > 0) {
      todoAttachmentIds = (await tx.select({ id: todoSchema.todoSubmissions.attachmentId })
        .from(todoSchema.todoSubmissions)
        .where(orm.inArray(todoSchema.todoSubmissions.todoId, todoIds)))
        .flatMap((attachment) => attachment.id ? [attachment.id] : []);
      await tx.delete(todoSchema.todoReviews).where(orm.inArray(todoSchema.todoReviews.todoId, todoIds));
      await tx.delete(todoSchema.todoRewards).where(orm.inArray(todoSchema.todoRewards.todoId, todoIds));
      await tx.delete(todoSchema.todoSubmissions).where(orm.inArray(todoSchema.todoSubmissions.todoId, todoIds));
      await tx.delete(todoSchema.todoTasks).where(orm.inArray(todoSchema.todoTasks.id, todoIds));
    }
    // Task deletion owns the tested aggregate and cascades through sessions,
    // immutable round membership and task items without bypassing DB guards.
    await tx.delete(taskSchema.learningTasks).where(orm.eq(taskSchema.learningTasks.familyId, familyId));
    await tx.delete(reviewSchema.reviewEvents).where(orm.and(
      orm.eq(reviewSchema.reviewEvents.familyId, familyId),
      orm.isNotNull(reviewSchema.reviewEvents.sourceReviewEventId),
    ));
    await tx.delete(reviewSchema.reviewEvents).where(orm.eq(reviewSchema.reviewEvents.familyId, familyId));
    await tx.delete(reviewSchema.childCardStates).where(orm.eq(reviewSchema.childCardStates.familyId, familyId));
    await tx.delete(mediaSchema.privateMedia).where(orm.eq(mediaSchema.privateMedia.familyId, familyId));
    await tx.delete(contentSchema.learningCards).where(orm.eq(contentSchema.learningCards.familyId, familyId));
    await tx.delete(familySchema.families).where(orm.eq(familySchema.families.id, familyId));
    }
    if (state.builtinCardIds?.length) await tx.delete(contentSchema.learningCards).where(orm.inArray(contentSchema.learningCards.id, state.builtinCardIds));
    if (authUserId) await tx.delete(authSchema.user).where(orm.eq(authSchema.user.id, authUserId));
  });
  await Promise.all(todoAttachmentIds.map((id) => removeAttachment(id)));
  if (cleanupJobIds.length > 0 || state.jobDedupeKeys.length > 0) {
    const remainingJobs = await db.select({ id: jobSchema.jobs.id })
      .from(jobSchema.jobs)
      .where(trackedJobPredicate(cleanupJobIds, state.jobDedupeKeys));
    expect(remainingJobs).toEqual([]);
  }
}

test.afterEach(async () => {
  if (!fixtureState) return;
  const state = fixtureState;
  try {
    await cleanupFixture(state);
  } finally {
    fixtureState = null;
  }
});

test("连续听写、刷新、切换孩子、批改恢复和错题循环", async ({ browser, page }) => {
  test.setTimeout(120_000);
  const setup = await createFamilyAndTask(page);
  const childIp = test.info().project.name === "webkit" ? "198.51.100.20" : "192.0.2.20";
  const childContext = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": childIp },
  });
  await childContext.addInitScript(() => {
    Object.defineProperty(globalThis, "__e2eDocumentId", {
      configurable: true,
      value: crypto.randomUUID(),
    });
    const originalPlay = HTMLMediaElement.prototype.play;
    const ids = new WeakMap<HTMLMediaElement, string>();
    const idFor = (audio: HTMLMediaElement) => {
      if (!ids.has(audio)) ids.set(audio, crypto.randomUUID());
      return ids.get(audio)!;
    };
    const originalPause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function instrumentedPause() {
      const observations = JSON.parse(sessionStorage.getItem("e2eAudioPauses") ?? "[]") as string[];
      observations.push(idFor(this));
      sessionStorage.setItem("e2eAudioPauses", JSON.stringify(observations));
      return originalPause.call(this);
    };
    HTMLMediaElement.prototype.play = function instrumentedPlay() {
      const count = Number(sessionStorage.getItem("e2eAudioPlayCount") ?? "0") + 1;
      sessionStorage.setItem("e2eAudioPlayCount", String(count));
      const observations = JSON.parse(
        sessionStorage.getItem("e2eAudioObservations") ?? "[]",
      ) as Array<{ at: number; rate: number; id: string }>;
      observations.push({ at: Date.now(), rate: this.playbackRate, id: idFor(this) });
      sessionStorage.setItem("e2eAudioObservations", JSON.stringify(observations));
      return originalPlay.call(this);
    };
  });
  const childPage = await pairAndSelect(childContext, setup.pairingCode, "小雨");
  const playbackCommands: Array<{ playedItemIds: string[]; sequenceFinished: boolean }> = [];
  childPage.on("request", request => {
    if (request.url().endsWith("/commands") && request.method() === "POST") {
      const body = request.postDataJSON();
      if (body.type === "playback") playbackCommands.push(body);
    }
  });
  const audioEvidenceNow = () => childPage.evaluate(() => ({
    plays: JSON.parse(sessionStorage.getItem("e2eAudioObservations") ?? "[]") as Array<{ id: string }>,
    pauses: JSON.parse(sessionStorage.getItem("e2eAudioPauses") ?? "[]") as string[],
  }));
  let blockAudio = true;
  await childPage.route("**/api/private-media/**", (route) => blockAudio ? route.abort() : route.continue());

  await expect(childPage.getByRole("heading", { name: "小雨的今日待办" })).toBeVisible();
  await expect(childPage.getByText("今日听写（3项）", { exact: true })).toBeVisible();
  // Leave a genuine previous child document in history, then prove that the
  // header switch and new-child selection both replace the current document.
  await childPage.goto("/child/tasks");
  await expect(childPage).toHaveURL(/\/child$/);
  await expect(childPage.getByRole("heading", { name: "小雨的今日待办" })).toBeVisible();
  await expect(childPage.getByText("今日听写（3项）", { exact: true })).toBeVisible();
  await childPage.goto("/child");
  await childPage.waitForLoadState("networkidle");
  const firstHomeDocumentId = await readDocumentId(childPage);
  await Promise.all([
    childPage.waitForURL(/\/child\/switch$/, { waitUntil: "domcontentloaded" }),
    childPage.getByRole("button", { name: "切换孩子" }).click(),
  ]);
  await expectDocumentReplaced(childPage, firstHomeDocumentId);
  const firstSwitchDocumentId = await readDocumentId(childPage);
  await Promise.all([
    childPage.waitForURL(/\/child$/, { waitUntil: "domcontentloaded" }),
    childPage.getByRole("button", { name: /小川/ }).click(),
  ]);
  await expect(childPage.getByRole("heading", { name: "小川的今日待办" })).toBeVisible();
  await expectDocumentReplaced(childPage, firstSwitchDocumentId);
  await childPage.waitForLoadState("networkidle");
  const firstSecondChildDocumentId = await readDocumentId(childPage);
  await childPage.goBack();
  await expect(childPage.getByRole("heading", { name: "小川的今日待办" })).toBeVisible();
  await expect(childPage.getByRole("heading", { name: "小雨的今日待办" })).toHaveCount(0);
  await expect(childPage.getByText("今日听写（3项）", { exact: true })).toHaveCount(0);
  await expect(childPage.getByText("桂花", { exact: true })).toHaveCount(0);
  await expectDocumentReplaced(childPage, firstSecondChildDocumentId);
  const firstBackDocumentId = await readDocumentId(childPage);
  await childPage.goForward();
  await expect(childPage.getByRole("heading", { name: "小川的今日待办" })).toBeVisible();
  await expectDocumentReplaced(childPage, firstBackDocumentId);
  await childPage.waitForLoadState("networkidle");
  const secondHomeDocumentId = await readDocumentId(childPage);
  await Promise.all([
    childPage.waitForURL(/\/child\/switch$/, { waitUntil: "domcontentloaded" }),
    childPage.getByRole("button", { name: "切换孩子" }).click(),
  ]);
  await expectDocumentReplaced(childPage, secondHomeDocumentId);
  await childPage.getByRole("button", { name: /小雨/ }).click();
  await expect(childPage.getByRole("heading", { name: "小雨的今日待办" })).toBeVisible();
  await childPage.waitForLoadState("networkidle");
  await childPage.getByRole("button", { name: "开始听写" }).click();
  await expect(childPage).toHaveURL(/\/child\/dictation\//);
  const sessionSettings = await childPage.evaluate(async () => {
    const response = await fetch(window.location.pathname.replace("/child/dictation/", "/api/child/dictation/"));
    const payload = await response.json() as { session: { repeatCount: number; speechRate: number } };
    return payload.session;
  });
  expect(sessionSettings).toMatchObject({ repeatCount: 2, speechRate: 1.25 });
  await expect(childPage.getByText("桂花", { exact: true })).toHaveCount(0);
  await expect(childPage.getByText("guì huā", { exact: true })).toBeVisible();
  await expect(childPage.getByText("语境：院子里的（　　）开了。", { exact: true })).toBeVisible();
  await expect(childPage.getByText("音频还没准备好，请让家长准备音频后再试。")).toBeVisible();
  blockAudio = false;
  await childPage.getByRole("button", { name: "重新准备" }).click();
  await expect(childPage.getByRole("button", { name: "开始听写" })).toBeEnabled();
  await expect(childPage.getByRole("button", { name: "重听当前词语" })).toBeDisabled();
  await childPage.getByRole("button", { name: "开始听写" }).click();
  const beforePause = await audioEvidenceNow();
  await childPage.getByRole("button", { name: "暂停" }).click();
  await expect(childPage.getByRole("button", { name: "继续" })).toBeVisible();
  expect((await audioEvidenceNow()).pauses.length).toBeGreaterThan(beforePause.pauses.length);
  await childPage.waitForTimeout(500);
  expect(playbackCommands).toHaveLength(0);
  await childPage.getByRole("button", { name: "继续" }).click();
  expect((await audioEvidenceNow()).plays.at(-1)!.id).toBe(beforePause.plays.at(-1)!.id);
  await expect(childPage.getByRole("button", { name: "重听当前词语" })).toBeEnabled({ timeout: 20_000 });
  await expect(childPage.getByLabel("第 1 / 3 题")).toBeVisible();
  await expect(childPage.getByText("guì huā", { exact: true })).toBeVisible();
  await expect(childPage.getByText("gù xiāng", { exact: true })).toHaveCount(0);
  await childPage.getByRole("button", { name: "暂停" }).click();
  const intervalPlays = (await audioEvidenceNow()).plays.length;
  await childPage.waitForTimeout(2300);
  expect((await audioEvidenceNow()).plays).toHaveLength(intervalPlays);
  expect(playbackCommands).toHaveLength(1);
  await childPage.getByRole("button", { name: "继续" }).click();
  await childPage.getByRole("button", { name: "重听当前词语" }).click();
  await childPage.getByRole("button", { name: "暂停" }).click();
  await childPage.waitForTimeout(500);
  expect(playbackCommands).toHaveLength(1);
  await childPage.getByRole("button", { name: "继续", exact: true }).click();
  await expect(childPage.getByRole("button", { name: "继续听写" })).toBeVisible();
  expect(playbackCommands).toHaveLength(2);
  expect(playbackCommands[1]).toMatchObject({ playedItemIds: playbackCommands[0]!.playedItemIds, sequenceFinished: false });
  await expect(childPage.getByLabel("第 1 / 3 题")).toBeVisible();

  await childPage.reload();
  await expect(childPage.getByLabel("第 2 / 3 题")).toBeVisible();
  await expect(childPage.getByText("桂花", { exact: true })).toHaveCount(0);
  const originalDocumentId = await childPage.evaluate(() => (globalThis as typeof globalThis & { __e2eDocumentId: string }).__e2eDocumentId);
  const switchButton = childPage.getByRole("button", { name: "切换孩子" });
  await switchButton.click();
  await expect(childPage.getByRole("dialog")).toContainText("听写任务不会取消");
  await childPage.keyboard.press("Escape");
  await expect(childPage.getByRole("dialog")).toHaveCount(0);
  await expect(switchButton).toBeFocused();
  await switchButton.click();
  const nativeNavigationDialogs: string[] = [];
  const recordNativeDialog = (dialog: { type(): string; accept(): Promise<void> }) => {
    nativeNavigationDialogs.push(dialog.type());
    void dialog.accept();
  };
  childPage.on("dialog", recordNativeDialog);
  await Promise.all([
    childPage.waitForURL(/\/child\/switch$/, { waitUntil: "domcontentloaded" }),
    childPage.getByRole("button", { name: "确认切换" }).click(),
  ]);
  await expectDocumentReplaced(childPage, originalDocumentId);
  const switchDocumentId = await readDocumentId(childPage);
  await Promise.all([
    childPage.waitForURL(/\/child$/, { waitUntil: "domcontentloaded" }),
    childPage.getByRole("button", { name: /小川/ }).click(),
  ]);
  await expect(childPage.getByRole("heading", { name: "小川的今日待办" })).toBeVisible();
  await expectDocumentReplaced(childPage, switchDocumentId);
  expect(nativeNavigationDialogs).toEqual([]);
  childPage.off("dialog", recordNativeDialog);
  await childPage.goBack();
  await expect(childPage.getByRole("heading", { name: "小川的今日待办" })).toBeVisible();
  await expect(childPage.getByRole("heading", { name: "小雨的今日待办" })).toHaveCount(0);
  await expect(childPage.getByText("今日听写（3项）", { exact: true })).toHaveCount(0);
  await expect(childPage.getByText("桂花", { exact: true })).toHaveCount(0);
  await childPage.goForward();
  await expect(childPage.getByRole("heading", { name: "小川的今日待办" })).toBeVisible();
  await childPage.waitForLoadState("networkidle");
  await childPage.getByRole("button", { name: "切换孩子" }).click();
  await childPage.getByRole("button", { name: /小雨/ }).click();
  await childPage.getByRole("button", { name: "继续听写" }).click();
  await expect(childPage.getByLabel("第 2 / 3 题")).toBeVisible();
  await childPage.getByRole("button", { name: "继续听写" }).click();

  await expect(childPage.getByRole("heading", { name: "请认真核对每一题" })).toBeVisible({ timeout: 20_000 });
  await expect(childPage.getByText("桂花", { exact: true })).toBeVisible();
  const gradingDocumentId = await childPage.evaluate(
    () => (globalThis as typeof globalThis & { __e2eDocumentId: string }).__e2eDocumentId,
  );
  await childPage.getByRole("button", { name: "切换孩子" }).click();
  await childPage.getByRole("button", { name: "确认切换" }).click();
  await expect.poll(() => childPage.evaluate(
    () => (globalThis as typeof globalThis & { __e2eDocumentId: string }).__e2eDocumentId,
  )).not.toBe(gradingDocumentId);
  await childPage.getByRole("button", { name: /小川/ }).click();
  await expect(childPage.getByRole("heading", { name: "小川的今日待办" })).toBeVisible();
  const gradingSwitchDocumentId = await childPage.evaluate(
    () => (globalThis as typeof globalThis & { __e2eDocumentId: string }).__e2eDocumentId,
  );
  await childPage.goBack();
  await expect(childPage.getByRole("heading", { name: "小川的今日待办" })).toBeVisible();
  await expect(childPage.getByRole("heading", { name: "请认真核对每一题" })).toHaveCount(0);
  await expect(childPage.getByRole("heading", { name: "小雨的今日待办" })).toHaveCount(0);
  await expect(childPage.getByText("桂花", { exact: true })).toHaveCount(0);
  await expect(childPage.getByText("故乡", { exact: true })).toHaveCount(0);
  await expect(childPage.getByText("清晨", { exact: true })).toHaveCount(0);
  await expect.poll(() => childPage.evaluate(
    () => (globalThis as typeof globalThis & { __e2eDocumentId: string }).__e2eDocumentId,
  )).not.toBe(gradingSwitchDocumentId);
  await childPage.goForward();
  await expect(childPage.getByRole("heading", { name: "小川的今日待办" })).toBeVisible();
  await childPage.waitForLoadState("networkidle");
  await childPage.getByRole("button", { name: "切换孩子" }).click();
  await childPage.getByRole("button", { name: /小雨/ }).click();
  await childPage.getByRole("button", { name: "继续听写" }).click();
  await expect(childPage.getByRole("heading", { name: "请认真核对每一题" })).toBeVisible();
  await childPage.waitForLoadState("networkidle");
  const firstAnswer = childPage.locator("fieldset").nth(0);
  await firstAnswer.getByRole("button", { name: "正确" }).click();
  await childPage.reload();
  await expect(childPage.locator("fieldset").nth(0).getByRole("button", { name: "正确" })).toHaveAttribute("aria-pressed", "true");
  await childPage.locator("fieldset").nth(1).getByRole("button", { name: "错了" }).click();
  await childPage.locator("fieldset").nth(2).getByRole("button", { name: "正确" }).click();
  let corruptSaveResponse = true;
  const retriedBodies: string[] = [];
  let releaseCorruptResponse!: () => void;
  let markCorruptRequestStarted!: () => void;
  const corruptResponseGate = new Promise<void>((resolve) => { releaseCorruptResponse = resolve; });
  const corruptRequestStarted = new Promise<void>((resolve) => { markCorruptRequestStarted = resolve; });
  await childPage.route("**/api/child/dictation/*/commands", async (route) => {
    retriedBodies.push(route.request().postData() ?? "");
    if (corruptSaveResponse) {
      markCorruptRequestStarted();
      await corruptResponseGate;
      await route.fulfill({ status: 503, contentType: "text/plain", body: "invalid-json" });
    } else {
      await route.continue();
    }
  });
  await childPage.getByRole("button", { name: "提交本轮" }).click();
  await corruptRequestStarted;
  await childPage.getByRole("button", { name: "切换孩子" }).click();
  await expect(childPage.getByRole("dialog")).toHaveCount(0);
  releaseCorruptResponse();
  await expect(childPage.getByRole("button", { name: "重试保存" })).toBeVisible();
  await expect(childPage.getByRole("dialog")).toHaveCount(0);
  await expect(childPage.locator("fieldset").nth(1).getByRole("button", { name: "错了" })).toBeDisabled();
  corruptSaveResponse = false;
  await childPage.getByRole("button", { name: "重试保存" }).click();
  await expect.poll(() => retriedBodies.length).toBe(2);
  expect(retriedBodies[1]).toBe(retriedBodies[0]);
  await childPage.unroute("**/api/child/dictation/*/commands");

  await expect(childPage.getByText("再听一次，共 1 题")).toBeVisible();
  await childPage.getByRole("button", { name: "开始听写" }).click();
  await expect(childPage.getByRole("heading", { name: "请认真核对每一题" })).toBeVisible({ timeout: 15_000 });
  await childPage.getByRole("button", { name: "正确" }).click();
  await childPage.getByRole("button", { name: "提交本轮" }).click();
  await expect(childPage.getByRole("heading", { name: "本次听写已完成" })).toBeVisible();
  await expect(childPage.getByText("听写已完成，待提交")).toBeVisible();
  await expect(childPage.getByLabel("上传照片（可选）")).toBeVisible();
  const completedTodo = await childPage.evaluate(async () => {
    const response = await fetch(window.location.pathname.replace("/child/dictation/", "/api/child/dictation/"));
    const payload = await response.json() as { session: { todoSubmission: { id: string; date: string; number: number } } };
    return payload.session.todoSubmission;
  });
  const audioMarker = `ID3dictation-${crypto.randomUUID()}`;
  const audioResult = await childPage.evaluate(async ({ todo, marker }) => {
    const body = new FormData();
    body.set("id", todo.id);
    body.set("date", todo.date);
    body.set("number", String(todo.number));
    body.set("file", new File([marker], "dictation.mp3", { type: "audio/mpeg" }));
    const response = await fetch("/api/child/todos", { method: "POST", body });
    return { status: response.status, error: (await response.json()).error as string };
  }, { todo: completedTodo, marker: audioMarker });
  expect(audioResult.status).toBe(409);
  expect(audioResult.error).toContain("只能上传图片");
  const { db: todoDb } = await import("@/db/client");
  const { todoTasks: todoTable, todoSubmissions: submissionTable } = await import("@/modules/todos/schema");
  const { eq: same } = await import("drizzle-orm");
  expect((await todoDb.select().from(todoTable).where(same(todoTable.id, completedTodo.id)))[0]).toMatchObject({ status: "open", submissionNumber: 0 });
  expect(await todoDb.select().from(submissionTable).where(same(submissionTable.todoId, completedTodo.id))).toHaveLength(0);
  const savedEvidence = await readdir("var/media/todo").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [] as string[];
    throw error;
  });
  for (const name of savedEvidence) {
    expect((await readFile(`var/media/todo/${name}`)).includes(audioMarker)).toBe(false);
  }
  await childPage.getByRole("button", { name: "提交家长审核" }).click();
  await expect(childPage.getByText("等待家长审核")).toBeVisible();
  await childPage.goto("/child");
  await expect(childPage.getByText("等待家长审核")).toBeVisible();
  await page.goto("/parent/todos");
  await expect(page.getByRole("button", { name: /通过并发放/ })).toBeVisible();
  expect(await childPage.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("dictation:")))).toEqual([]);
  const audioEvidence = await childPage.evaluate(() => ({
    count: Number(sessionStorage.getItem("e2eAudioPlayCount") ?? "0"),
    observations: JSON.parse(sessionStorage.getItem("e2eAudioObservations") ?? "[]") as Array<{
      at: number;
      rate: number;
    }>,
  }));
  expect(audioEvidence.count).toBeGreaterThanOrEqual(9);
  expect([...new Set(audioEvidence.observations.map((entry) => entry.rate))]).toEqual([1]);
  expect(
    audioEvidence.observations.some(
      (entry, index) => index > 0 && entry.at - audioEvidence.observations[index - 1]!.at >= 1_500,
    ),
  ).toBe(true);

  await page.goto("/parent/reports");
  await expect(page.getByRole("heading", { name: "今天先看这些" })).toBeVisible();
  const childSummary = page.locator("article").filter({ hasText: "小雨" }).first();
  await expect(childSummary).toContainText("今日听写已完成");
  const weakSection = page.locator("section").filter({
    has: page.getByRole("heading", { name: "今日薄弱词" }),
  });
  const weakCardLink = weakSection.locator("article").filter({ hasText: "小雨" })
    .getByRole("link");
  await expect(weakCardLink).toHaveCount(1);
  const weakAnswer = await weakCardLink.innerText();
  await childSummary.getByRole("link", { name: "查看今日听写报告" }).click();
  await expect(page.getByRole("heading", { name: "本次学习报告" })).toBeVisible();
  await expect(page.getByText("由孩子自主批改，未经机器或家长判卷")).toBeVisible();
  await expect(page.getByText("首轮正确率")).toBeVisible();
  await expect(page.getByText("最终完成率")).toBeVisible();
  await page.getByRole("link", { name: weakAnswer }).click();
  await expect(page.getByRole("heading", { name: weakAnswer })).toBeVisible();
  await expect(page.getByText("首轮需加强")).toBeVisible();
  await expect(page.getByText("本场订正完成")).toBeVisible();
  await expect(page.getByText("答题记录（最近 100 次）")).toBeVisible();

  await childContext.close();
});

test("完成听写后可在待办清单上传照片，家长可打开凭证", async ({ browser, page }) => {
  test.setTimeout(120_000);
  const setup = await createFamilyAndTask(page);
  const child = setup.children.find((item) => item.nickname === "小雨")!;
  const [{ db }, { learningTasks }, { dictationSessions }, { eq }] = await Promise.all([
    import("@/db/client"),
    import("@/modules/dictation/task-schema"),
    import("@/modules/dictation/session-schema"),
    import("drizzle-orm"),
  ]);
  await db.update(learningTasks).set({ status: "completed", completedAt: new Date() }).where(eq(learningTasks.id, setup.task.id));
  await db.insert(dictationSessions).values({
    familyId: fixtureState!.familyId!, childId: child.id, taskId: setup.task.id,
    mode: "continuous_batch", status: "completed", phase: "completed",
    completedAt: new Date(), currentRoundItemIds: [],
  });
  const childContext = await browser.newContext();
  const childPage = await pairAndSelect(childContext, setup.pairingCode, "小雨");
  await expect(childPage.getByText("听写已完成，待提交")).toBeVisible();
  const photo = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X6uoAAAAASUVORK5CYII=", "base64");
  await childPage.getByLabel("上传照片（可选）").setInputFiles({ name: "dictation.png", mimeType: "image/png", buffer: photo });
  let releaseSubmission!: () => void;
  let submissionStarted!: () => void;
  const submissionGate = new Promise<void>((resolve) => { releaseSubmission = resolve; });
  const started = new Promise<void>((resolve) => { submissionStarted = resolve; });
  await childPage.route("**/api/child/todos", async (route) => {
    if (route.request().method() === "POST") {
      submissionStarted();
      await submissionGate;
    }
    await route.continue();
  });
  await childPage.getByRole("button", { name: "提交家长审核" }).click();
  await started;
  await expect(childPage.getByRole("button", { name: "正在提交…" })).toBeDisabled();
  releaseSubmission();
  await expect(childPage.getByText("等待家长审核")).toBeVisible();
  await page.goto("/parent/todos");
  const evidenceLink = page.getByRole("link", { name: "完成任务的图片" });
  await expect(evidenceLink).toBeVisible();
  const [evidencePage] = await Promise.all([page.waitForEvent("popup"), evidenceLink.click()]);
  await expect(evidencePage).toHaveURL(/\/api\/todo-attachments\//);
  const evidence = await page.request.get(evidencePage.url());
  expect(evidence.status()).toBe(200);
  expect(evidence.headers()["content-type"]).toBe("image/png");
  await page.getByPlaceholder("退回时必填").fill("请确认照片");
  await page.getByRole("button", { name: "退回，不发积分" }).click();
  await childPage.getByRole("button", { name: "刷新" }).click();
  await expect(childPage.getByText("听写已完成，待提交")).toBeVisible();
  await expect(childPage.getByLabel("上传照片（可选）")).toBeVisible();
  await childContext.close();
});

test("初始化中途失败也能按email精确清理已创建用户", async ({ page }) => {
  const email = `dictation-partial-${Date.now()}-${test.info().project.name}-${crypto.randomUUID()}@example.test`;
  fixtureState = { email, mediaIds: [], jobIds: [], jobDedupeKeys: [] };
  await page.goto("/sign-up");
  await page.getByLabel("称呼").fill("部分初始化家长");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  const [signUpResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/auth/sign-up/email")),
    page.getByRole("button", { name: "注册" }).click(),
  ]);
  expect(signUpResponse.status()).toBe(200);
  await expect(page).toHaveURL(/\/onboarding/);
  await cleanupFixture(fixtureState);
  fixtureState = null;
  const [{ db }, { user }, { eq }] = await Promise.all([
    import("@/db/client"), import("@/modules/auth/schema"), import("drizzle-orm"),
  ]);
  expect(await db.select({ id: user.id }).from(user).where(eq(user.email, email))).toEqual([]);
});
