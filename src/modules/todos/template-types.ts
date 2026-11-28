import { z } from 'zod';
import { taskInputSchema } from './validation';
export const templateFieldsSchema=taskInputSchema.pick({title:true,requirements:true,rewardCoins:true,rewardGrowth:true,confirmation:true}).strict();
export type TaskTemplateFields=z.infer<typeof templateFieldsSchema>;
const base={commandId:z.string().uuid()};
export const templateCommandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),...base,fields:templateFieldsSchema}).strict(),
 z.object({action:z.literal('update'),...base,id:z.string().uuid(),revision:z.number().int().positive(),fields:templateFieldsSchema}).strict(),
 z.object({action:z.literal('delete'),...base,id:z.string().uuid(),revision:z.number().int().positive()}).strict(),
]);
export type TemplateCommand=z.input<typeof templateCommandSchema>;
export type TaskTemplate=TaskTemplateFields&{id:string;revision:number;createdAt:string;updatedAt:string};
export const defaultTemplateFields:TaskTemplateFields={title:'',requirements:'',rewardCoins:1,rewardGrowth:10,confirmation:'parent'};
export function templateFormFields(form:HTMLFormElement):TaskTemplateFields{
 const value=new FormData(form);return templateFieldsSchema.parse({title:String(value.get('title')??''),requirements:String(value.get('requirements')??''),rewardCoins:Number(value.get('rewardCoins')),rewardGrowth:Number(value.get('rewardGrowth')),confirmation:value.get('confirmation')});
}
