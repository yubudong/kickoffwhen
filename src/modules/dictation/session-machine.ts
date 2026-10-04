import type {
  DictationMark,
  DictationMode,
  DictationState,
} from "./session-types";

export type SessionMachineEvent =
  | {
      type: "PLAYBACK_RECORDED";
      roundNumber: number;
      playedItemIds: string[];
      sequenceFinished: boolean;
    }
  | { type: "BATCH_MARKED"; roundNumber: number; marks: DictationMark[] };

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

export function createSessionState(input: {
  mode: DictationMode;
  itemIds: string[];
}): DictationState {
  if (input.itemIds.length === 0) throw new Error("SESSION_ITEMS_REQUIRED");
  if (!unique(input.itemIds)) throw new Error("SESSION_ITEMS_DUPLICATE");
  return {
    mode: input.mode,
    phase: "listening",
    roundNumber: 1,
    currentRoundItemIds: [...input.itemIds],
    playedItemIds: [],
    markedItemIds: [],
    firstPassMarks: {},
    latestMarks: {},
  };
}

function recordPlayback(
  state: DictationState,
  event: Extract<SessionMachineEvent, { type: "PLAYBACK_RECORDED" }>,
): DictationState {
  if (state.phase !== "listening") throw new Error("PLAYBACK_NOT_ALLOWED");
  if (!unique(event.playedItemIds)) throw new Error("PLAYBACK_ITEMS_DUPLICATE");
  if (event.playedItemIds.length === 0) throw new Error("PLAYBACK_ITEMS_REQUIRED");
  const current = new Set(state.currentRoundItemIds);
  if (event.playedItemIds.some((id) => !current.has(id))) {
    throw new Error("PLAYBACK_ITEM_NOT_IN_ROUND");
  }

  if (state.mode === "item_by_item") {
    const nextItemId = state.currentRoundItemIds[state.markedItemIds.length];
    if (
      event.playedItemIds.length !== 1 ||
      event.playedItemIds[0] !== nextItemId
    ) {
      throw new Error("PLAYBACK_OUT_OF_ORDER");
    }
    if (!event.sequenceFinished) throw new Error("PLAYBACK_INCOMPLETE");
    return {
      ...state,
      phase: "grading",
      playedItemIds: [...state.playedItemIds, nextItemId],
    };
  }

  const nextPrefix = state.currentRoundItemIds.slice(
    state.playedItemIds.length,
    state.playedItemIds.length + event.playedItemIds.length,
  );
  const advancesPrefix =
    nextPrefix.length === event.playedItemIds.length &&
    nextPrefix.every((itemId, index) => itemId === event.playedItemIds[index]);
  const currentItemId = state.playedItemIds.at(-1);
  const replaysCurrent =
    event.playedItemIds.length === 1 &&
    currentItemId !== undefined &&
    event.playedItemIds[0] === currentItemId;
  if (!advancesPrefix && !replaysCurrent) throw new Error("PLAYBACK_OUT_OF_ORDER");
  const playedItemIds = advancesPrefix
    ? [...state.playedItemIds, ...event.playedItemIds]
    : [...state.playedItemIds];
  if (event.sequenceFinished && playedItemIds.length !== state.currentRoundItemIds.length) {
    throw new Error("PLAYBACK_INCOMPLETE");
  }
  return {
    ...state,
    phase: event.sequenceFinished ? "grading" : "listening",
    playedItemIds,
  };
}

function submitMarks(
  state: DictationState,
  marks: DictationMark[],
): DictationState {
  if (state.phase !== "grading") throw new Error("GRADING_NOT_READY");
  const ids = marks.map((mark) => mark.itemId);
  if (!unique(ids)) throw new Error("MARKS_DUPLICATE");
  const current = new Set(state.currentRoundItemIds);
  if (ids.some((id) => !current.has(id))) throw new Error("MARK_ITEM_NOT_IN_ROUND");

  if (state.mode === "continuous_batch") {
    if (
      marks.length !== state.currentRoundItemIds.length ||
      state.currentRoundItemIds.some((id) => !ids.includes(id))
    ) {
      throw new Error("MARKS_INCOMPLETE");
    }
  } else {
    const expectedItemId = state.currentRoundItemIds[state.markedItemIds.length];
    if (marks.length !== 1 || marks[0]?.itemId !== expectedItemId) {
      throw new Error("MARKS_INCOMPLETE");
    }
  }

  const firstPassMarks = { ...state.firstPassMarks };
  const latestMarks = { ...state.latestMarks };
  for (const mark of marks) {
    if (!(mark.itemId in firstPassMarks)) firstPassMarks[mark.itemId] = mark.correct;
    latestMarks[mark.itemId] = mark.correct;
  }
  const markedItemIds = [...state.markedItemIds, ...ids];
  if (
    state.mode === "item_by_item" &&
    markedItemIds.length < state.currentRoundItemIds.length
  ) {
    return { ...state, phase: "listening", markedItemIds, firstPassMarks, latestMarks };
  }

  const incorrectItemIds = state.currentRoundItemIds.filter(
    (itemId) => latestMarks[itemId] !== true,
  );
  if (incorrectItemIds.length === 0) {
    return {
      ...state,
      phase: "completed",
      markedItemIds,
      firstPassMarks,
      latestMarks,
    };
  }
  return {
    ...state,
    phase: "listening",
    roundNumber: state.roundNumber + 1,
    currentRoundItemIds: incorrectItemIds,
    playedItemIds: [],
    markedItemIds: [],
    firstPassMarks,
    latestMarks,
  };
}

export function reduceSession(
  state: DictationState,
  event: SessionMachineEvent,
): DictationState {
  if (state.phase === "completed") throw new Error("SESSION_COMPLETED");
  if (event.roundNumber !== state.roundNumber) throw new Error("SESSION_ROUND_MISMATCH");
  return event.type === "PLAYBACK_RECORDED"
    ? recordPlayback(state, event)
    : submitMarks(state, event.marks);
}
