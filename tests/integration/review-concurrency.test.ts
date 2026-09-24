import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { expect, test } from "vitest";

import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { user as authUsers } from "@/modules/auth/schema";
import { children, families, guardians } from "@/modules/families/schema";
import { learningCards } from "@/modules/learning-content/schema";
import { createReviewService } from "@/modules/review/service";

const connectionString = process.env.DATABASE_URL!;
type ReviewTestDatabase = typeof db;

async function committedFixture(database: ReviewTestDatabase, label: string) {
  const suffix = crypto.randomUUID();
  const authUserId = `review-concurrent-${label}-${suffix}`;
  await database.insert(authUsers).values({
    id: authUserId,
    name: "并发复习家长",
    email: `review-concurrent-${label}-${suffix}@example.test`,
  });
  const [family] = await database.insert(families).values({
    name: `并发复习-${label}-${suffix}`,
  }).returning();
  await database.insert(guardians).values({
    familyId: family.id,
    authUserId,
  });
  const [child] = await database.insert(children).values({
    familyId: family.id,
    nickname: "并发孩子",
    grade: 5,
  }).returning();
  const [card] = await database.insert(learningCards).values({
    familyId: family.id,
    subject: "english",
    answerText: `concurrency-${label}`,
    broadcastText: `concurrency-${label}`,
    source: "manual",
  }).returning();
  return {
    familyId: family.id,
    authUserId,
    card,
    actor: {
      role: "child" as const,
      familyId: family.id,
      childId: child.id,
      deviceId: crypto.randomUUID(),
    },
  };
}

async function waitUntilBothConnectionsAreBlocked(
  control: PoolClient,
  applicationNames: string[],
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await control.query<{ count: string }>(
      `select count(*)::text as count
       from pg_stat_activity
         where application_name = any($1::text[])
         and wait_event_type = 'Lock'
         and wait_event = 'advisory'`,
      [applicationNames],
    );
    if (Number(result.rows[0]?.count) === applicationNames.length) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const debug = await control.query(
    `select application_name, state, wait_event_type, wait_event, left(query, 100) as query
     from pg_stat_activity
     where application_name = any($1::text[])`,
    [applicationNames],
  );
  throw new Error(
    `CONCURRENT_REVIEW_CALLS_DID_NOT_OVERLAP:${JSON.stringify(debug.rows)}`,
  );
}

async function withIndependentDatabases(
  run: (input: {
    databaseA: ReviewTestDatabase;
    databaseB: ReviewTestDatabase;
    control: PoolClient;
    applicationNames: string[];
  }) => Promise<void>,
) {
  const applicationNames = [
    `rca-${crypto.randomUUID().slice(0, 8)}`,
    `rcb-${crypto.randomUUID().slice(0, 8)}`,
  ];
  const poolA = new Pool({ connectionString, application_name: applicationNames[0], max: 1 });
  const poolB = new Pool({ connectionString, application_name: applicationNames[1], max: 1 });
  const controlPool = new Pool({ connectionString, application_name: "review-concurrency-control", max: 1 });
  const clientA = await poolA.connect();
  const clientB = await poolB.connect();
  const control = await controlPool.connect();
  try {
    await run({
      databaseA: drizzle({ client: clientA, schema }) as ReviewTestDatabase,
      databaseB: drizzle({ client: clientB, schema }) as ReviewTestDatabase,
      control,
      applicationNames,
    });
  } finally {
    await control.query("rollback").catch(() => undefined);
    clientA.release();
    clientB.release();
    control.release();
    await Promise.all([poolA.end(), poolB.end(), controlPool.end()]);
  }
}

async function holdScopeLock(control: PoolClient, scope: string) {
  await control.query("begin");
  await control.query(
    "select pg_advisory_xact_lock(hashtextextended($1, 0))",
    [scope],
  );
}

test("两个独立连接并发创建新 state，同 command 仅产生一个事件", async () => {
  let cleanup: { familyId: string; authUserId: string } | undefined;
  try {
    await withIndependentDatabases(async ({
      databaseA,
      databaseB,
      control,
      applicationNames,
    }) => {
      const fixture = await committedFixture(databaseA, "new-state");
      cleanup = fixture;
      const { actor, card } = fixture;
      const scope = `${actor.familyId}:${actor.childId}:${card.id}`;
      await holdScopeLock(control, scope);
      const input = {
        cardId: card.id,
        commandId: crypto.randomUUID(),
        correct: false,
        reviewedAt: new Date("2026-09-01T08:00:00.000Z"),
        eventType: "new_first" as const,
      };
      const outcomesPromise = Promise.allSettled([
        createReviewService(databaseA).recordFirstResult(actor, input),
        createReviewService(databaseB).recordFirstResult(actor, input),
      ]);
      try {
        await waitUntilBothConnectionsAreBlocked(control, applicationNames);
        await control.query("commit");
        const outcomes = await outcomesPromise;
        expect(outcomes.every((outcome) => outcome.status === "fulfilled")).toBe(true);
        if (outcomes[0].status !== "fulfilled" || outcomes[1].status !== "fulfilled") {
          throw new Error("CONCURRENT_REVIEW_RETRY_FAILED");
        }
        expect(outcomes[1].value.reviewEventId).toBe(outcomes[0].value.reviewEventId);
      } finally {
        await control.query("rollback").catch(() => undefined);
        await outcomesPromise;
      }
    });
  } finally {
    if (cleanup) {
      await db.delete(families).where(eq(families.id, cleanup.familyId));
      await db.delete(authUsers).where(eq(authUsers.id, cleanup.authUserId));
    }
  }
});

test("已有 state 时两个独立连接的不同 command 串行，仅一个能推进", async () => {
  let cleanup: { familyId: string; authUserId: string } | undefined;
  try {
    await withIndependentDatabases(async ({
      databaseA,
      databaseB,
      control,
      applicationNames,
    }) => {
      const fixture = await committedFixture(databaseA, "existing-state");
      cleanup = fixture;
      const { actor, card } = fixture;
      const service = createReviewService(databaseA);
      const initial = await service.recordFirstResult(actor, {
        cardId: card.id,
        commandId: crypto.randomUUID(),
        correct: true,
        reviewedAt: new Date("2026-08-01T08:00:00.000Z"),
        eventType: "new_first",
      });
      const reviewedAt = new Date(initial.dueAt.getTime() + 1_000);
      const scope = `${actor.familyId}:${actor.childId}:${card.id}`;
      await holdScopeLock(control, scope);
      const outcomesPromise = Promise.allSettled([
        createReviewService(databaseA).recordFirstResult(actor, {
          cardId: card.id,
          commandId: crypto.randomUUID(),
          correct: true,
          reviewedAt,
          eventType: "scheduled_first",
        }),
        createReviewService(databaseB).recordFirstResult(actor, {
          cardId: card.id,
          commandId: crypto.randomUUID(),
          correct: false,
          reviewedAt,
          eventType: "scheduled_first",
        }),
      ]);
      try {
        await waitUntilBothConnectionsAreBlocked(control, applicationNames);
        await control.query("commit");
        const outcomes = await outcomesPromise;
        expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
        expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
        const rejected = outcomes.find((outcome) => outcome.status === "rejected");
        expect(rejected?.status === "rejected" ? rejected.reason.message : "")
          .toBe("REVIEW_TIME_INVALID");
      } finally {
        await control.query("rollback").catch(() => undefined);
        await outcomesPromise;
      }
    });
  } finally {
    if (cleanup) {
      await db.delete(families).where(eq(families.id, cleanup.familyId));
      await db.delete(authUsers).where(eq(authUsers.id, cleanup.authUserId));
    }
  }
});
