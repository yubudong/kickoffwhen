"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { CurriculumTree } from "@/components/dictation/curriculum-tree";
import { ExtraPracticePicker } from "@/components/dictation/extra-practice-picker";
import { buildCurriculumTree } from "@/modules/dictation/curriculum-selection";
import type { TaskCardOption } from "@/modules/dictation/task-card-filter";
import {
  createTaskSubmissionController,
  readTaskBatchCreationResponse,
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
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>([]);
  const [extraCardIds, setExtraCardIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [subject, setSubject] = useState<"chinese" | "english">("chinese");
  const submissionRef = useRef<ReturnType<typeof createTaskSubmissionController> | null>(null);
  if (submissionRef.current === null) {
    submissionRef.current = createTaskSubmissionController();
  }
  const child = useMemo(
    () => childOptions.find((item) => item.id === childId),
    [childId, childOptions],
  );
  const editions = useMemo(() => buildCurriculumTree(cards, childId, subject), [cards, childId, subject]);
  const selectedSections = editions.flatMap((edition) => edition.units.flatMap((unit) => unit.sections))
    .filter((section) => selectedSectionIds.includes(section.id) && section.availableCount > 0);
  const selectedNewWords = selectedSections.reduce((total, section) => total + section.availableCount, 0);

  async function submit(formData: FormData) {
    setMessage("");
    const resultPromise = submissionRef.current!.submit(async (commandId) => {
      setPending(true);
      const response = await fetch("/api/parent/task-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          childId,
          subject,
          sectionIds: selectedSectionIds,
          extraCardIds,
          commandId,
          mode: formData.get("mode"),
          order: formData.get("order"),
          intervalSeconds: Number(formData.get("intervalSeconds")),
          repeatCount: Number(formData.get("repeatCount")),
          speechRate: Number(formData.get("speechRate")),
          allowManualReplay: formData.get("allowManualReplay") === "on",
        }),
      });
      return readTaskBatchCreationResponse(response);
    });
    const result = await resultPromise;
    if (result.status === "busy") return;
    try {
      if (result.status === "failed") throw result.error;
      const body = result.value;
      const wordCount = body.tasks.reduce((count, task) => count + task.items.length, 0);
      setMessage(
        `已创建 ${body.tasks.length} 项任务、共 ${wordCount} 词。${body.tasks.every((task) => task.audioStatus === "ready") ? "音频已就绪。" : "音频正在后台准备。"}`,
      );
      setSelectedSectionIds([]);
      setExtraCardIds([]);
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
            setSelectedSectionIds([]);
            setExtraCardIds([]);
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
        <legend>选择教材范围</legend>
        <label>科目<select aria-label="科目" value={subject} onChange={(event) => {
          setSubject(event.target.value as typeof subject);
          setSelectedSectionIds([]);
          setExtraCardIds([]);
        }}><option value="chinese">语文</option><option value="english">英语</option></select></label>
        <p className="muted">展开教材和单元后勾选课次。勾选整个单元会按课生成任务。</p>
        <CurriculumTree editions={editions} selected={selectedSectionIds} onChange={(ids) => {
          setSelectedSectionIds(ids);
          setExtraCardIds((previous) => previous.filter((id) => {
            const sectionId = cards.find((card) => card.id === id)?.sectionId;
            return !sectionId || !ids.includes(sectionId);
          }));
        }}/>
      </fieldset>
      <ExtraPracticePicker cards={cards} childId={childId} subject={subject} selectedSectionIds={selectedSectionIds} selected={extraCardIds} onChange={setExtraCardIds}/>
      <p className="task-batch-preview" aria-live="polite">将创建 {selectedSections.length + (extraCardIds.length ? 1 : 0)} 项任务：{selectedSections.length} 课、{selectedNewWords} 个教材新词{extraCardIds.length ? `，另加练 ${extraCardIds.length} 词` : ""}。</p>

      <div className="grid two">
        <label>模式<select name="mode" defaultValue="continuous_batch"><option value="continuous_batch">连续听写</option><option value="item_by_item">逐题练习</option></select></label>
        <label>顺序<select name="order" defaultValue="source"><option value="source">原顺序</option><option value="random">随机</option></select></label>
        <label>题间隔（秒）<input name="intervalSeconds" type="number" min="2" max="120" defaultValue="8" /></label>
        <label>播报次数<select name="repeatCount" defaultValue="1"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
        <label>朗读速度<input name="speechRate" type="number" min="0.5" max="2" step="0.05" defaultValue="1" /></label>
      </div>
      <label><input name="allowManualReplay" type="checkbox" defaultChecked /> 允许孩子手动重听</label>
      <p>当前孩子有 {child?.dueCounts[subject] ?? 0} 张{subject === "chinese" ? "语文" : "英语"}到期卡片，会自动汇总成复习任务。</p>
      <button disabled={pending || !childId || (selectedSections.length === 0 && extraCardIds.length === 0)} type="submit">{pending ? "正在创建…" : "下发所选任务"}</button>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
