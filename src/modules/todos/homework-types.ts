import { z } from 'zod';
const uuid=z.string().uuid();
export const rotationSchema=z.union([z.literal(0),z.literal(90),z.literal(180),z.literal(270)]);
const point=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1)}).strict();
export const markSchema=z.object({id:uuid,tool:z.enum(['pen','ellipse','line','arrow','number','text']),points:z.array(point).min(1).max(800),text:z.string().max(300).default(''),color:z.enum(['red','blue','green']).default('red')}).strict();
export type HomeworkMark=z.infer<typeof markSchema>;
export const annotationPageSchema=z.object({pageKey:uuid,marks:z.array(markSchema).max(100),note:z.string().trim().max(1000)}).strict();
export type AnnotationPage=z.infer<typeof annotationPageSchema>;
export const reviewDocumentSchema=z.object({note:z.string().trim().max(2000),pages:z.array(annotationPageSchema).max(20)}).strict();
export type ReviewDocument=z.infer<typeof reviewDocumentSchema>;
export const homeworkSubmitSchema=z.object({commandId:uuid,number:z.number().int().nonnegative(),expectedUpdatedAt:z.iso.datetime(),note:z.string().trim().max(2000).default(''),pages:z.array(z.object({pageKey:uuid,attachmentId:uuid,rotation:rotationSchema,parentPageKey:uuid.nullable().default(null)}).strict()).min(1).max(20)}).strict();
export type HomeworkSubmit=z.infer<typeof homeworkSubmitSchema>;
const reviewBase={commandId:uuid,number:z.number().int().positive(),expectedUpdatedAt:z.iso.datetime(),revision:z.number().int().nonnegative(),document:reviewDocumentSchema};
export const homeworkReviewSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('draft'),...reviewBase}).strict(),
 z.object({type:z.literal('publish'),...reviewBase,decision:z.enum(['approved','rejected']),bonus:z.number().int().min(0).max(10000)}).strict(),
]);
export type HomeworkReviewCommand=z.infer<typeof homeworkReviewSchema>;
export type HomeworkPage={pageKey:string;attachmentId:string;mimeType:string;byteSize:number;rotation:0|90|180|270;parentPageKey:string|null;position:number};
export type HomeworkRound={number:number;submittedAt:string;note:string;pages:HomeworkPage[];review:null|{decision:string;note:string;reviewedAt:string;document:ReviewDocument}};
export type HomeworkView={task:{id:string;title:string;requirements:string;date:string;status:string;submissionNumber:number;updatedAt:string;reviewNote:string;rewardCoins:number;rewardGrowth:number;confirmation:string;kind:string;childName:string;canSubmit:boolean};rounds:HomeworkRound[];draft?:{revision:number;document:ReviewDocument;savedAt:string}|null};
export type CorrectionTask={id:string;title:string;date:string;reviewNote:string;submissionNumber:number};
export function homeworkDocumentText(document:ReviewDocument,pageKeys?:string[]){return [document.note,...document.pages.filter(p=>p.note).map((p,i)=>`第${pageKeys?Math.max(1,pageKeys.indexOf(p.pageKey)+1):i+1}页要求：${p.note}`)].filter(Boolean).join('\n').slice(0,2000)}
export function validateReviewDocument(document:ReviewDocument,pageKeys:string[]){
 const seen=new Set<string>();let points=0;
 for(const p of document.pages){if(!pageKeys.includes(p.pageKey)||seen.has(p.pageKey))throw new Error('HOMEWORK_PAGE_SCOPE');seen.add(p.pageKey);const ids=new Set<string>();for(const mark of p.marks){if(ids.has(mark.id))throw new Error('HOMEWORK_MARK_DUPLICATE');ids.add(mark.id);points+=mark.points.length;if(['ellipse','line','arrow'].includes(mark.tool)&&mark.points.length!==2)throw new Error('HOMEWORK_MARK_INVALID');if(['number','text'].includes(mark.tool)&&(!mark.text.trim()||mark.points.length!==1))throw new Error('HOMEWORK_MARK_INVALID')}}
 if(points>30000)throw new Error('HOMEWORK_MARK_LIMIT');
}
