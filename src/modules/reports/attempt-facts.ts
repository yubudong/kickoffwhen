export type ReportAttemptFactInput = {
  round: number;
  correct: boolean;
  eventRole: string;
  occurredAt: Date;
  taskItemKind: string;
  sessionItemKind: string;
  answerReviewEventId: string | null;
  firstReviewEventId: string | null;
  reviewEventType: string | null;
  reviewEventCorrect: boolean | null;
  reviewEventReviewedAt: Date | null;
  reviewEventSourceId: string | null;
};

function inconsistent(): never {
  throw new Error("REPORT_INCONSISTENT");
}

export function validateReportAttemptFact(fact: ReportAttemptFactInput):
  | { eventRole: "first_pass"; eventType: "new_first" | "scheduled_first" }
  | { eventRole: "continued_error"; eventType: null }
  | { eventRole: "same_session_relearning"; eventType: "same_session_relearning" } {
  if (
    !Number.isInteger(fact.round) ||
    fact.round < 1 ||
    !Number.isFinite(fact.occurredAt.getTime()) ||
    !["new", "due_review"].includes(fact.taskItemKind) ||
    fact.sessionItemKind !== fact.taskItemKind
  ) inconsistent();

  if (fact.eventRole === "continued_error") {
    if (
      fact.round === 1 ||
      fact.correct ||
      fact.answerReviewEventId !== null ||
      fact.reviewEventType !== null ||
      fact.reviewEventCorrect !== null ||
      fact.reviewEventReviewedAt !== null ||
      fact.reviewEventSourceId !== null ||
      fact.firstReviewEventId === null
    ) inconsistent();
    return { eventRole: "continued_error", eventType: null };
  }

  if (
    fact.answerReviewEventId === null ||
    fact.firstReviewEventId === null ||
    fact.reviewEventCorrect === null ||
    fact.reviewEventReviewedAt === null ||
    fact.reviewEventCorrect !== fact.correct ||
    fact.reviewEventReviewedAt.getTime() !== fact.occurredAt.getTime()
  ) inconsistent();

  if (fact.eventRole === "first_pass") {
    const expectedType = fact.taskItemKind === "new" ? "new_first" : "scheduled_first";
    if (
      fact.round !== 1 ||
      fact.answerReviewEventId !== fact.firstReviewEventId ||
      fact.reviewEventType !== expectedType ||
      fact.reviewEventSourceId !== null
    ) inconsistent();
    return { eventRole: "first_pass", eventType: expectedType };
  }

  if (fact.eventRole === "same_session_relearning") {
    if (
      fact.round === 1 ||
      !fact.correct ||
      fact.reviewEventType !== "same_session_relearning" ||
      fact.reviewEventSourceId !== fact.firstReviewEventId
    ) inconsistent();
    return {
      eventRole: "same_session_relearning",
      eventType: "same_session_relearning",
    };
  }

  inconsistent();
}
