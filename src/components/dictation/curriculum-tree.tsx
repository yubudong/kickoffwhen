"use client";

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
  if (editions.length === 0) return <p>这门科目的教材词库还没有内容。</p>;
  return <div className="curriculum-tree">
    {editions.map((edition) => <details key={edition.id} className="curriculum-edition">
      <summary>{edition.grade}年级{edition.subject === "chinese" ? "语文" : "英语"} · {edition.volume}<span>{edition.units.length} 个单元</span></summary>
      <div className="curriculum-units">
        {edition.units.map((unit) => {
          const selectable = unit.sections.filter((section) => section.availableCount > 0).map((section) => section.id);
          const available = unit.sections.reduce((sum, section) => sum + section.availableCount, 0);
          return <div key={unit.id} className="curriculum-unit">
            <UnitCheckbox label={unit.title} ids={selectable} selected={selected} onChange={onChange} />
            <details>
              <summary>{unit.title}<span>{unit.sections.length} 课 · {available} 个可选词</span></summary>
              <div className="curriculum-sections">
                {unit.sections.map((section) => <label key={section.id}>
                  <input type="checkbox" checked={selected.includes(section.id)} disabled={section.availableCount === 0}
                    onChange={(event) => onChange(event.target.checked
                      ? [...selected, section.id]
                      : selected.filter((id) => id !== section.id))}/>
                  <span>{section.title}</span><small>{section.availableCount} 个可选词{section.totalCount > section.availableCount ? `，${section.totalCount - section.availableCount} 个已学或进行中` : ""}</small>
                </label>)}
              </div>
            </details>
          </div>;
        })}
      </div>
    </details>)}
  </div>;
}
