import { and, eq } from 'drizzle-orm';
import type { DbTransaction } from '@/db/client';
import { todoTasks, todoSubmissions } from './schema';
import { todayShanghai } from './validation';
export async function addDictationTodo(tx: DbTransaction, input: {
    id: string;
    familyId: string;
    childId: string;
    guardianId: string;
    createdAt: Date;
}, count: number) {
    await tx.insert(todoTasks).values({ familyId: input.familyId, childId: input.childId, guardianId: input.guardianId, commandId: input.id, title: `今日听写（${count}项）`, requirements: '完成全部听写及错题订正，完成后自动提交家长审核。', date: todayShanghai(input.createdAt), kind: 'dictation', dictationTaskId: input.id }).onConflictDoNothing();
}
export async function submitDictationTodo(tx: DbTransaction, taskId: string, at: Date) {
    const [todo] = await tx.select().from(todoTasks).where(and(eq(todoTasks.dictationTaskId, taskId), eq(todoTasks.status, 'open'))).for('update');
    if (!todo)
        return;
    await tx.insert(todoSubmissions).values({ todoId: todo.id, number: todo.submissionNumber + 1, submittedAt: at });
    await tx.update(todoTasks).set({ status: 'submitted', submissionNumber: todo.submissionNumber + 1, updatedAt: at }).where(eq(todoTasks.id, todo.id));
}
