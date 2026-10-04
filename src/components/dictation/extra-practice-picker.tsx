"use client";

import { useMemo, useState } from "react";

import type { TaskCardOption } from "@/modules/dictation/task-card-filter";

export function ExtraPracticePicker({ cards, childId, subject, selectedSectionIds, selected, onChange }: {
  cards: TaskCardOption[];
  childId: string;
  subject: "chinese" | "english";
  selectedSectionIds: string[];
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const eligible = useMemo(() => cards.filter((card) => card.subject === subject && !card.activeChildIds?.includes(childId) &&
    (!card.sectionId || !selectedSectionIds.includes(card.sectionId))), [cards, childId, subject, selectedSectionIds]);
  const results = query.trim() ? eligible.filter((card) => card.answerText.includes(query.trim())).slice(0, 30) : [];
  const selectedCards = selected.map((id) => eligible.find((card) => card.id === id)).filter((card): card is TaskCardOption => Boolean(card));
  return <details className="extra-practice-picker">
    <summary>单独加练易错词 <span>已选 {selected.length} 词</span></summary>
    <div className="extra-practice-content">
      {selectedCards.length > 0 ? <div className="extra-practice-chips">{selectedCards.map((card) => <button type="button" key={card.id} onClick={() => onChange(selected.filter((id) => id !== card.id))}>{card.answerText} ×</button>)}</div> : null}
      <label>搜索词语<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入易错词后选择"/></label>
      {query.trim() ? <div className="extra-practice-results">{results.length ? results.map((card) => <label key={card.id}>
        <input type="checkbox" checked={selected.includes(card.id)} onChange={(event) => onChange(event.target.checked
          ? [...selected, card.id]
          : selected.filter((id) => id !== card.id))}/>
        {card.answerText}<small>{card.sectionTitle ?? "自建词卡"}{card.startedChildIds.includes(childId) ? " · 已学过" : ""}</small>
      </label>) : <p>没有找到可加练的词语。</p>}</div> : <p className="muted">输入词语后才显示匹配卡片。</p>}
    </div>
  </details>;
}
