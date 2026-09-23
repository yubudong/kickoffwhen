"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  childSessionViewSchema,
  type ChildSessionView,
} from "@/modules/dictation/child-view-types";
import { recoveryStorageKey } from "@/modules/dictation/client-resume";
import {
  createPendingCommand,
  pendingCommandMatches,
  reconcileAuthoritativeCommand,
  type PendingCommand,
} from "@/modules/dictation/client-resume";

import { AudioSequence } from "./audio-sequence";
import { BatchGrader } from "./batch-grader";

export function DictationExperience({ initialSession }: { initialSession: ChildSessionView }) {
  const router = useRouter();
  const [session, setSession] = useState(initialSession);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [dirtyMarks, setDirtyMarks] = useState(false);
  const [navigationTarget, setNavigationTarget] = useState<"/child" | "/child/switch" | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [retryLocked, setRetryLocked] = useState(false);
  const retryCommand = useRef<PendingCommand | null>(null);
  const pendingOperation = useRef<Promise<boolean> | null>(null);
  const confirmedNavigation = useRef(false);
  const switchButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const storageKey = recoveryStorageKey(session.familyId, session.childId, session.sessionId);

  useEffect(() => {
    if (session.phase === "completed") return;
    const controller = new AbortController();
    const check = async () => {
      try {
        const response = await fetch(`/api/child/dictation/${session.sessionId}`, {
          cache: "no-store", signal: controller.signal,
        });
        if (response.status === 404) setRevoked(true);
      } catch { /* A temporary network failure should not interrupt dictation. */ }
    };
    const timer = window.setInterval(() => void check(), 5_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [session.phase, session.sessionId]);

  useEffect(() => {
    if (session.phase === "completed" || session.phase === "listening") {
      window.localStorage.removeItem(storageKey);
    }
  }, [session.phase, storageKey]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!confirmedNavigation.current && (session.phase !== "completed" || pending || dirtyMarks)) event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirtyMarks, pending, session.phase]);

  const sendCommand = useCallback(async (body: Record<string, unknown>) => {
    if (retryCommand.current && !pendingCommandMatches(retryCommand.current, body)) {
      setError("请先重试保存刚才的进度。");
      return false;
    }
    setPending(true);
    setError("");
    const stable = retryCommand.current ?? createPendingCommand(body);
    retryCommand.current = stable;
    const operation = (async () => {
      const response = await fetch(`/api/child/dictation/${session.sessionId}/commands`, {
        method: "POST", headers: { "content-type": "application/json" }, body: stable.serializedPayload,
      });
      const raw = await response.json() as unknown;
      if (response.ok) {
        const next = childSessionViewSchema.parse((raw as { session?: unknown })?.session);
        retryCommand.current = null;
        setRetryLocked(false);
        setSession(next);
        return true;
      }
      if (
        response.status === 409 &&
        (raw as { error?: string })?.error === "SESSION_CHANGED"
      ) {
        const authoritative = childSessionViewSchema.parse((raw as { session?: unknown }).session);
        const reconciliation = reconcileAuthoritativeCommand(authoritative, {
          retryCommand: retryCommand.current,
          retryLocked,
          dirtyMarks,
        });
        retryCommand.current = reconciliation.retryCommand;
        setRetryLocked(reconciliation.retryLocked);
        setDirtyMarks(reconciliation.dirtyMarks);
        if (reconciliation.clearRecovery) {
          window.localStorage.removeItem(recoveryStorageKey(
            authoritative.familyId,
            authoritative.childId,
            authoritative.sessionId,
          ));
        }
        setSession(authoritative);
        setError("进度已在另一处更新，已恢复到最新位置。");
        return false;
      }
      if ((raw as { error?: string })?.error === "SESSION_NOT_FOUND") {
        setRevoked(true);
        setError("这项任务已被家长撤回，请返回今日清单。");
      } else if ((raw as { error?: string })?.error === "AUDIO_NOT_READY") {
        setError("音频还没准备好，请让家长准备音频后再试。");
      } else {
        setError("暂时没有保存成功，请重试。");
      }
      retryCommand.current = null;
      setRetryLocked(false);
      return false;
    })().catch(() => {
      setRetryLocked(true);
      setError("网络中断了，请重试，进度不会重复保存。");
      return false;
    });
    pendingOperation.current = operation;
    try {
      return await operation;
    } finally {
      if (pendingOperation.current === operation) {
        pendingOperation.current = null;
        setPending(false);
      }
    }
  }, [dirtyMarks, retryLocked, session.sessionId]);

  function retrySave() {
    const current = retryCommand.current;
    if (!current) return;
    const body = JSON.parse(current.serializedPayload) as Record<string, unknown>;
    delete body.commandId;
    void sendCommand(body);
  }

  async function playback(
    itemId: string,
    sequenceFinished: boolean,
    expectedVersion: number,
  ) {
    return sendCommand({
      type: "playback",
      expectedVersion,
      roundNumber: session.roundNumber,
      playedItemIds: [itemId],
      sequenceFinished,
    });
  }

  async function submitMarks(marks: Array<{ itemId: string; correct: boolean }>) {
    const accepted = await sendCommand({
      type: "grading",
      expectedVersion: session.version,
      roundNumber: session.roundNumber,
      marks,
    });
    if (accepted) {
      window.localStorage.removeItem(storageKey);
      setDirtyMarks(false);
    }
  }

  async function requestNavigation(target: "/child" | "/child/switch") {
    await pendingOperation.current?.catch(() => undefined);
    if (retryCommand.current) {
      setError("请先重试保存刚才的进度，再离开听写。");
      return;
    }
    setNavigationTarget(target);
  }

  function confirmNavigation() {
    if (!navigationTarget) return;
    confirmedNavigation.current = true;
    window.setTimeout(() => { confirmedNavigation.current = false; }, 2_000);
    window.location.replace(navigationTarget);
  }

  function cancelNavigation() {
    setNavigationTarget(null);
    queueMicrotask(() => switchButtonRef.current?.focus());
  }

  useEffect(() => {
    if (!navigationTarget) return;
    const dialog = dialogRef.current;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelNavigation();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>("button, [href], input, [tabindex]:not([tabindex='-1'])")];
      if (controls.length === 0) return;
      const first = controls[0]!;
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [navigationTarget]);

  return (
    <main className="page-shell dictation-shell">
      <div className="dictation-topbar">
        <button className="dictation-switch" onClick={() => void requestNavigation("/child")} type="button">
          ← 返回今日清单
        </button>
        <button ref={switchButtonRef} className="dictation-switch" onClick={() => void requestNavigation("/child/switch")} type="button">
          切换孩子
        </button>
      </div>
      {error ? <p className="dictation-global-error" role="alert">{error}</p> : null}
      {revoked ? <section className="dictation-card completed-card"><h1>这项任务已撤回</h1><p>这项听写已从你的待办中移除。</p><button className="dictation-primary" onClick={() => router.replace("/child")} type="button">返回今日清单</button></section> : session.phase === "listening" ? (
        <AudioSequence key={session.roundNumber} pending={pending || retryLocked} session={session} onPlayback={playback} />
      ) : session.phase === "grading" ? (
        <BatchGrader
          key={`${session.roundNumber}:${session.version}`}
          pending={pending || retryLocked}
          session={session}
          onDirtyChange={setDirtyMarks}
          onSubmit={submitMarks}
        />
      ) : (
        <section className="dictation-card completed-card">
          <p aria-hidden="true" className="completion-star">⭐</p>
          <h1>本次听写已完成</h1>
          <p>你认真完成了每一道题。</p>
          <button className="dictation-primary" onClick={() => router.replace("/child")} type="button">
            返回今日任务
          </button>
        </section>
      )}
      {retryLocked ? <button className="dictation-primary" disabled={pending} onClick={retrySave} type="button">重试保存</button> : null}
      {navigationTarget ? (
        <div ref={dialogRef} aria-labelledby="switch-dialog-title" aria-modal="true" className="confirm-overlay" role="dialog">
          <section className="confirm-card">
            <h2 id="switch-dialog-title">{navigationTarget === "/child" ? "现在返回今日清单吗？" : "现在要切换孩子吗？"}</h2>
            <p>听写任务不会取消，回来后会从已保存的位置继续。</p>
            {dirtyMarks ? <p>尚未提交的批改选择只保存在这台设备上。</p> : null}
            <div className="dictation-actions">
              <button autoFocus onClick={cancelNavigation} type="button">继续听写</button>
              <button
                className="dictation-primary"
                onClick={confirmNavigation}
                type="button"
              >
                {navigationTarget === "/child" ? "返回清单" : "确认切换"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
