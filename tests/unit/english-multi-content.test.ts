import { readFileSync } from 'node:fs';
import { expect,test } from 'vitest';
import { multiEnglishManifest,multiEnglishInfo } from '@/modules/learning-content/english-multi-catalog';
import { assertMultiEnglishAudit,type MultiEnglishReference } from '@/modules/learning-content/english-multi-audit';
import { validateSeedContents } from '@/modules/learning-content/seed-validator';
import { getEnglishMetadata,englishListeningProjection,englishGradingDetails } from '@/modules/learning-content/english-metadata';
import { englishCardMetadataSchema,englishTargetLabel } from '@/modules/learning-content/english-types';
import { checkEnglishSpelling } from '@/modules/learning-content/english-spelling';
const load=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
test('其他23系列170册独立绑定来源与单元，稳定标识不碰撞PEP',()=>{
 expect(multiEnglishManifest.books).toHaveLength(170);expect(new Set(multiEnglishManifest.books.map(b=>b.seriesKey)).size).toBe(23);
 const keys=new Set<string>();let total=0;
 for(const book of multiEnglishManifest.books){
  const [content]=validateSeedContents([load(book.seedFile)]);const reference=load(book.referenceFile) as MultiEnglishReference;
  expect(assertMultiEnglishAudit(content,reference).cards).toBe(book.cardCount);expect(reference.source.resourceId).toBe(book.resourceId);
  expect(reference.review.unresolvedRows).toBe(0);
  for(const u of content.units)for(const s of u.sections)for(const card of s.cards){expect(keys.has(card.builtinKey)).toBe(false);keys.add(card.builtinKey);expect(card.builtinKey.startsWith('en-pep-')).toBe(false);expect(getEnglishMetadata(card.builtinKey)).toEqual(card.english);total++}
 }
 expect(total).toBe(19553);expect(keys.size).toBe(total);
});
test('同年级同册次的出版社和系列不会串教材说明',()=>{
 for(const book of multiEnglishManifest.books){const input={...book,subject:'english',volume:book.volumeText};expect(multiEnglishInfo(input)?.resourceId).toBe(book.resourceId);expect(multiEnglishInfo({subject:'english',grade:book.grade,volume:book.volumeText,label:[book.publisher,book.series,book.editionText].join(' · ')})?.resourceId).toBe(book.resourceId);expect(multiEnglishInfo({...input,publisher:'其他出版社'})).toBeUndefined();expect(multiEnglishInfo({...input,series:'其他系列'})).toBeUndefined()}
});
test('不补造例句，标准听写不暴露中文答案音标，辅助模式只投影提示',()=>{
 const book=multiEnglishManifest.books[0];const [content]=validateSeedContents([load(book.seedFile)]);const card=content.units.flatMap(u=>u.sections.flatMap(s=>s.cards))[0];const meta=getEnglishMetadata(card.builtinKey)!;
 expect(meta.version).toBe(2);expect(englishTargetLabel(meta)).toContain('教材词表');expect(meta.exampleSentence).toBeUndefined();
 const standard=englishListeningProjection(card.builtinKey,{version:1,mode:'standard',includeRecognition:false});expect(standard).not.toHaveProperty('englishHints');expect(JSON.stringify(standard)).not.toContain(card.answerText);
 const assisted=englishListeningProjection(card.builtinKey,{version:1,mode:'assisted',includeRecognition:false});expect(assisted.englishHints?.meaningZh).toBe(meta.meaningZh);expect(assisted.englishHints).not.toHaveProperty('phonetic');expect(assisted.englishHints).not.toHaveProperty('exampleSentence');expect(englishGradingDetails(card.builtinKey)?.exampleSentence).toBeNull();
});
test('来源、目录或已核对释义被改动会拒绝导入',()=>{
 const book=multiEnglishManifest.books[0];const raw=load(book.seedFile);const reference=load(book.referenceFile) as MultiEnglishReference;
 const source=structuredClone(reference);source.source.resourceId='different';expect(()=>assertMultiEnglishAudit(validateSeedContents([raw])[0],source)).toThrow('SOURCE');
 const altered=structuredClone(raw);altered.units[0].sections[0].cards[0].english.meaningZh='另一个释义';expect(()=>assertMultiEnglishAudit(validateSeedContents([altered])[0],reference)).toThrow('MISMATCH');
 const missing=structuredClone(reference);missing.source.evidence=[];expect(()=>assertMultiEnglishAudit(validateSeedContents([raw])[0],missing)).toThrow('EVIDENCE');
});
test('原PEP元数据仍要求v1完整语境，新资料v2允许没有例句',()=>{
 const old=load('content/seed/english-official-grade3-volume1.json');const card=old.units[0].sections[0].cards[0];card.english.version=2;card.english.learningTarget='vocabulary';expect(()=>validateSeedContents([old])).toThrow('PEP_METADATA_VERSION');
 const m=englishCardMetadataSchema.parse({version:2,learningTarget:'vocabulary',meaningZh:'咖啡馆',sourceWord:'café',sourceRole:'head',sourceImagePage:1,kind:'word',spellingRules:{caseRule:'initial_optional',acceptedAnswers:[]}});expect(m).not.toHaveProperty('exampleSentence');expect(checkEnglishSpelling('café','café',m.spellingRules).correct).toBe(true);
});
