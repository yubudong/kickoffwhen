import type { DbTransaction } from '@/db/client';
import { todoTasks } from './schema';
import { todayShanghai } from './validation';
export async function addDictationTodo(tx: DbTransaction, input: {
    id: string;
    familyId: string;
    childId: string;
    guardianId: string;
    createdAt: Date;
}, count: number, title?: string) {
    await tx.insert(todoTasks).values({ familyId: input.familyId, childId: input.childId, guardianId: input.guardianId, commandId: input.id, title: title ? `${title}（${count}词）` : `今日听写（${count}项）`, requirements: '完成全部听写及错题订正后，请手动提交家长审核；可附上一张订正照片。', date: todayShanghai(input.createdAt), kind: 'dictation', dictationTaskId: input.id }).onConflictDoNothing();
}
