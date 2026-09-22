import { describe, expect, test } from "vitest";

import {
  createCommandRetryState,
  recoveryStorageKey,
  readRecoveryDraft,
  serializeRecoveryDraft,
  settleCommandSuccess,
  createPendingCommand,
  pendingCommandMatches,
  reconcileAuthoritativeCommand,
} from "@/modules/dictation/client-resume";
import type { ChildSessionView } from "@/modules/dictation/child-view-types";

const scope = {
  familyId: "018f3b5d-1111-7111-8111-111111111111",
  childId: "018f3b5d-2222-7222-8222-222222222222",
  sessionId: "018f3b5d-3333-7333-8333-333333333333",
  roundNumber: 2,
  serverVersion: 7,
};

test("恢复键包含家庭、孩子和会话", () => {
  expect(recoveryStorageKey("f1", "c1", "s1")).toBe("dictation:f1:c1:s1");
  expect(recoveryStorageKey("f1", "c2", "s1")).not.toBe(
    recoveryStorageKey("f1", "c1", "s1"),
  );
});

describe("恢复草稿只保存当前批改选择", () => {
  test("严格序列化非秘密字段", () => {
    const raw = serializeRecoveryDraft({
      ...scope,
      marks: {
        "018f3b5d-4444-7444-8444-444444444444": true,
      },
    });
    expect(JSON.parse(raw)).toEqual({
      schemaVersion: 1,
      ...scope,
      marks: {
        "018f3b5d-4444-7444-8444-444444444444": true,
      },
    });
    expect(raw).not.toMatch(/answer|broadcast|media|token|pin|url/i);
  });

  test.each([
    ["wrong family", { familyId: crypto.randomUUID() }],
    ["wrong child", { childId: crypto.randomUUID() }],
    ["wrong session", { sessionId: crypto.randomUUID() }],
    ["stale round", { roundNumber: 3 }],
    ["stale version", { serverVersion: 8 }],
  ])("忽略 %s 的草稿", (_label, override) => {
    const raw = serializeRecoveryDraft({ ...scope, ...override, marks: {} });
    expect(readRecoveryDraft(raw, scope)).toBeNull();
  });

  test("完成会话不恢复草稿", () => {
    const raw = serializeRecoveryDraft({ ...scope, marks: {} });
    expect(readRecoveryDraft(raw, { ...scope, completed: true })).toBeNull();
  });

  test("未知字段和答案字段使草稿整体失效", () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      ...scope,
      marks: {},
      answerText: "secret",
    });
    expect(readRecoveryDraft(raw, scope)).toBeNull();
  });

  test("包含非当前轮题目的marks不恢复", () => {
    const markId = "018f3b5d-4444-7444-8444-444444444444";
    const raw = serializeRecoveryDraft({ ...scope, marks: { [markId]: true } });
    expect(readRecoveryDraft(raw, { ...scope, allowedItemIds: [crypto.randomUUID()] })).toBeNull();
    expect(readRecoveryDraft(raw, { ...scope, allowedItemIds: [markId] })).not.toBeNull();
  });
});

test("网络或无效响应后保留命令ID，仅确认成功后轮换", () => {
  const firstId = "018f3b5d-5555-7555-8555-555555555555";
  const nextId = "018f3b5d-6666-7666-8666-666666666666";
  const state = createCommandRetryState(firstId);
  expect(state.commandId).toBe(firstId);
  expect(state.commandId).toBe(firstId);
  expect(settleCommandSuccess(state, nextId).commandId).toBe(nextId);
});

test("pending命令锁定commandId和完全相同的序列化payload", () => {
  const commandId = "018f3b5d-5555-7555-8555-555555555555";
  const body = { type: "grading", expectedVersion: 7, roundNumber: 2, marks: [{ itemId: crypto.randomUUID(), correct: false }] };
  const pending = createPendingCommand(body, commandId);
  expect(JSON.parse(pending.serializedPayload)).toEqual({ ...body, commandId });
  expect(pendingCommandMatches(pending, body)).toBe(true);
  expect(pendingCommandMatches(pending, { ...body, marks: [{ ...body.marks[0], correct: true }] })).toBe(false);
});

test("旧pending命令收到权威completed后释放重试锁并丢弃草稿", () => {
  const pending = createPendingCommand({
    type: "grading",
    expectedVersion: 8,
    roundNumber: 2,
    marks: [{ itemId: crypto.randomUUID(), correct: true }],
  });
  const completed = {
    sessionId: scope.sessionId,
    taskId: "018f3b5d-4444-7444-8444-444444444444",
    familyId: scope.familyId,
    childId: scope.childId,
    version: 9,
    phase: "completed",
    mode: "continuous_batch",
    roundNumber: 2,
    itemCount: 1,
    playedItemIds: [],
    intervalSeconds: 2,
    repeatCount: 1,
    speechRate: 1,
    allowManualReplay: true,
    items: [],
  } satisfies ChildSessionView;
  expect(reconcileAuthoritativeCommand(completed, {
    retryCommand: pending,
    retryLocked: true,
    dirtyMarks: true,
  })).toEqual({
    retryCommand: null,
    retryLocked: false,
    dirtyMarks: false,
    clearRecovery: true,
  });
});
