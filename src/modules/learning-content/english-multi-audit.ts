import { createHash } from 'node:crypto';
import approved from '../../../content/english-multi/metadata.json';
import type { SeedContent } from './seed-validator';
import { englishCardMetadataSchema } from './english-types';
export type MultiEnglishReference={auditProfile:'verified_english';publisher:string;series:string;subject:'english';grade:number;volume:string;editionText:string;source:{provider:string;resourceId:string;url:string;activeImageBase:string;evidence:Array<{imagePage:number;url:string;sha256:string;role:string}>};unitTitles:string[];entries:Array<{builtinKey:string;answerText:string;broadcastText:string;unitOrder:number;sectionKey:string;sourceWord:string;sourceImagePage:number;meaningZh:string;metadataDigest:string}>;review:{status:'verified';vocabularyPages:number[];unresolvedRows:number;notes:string[]}};
function stable(value:unknown):unknown{if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,stable(v)]));return value}
export function multiEnglishDigest(value:unknown){return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')}
export function validateMultiEnglishMetadata(content:SeedContent){
 if(content.subject!=='english'||content.grade<1||content.grade>6)throw new Error('MULTI_ENGLISH_SCOPE_INVALID');
 for(const unit of content.units)for(const section of unit.sections)for(const card of section.cards){
  const meta=englishCardMetadataSchema.parse(card.english);
  if(meta.version!==2||meta.learningTarget!=='vocabulary')throw new Error('MULTI_ENGLISH_METADATA_REQUIRED');
  if(!/^en-multi-[a-z0-9-]+-g[1-6]-v[12]-u\d+-l\d+-[0-9a-f]{14}$/.test(card.builtinKey))throw new Error('MULTI_ENGLISH_KEY_INVALID');
  if(!/^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ0-9 .'-]*$/u.test(card.answerText)||/[\u4e00-\u9fff]/.test(card.broadcastText)||card.broadcastText.length>500)throw new Error('MULTI_ENGLISH_TEXT_INVALID');
  if(meta.exampleWithBlank&&((meta.exampleWithBlank.match(/（　　）/g)??[]).length!==1||meta.exampleWithBlank.toLowerCase().includes(card.answerText.toLowerCase())))throw new Error('MULTI_ENGLISH_EXAMPLE_INVALID');
  if(meta.pronunciation&&meta.pronunciation.target!==card.answerText)throw new Error('MULTI_ENGLISH_PRONUNCIATION_MISMATCH');
  if(card.broadcastText!==(meta.spokenContext?card.answerText+(card.answerText.endsWith('.')?' ':'. ')+meta.spokenContext:card.answerText))throw new Error('MULTI_ENGLISH_BROADCAST_MISMATCH');
  if(card.pinyinText||card.curriculumSource)throw new Error('MULTI_ENGLISH_CHINESE_FIELD_INVALID');
 }
}
export function assertMultiEnglishAudit(content:SeedContent,reference:MultiEnglishReference){
 validateMultiEnglishMetadata(content);
 if(content.auditProfile!=='verified_english'||reference.auditProfile!=='verified_english'||reference.subject!=='english')throw new Error('MULTI_ENGLISH_PROFILE_INVALID');
 for(const key of ['publisher','series','grade','volume','editionText'] as const)if(content[key]!==reference[key])throw new Error('MULTI_ENGLISH_IDENTITY_MISMATCH');
 const source=reference.source;
 if(source.provider!=='国家中小学智慧教育平台'||!/^https:\/\/basic\.smartedu\.cn\//.test(source.url)||!source.url.includes(source.resourceId)||!/^https:\/\/r[123]-ndr\.ykt\.cbern\.com\.cn\/edu_product\/esp\/assets\//.test(source.activeImageBase))throw new Error('MULTI_ENGLISH_SOURCE_INVALID');
 for(const page of source.evidence)if(!/^https:\/\/r[123]-ndr\.ykt\.cbern\.com\.cn\/edu_product\/esp\/assets\//.test(page.url)||!page.url.endsWith('/'+page.imagePage+'.jpg')||!/^[a-f0-9]{64}$/.test(page.sha256))throw new Error('MULTI_ENGLISH_EVIDENCE_URL_INVALID');
 if(reference.review.status!=='verified'||reference.review.unresolvedRows!==0||!reference.review.vocabularyPages.length)throw new Error('MULTI_ENGLISH_REVIEW_INCOMPLETE');
 if(content.units.map(u=>u.title).join('\0')!==reference.unitTitles.join('\0'))throw new Error('MULTI_ENGLISH_UNIT_MISMATCH');
 const entries=new Map(reference.entries.map(e=>[e.builtinKey,e]));let count=0;
 for(const unit of content.units)for(const section of unit.sections)for(const card of section.cards){
  const meta=card.english!,entry=entries.get(card.builtinKey),indexed=(approved as Record<string,unknown>)[card.builtinKey];count++;
  if(!indexed)throw new Error('MULTI_ENGLISH_RUNTIME_INDEX_MISSING');
  if(!entry||entry.answerText!==card.answerText||entry.broadcastText!==card.broadcastText||entry.unitOrder!==unit.order||entry.sectionKey!==section.key||entry.sourceWord!==meta.sourceWord||entry.sourceImagePage!==meta.sourceImagePage||entry.meaningZh!==meta.meaningZh||entry.metadataDigest!==multiEnglishDigest(meta)||multiEnglishDigest(indexed)!==entry.metadataDigest)throw new Error('MULTI_ENGLISH_CARD_MISMATCH:'+card.builtinKey);
  const evidence=source.evidence.find(p=>p.imagePage===meta.sourceImagePage&&p.role==='vocabulary');if(!evidence||!reference.review.vocabularyPages.includes(meta.sourceImagePage)||!evidence.url.endsWith('/'+meta.sourceImagePage+'.jpg')||!/^[a-f0-9]{64}$/.test(evidence.sha256))throw new Error('MULTI_ENGLISH_PAGE_EVIDENCE_MISSING');
 }
 if(!count||count!==reference.entries.length||entries.size!==count)throw new Error('MULTI_ENGLISH_COVERAGE_MISMATCH');
 return {cards:count};
}
