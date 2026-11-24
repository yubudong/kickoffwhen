"use client";

import type { GradeFilter, SubjectFilter } from "@/modules/learning-content/curriculum-filter";

const grades = ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级"];

export function CurriculumFilters({ subject, grade, onSubjectChange, onGradeChange }: {
  subject: SubjectFilter;
  grade: GradeFilter;
  onSubjectChange: (value: SubjectFilter) => void;
  onGradeChange: (value: GradeFilter) => void;
}) {
  return <div className="curriculum-filters">
    <label>科目<select aria-label="科目" value={subject} onChange={event => onSubjectChange(event.target.value as SubjectFilter)}>
      <option value="all">全部科目</option><option value="chinese">语文</option><option value="english">英语</option>
    </select></label>
    <label>年级<select aria-label="年级" value={grade} onChange={event => onGradeChange(event.target.value === "all" ? "all" : Number(event.target.value))}>
      <option value="all">全部年级</option>{grades.map((label, index) => <option key={index + 1} value={index + 1}>{label}</option>)}
    </select></label>
    <button type="button" disabled={subject === "all" && grade === "all"} onClick={() => { onSubjectChange("all"); onGradeChange("all"); }}>重置筛选</button>
  </div>;
}
