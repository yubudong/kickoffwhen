import { describe, expect, test } from "vitest";
import { Rating, State } from "ts-fsrs";

import {
  createInitialState,
  markRelearningComplete,
  scheduleFirstResult,
} from "@/modules/review/scheduler";

describe("FSRS 调度包装", () => {
  test("正确与错误分别映射 Good 和 Again，且保持率精确为 90%", () => {
    const now = new Date("2026-09-01T08:00:00.000Z");

    const good = scheduleFirstResult({
      state: createInitialState(now),
      correct: true,
      reviewedAt: now,
      eventType: "new_first",
    });
    const again = scheduleFirstResult({
      state: createInitialState(now),
      correct: false,
      reviewedAt: now,
      eventType: "scheduled_first",
    });

    expect(good.rating).toBe("good");
    expect(good.fsrsRating).toBe(Rating.Good);
    expect(good.eventType).toBe("new_first");
    expect(again.rating).toBe("again");
    expect(again.fsrsRating).toBe(Rating.Again);
    expect(again.eventType).toBe("scheduled_first");
    expect(good.parameters).toEqual({ request_retention: 0.9 });
    expect(good.card.due).toEqual(good.dueAt);
  });

  test("同场订正保留独立事件类型，不伪装成第二次首轮结果", () => {
    const firstAt = new Date("2026-09-01T08:00:00.000Z");
    const correctedAt = new Date("2026-09-01T08:10:00.000Z");
    const forgotten = scheduleFirstResult({
      state: createInitialState(firstAt),
      correct: false,
      reviewedAt: firstAt,
      eventType: "scheduled_first",
    });

    const relearned = markRelearningComplete({
      state: forgotten.card,
      correctedAt,
      sourceReviewEventId: "018f3b5d-1111-7111-8111-111111111111",
    });

    expect(relearned.eventType).toBe("same_session_relearning");
    expect(relearned.rating).toBe("good");
    expect(relearned.fsrsRating).toBe(Rating.Good);
    expect(relearned.card.state).not.toBe(State.New);
    expect(relearned.parameters.request_retention).toBe(0.9);
  });
});
