import { count, eq } from "drizzle-orm";
import { expect, test } from "vitest";

import { user as authUsers } from "@/modules/auth/schema";
import type { DbTransaction } from "@/db/client";
import { children, families, guardians } from "@/modules/families/schema";
import { learningCards } from "@/modules/learning-content/schema";
import { reviewEvents } from "@/modules/review/db-schema";
import { createReviewService } from "@/modules/review/service";

import { withDatabaseRollback } from "../helpers/database";

async function familyFixture(tx: DbTransaction, label: string) {
  const suffix = crypto.randomUUID();
  await tx.insert(authUsers).values({
    id: `review-db-${label}-${suffix}`,
    name: `约束家长${label}`,
    email: `review-db-${label}-${suffix}@example.test`,
  });
  const [family] = await tx.insert(families).values({ name: `约束家庭${label}-${suffix}` }).returning();
  await tx.insert(guardians).values({ familyId: family.id, authUserId: `review-db-${label}-${suffix}` });
  const childRows = await tx.insert(children).values([
    { familyId: family.id, nickname: `${label}-1`, grade: 5 },
    { familyId: family.id, nickname: `${label}-2`, grade: 5 },
  ]).returning();
  const cardRows = await tx.insert(learningCards).values([
    { familyId: family.id, subject: "english", answerText: `${label}-card-1`, broadcastText: `${label}-card-1`, source: "manual" },
    { familyId: family.id, subject: "english", answerText: `${label}-card-2`, broadcastText: `${label}-card-2`, source: "manual" },
  ]).returning();
  return { family, children: childRows, cards: cardRows };
}

function actor(familyId: string, childId: string) {
  return { role: "child" as const, familyId, childId, deviceId: crypto.randomUUID() };
}

async function expectSavepointRejection(
  tx: DbTransaction,
  write: (nested: DbTransaction) => Promise<unknown>,
  message?: string,
) {
  const error = await tx.transaction(write).then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).not.toBeNull();
  if (message) {
    const messages: string[] = [];
    let current: unknown = error;
    while (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
    }
    expect(messages.join("\n")).toContain(message);
  }
  const [stillUsable] = await tx.select({ value: count() }).from(reviewEvents);
  expect(stillUsable.value).toBeGreaterThanOrEqual(0);
}

test("复习来源的跨家庭、跨孩子、跨卡片、正确来源、再学习来源和重复来源均由 DB 独立拒绝", async () => {
  await withDatabaseRollback(async (tx) => {
    const familyA = await familyFixture(tx, "A");
    const familyB = await familyFixture(tx, "B");
    const serviceA = createReviewService(tx);
    const wrongSource = await serviceA.recordFirstResult(
      actor(familyA.family.id, familyA.children[0].id),
      {
        cardId: familyA.cards[0].id,
        commandId: crypto.randomUUID(),
        correct: false,
        reviewedAt: new Date("2026-09-01T08:00:00.000Z"),
        eventType: "new_first",
      },
    );
    const correctSource = await serviceA.recordFirstResult(
      actor(familyA.family.id, familyA.children[0].id),
      {
        cardId: familyA.cards[1].id,
        commandId: crypto.randomUUID(),
        correct: true,
        reviewedAt: new Date("2026-09-01T08:00:00.000Z"),
        eventType: "new_first",
      },
    );

    const insertRelearning = (
      nested: DbTransaction,
      scope: { familyId: string; childId: string; cardId: string },
      sourceReviewEventId: string,
    ) => nested.insert(reviewEvents).values({
      ...scope,
      eventType: "same_session_relearning",
      correct: true,
      fsrsRating: 3,
      reviewedAt: new Date("2026-09-01T08:10:00.000Z"),
      dueAt: new Date("2026-09-02T08:10:00.000Z"),
      cardJson: wrongSource.card,
      sourceReviewEventId,
      commandId: crypto.randomUUID(),
      inputFingerprint: "a".repeat(64),
    });

    await expectSavepointRejection(tx, (nested) => insertRelearning(nested, {
      familyId: familyB.family.id,
      childId: familyB.children[0].id,
      cardId: familyB.cards[0].id,
    }, wrongSource.reviewEventId));
    await expectSavepointRejection(tx, (nested) => insertRelearning(nested, {
      familyId: familyA.family.id,
      childId: familyA.children[1].id,
      cardId: familyA.cards[0].id,
    }, wrongSource.reviewEventId));
    await expectSavepointRejection(tx, (nested) => insertRelearning(nested, {
      familyId: familyA.family.id,
      childId: familyA.children[0].id,
      cardId: familyA.cards[1].id,
    }, wrongSource.reviewEventId));
    await expectSavepointRejection(tx, (nested) => insertRelearning(nested, {
      familyId: familyA.family.id,
      childId: familyA.children[0].id,
      cardId: familyA.cards[1].id,
    }, correctSource.reviewEventId));

    const correction = await serviceA.markRelearningComplete(
      actor(familyA.family.id, familyA.children[0].id),
      {
        cardId: familyA.cards[0].id,
        commandId: crypto.randomUUID(),
        correctedAt: new Date("2026-09-01T08:10:00.000Z"),
        sourceReviewEventId: wrongSource.reviewEventId,
      },
    );
    await expectSavepointRejection(tx, (nested) => insertRelearning(nested, {
      familyId: familyA.family.id,
      childId: familyA.children[0].id,
      cardId: familyA.cards[0].id,
    }, correction.reviewEventId));
    await expectSavepointRejection(tx, (nested) => insertRelearning(nested, {
      familyId: familyA.family.id,
      childId: familyA.children[0].id,
      cardId: familyA.cards[0].id,
    }, wrongSource.reviewEventId));
  });
});

test("复习事件事实不可修改，每次拒绝后外层事务仍可用", async () => {
  await withDatabaseRollback(async (tx) => {
    const familyA = await familyFixture(tx, "immutable-A");
    const familyB = await familyFixture(tx, "immutable-B");
    const childActor = actor(familyA.family.id, familyA.children[0].id);
    const service = createReviewService(tx);
    const source = await service.recordFirstResult(childActor, {
      cardId: familyA.cards[0].id,
      commandId: crypto.randomUUID(),
      correct: false,
      reviewedAt: new Date("2026-09-01T08:00:00.000Z"),
      eventType: "new_first",
    });
    const correction = await service.markRelearningComplete(childActor, {
      cardId: familyA.cards[0].id,
      commandId: crypto.randomUUID(),
      correctedAt: new Date("2026-09-01T08:10:00.000Z"),
      sourceReviewEventId: source.reviewEventId,
    });
    const standalone = await service.recordFirstResult(childActor, {
      cardId: familyA.cards[1].id,
      commandId: crypto.randomUUID(),
      correct: true,
      reviewedAt: new Date("2026-09-01T09:00:00.000Z"),
      eventType: "new_first",
    });

    const sourceMutations: Array<Record<string, unknown>> = [
      {
        familyId: familyB.family.id,
        childId: familyB.children[0].id,
        cardId: familyB.cards[0].id,
      },
      { commandId: crypto.randomUUID() },
      { inputFingerprint: "b".repeat(64) },
      { eventType: "scheduled_first" },
      { correct: true },
      { fsrsRating: 3 },
      { reviewedAt: new Date("2026-09-01T08:01:00.000Z") },
      { dueAt: new Date("2027-09-01T08:00:00.000Z") },
      { cardJson: { changed: true } },
      { sourceReviewEventId: correction.reviewEventId },
    ];
    for (const values of sourceMutations) {
      await expectSavepointRejection(
        tx,
        (nested) => nested
          .update(reviewEvents)
          .set(values)
          .where(eq(reviewEvents.id, source.reviewEventId)),
        "REVIEW_EVENT_IMMUTABLE",
      );
    }
    await expectSavepointRejection(
      tx,
      (nested) => nested
        .update(reviewEvents)
        .set({ correct: false })
        .where(eq(reviewEvents.id, standalone.reviewEventId)),
      "REVIEW_EVENT_IMMUTABLE",
    );

  });
});

test("复习事件不可变 trigger 不阻断家庭级 FK 联删", async () => {
  await withDatabaseRollback(async (tx) => {
    const familyA = await familyFixture(tx, "cascade-delete");
    const childActor = actor(familyA.family.id, familyA.children[0].id);
    const service = createReviewService(tx);
    const source = await service.recordFirstResult(childActor, {
      cardId: familyA.cards[0].id,
      commandId: crypto.randomUUID(),
      correct: false,
      reviewedAt: new Date("2026-09-01T08:00:00.000Z"),
      eventType: "new_first",
    });
    await service.markRelearningComplete(childActor, {
      cardId: familyA.cards[0].id,
      commandId: crypto.randomUUID(),
      correctedAt: new Date("2026-09-01T08:10:00.000Z"),
      sourceReviewEventId: source.reviewEventId,
    });

    await expect(
      tx.transaction(async (nested) => {
        await nested.delete(families).where(eq(families.id, familyA.family.id));
      }),
    ).resolves.toBeUndefined();
    const [remaining] = await tx
      .select({ value: count() })
      .from(reviewEvents)
      .where(eq(reviewEvents.familyId, familyA.family.id));
    expect(remaining.value).toBe(0);
  });
});
