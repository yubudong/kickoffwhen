"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { CurriculumFilters } from "@/components/content/curriculum-filters";
import { matchesCurriculumFilter, type SubjectFilter, type GradeFilter } from "@/modules/learning-content/curriculum-filter";
import { CurriculumTree } from "@/components/dictation/curriculum-tree";
import { ExtraPracticePicker } from "@/components/dictation/extra-practice-picker";
import { buildCurriculumTree, type CurriculumCatalogEdition } from "@/modules/dictation/curriculum-selection";
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
  catalog,
}: {
  childOptions: ChildOption[];
  cards: CardOption[];
  catalog: CurriculumCatalogEdition[];
}) {
  const router = useRouter();
  const [childId, setChildId] = useState(childOptions[0]?.id ?? "");
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>([]);
  const [extraCardIds, setExtraCardIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [subject, setSubject] = useState<"chinese" | "english">("chinese");
  const [subjectFilter, setSubjectFilter] = useState<SubjectFilter>("all");
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>("all");
  const [englishMode, setEnglishMode] = useState<"standard" | "assisted">("standard");
  const [includeRecognition, setIncludeRecognition] = useState(false);
  const submissionRef = useRef<ReturnType<typeof createTaskSubmissionController> | null>(null);
  if (submissionRef.current === null) {
    submissionRef.current = createTaskSubmissionController();
  }
  const child = useMemo(
    () => childOptions.find((item) => item.id === childId),
    [childId, childOptions],
  );
  const editions = useMemo(() => ([
    ...(subjectFilter === "english" ? [] : buildCurriculumTree(cards, childId, "chinese", catalog)),
    ...(subjectFilter === "chinese" ? [] : buildCurriculumTree(cards, childId, "english", catalog, includeRecognition)),
  ]).filter(edition => matchesCurriculumFilter(edition, subjectFilter, gradeFilter)), [cards, childId, subjectFilter, gradeFilter, catalog, includeRecognition]);
  const sectionSubjects = useMemo(() => new Map(catalog.flatMap(edition => edition.units.flatMap(unit => unit.sections.map(section => [section.id, edition.subject] as const)))), [catalog]);
  const filteredCards = useMemo(() => cards.filter(card => matchesCurriculumFilter(card, subjectFilter, gradeFilter)), [cards, subjectFilter, gradeFilter]);
  function clearSelection() { setSelectedSectionIds([]); setExtraCardIds([]); setMessage(""); }
  function changeSubjectFilter(value: SubjectFilter) {
    setSubjectFilter(value);
    if (value !== "all") setSubject(value);
    clearSelection();
  }
  function changeGradeFilter(value: GradeFilter) { setGradeFilter(value); clearSelection(); }
  function selectSections(ids: string[]) {
    const added = ids.find(id => !selectedSectionIds.includes(id));
    const nextSubject = (added ? sectionSubjects.get(added) : undefined) ?? subject;
    const next = ids.filter(id => sectionSubjects.get(id) === nextSubject);
    setSubject(nextSubject);
    setSelectedSectionIds(next);
    setExtraCardIds(previous => previous.filter(id => {
      const card = cards.find(item => item.id === id);
      return card?.subject === nextSubject && (!card.sectionId || !next.includes(card.sectionId) || (card.englishLearningTarget === "recognition" && !includeRecognition));
    }));
  }
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
          gradingMode: formData.get("gradingMode") ?? "self",
          ...(subject === "english" ? { englishStudyOptions: { version: 1, mode: englishMode, includeRecognition } } : {}),
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
              {item.nickname}（到期 {subjectFilter === "all" ? item.dueCount : item.dueCounts[subjectFilter]} 张）
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>选择教材范围</legend>
        <CurriculumFilters subject={subjectFilter} grade={gradeFilter} onSubjectChange={changeSubjectFilter} onGradeChange={changeGradeFilter}/>
        <p className="catalog-filter-summary" aria-live="polite">筛选结果：{editions.length} 册教材。</p>
        {editions.length === 0 && <p className="library-empty">没有符合当前科目和年级的教材内容。</p>}
        {subjectFilter === "all" && <p className="muted">当前下发科目：{subject === "chinese" ? "语文" : "英语"}。每批任务只含一个科目，改选另一科目的课次会替换当前勾选。</p>}
        {subjectFilter !== "chinese" && editions.some(item=>item.subject === "english") && <div className="english-study-settings">
          <label>英语练习方式<select aria-label="英语练习方式" value={englishMode} disabled={pending} onChange={event=>setEnglishMode(event.target.value as typeof englishMode)}>
            <option value="standard">标准听写（只听英语）</option><option value="assisted">辅助练习（词义与可用语境）</option>
          </select></label>
          <label><input type="checkbox" checked={includeRecognition} disabled={pending} onChange={event=>{setIncludeRecognition(event.target.checked);clearSelection();}}/> 包含认读词与教材注释词形（自选拼写练习）</label>
          <p className="muted">PEP默认新课范围为明确读写词与理解运用核心词；其他版本提供已核对教材词表，由家长自选练习，不推定全部词汇都要求四会。调整范围后请重新勾选；已学词照常到期复习，也可在下方单独加练认读词。标准模式不显示英文、音标或词义；同音词补读短语境。缩写题会提示填写形式。</p>
        </div>}
        <p className="muted">展开教材和单元后勾选课次。勾选整个单元会按课生成任务。</p>
        {editions.length > 0 && <CurriculumTree editions={editions} selected={selectedSectionIds} onChange={selectSections}/>}
      </fieldset>
      <ExtraPracticePicker includeRecognition={includeRecognition} cards={filteredCards} childId={childId} subject={subject} selectedSectionIds={selectedSectionIds} selected={extraCardIds} onChange={setExtraCardIds}/>
      <p className="task-batch-preview" aria-live="polite">将创建 {selectedSections.length + (extraCardIds.length ? 1 : 0)} 项任务：{selectedSections.length} 课、{selectedNewWords} 个教材新词{extraCardIds.length ? `，另加练 ${extraCardIds.length} 词` : ""}。</p>

      <div className="grid two">
        <label>模式<select name="mode" defaultValue="continuous_batch"><option value="continuous_batch">连续听写</option><option value="item_by_item">逐题练习</option></select></label>
        <label>顺序<select name="order" defaultValue="source"><option value="source">原顺序</option><option value="random">随机</option></select></label>
        <label>题间隔（秒）<input name="intervalSeconds" type="number" min="2" max="120" defaultValue="8" /></label>
        <label>播报次数<select name="repeatCount" defaultValue="1"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
        <label>朗读速度<input name="speechRate" type="number" min="0.5" max="2" step="0.05" defaultValue="1" /></label>
      </div>
      <label><input name="allowManualReplay" type="checkbox" defaultChecked /> 允许孩子手动重听</label>
      <fieldset>
        <legend>批改方式</legend>
        <label><input type="radio" name="gradingMode" value="self" defaultChecked /> 孩子自己批改</label>
        <label><input type="radio" name="gradingMode" value="parent" /> 提交给家长批改</label>
        <p>家长批改：孩子听完后拍照上传，家长逐词判对错；错词继续听写订正。</p>
      </fieldset>
      <p>当前孩子有 {child?.dueCounts[subject] ?? 0} 张{subject === "chinese" ? "语文" : "英语"}到期卡片，会自动汇总成复习任务。</p>
      <button disabled={pending || !childId || (selectedSections.length === 0 && extraCardIds.length === 0)} type="submit">{pending ? "正在创建…" : "下发所选任务"}</button>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
