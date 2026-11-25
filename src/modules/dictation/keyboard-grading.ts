import { normalizeEnglishSpelling } from '@/modules/learning-content/english-spelling';
import type { EnglishCardMetadata } from '@/modules/learning-content/english-types';
import type { KeyboardResult,KeyboardSnapshot } from './keyboard-types';
const variants=[['colour','color'],['colours','colors'],['colourful','colorful'],['centre','center'],['centres','centers'],['favourite','favorite'],['labour','labor'],['metre','meter'],['metres','meters'],['kilometre','kilometer'],['theatre','theater'],['neighbour','neighbor'],['neighbours','neighbors'],['grey','gray'],['travelling','traveling'],['travelled','traveled'],['maths','math'],['yoghurt','yogurt'],['pyjamas','pajamas'],['organise','organize'],['realise','realize'],['hard-working','hardworking']];
export function knownSpellingVariants(answer:string){
 const result=new Set<string>();
 for(const pair of variants)for(const from of pair){const match=new RegExp('(?<![A-Za-z])'+from.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![A-Za-z])','gi');if(match.test(answer))result.add(answer.replace(match,value=>{const to=pair.find(v=>v!==from)!;return value[0]===value[0].toUpperCase()?to[0].toUpperCase()+to.slice(1):to}))}
 return [...result];
}
export function createKeyboardSnapshot(answer:string,meta?:EnglishCardMetadata):KeyboardSnapshot{
 const isAbbreviation=meta?.kind==='abbreviation';
 const phrase=answer.includes(' ');
 // Unrestricted manual/OCR hints may contain the answer and are never copied.
 const redact=(text:string|undefined)=>text===undefined?undefined:[answer,...(meta?.spellingRules.acceptedAnswers??[]),...knownSpellingVariants(answer)].reduce((result,word)=>result.replace(new RegExp('(?<![A-Za-zÀ-ÖØ-öø-ÿ0-9])'+word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![A-Za-zÀ-ÖØ-öø-ÿ0-9])','giu'),'____'),text);
 const hints=meta?{meaningZh:redact(meta.meaningZh),exampleWithBlank:redact(meta.exampleWithBlank),exampleTranslation:redact(meta.exampleTranslation)}:undefined;
 return {version:1,answer,rules:meta?.spellingRules??{caseRule:/[A-Z]/.test(answer)?'required':'initial_optional',acceptedAnswers:[]},variants:knownSpellingVariants(answer),manualReview:!meta&&!/^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ0-9 .'-]{0,99}$/.test(answer),writingHint:isAbbreviation?'本题请写规范缩写。':phrase?'请写完整英文短语。':'请写完整英文单词。',...(hints?{hints}:{}),...(meta?{details:{meaningZh:meta.meaningZh,phonetic:meta.phonetic??null,exampleSentence:meta.exampleSentence??null,exampleWithBlank:meta.exampleWithBlank??null,exampleTranslation:meta.exampleTranslation??null,spellingRules:meta.spellingRules,kind:meta.kind,learningTarget:meta.learningTarget,sourceRole:meta.sourceRole,sourceWord:meta.sourceWord,...(meta.sourcePrintedPage!==undefined?{sourcePrintedPage:meta.sourcePrintedPage}:{})}}:{})};
}
function targets(values:string[],rule:KeyboardSnapshot['rules']){return values.flatMap(value=>{const s=normalizeEnglishSpelling(value);return rule.caseRule==='required'?[s]:[s,s.charAt(0).toUpperCase()+s.slice(1)]})}
export function gradeKeyboardAnswer(itemId:string,input:string,snapshot:KeyboardSnapshot):KeyboardResult{
 const value=normalizeEnglishSpelling(input);const valid=targets([snapshot.answer,...snapshot.rules.acceptedAnswers],snapshot.rules);const base={itemId,input};
 if(!value)return {...base,status:'incorrect',correct:false,reason:'blank'};
 if(snapshot.manualReview)return {...base,status:'pending',correct:null,reason:'manual'};
 if(valid.includes(value))return {...base,status:'correct',correct:true,reason:'match'};
 if(targets(snapshot.variants,snapshot.rules).includes(value))return {...base,status:'pending',correct:null,reason:'variant'};
 const reason=valid.some(v=>v.toLowerCase()===value.toLowerCase())?'case':valid.some(v=>v.replaceAll(' ','')===value.replaceAll(' ',''))?'spacing':'spelling';
 return {...base,status:'incorrect',correct:false,reason};
}
