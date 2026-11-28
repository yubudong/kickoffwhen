import { createHash } from 'node:crypto';
import { and,desc,eq,isNull,sql } from 'drizzle-orm';
import { db,type DbTransaction } from '@/db/client';
import type { GuardianActor } from '@/modules/auth/actor';
import { families,guardians } from '@/modules/families/schema';
import { taskTemplates } from './template-schema';
import { templateCommandSchema,type TemplateCommand,type TaskTemplate } from './template-types';
type Database=typeof db|DbTransaction;
function publicTemplate(t:typeof taskTemplates.$inferSelect):TaskTemplate{return {id:t.id,title:t.title,requirements:t.requirements,rewardCoins:t.rewardCoins,rewardGrowth:t.rewardGrowth,confirmation:t.confirmation as TaskTemplate['confirmation'],revision:t.revision,createdAt:t.createdAt.toISOString(),updatedAt:t.updatedAt.toISOString()}}
export function createTaskTemplateService(database:Database=db){
 async function authorize(actor:GuardianActor,tx:Database=database){if(actor.role!=='guardian')throw new Error('FORBIDDEN');const [member]=await tx.select({id:guardians.id}).from(guardians).where(and(eq(guardians.id,actor.guardianId),eq(guardians.familyId,actor.familyId))).limit(1);if(!member)throw new Error('FORBIDDEN')}
 async function list(actor:GuardianActor){await authorize(actor);return (await database.select().from(taskTemplates).where(and(eq(taskTemplates.familyId,actor.familyId),isNull(taskTemplates.deletedAt))).orderBy(desc(taskTemplates.updatedAt),desc(taskTemplates.id)).limit(200)).map(publicTemplate)}
 async function mutate(actor:GuardianActor,raw:TemplateCommand){
  if(actor.role!=='guardian')throw new Error('FORBIDDEN');const input=templateCommandSchema.parse(raw),fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return database.transaction(async tx=>{
   await authorize(actor,tx);const [family]=await tx.select({id:families.id}).from(families).where(eq(families.id,actor.familyId)).for('update');if(!family)throw new Error('FORBIDDEN');
   if(input.action==='create'){
    const [old]=await tx.select().from(taskTemplates).where(and(eq(taskTemplates.familyId,actor.familyId),eq(taskTemplates.commandId,input.commandId))).limit(1);if(old){if(old.inputFingerprint!==fingerprint)throw new Error('TEMPLATE_COMMAND_CONFLICT');return old.deletedAt?null:publicTemplate(old)}
    const [count]=await tx.select({n:sql<number>`count(*)::int`}).from(taskTemplates).where(and(eq(taskTemplates.familyId,actor.familyId),isNull(taskTemplates.deletedAt)));if(count.n>=200)throw new Error('TEMPLATE_LIMIT');
    const [created]=await tx.insert(taskTemplates).values({familyId:actor.familyId,guardianId:actor.guardianId,commandId:input.commandId,inputFingerprint:fingerprint,lastCommandId:input.commandId,lastFingerprint:fingerprint,...input.fields}).returning();return publicTemplate(created);
   }
   const [old]=await tx.select().from(taskTemplates).where(and(eq(taskTemplates.id,input.id),eq(taskTemplates.familyId,actor.familyId))).for('update');if(!old)throw new Error('TEMPLATE_NOT_FOUND');
   if(old.lastCommandId===input.commandId){if(old.lastFingerprint!==fingerprint)throw new Error('TEMPLATE_COMMAND_CONFLICT');return old.deletedAt?null:publicTemplate(old)}
   if(old.deletedAt||old.revision!==input.revision)throw new Error('TEMPLATE_STALE');
   const at=new Date(Math.max(Date.now(),old.updatedAt.getTime()+1));const [updated]=await tx.update(taskTemplates).set({...(input.action==='update'?input.fields:{deletedAt:at}),revision:old.revision+1,lastCommandId:input.commandId,lastFingerprint:fingerprint,updatedAt:at}).where(eq(taskTemplates.id,old.id)).returning();return updated.deletedAt?null:publicTemplate(updated);
  });
 }
 return {list,mutate};
}
