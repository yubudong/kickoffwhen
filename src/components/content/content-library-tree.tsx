"use client";

import { LazyDetails } from './lazy-details';
import { EnglishBookNote } from "./english-book-note";
import { EnglishCardDetails } from "./english-card-details";
import { englishTargetLabel } from "@/modules/learning-content/english-types";
import { curriculumGroupLabel } from "@/modules/learning-content/english-catalog";
import { useState } from "react";
import { CurriculumFilters } from "./curriculum-filters";
import { filterContentLibrary, type SubjectFilter, type GradeFilter } from "@/modules/learning-content/curriculum-filter";
import { officialTextbookInfo } from "@/modules/learning-content/official-catalog";
import type { ContentLibrary } from "@/modules/learning-content/library-tree";
import type { LearningCard, Subject } from "@/modules/learning-content/types";

const subjectNames: Record<Subject, string> = { chinese: "语文", english: "英语" };

function WordList({ cards }: { cards: LearningCard[] }) {
  return (
    <ul className="library-words">
      {cards.map((card) => (
        <li key={card.id}>
          <strong lang={card.subject === "english" ? "en" : undefined}>{card.answerText}</strong>
          {card.english && <small className="english-target-label"> · {englishTargetLabel(card.english)}</small>}
          {card.english && <EnglishCardDetails details={card.english}/> }
           {card.curriculumSource && <small> · {card.curriculumSource === "required_vocabulary" ? "教材词语" : card.practiceOrigin === "grade_one_character" ? "一年级单字" : card.practiceOrigin === "lesson_text" ? "课文组词" : card.practiceOrigin === "age_appropriate" ? "适龄补充" : "写字练习"}</small>}
           {card.broadcastText !== card.answerText && <span className="library-word-note">听写提示：{card.broadcastText}</span>}
          {!card.english && (card.pinyinText || card.hintText) && (
            <span className="library-word-note">
              {[card.pinyinText, card.hintText].filter(Boolean).join(" · ")}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function UnplacedWords({ cards }: { cards: LearningCard[] }) {
  if (cards.length === 0) return null;
  return (
    <section className="library-unplaced">
      <h3>教材未分课 <span>{cards.length} 项字词</span></h3>
      <WordList cards={cards} />
    </section>
  );
}

export function ContentLibraryTree({ library: allLibrary }: { library: ContentLibrary }) {
  const [subjectFilter, setSubjectFilter] = useState<SubjectFilter>("all");
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>("all");
  const [versionFilter,setVersionFilter]=useState('all');
  const filtered=filterContentLibrary(allLibrary,subjectFilter,gradeFilter);
  const versions=[...new Set(filtered.editions.filter(e=>e.count>0).map(e=>e.label))];
  const chosen=filtered.editions.filter(e=>versionFilter==='all'||e.label===versionFilter);
  const library=versionFilter==='all'?filtered:{editions:chosen,personal:{chinese:[],english:[]},total:chosen.reduce((n,e)=>n+e.count,0)};
  const hasPersonal = library.personal.chinese.length > 0 || library.personal.english.length > 0;
  return (
    <div className="content-library">
      <CurriculumFilters subject={subjectFilter} grade={gradeFilter} onSubjectChange={value=>{setSubjectFilter(value);setVersionFilter('all')}} onGradeChange={value=>{setGradeFilter(value);setVersionFilter('all')}}/>
      <label className="catalog-version-filter">教材版本<select aria-label="教材版本" value={versionFilter} onChange={event=>setVersionFilter(event.target.value)}><option value="all">全部教材版本</option>{versions.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
      <p className="catalog-filter-summary" aria-live="polite">筛选结果：{library.editions.filter(edition => edition.count > 0).length} 册教材，{library.total} 项字词。</p>
      {allLibrary.total === 0 && <p className="library-empty">还没有听写内容</p>}
      {allLibrary.total > 0 && library.total === 0 && <p className="library-empty">没有符合当前科目和年级的听写内容。</p>}
      {gradeFilter !== "all" && (allLibrary.personal.chinese.length + allLibrary.personal.english.length > 0) && <p className="muted">未标注年级的自建内容可在“全部年级”中查看。</p>}
      {library.editions.some(edition => edition.count > 0) && (
        <div className="library-editions">
          {library.editions.filter(edition => edition.count > 0).map((edition) => (
            <LazyDetails className="library-edition" key={edition.id} summary={<>
                <span className="library-title">{subjectNames[edition.subject]} · {edition.grade} 年级{edition.volume} · {edition.label}</span>
                <span className="library-count">{curriculumGroupLabel(edition)} · {edition.count} 项字词</span>
              </>}>
              <div className="library-edition-content">
                {officialTextbookInfo(edition) && <p className="muted">依据国家中小学智慧教育平台教材的词语表、写字表整理。一年级采用单字组词播报；二至六年级采用词语听写，课文组词优先。全部配有拼音和语境，课文组词与适龄补充分别标明。<a href={officialTextbookInfo(edition)!.sourceUrl} target="_blank" rel="noreferrer">查看教材来源</a></p>}
                <EnglishBookNote edition={edition}/>
                {edition.count === 0 && <p className="library-empty">该教材暂无词条</p>}
                {edition.units.map((unit) => (
                  <LazyDetails className="library-unit" key={unit.id} summary={<>
                      <span className="library-title">{unit.title}</span>
                      <span className="library-count">{unit.sections.length} 个小节 · {unit.count} 项字词</span>
                    </>}>
                    <div className="library-unit-content">
                      {unit.sections.map((section) => (
                        <LazyDetails className="library-section" key={section.id} summary={<>
                            <span className="library-title">{section.title}</span>
                            <span className="library-count">{section.cards.length} 项字词</span>
                          </>}>
                          <WordList cards={section.cards} />
                        </LazyDetails>
                      ))}
                      <UnplacedWords cards={unit.unplaced} />
                    </div>
                  </LazyDetails>
                ))}
                <UnplacedWords cards={edition.unplaced} />
              </div>
            </LazyDetails>
          ))}
        </div>
      )}
      {subjectFilter !== "chinese" && !allLibrary.editions.some((edition) => edition.subject === "english" && edition.count > 0) && (
        <p className="library-empty library-english-empty">英语教材词库尚未导入</p>
      )}
      {hasPersonal && (
        <section className="library-personal-group">
          <h2>我的自建内容</h2>
          {(["chinese", "english"] as const).map((subject) => {
            const cards = library.personal[subject];
            return cards.length > 0 ? (
              <LazyDetails className="library-personal" key={subject} summary={<>
                  <span className="library-title">{subjectNames[subject]}</span>
                  <span className="library-count">{cards.length} 项字词</span>
                </>}>
                <WordList cards={cards} />
              </LazyDetails>
            ) : null;
          })}
        </section>
      )}
    </div>
  );
}
