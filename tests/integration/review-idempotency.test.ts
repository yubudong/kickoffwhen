import { eq } from "drizzle-orm";
import { expect, test } from "vitest";

import { user as authUsers } from "@/modules/auth/schema";
import { children, families, guardians } from "@/modules/families/schema";
import { learningCards } from "@/modules/learning-content/schema";
import { childCardStates, reviewEvents } from "@/modules/review/db-schema";
import { createReviewService } from "@/modules/review/service";

import { withDatabaseRollback } from "../helpers/database";

async function fixture(tx: Parameters<Parameters<typeof withDatabaseRollback>[0]>[0]) {
  const suffix = crypto.randomUUID();
  await tx.insert(authUsers).values({
    id: `review-fix-${suffix}`,
    name: "复习幂等家长",
    email: `review-fix-${suffix}@example.test`,
  });
  const [family] = await tx.insert(families).values({ name: `复习幂等-${suffix}` }).returning();
  await tx.insert(guardians).values({ familyId: family.id, authUserId: `review-fix-${suffix}` });
  const [child] = await tx.insert(children).values({
    familyId: family.id,
    nickname: "小复习",
    grade: 5,
  }).returning();
  const [card] = await tx.insert(learningCards).values({
    familyId: family.id,
    subject: "english",
    answerText: "review",
    broadcastText: "review",
    source: "manual",
  }).returning();
  return {
    card,
    actor: {
      role: "child" as const,
      familyId: family.id,
      childId: child.id,
      deviceId: crypto.randomUUID(),
    },
  };
}

test("同一复习 command 重试返回同一事件，不同 payload 冲突", async () => {
  await withDatabaseRollback(async (tx) => {
    const { actor, card } = await fixture(tx);
    const service = createReviewService(tx);
    const commandId = crypto.randomUUID();
    const input = {
      cardId: card.id,
      commandId,
      correct: false,
      reviewedAt: new Date("2026-09-01T08:00:00.000Z"),
      eventType: "new_first" as const,
    };

    const first = await service.recordFirstResult(actor, input);
    const retry = await service.recordFirstResult(actor, input);
    expect(retry.reviewEventId).toBe(first.reviewEventId);
    expect(await tx.select().from(reviewEvents).where(eq(reviewEvents.cardId, card.id))).toHaveLength(1);

    await expect(service.recordFirstResult(actor, {
      ...input,
      correct: true,
    })).rejects.toThrow("REVIEW_IDEMPOTENCY_CONFLICT");
  });
});

test("同一首轮错误只能订正一次，且时间必须严格递增", async () => {
  await withDatabaseRollback(async (tx) => {
    const { actor, card } = await fixture(tx);
    const service = createReviewService(tx);
    const first = await service.recordFirstResult(actor, {
      cardId: card.id,
      commandId: crypto.randomUUID(),
      correct: false,
      reviewedAt: new Date("2026-09-01T08:00:00.000Z"),
      eventType: "new_first",
    });
    await expect(service.markRelearningComplete(actor, {
      cardId: card.id,
      commandId: crypto.randomUUID(),
      correctedAt: new Date("2026-09-01T08:00:00.000Z"),
      sourceReviewEventId: first.reviewEventId,
    })).rejects.toThrow("REVIEW_TIME_INVALID");

    const correctionCommand = crypto.randomUUID();
    const correction = await service.markRelearningComplete(actor, {
      cardId: card.id,
      commandId: correctionCommand,
      correctedAt: new Date("2026-09-01T08:10:00.000Z"),
      sourceReviewEventId: first.reviewEventId,
    });
    const retry = await service.markRelearningComplete(actor, {
      cardId: card.id,
      commandId: correctionCommand,
      correctedAt: new Date("2026-09-01T08:10:00.000Z"),
      sourceReviewEventId: first.reviewEventId,
    });
    expect(retry.reviewEventId).toBe(correction.reviewEventId);

    await expect(service.markRelearningComplete(actor, {
      cardId: card.id,
      commandId: crypto.randomUUID(),
      correctedAt: new Date("2026-09-01T08:20:00.000Z"),
      sourceReviewEventId: first.reviewEventId,
    })).rejects.toThrow("RELEARNING_SOURCE_ALREADY_USED");
    expect(await tx.select().from(childCardStates).where(eq(childCardStates.cardId, card.id))).toHaveLength(1);
  });
});
