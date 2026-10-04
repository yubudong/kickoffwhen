"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { childSessionViewSchema, type ChildTaskSummary } from "@/modules/dictation/child-view-types";

export function ChildTaskList({ tasks }: { tasks: ChildTaskSummary[] }) {
  const router = useRouter();
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function start(taskId: string) {
    setPendingTaskId(taskId);
    setError("");
    try {
      const response = await fetch(`/api/child/tasks/${taskId}/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const payload = await response.json().catch(() => null) as {
        error?: string;
        session?: unknown;
      } | null;
      if (!response.ok) {
        setError(
          payload?.error === "AUDIO_NOT_READY"
            ? "音频还没准备好，请让家长准备好后再试。"
            : "暂时不能开始，请稍后再试。",
        );
        return;
      }
      const session = childSessionViewSchema.parse(payload?.session);
      router.push(`/child/dictation/${session.sessionId}`);
    } catch {
      setError("网络中断了，请稍后再试。");
    } finally {
      setPendingTaskId(null);
    }
  }

  if (tasks.length === 0) return <p>今日任务尚未开放</p>;

  return (
    <div className="child-task-list">
      {tasks.map((task, index) => (
        <article className="child-task-row" key={task.taskId}>
          <div>
            <strong>听写任务 {index + 1}</strong>
            <span>{task.itemCount} 题 · {task.mode === "continuous_batch" ? "连续听写" : "逐题练习"}</span>
          </div>
          {task.sessionId ? (
            <Link className="dictation-primary" href={`/child/dictation/${task.sessionId}`}>继续听写</Link>
          ) : (
            <button
              className="dictation-primary"
              disabled={task.audioStatus !== "ready" || pendingTaskId !== null}
              onClick={() => void start(task.taskId)}
              type="button"
            >
              {pendingTaskId === task.taskId
                ? "正在开始…"
                : task.audioStatus === "ready"
                  ? "开始听写"
                  : "音频准备中"}
            </button>
          )}
        </article>
      ))}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
