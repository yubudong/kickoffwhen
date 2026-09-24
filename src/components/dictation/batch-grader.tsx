"use client";

import { useEffect, useMemo, useState } from "react";

import type { GradingSessionView } from "@/modules/dictation/child-view-types";
import {
  readRecoveryDraft,
  recoveryStorageKey,
  serializeRecoveryDraft,
} from "@/modules/dictation/client-resume";

export function BatchGrader({
  session,
  pending,
  onSubmit,
  onDirtyChange,
}: {
  session: GradingSessionView;
  pending: boolean;
  onSubmit: (marks: Array<{ itemId: string; correct: boolean }>) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const storageKey = recoveryStorageKey(session.familyId, session.childId, session.sessionId);
  const [marks, setMarks] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const recovered = readRecoveryDraft(window.localStorage.getItem(storageKey), {
        familyId: session.familyId,
        childId: session.childId,
        sessionId: session.sessionId,
        roundNumber: session.roundNumber,
        serverVersion: session.version,
        allowedItemIds: session.items.map((item) => item.itemId),
      });
      setMarks(recovered?.marks ?? {});
      if (!recovered) window.localStorage.removeItem(storageKey);
    });
    return () => { active = false; };
  }, [session, storageKey]);

  useEffect(() => {
    const dirty = Object.keys(marks).length > 0;
    onDirtyChange(dirty);
    if (!dirty) return;
    window.localStorage.setItem(
      storageKey,
      serializeRecoveryDraft({
        familyId: session.familyId,
        childId: session.childId,
        sessionId: session.sessionId,
        roundNumber: session.roundNumber,
        serverVersion: session.version,
        marks,
      }),
    );
  }, [marks, onDirtyChange, session, storageKey]);

  const complete = useMemo(
    () => session.items.every((item) => typeof marks[item.itemId] === "boolean"),
    [marks, session.items],
  );

  return (
    <section aria-labelledby="grading-title" className="dictation-card">
      <p className="eyebrow">自己批改</p>
      <h1 id="grading-title">请认真核对每一题</h1>
      <div className="answer-list">
        {session.items.map((item) => (
          <fieldset key={item.itemId}>
            <legend>
              第 {item.position + 1} 题：<strong>{item.answerText}</strong>
            </legend>
            <div className="mark-actions">
              <button
                aria-pressed={marks[item.itemId] === true}
                className={marks[item.itemId] === true ? "selected-correct" : ""}
                disabled={pending}
                onClick={() => setMarks((current) => ({ ...current, [item.itemId]: true }))}
                type="button"
              >
                正确
              </button>
              <button
                aria-pressed={marks[item.itemId] === false}
                className={marks[item.itemId] === false ? "selected-wrong" : ""}
                disabled={pending}
                onClick={() => setMarks((current) => ({ ...current, [item.itemId]: false }))}
                type="button"
              >
                错了
              </button>
            </div>
          </fieldset>
        ))}
      </div>
      <button
        className="dictation-primary"
        disabled={!complete || pending}
        onClick={() =>
          void onSubmit(
            session.items.map((item) => ({ itemId: item.itemId, correct: marks[item.itemId]! })),
          )
        }
        type="button"
      >
        {pending ? "正在保存…" : complete ? "提交本轮" : "请先标记全部题目"}
      </button>
    </section>
  );
}
