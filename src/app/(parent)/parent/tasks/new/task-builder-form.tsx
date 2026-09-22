"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { filterTaskCardOptions, type TaskCardOption } from "@/modules/dictation/task-card-filter";
import {
  createTaskSubmissionController,
  readTaskCreationResponse,
} from "@/modules/dictation/task-submission";

type ChildOption = { id: string; nickname: string; dueCount: number; dueCounts: Record<"chinese" | "english", number> };
type CardOption = TaskCardOption;

export function TaskBuilderForm({
  childOptions,
  cards,
}: {
  childOptions: ChildOption[];
  cards: CardOption[];
}) {
  const router = useRouter();
  const [childId, setChildId] = useState(childOptions[0]?.id ?? "");
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [sourceView, setSourceView] = useState<"all" | "textbook" | "custom">("all");
  const [unitId, setUnitId] = useState("all");
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState<"chinese" | "english">("chinese");
  const [sectionId, setSectionId] = useState("all");
  const submissionRef = useRef<ReturnType<typeof createTaskSubmissionController> | null>(null);
  if (submissionRef.current === null) {
    submissionRef.current = createTaskSubmissionController();
  }
  const child = useMemo(
    () => childOptions.find((item) => item.id === childId),
    [childId, childOptions],
  );
  const units = useMemo(
    () => [...new Map(cards.filter((card) => card.subject === subject && card.unitId).map((card) => [
      card.unitId!,
      card.unitTitle ?? "未命名单元",
    ])).entries()],
    [cards, subject],
  );
  const sections = useMemo(
    () => [...new Map(cards.filter((card) => card.subject === subject && card.sectionId && (unitId === "all" || card.unitId === unitId)).map((card) => [card.sectionId!, card.sectionTitle ?? "未命名小节"])).entries()],
    [cards, subject, unitId],
  );
  const visibleCards = useMemo(
    () => filterTaskCardOptions(cards, { childId, sourceView, subject, unitId, sectionId, query }),
    [cards, childId, query, sourceView, subject, unitId, sectionId],
  );

  async function submit(formData: FormData) {
    setMessage("");
    const resultPromise = submissionRef.current!.submit(async (commandId) => {
      setPending(true);
      const response = await fetch("/api/parent/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          childId,
          subject,
          newCardIds: selectedCardIds,
          commandId,
          maxReviewCards: Number(formData.get("maxReviewCards")),
          mode: formData.get("mode"),
          order: formData.get("order"),
          intervalSeconds: Number(formData.get("intervalSeconds")),
          repeatCount: Number(formData.get("repeatCount")),
          speechRate: Number(formData.get("speechRate")),
          allowManualReplay: formData.get("allowManualReplay") === "on",
        }),
      });
      return readTaskCreationResponse(response);
    });
    const result = await resultPromise;
    if (result.status === "busy") return;
    try {
      if (result.status === "failed") throw result.error;
      const body = result.value;
      setMessage(
        body.task.audioStatus === "ready"
          ? `任务已创建，共 ${body.task.items.length} 题，音频已就绪。`
          : `任务已创建，共 ${body.task.items.length} 题，音频正在后台准备。`,
      );
      setSelectedCardIds([]);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? `创建失败：${error.message}` : "创建失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={submit} className="stack">
      <label>
        孩子
        <select
          value={childId}
          onChange={(event) => {
            setChildId(event.target.value);
            setSelectedCardIds([]);
          }}
          required
        >
          {childOptions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.nickname}（到期 {item.dueCounts[subject]} 张）
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>选择本次新卡片</legend>
        <div className="grid two">
          <label>
            科目
            <select aria-label="科目" value={subject} onChange={(event) => {
              setSubject(event.target.value as typeof subject);
              setUnitId("all");
              setSectionId("all");
              setSelectedCardIds([]);
            }}>
              <option value="chinese">语文</option>
              <option value="english">英语</option>
            </select>
          </label>
          <label>
            教材单元
            <select aria-label="教材单元" value={unitId} onChange={(event) => {
              setUnitId(event.target.value);
              setSectionId("all");
              setSelectedCardIds([]);
            }}>
              <option value="all">全部单元</option>
              {units.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
            </select>
          </label>
          <label>
            课次或教材小节
            <select aria-label="课次或教材小节" value={sectionId} onChange={(event) => {
              setSectionId(event.target.value);
              setSelectedCardIds([]);
            }}>
              <option value="all">全部小节</option>
              {sections.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
            </select>
          </label>
          <label>
            内容来源
            <select value={sourceView} onChange={(event) => setSourceView(event.target.value as typeof sourceView)}>
              <option value="all">全部</option>
              <option value="textbook">教材单元</option>
              <option value="custom">家长自建</option>
            </select>
          </label>
        </div>
        <label>
          搜索新卡片
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入词语或单词" />
        </label>
        {visibleCards.length === 0 ? <p>当前条件下没有可选新卡片。</p> : null}
        {visibleCards.map((card) => (
          <label key={card.id} style={{ display: "block" }}>
            <input
              type="checkbox"
              checked={selectedCardIds.includes(card.id)}
              onChange={(event) => setSelectedCardIds((current) =>
                event.target.checked
                  ? [...current, card.id]
                  : current.filter((id) => id !== card.id))}
            />
            {card.answerText} · {card.subject === "chinese" ? "语文" : "英语"}
            {card.unitTitle ? ` · ${card.unitTitle}` : ""}
            {card.sectionTitle ? ` · ${card.sectionTitle}` : ""}
          </label>
        ))}
      </fieldset>

      <div className="grid two">
        <label>模式<select name="mode" defaultValue="continuous_batch"><option value="continuous_batch">连续听写</option><option value="item_by_item">逐题练习</option></select></label>
        <label>顺序<select name="order" defaultValue="source"><option value="source">原顺序</option><option value="random">随机</option></select></label>
        <label>题间隔（秒）<input name="intervalSeconds" type="number" min="2" max="120" defaultValue="8" /></label>
        <label>播报次数<select name="repeatCount" defaultValue="1"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
        <label>朗读速度<input name="speechRate" type="number" min="0.5" max="2" step="0.05" defaultValue="1" /></label>
        <label>最多到期复习<input name="maxReviewCards" type="number" min="0" max="100" defaultValue="20" /></label>
      </div>
      <label><input name="allowManualReplay" type="checkbox" defaultChecked /> 允许孩子手动重听</label>
      <p>当前孩子有 {child?.dueCounts[subject] ?? 0} 张{subject === "chinese" ? "语文" : "英语"}到期卡片，会优先排在新卡片前。</p>
      <button disabled={pending || !childId} type="submit">{pending ? "正在创建…" : "创建今日任务"}</button>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
