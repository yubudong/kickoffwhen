import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import manifest from "../../content/official-english-manifest.json";
import rawIndex from "../../content/official-english-metadata.json";
import { validateSeedContents } from "@/modules/learning-content/seed-validator";
import { assertEnglishSeedAudit, type EnglishContentRequirements } from "@/modules/learning-content/english-content-audit";
import { englishListeningProjection, getEnglishMetadata } from "@/modules/learning-content/english-metadata";
import { buildCurriculumTree } from "@/modules/dictation/curriculum-selection";

const load=(path:string)=>JSON.parse(readFileSync(path,"utf8"));
test("八册英语覆盖999项，保留真实教材目标和单元，没有混用精通版",()=>{
  expect(manifest.books).toHaveLength(8);
  expect(new Set(manifest.books.map(book=>`${book.grade}:${book.volume}`)).size).toBe(8);
  expect(manifest.counts).toMatchObject({cards:999,spelling:111,core:328,recognition:560,defaultTextbookSpellingPractice:439});
  const all=[];
  for(const book of manifest.books){
    const [content]=validateSeedContents([load(book.seedFile)]);
    const audit=assertEnglishSeedAudit(content!,load(book.referenceFile) as EnglishContentRequirements);
    expect(audit.cards).toBe(book.cardCount);
    for(const unit of content!.units)for(const section of unit.sections)for(const card of section.cards){
      all.push(card);expect(getEnglishMetadata(card.builtinKey)).toEqual(card.english);
      expect(card.english!.exampleWithBlank.split("（　　）")).toHaveLength(2);
      expect(card.english!.meaningZh).toMatch(/[\u4e00-\u9fff]/);
    }
  }
  expect(all).toHaveLength(999);expect(Object.keys(rawIndex)).toHaveLength(999);
  expect(new Set(all.map(card=>card.builtinKey)).size).toBe(999);
});

test("词表缺词、错分目标、释义泄露英文和未审运行索引都会被拒绝",()=>{
  const book=manifest.books[0]!;const ref=load(book.referenceFile);
  const input=load(book.seedFile);input.units[0].sections[0].cards.pop();
  const [content]=validateSeedContents([input]);expect(()=>assertEnglishSeedAudit(content!,ref)).toThrow("COVERAGE");
  const leaked=load(book.seedFile);const card=leaked.units[0].sections[0].cards[0];card.english.meaningZh=card.answerText;
  expect(()=>validateSeedContents([leaked])).toThrow("ANSWER_LEAK");
  const altered=load(book.seedFile);altered.units[0].sections[0].cards[0].english.learningTarget="spelling";
  expect(()=>assertEnglishSeedAudit(validateSeedContents([altered])[0]!,ref)).toThrow("INDEX_MISMATCH");
});

test("同一课read原形和过去式独立，音标、播报和卡片ID不得混同",()=>{
  const book=manifest.books.find(book=>book.grade===6&&book.volume===1)!;
  const [content]=validateSeedContents([load(book.seedFile)]);
  const reads=content!.units[1]!.sections.flatMap(section=>section.cards).filter(card=>card.answerText==="read");
  expect(reads).toHaveLength(2);expect(new Set(reads.map(card=>card.builtinKey)).size).toBe(2);
  expect(new Set(reads.map(card=>card.broadcastText)).size).toBe(2);
  expect(reads.map(card=>card.english!.pronunciation)).toContainEqual({kind:"ipa",target:"read",ipa:"rɛd"});
  const invalid=load(book.seedFile);const cards=invalid.units[1].sections.flatMap((section:{cards:unknown[]})=>section.cards) as Array<{answerText:string;english:{grammarForm?:string}}>;
  delete cards.find(card=>card.answerText==="read"&&card.english.grammarForm==="past")!.english.grammarForm;
  expect(()=>validateSeedContents([invalid])).toThrow("DUPLICATE_SECTION_ANSWER");
});

test("标准英语只给填写形式；辅助只给白名单释义及留空语境",()=>{
  for(const [key,meta]of Object.entries(rawIndex)){
    const standard=englishListeningProjection(key,{version:1,mode:"standard",includeRecognition:false});
    expect(Object.keys(standard)).toEqual(["writingHint"]);
    const assisted=englishListeningProjection(key,{version:1,mode:"assisted",includeRecognition:false});
    expect(Object.keys(assisted.englishHints!)).toEqual(["meaningZh","exampleWithBlank","exampleTranslation"]);
    expect(assisted.englishHints!.exampleWithBlank).toContain("（　　）");
    expect(assisted.englishHints).not.toHaveProperty("phonetic");
    expect(assisted.englishHints).not.toHaveProperty("exampleSentence");
    expect(meta).toBeTruthy();
  }
  expect(englishListeningProjection(null,null)).toEqual({});
});

test("认读课仍有真实内容，默认排除可选新词但不冒充已学；开启后可选择",()=>{
  const catalog=[{id:"edition",publisher:"人教",series:"PEP",editionText:"test",subject:"english" as const,grade:3,volume:"上册",units:[{id:"unit",title:"Unit 1",order:1,sections:[{id:"section",title:"Part A",order:1}]}]}];
  const cards=[{id:"card",answerText:"name",subject:"english" as const,source:"builtin" as const,editionId:"edition",unitId:"unit",unitTitle:"Unit 1",sectionId:"section",startedChildIds:[],englishLearningTarget:"recognition" as const}];
  const section=buildCurriculumTree(cards,"child","english",catalog)[0]!.units[0]!.sections[0]!;
  expect(section).toMatchObject({totalCount:1,availableCount:0,excludedOptionalCount:1});
  expect(buildCurriculumTree(cards,"child","english",catalog,true)[0]!.units[0]!.sections[0]!.availableCount).toBe(1);
});
