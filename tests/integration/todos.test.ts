import { expect,test } from 'vitest';
import { withDatabaseRollback } from '../helpers/database';
import { user } from '@/modules/auth/schema';
import { families,guardians,children } from '@/modules/families/schema';
import { createTodoService } from '@/modules/todos/service';
import { learningTasks } from '@/modules/dictation/task-schema';
import { todoTasks, todoSubmissions } from '@/modules/todos/schema';
import { eq } from 'drizzle-orm';

test('听写待办仅在听写完成后提交，附件可省略或为图片',async()=>withDatabaseRollback(async tx=>{
 const id=crypto.randomUUID();await tx.insert(user).values({id,name:'听写待办测试',email:id+'@example.test'});
 const [family]=await tx.insert(families).values({name:'听写待办测试'}).returning();
 const [guardian]=await tx.insert(guardians).values({familyId:family.id,authUserId:id}).returning();
 const [child]=await tx.insert(children).values({familyId:family.id,nickname:'甲',grade:5}).returning();
 const actor={role:'child' as const,familyId:family.id,childId:child.id,deviceId:crypto.randomUUID()};
 const service=createTodoService(tx);
 async function makeDictationTodo(status:'active'|'completed') {
  const [task]=await tx.insert(learningTasks).values({
   familyId:family.id,childId:child.id,guardianId:guardian.id,commandId:crypto.randomUUID(),
   inputFingerprint:'a'.repeat(64),mode:'continuous_batch',taskOrder:'source',intervalSeconds:8,
   repeatCount:1,speechRate:'1',allowManualReplay:true,maxReviewCards:0,status,
  }).returning();
  const [todo]=await tx.insert(todoTasks).values({
   familyId:family.id,childId:child.id,guardianId:guardian.id,commandId:crypto.randomUUID(),
   title:'今日听写',date:'2026-09-22',kind:'dictation',dictationTaskId:task.id,
  }).returning();
  return todo;
 }
 const incomplete=await makeDictationTodo('active');
 await expect(service.submit(actor,incomplete.id,0)).rejects.toThrow('DICTATION_INCOMPLETE');
 const noPhoto=await makeDictationTodo('completed');
 await service.submit(actor,noPhoto.id,0);
 expect((await tx.select().from(todoSubmissions).where(eq(todoSubmissions.todoId,noPhoto.id)))[0]).toMatchObject({number:1,attachmentId:null});
 const photo=await makeDictationTodo('completed');
 const image={id:crypto.randomUUID(),mimeType:'image/png',byteSize:100};
 await service.submit(actor,photo.id,0,image);
 expect((await tx.select().from(todoSubmissions).where(eq(todoSubmissions.todoId,photo.id)))[0]).toMatchObject({number:1,attachmentId:image.id,mimeType:image.mimeType,byteSize:image.byteSize});
 const audio=await makeDictationTodo('completed');
 await expect(service.submit(actor,audio.id,0,{id:crypto.randomUUID(),mimeType:'audio/mpeg',byteSize:100})).rejects.toThrow('DICTATION_IMAGE_ONLY');
 expect((await tx.select().from(todoTasks).where(eq(todoTasks.id,audio.id)))[0]).toMatchObject({status:'open',submissionNumber:0});
 expect(await tx.select().from(todoSubmissions).where(eq(todoSubmissions.todoId,audio.id))).toHaveLength(0);
}));
test('待办退回后重提、审核发积分且重复审核不重复发放，孩子隔离',async()=>withDatabaseRollback(async tx=>{
 const id=crypto.randomUUID();await tx.insert(user).values({id,name:'测试',email:id+'@example.test'});
 const [f]=await tx.insert(families).values({name:'待办测试'}).returning();
 const [g]=await tx.insert(guardians).values({familyId:f.id,authUserId:id}).returning();
 const [c,sibling]=await tx.insert(children).values([{familyId:f.id,nickname:'甲',grade:5},{familyId:f.id,nickname:'乙',grade:5}]).returning();
 const parent={role:'guardian' as const,familyId:f.id,guardianId:g.id};
 const child={role:'child' as const,familyId:f.id,childId:c.id,deviceId:crypto.randomUUID()};
 const service=createTodoService(tx);
 const task=await service.create(parent,{childId:c.id,title:'阅读',requirements:'20分钟',date:'2026-09-22',commandId:crypto.randomUUID()});
 await expect(service.submit({...child,childId:sibling.id},task.id,0)).rejects.toThrow('TODO_NOT_FOUND');
 await service.submit(child,task.id,0);
 await service.review(parent,task.id,{number:1,decision:'rejected',bonus:0,note:'请补充'});
 expect((await service.list(child,'2026-09-22')).points).toBe(0);
 const attachment={id:crypto.randomUUID(),mimeType:"image/png",byteSize:100};
 await service.submit(child,task.id,1,attachment);
 expect(await service.attachment(child,attachment.id)).toMatchObject(attachment);
 await expect(service.attachment({...child,childId:sibling.id},attachment.id)).rejects.toThrow("TODO_NOT_FOUND");
 await expect(service.attachment({...parent,familyId:crypto.randomUUID()},attachment.id)).rejects.toThrow("TODO_NOT_FOUND");
 await expect(service.review(parent,task.id,{number:1,decision:'approved',bonus:3,note:''})).rejects.toThrow('TODO_STALE');
 await service.review(parent,task.id,{number:2,decision:'approved',bonus:3,note:''});
 await service.review(parent,task.id,{number:2,decision:'approved',bonus:3,note:''});
 const result=await service.list(child,'2026-09-22');expect(result.points).toBe(4);expect(result.tasks[0].status).toBe('approved');
 expect((await service.list({...child,childId:sibling.id},'2026-09-22')).tasks).toHaveLength(0);
}));

test('并发审核通过只发一次积分，跨家庭审核被拒绝',async()=>{
 const {db}=await import('@/db/client');const service=createTodoService(db);const id=crypto.randomUUID();
 await db.insert(user).values({id,name:'并发测试',email:id+'@example.test'});
 const [f]=await db.insert(families).values({name:'并发隔离测试'}).returning();
 const [g]=await db.insert(guardians).values({familyId:f.id,authUserId:id}).returning();
 const [c]=await db.insert(children).values({familyId:f.id,nickname:'测试',grade:5}).returning();
 const parent={role:'guardian' as const,familyId:f.id,guardianId:g.id};const child={role:'child' as const,familyId:f.id,childId:c.id,deviceId:crypto.randomUUID()};
 const t=await service.create(parent,{childId:c.id,title:'整理',date:'2026-09-22',commandId:crypto.randomUUID()});await service.submit(child,t.id,0);
 await expect(service.review({...parent,familyId:crypto.randomUUID()},t.id,{number:1,decision:'approved',bonus:7,note:''})).rejects.toThrow('TODO_NOT_FOUND');
 await Promise.all([service.review(parent,t.id,{number:1,decision:'approved',bonus:7,note:''}),service.review(parent,t.id,{number:1,decision:'approved',bonus:7,note:''})]);
 expect((await service.list(child,'2026-09-22')).points).toBe(8);
});
