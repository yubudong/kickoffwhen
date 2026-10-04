export type DictationMode = "continuous_batch" | "item_by_item";
export type DictationPhase = "listening" | "grading" | "completed";

export type DictationMark = { itemId: string; correct: boolean };

export type DictationState = {
  mode: DictationMode;
  phase: DictationPhase;
  roundNumber: number;
  currentRoundItemIds: string[];
  playedItemIds: string[];
  markedItemIds: string[];
  firstPassMarks: Record<string, boolean>;
  latestMarks: Record<string, boolean>;
};

export type PlaybackCommand = {
  commandId: string;
  sessionId: string;
  expectedVersion: number;
  roundNumber: number;
  playedItemIds: string[];
  sequenceFinished: boolean;
};

export type SubmitBatchMarksInput = {
  commandId: string;
  sessionId: string;
  expectedVersion: number;
  roundNumber: number;
  marks: DictationMark[];
};

export type DictationSnapshot = {
  sessionId: string;
  taskId: string;
  version: number;
  phase: DictationPhase;
  roundNumber: number;
  currentRoundItemIds: string[];
  playedItemIds: string[];
  markedItemIds: string[];
  replayCounts: Record<string, number>;
};

export type LearningTaskCompleted = {
  type: "LearningTaskCompleted";
  eventId: string;
  familyId: string;
  childId: string;
  taskId: string;
  sessionId: string;
  completedAt: Date;
};
