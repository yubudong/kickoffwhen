import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { expect, test } from "vitest";

import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { user as authUsers } from "@/modules/auth/schema";
import { learningTaskItems, learningTasks } from "@/modules/dictation/task-schema";
import { createDictationTaskService } from "@/modules/dictation/task-service";
import { children, families, guardians } from "@/modules/families/schema";
import { buildTtsDedupeKey } from "@/modules/jobs/service";
import { jobs } from "@/modules/jobs/schema";
import { learningCards } from "@/modules/learning-content/schema";
import { privateMedia } from "@/modules/media/schema";
import { todoTasks } from "@/modules/todos/schema";

type TaskTestDatabase = typeof db;
const connectionString = process.env.DATABASE_URL!;

async function committedFixture(database: TaskTestDatabase) {
  const suffix = crypto.randomUUID();
  const authUserId = `task-concurrent-${suffix}`;
  await database.insert(authUsers).values({
    id: authUserId,
    name: "并发建任务家长",
    email: `task-concurrent-${suffix}@example.test`,
  });
  const [family] = await database.insert(families).values({ name: `并发建任务-${suffix}` }).returning();
  const [guardian] = await database.insert(guardians).values({
    familyId: family.id,
    authUserId,
  }).returning();
  const [child] = await database.insert(children).values({
    familyId: family.id,
    nickname: "并发任务孩子",
    grade: 5,
  }).returning();
  const cards = await database.insert(learningCards).values([
    {
      familyId: family.id,
      subject: "english",
      answerText: "concurrent-idempotent",
      broadcastText: "concurrent-idempotent",
      source: "manual",
    },
    {
      familyId: family.id,
      subject: "english",
      answerText: "concurrent-distinct-commands",
      broadcastText: "concurrent-distinct-commands",
      source: "manual",
    },
  ]).returning();
  const ttsDedupeKeys = cards.map((card) => buildTtsDedupeKey({
    familyId: family.id,
    childId: child.id,
    cardId: card.id,
    text: card.broadcastText,
    language: "en-US",
    voice: "en-US-JennyNeural",
    rate: 1,
  }));
  await database.insert(privateMedia).values(cards.map((card, index) => ({
    familyId: family.id,
    childId: child.id,
    kind: "tts_audio",
    mimeType: "audio/mpeg",
    byteSize: 1,
    sha256: "0".repeat(64),
    relativePath: `tests/task-concurrency-${suffix}-${index}.mp3`,
    dedupeKey: ttsDedupeKeys[index],
    expiresAt: null,
  })));
  return {
    familyId: family.id,
    authUserId,
    ttsDedupeKeys,
    child,
    cards,
    actor: {
      role: "guardian" as const,
      familyId: family.id,
      guardianId: guardian.id,
    },
  };
}

async function waitForTwoBlockedClients(
  control: PoolClient,
  applicationNames: string[],
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await control.query<{ count: string }>(
      `select count(*)::text as count
       from pg_stat_activity
       where application_name = any($1::text[])
         and wait_event_type = 'Lock'`,
      [applicationNames],
    );
    if (Number(result.rows[0]?.count) === 2) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("CONCURRENT_TASK_CALLS_DID_NOT_OVERLAP");
}

test("独立连接真实重叠时，同 command 幂等且不同 command 不会重复卡片", async () => {
  const names = [
    `tca-${crypto.randomUUID().slice(0, 8)}`,
    `tcb-${crypto.randomUUID().slice(0, 8)}`,
  ];
  const poolA = new Pool({ connectionString, application_name: names[0], max: 1 });
  const poolB = new Pool({ connectionString, application_name: names[1], max: 1 });
  const controlPool = new Pool({ connectionString, application_name: "task-concurrency-control", max: 1 });
  const clientA = await poolA.connect();
  const clientB = await poolB.connect();
  const control = await controlPool.connect();
  let cleanup:
    | { familyId: string; authUserId: string; ttsDedupeKeys: string[] }
    | undefined;
  let distinctCommandOutcomesPromise:
    | ReturnType<typeof Promise.allSettled>
    | undefined;
  try {
    const databaseA = drizzle({ client: clientA, schema }) as TaskTestDatabase;
    const databaseB = drizzle({ client: clientB, schema }) as TaskTestDatabase;
    const fixture = await committedFixture(databaseA);
    cleanup = fixture;
    const { actor, child, cards } = fixture;
    await control.query("begin");
    await control.query("select id from children where id = $1 for update", [child.id]);
    const input = {
      childId: child.id,
      newCardIds: [cards[0].id],
      commandId: crypto.randomUUID(),
      maxReviewCards: 0,
      mode: "continuous_batch" as const,
      order: "source" as const,
      intervalSeconds: 8,
      repeatCount: 1 as const,
      speechRate: 1,
      allowManualReplay: true,
    };
    const outcomesPromise = Promise.allSettled([
      createDictationTaskService(databaseA).buildDailyTask(actor, input),
      createDictationTaskService(databaseB).buildDailyTask(actor, input),
    ]);
    try {
      await waitForTwoBlockedClients(control, names);
      await control.query("commit");
      const outcomes = await outcomesPromise;
      expect(outcomes.every((outcome) => outcome.status === "fulfilled")).toBe(true);
      if (outcomes[0].status !== "fulfilled" || outcomes[1].status !== "fulfilled") {
        throw new Error("CONCURRENT_TASK_RETRY_FAILED");
      }
      expect(outcomes[1].value.id).toBe(outcomes[0].value.id);

      await control.query("begin");
      await control.query("select id from children where id = $1 for update", [child.id]);
      distinctCommandOutcomesPromise = Promise.allSettled([
        createDictationTaskService(databaseA).buildDailyTask(actor, {
          ...input,
          commandId: crypto.randomUUID(),
          newCardIds: [cards[1].id],
        }),
        createDictationTaskService(databaseB).buildDailyTask(actor, {
          ...input,
          commandId: crypto.randomUUID(),
          newCardIds: [cards[1].id],
        }),
      ]);
      await waitForTwoBlockedClients(control, names);
      await control.query("commit");
      const distinctCommandOutcomes = await distinctCommandOutcomesPromise;
      expect(distinctCommandOutcomes.filter((outcome) => outcome.status === "fulfilled"))
        .toHaveLength(1);
      const rejected = distinctCommandOutcomes.find((outcome) => outcome.status === "rejected");
      expect(rejected).toBeDefined();
      if (rejected?.status === "rejected") {
        expect(rejected.reason).toMatchObject({ message: "TASK_EMPTY" });
      }
    } finally {
      await control.query("rollback").catch(() => undefined);
      await outcomesPromise;
      await distinctCommandOutcomesPromise;
    }
  } finally {
    await control.query("rollback").catch(() => undefined);
    clientA.release();
    clientB.release();
    control.release();
    await Promise.all([poolA.end(), poolB.end(), controlPool.end()]);
    if (cleanup) {
      for (const dedupeKey of cleanup.ttsDedupeKeys) {
        await db.delete(jobs).where(eq(jobs.dedupeKey, dedupeKey));
      }
      await db
        .delete(learningTaskItems)
        .where(eq(learningTaskItems.familyId, cleanup.familyId));
      await db.delete(todoTasks).where(eq(todoTasks.familyId, cleanup.familyId));
      await db.delete(learningTasks).where(eq(learningTasks.familyId, cleanup.familyId));
      await db.delete(families).where(eq(families.id, cleanup.familyId));
      await db.delete(authUsers).where(eq(authUsers.id, cleanup.authUserId));
    }
  }
});
