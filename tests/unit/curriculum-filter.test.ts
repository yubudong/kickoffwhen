import { expect, test, vi } from "vitest";
import type { ReactElement } from "react";
import { filterContentLibrary, matchesCurriculumFilter } from "@/modules/learning-content/curriculum-filter";
import type { ContentLibrary, LibraryEdition } from "@/modules/learning-content/library-tree";
import type { LearningCard, Subject } from "@/modules/learning-content/types";
import { CurriculumFilters } from "@/components/content/curriculum-filters";

const edition = (id: string, subject: Subject, grade: number, count: number): LibraryEdition => ({ id,subject,grade,count,label:id,volume:"上册",units:[],unplaced:[] });
const personal = (subject: Subject): LearningCard => ({id:subject,familyId:"family",subject,answerText:"自建",broadcastText:"自建",hintText:null,pinyinText:null,curriculumSource:null,sourceOrder:null,textbookEditionId:null,unitId:null,sectionId:null,source:"manual"});
const library: ContentLibrary = { editions:[edition("cn3","chinese",3,2),edition("cn5","chinese",5,3),edition("en5","english",5,1)], personal:{chinese:[personal("chinese")],english:[personal("english")]}, total:8 };

test("科目、年级各自独立，组合时取交集", () => {
  expect(filterContentLibrary(library,"all","all").total).toBe(8);
  expect(filterContentLibrary(library,"chinese","all").editions.map(item=>item.id)).toEqual(["cn3","cn5"]);
  expect(filterContentLibrary(library,"chinese","all").total).toBe(6);
  expect(filterContentLibrary(library,"all",5).editions.map(item=>item.id)).toEqual(["cn5","en5"]);
  expect(filterContentLibrary(library,"all",5).total).toBe(4);
  expect(filterContentLibrary(library,"english",5).editions.map(item=>item.id)).toEqual(["en5"]);
  expect(filterContentLibrary(library,"english",3).total).toBe(0);
});

test("不猜测自建词年级，不修改原目录或个人内容", () => {
  const before = structuredClone(library);
  expect(filterContentLibrary(library,"all",5).personal).toEqual({chinese:[],english:[]});
  expect(filterContentLibrary(library,"english","all").personal.english).toHaveLength(1);
  expect(matchesCurriculumFilter({subject:"english",grade:null},"all",5)).toBe(false);
  expect(library).toEqual(before);
});

function elements(node: unknown): ReactElement<Record<string,unknown>>[] {
  if(Array.isArray(node)) return node.flatMap(elements);
  if(!node || typeof node!=="object" || !("props" in node)) return [];
  const element=node as ReactElement<Record<string,unknown>>;
  return [element,...elements(element.props.children)];
}
test("共享筛选包含全部选项，年级独立改变，重置按钮不提交任务", () => {
  const onSubjectChange=vi.fn(),onGradeChange=vi.fn();
  const tree=elements(CurriculumFilters({subject:"english",grade:5,onSubjectChange,onGradeChange}));
  const grade=tree.find(element=>element.type==="select" && element.props["aria-label"]==="年级")!;
  (grade.props.onChange as (event:unknown)=>void)({target:{value:"3"}});
  expect(onGradeChange).toHaveBeenCalledWith(3);
  expect(onSubjectChange).not.toHaveBeenCalled();
  const button=tree.find(element=>element.type==="button")!;
  expect(button.props.type).toBe("button");
  (button.props.onClick as ()=>void)();
  expect(onSubjectChange).toHaveBeenCalledWith("all");
  expect(onGradeChange).toHaveBeenLastCalledWith("all");
});
