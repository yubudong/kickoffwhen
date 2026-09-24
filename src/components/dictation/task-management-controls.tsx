"use client";

import { useState } from "react";

type Detail = {
  title: string;
  started: boolean;
  status: string;
  todoStatus: string | null;
  items: Array<{ cardId: string; answerText: string }>;
};

const messages: Record<string, string> = {
  TASK_REWARDED: "这项任务已经发放积分，不能撤回。",
  TASK_ALREADY_STARTED: "孩子已经开始听写，不能再移除单词；可以撤回整项任务。",
  TASK_NOT_ACTIVE: "这项任务已结束或已撤回。",
  TASK_ITEM_NOT_FOUND: "这个词已不在任务中，请刷新后再试。",
};

export function TaskManagementControls({ taskId, onChanged }: {
  taskId: string;
  onChanged: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    const response = await fetch(`/api/parent/tasks/${taskId}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(messages[body.error] ?? "无法读取任务详情。");
    setDetail(body.result);
  }

  async function act(method: "DELETE" | "PATCH", cardId?: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/parent/tasks/${taskId}`, {
        method,
        ...(cardId ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ cardId }) } : {}),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(messages[body.error] ?? "操作未成功，请重试。");
      await onChanged();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "网络中断，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return <details className="task-management" onToggle={(event) => {
    if (event.currentTarget.open && !detail) void load().catch((cause) => setError(cause instanceof Error ? cause.message : "无法读取任务详情。"));
  }}>
    <summary>管理听写</summary>
    {error && <p role="alert">{error}</p>}
    {detail && <>
      <p>{detail.started ? "孩子已开始听写，词语不能再单独移除。" : "尚未开始，可以移除误加的词语。"}</p>
      {!detail.started && detail.status === "active" && <ul>{detail.items.map((item) => <li key={item.cardId}>
        {item.answerText} <button type="button" disabled={busy} onClick={() => {
          if (window.confirm(`从“${detail.title}”中移除“${item.answerText}”？`)) void act("PATCH", item.cardId);
        }}>移除</button>
      </li>)}</ul>}
      {detail.status !== "cancelled" && detail.todoStatus !== "approved" && <button type="button" className="secondary-button" disabled={busy} onClick={() => {
        if (window.confirm(`撤回“${detail.title}”？孩子将无法继续这项听写，已产生的记录会保留。`)) void act("DELETE");
      }}>撤回整项任务</button>}
      {detail.status === "cancelled" && <p>已撤回，记录仍可查询。</p>}
    </>}
  </details>;
}
