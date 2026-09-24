import {
  createEmptyCard,
  fsrs,
  Rating,
  type Card,
  type Grade,
} from "ts-fsrs";

import type { ReviewEventType } from "./schema";

const REQUEST_RETENTION = 0.9 as const;

const scheduler = fsrs({
  request_retention: REQUEST_RETENTION,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
});

export type FirstResultInput = {
  state: Card;
  correct: boolean;
  reviewedAt: Date;
  eventType: "new_first" | "scheduled_first" | "manual_first";
};

export type RelearningInput = {
  state: Card;
  correctedAt: Date;
  sourceReviewEventId: string;
};

export type ScheduledReview = {
  card: Card;
  dueAt: Date;
  rating: "again" | "good";
  fsrsRating: Grade;
  eventType: ReviewEventType;
  parameters: { request_retention: 0.9 };
};

export function createInitialState(now: Date): Card {
  return createEmptyCard(now);
}

function schedule(
  state: Card,
  reviewedAt: Date,
  fsrsRating: Grade,
  rating: ScheduledReview["rating"],
  eventType: ReviewEventType,
): ScheduledReview {
  const result = scheduler.next(state, reviewedAt, fsrsRating);
  return {
    card: result.card,
    dueAt: result.card.due,
    rating,
    fsrsRating,
    eventType,
    parameters: { request_retention: REQUEST_RETENTION },
  };
}

export function scheduleFirstResult(input: FirstResultInput): ScheduledReview {
  return input.correct
    ? schedule(input.state, input.reviewedAt, Rating.Good, "good", input.eventType)
    : schedule(input.state, input.reviewedAt, Rating.Again, "again", input.eventType);
}

export function markRelearningComplete(input: RelearningInput): ScheduledReview {
  if (!input.sourceReviewEventId) throw new Error("SOURCE_REVIEW_EVENT_REQUIRED");
  return schedule(
    input.state,
    input.correctedAt,
    Rating.Good,
    "good",
    "same_session_relearning",
  );
}
