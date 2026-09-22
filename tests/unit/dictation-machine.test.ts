import { describe, expect, test } from "vitest";

import {
  createSessionState,
  reduceSession,
} from "@/modules/dictation/session-machine";

describe("continuous batch dictation", () => {
  test("播完当前轮后才能集中批改，错题进入下一轮", () => {
    let state = createSessionState({
      mode: "continuous_batch",
      itemIds: ["a", "b", "c"],
    });
    state = reduceSession(state, {
      type: "PLAYBACK_RECORDED",
      roundNumber: 1,
      playedItemIds: ["a", "b", "c"],
      sequenceFinished: true,
    });
    expect(state.phase).toBe("grading");
    state = reduceSession(state, {
      type: "BATCH_MARKED",
      roundNumber: 1,
      marks: [
        { itemId: "a", correct: true },
        { itemId: "b", correct: false },
        { itemId: "c", correct: true },
      ],
    });
    expect(state).toMatchObject({
      phase: "listening",
      roundNumber: 2,
      currentRoundItemIds: ["b"],
      firstPassMarks: { a: true, b: false, c: true },
    });
  });

  test("播放不完整、批改缺失、重复或外来题目都被拒绝", () => {
    const initial = createSessionState({
      mode: "continuous_batch",
      itemIds: ["a", "b"],
    });
    expect(() => reduceSession(initial, {
      type: "PLAYBACK_RECORDED",
      roundNumber: 1,
      playedItemIds: ["a"],
      sequenceFinished: true,
    })).toThrow("PLAYBACK_INCOMPLETE");
    expect(() => reduceSession(initial, {
      type: "BATCH_MARKED",
      roundNumber: 1,
      marks: [{ itemId: "a", correct: true }],
    })).toThrow("GRADING_NOT_READY");

    const grading = reduceSession(initial, {
      type: "PLAYBACK_RECORDED",
      roundNumber: 1,
      playedItemIds: ["a", "b"],
      sequenceFinished: true,
    });
    expect(() => reduceSession(grading, {
      type: "BATCH_MARKED",
      roundNumber: 1,
      marks: [{ itemId: "a", correct: true }],
    })).toThrow("MARKS_INCOMPLETE");
    expect(() => reduceSession(grading, {
      type: "BATCH_MARKED",
      roundNumber: 1,
      marks: [
        { itemId: "a", correct: true },
        { itemId: "a", correct: false },
      ],
    })).toThrow("MARKS_DUPLICATE");
    expect(() => reduceSession(grading, {
      type: "BATCH_MARKED",
      roundNumber: 1,
      marks: [
        { itemId: "a", correct: true },
        { itemId: "foreign", correct: true },
      ],
    })).toThrow("MARK_ITEM_NOT_IN_ROUND");
  });

  test("首次播放只能推进有序前缀，当前题重听不推进进度", () => {
    const initial = createSessionState({
      mode: "continuous_batch",
      itemIds: ["a", "b", "c"],
    });
    for (const playedItemIds of [["b"], ["a", "c"], ["b", "a"]]) {
      expect(() => reduceSession(initial, {
        type: "PLAYBACK_RECORDED",
        roundNumber: 1,
        playedItemIds,
        sequenceFinished: false,
      })).toThrow("PLAYBACK_OUT_OF_ORDER");
    }
    let state = reduceSession(initial, {
      type: "PLAYBACK_RECORDED",
      roundNumber: 1,
      playedItemIds: ["a"],
      sequenceFinished: false,
    });
    const replayed = reduceSession(state, {
      type: "PLAYBACK_RECORDED",
      roundNumber: 1,
      playedItemIds: ["a"],
      sequenceFinished: false,
    });
    expect(replayed.playedItemIds).toEqual(["a"]);
    state = reduceSession(replayed, {
      type: "PLAYBACK_RECORDED",
      roundNumber: 1,
      playedItemIds: ["b", "c"],
      sequenceFinished: true,
    });
    expect(state).toMatchObject({
      phase: "grading",
      playedItemIds: ["a", "b", "c"],
    });
  });

  test("首轮事实不变，全部订正后完成且完成后不可命令", () => {
    let state = createSessionState({ mode: "continuous_batch", itemIds: ["a"] });
    state = reduceSession(state, {
      type: "PLAYBACK_RECORDED",
      roundNumber: 1,
      playedItemIds: ["a"],
      sequenceFinished: true,
    });
    state = reduceSession(state, {
      type: "BATCH_MARKED",
      roundNumber: 1,
      marks: [{ itemId: "a", correct: false }],
    });
    state = reduceSession(state, {
      type: "PLAYBACK_RECORDED",
      roundNumber: 2,
      playedItemIds: ["a"],
      sequenceFinished: true,
    });
    state = reduceSession(state, {
      type: "BATCH_MARKED",
      roundNumber: 2,
      marks: [{ itemId: "a", correct: true }],
    });
    expect(state.phase).toBe("completed");
    expect(state.firstPassMarks).toEqual({ a: false });
    expect(state.latestMarks).toEqual({ a: true });
    expect(() => reduceSession(state, {
      type: "BATCH_MARKED",
      roundNumber: 2,
      marks: [{ itemId: "a", correct: true }],
    })).toThrow("SESSION_COMPLETED");
  });
});

describe("item by item dictation", () => {
  test("逐题播放和批改，错题在当轮末后进入下轮", () => {
    let state = createSessionState({ mode: "item_by_item", itemIds: ["a", "b"] });
    state = reduceSession(state, {
      type: "PLAYBACK_RECORDED",
      roundNumber: 1,
      playedItemIds: ["a"],
      sequenceFinished: true,
    });
    expect(state.phase).toBe("grading");
    state = reduceSession(state, {
      type: "BATCH_MARKED",
      roundNumber: 1,
      marks: [{ itemId: "a", correct: false }],
    });
    expect(state).toMatchObject({ phase: "listening", roundNumber: 1 });
    state = reduceSession(state, {
      type: "PLAYBACK_RECORDED",
      roundNumber: 1,
      playedItemIds: ["b"],
      sequenceFinished: true,
    });
    state = reduceSession(state, {
      type: "BATCH_MARKED",
      roundNumber: 1,
      marks: [{ itemId: "b", correct: true }],
    });
    expect(state).toMatchObject({
      phase: "listening",
      roundNumber: 2,
      currentRoundItemIds: ["a"],
      firstPassMarks: { a: false, b: true },
    });
  });

  test("只能播放当前应播题，且不接受错轮事件", () => {
    const state = createSessionState({ mode: "item_by_item", itemIds: ["a", "b"] });
    expect(() => reduceSession(state, {
      type: "PLAYBACK_RECORDED",
      roundNumber: 2,
      playedItemIds: ["a"],
      sequenceFinished: true,
    })).toThrow("SESSION_ROUND_MISMATCH");
    expect(() => reduceSession(state, {
      type: "PLAYBACK_RECORDED",
      roundNumber: 1,
      playedItemIds: ["b"],
      sequenceFinished: true,
    })).toThrow("PLAYBACK_OUT_OF_ORDER");
    expect(() => reduceSession(state, {
      type: "PLAYBACK_RECORDED",
      roundNumber: 1,
      playedItemIds: ["a"],
      sequenceFinished: false,
    })).toThrow("PLAYBACK_INCOMPLETE");
    const grading = reduceSession(state, {
      type: "PLAYBACK_RECORDED",
      roundNumber: 1,
      playedItemIds: ["a"],
      sequenceFinished: true,
    });
    expect(() => reduceSession(grading, {
      type: "BATCH_MARKED",
      roundNumber: 1,
      marks: [
        { itemId: "a", correct: true },
        { itemId: "a", correct: false },
      ],
    })).toThrow("MARKS_DUPLICATE");
    expect(() => reduceSession(grading, {
      type: "BATCH_MARKED",
      roundNumber: 1,
      marks: [{ itemId: "foreign", correct: true }],
    })).toThrow("MARK_ITEM_NOT_IN_ROUND");
  });
});
