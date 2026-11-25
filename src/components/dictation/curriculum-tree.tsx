"use client";
import { useState } from 'react';

import { LazyDetails } from '@/components/content/lazy-details';
import { EnglishBookNote } from "@/components/content/english-book-note";
import { curriculumGroupLabel } from "@/modules/learning-content/english-catalog";
import { officialTextbookInfo } from "@/modules/learning-content/official-catalog";
import type { CurriculumEdition } from "@/modules/dictation/curriculum-selection";
import { toggleUnitSections } from "@/modules/dictation/curriculum-selection";

function UnitCheckbox({ label, ids, selected, onChange }: {
  label: string;
  ids: string[];
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  const count = ids.filter((id) => selected.includes(id)).length;
  return <input
    aria-label={`选择${label}全部课次`}
    type="checkbox"
    checked={ids.length > 0 && count === ids.length}
    disabled={ids.length === 0}
    ref={(node) => { if (node) node.indeterminate = count > 0 && count < ids.length; }}
    onChange={() => onChange(toggleUnitSections(selected, ids))}
  />;
}

export function CurriculumTree({ editions, selected, onChange }: {
  editions: CurriculumEdition[];
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  const [version,setVersion]=useState('all');
  const versionOf=(e:CurriculumEdition)=>[e.publisher,e.series,e.editionText].join(' · ');
  const versions=[...new Set(editions.map(versionOf))];
  if (editions.length === 0) return <p>这门科目的教材词库还没有内容。</p>;
  return <div className="curriculum-tree">
    <label className="catalog-version-filter">教材版本<select aria-label="教材版本" value={versions.includes(version)?version:'all'} onChange={event=>setVersion(event.target.value)}><option value="all">全部教材版本</option>{versions.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
    {editions.filter(e=>!versions.includes(version)||version==='all'||versionOf(e)===version).map((edition) => <LazyDetails key={edition.id} className="curriculum-edition" summary={<>{edition.grade}年级{edition.subject === "chinese" ? "语文" : "英语"} · {edition.volume} · {edition.publisher} · {edition.series}{edition.editionText ? `（${edition.editionText}）` : ""}<span>{curriculumGroupLabel(edition)}</span></>}>
      {officialTextbookInfo(edition) && <p className="muted">教材词语＋分级写字练习 · <a href={officialTextbookInfo(edition)!.sourceUrl} target="_blank" rel="noreferrer">国家平台教材来源</a>。{edition.grade === 1 ? "一年级单字使用简单组词播报。" : "按本年级水平组词，优先选用课文原词。"}全部配有拼音和语境。</p>}
      <EnglishBookNote edition={edition}/>
      <div className="curriculum-units">
        {edition.units.map((unit) => {
          const selectable = unit.sections.filter((section) => section.availableCount > 0).map((section) => section.id);
          const available = unit.sections.reduce((sum, section) => sum + section.availableCount, 0);
          return <div key={unit.id} className="curriculum-unit">
            <UnitCheckbox label={unit.title} ids={selectable} selected={selected} onChange={onChange} />
            <LazyDetails summary={<>{unit.title}<span>{unit.sections.length} 课 · {available} 项可选字词</span></>}>
              <div className="curriculum-sections">
                {unit.sections.map((section) => <label key={section.id}>
                  <input type="checkbox" checked={selected.includes(section.id)} disabled={section.availableCount === 0}
                    onChange={(event) => onChange(event.target.checked
                      ? [...selected, section.id]
                      : selected.filter((id) => id !== section.id))}/>
                  <span>{section.title}</span><small>{section.availableCount} 项可选字词{(section.excludedOptionalCount ?? 0) > 0 ? `，${section.excludedOptionalCount} 项认读或注释词形可自选` : ""}{section.totalCount - section.availableCount - (section.excludedOptionalCount ?? 0) > 0 ? `，${section.totalCount - section.availableCount - (section.excludedOptionalCount ?? 0)} 个已学或进行中` : ""}</small>
                </label>)}
              </div>
            </LazyDetails>
          </div>;
        })}
      </div>
    </LazyDetails>)}
  </div>;
}
