import type { DbTransaction } from '@/db/client';
import { todoTasks } from './schema';
import { todayShanghai } from './validation';
export async function addDictationTodo(tx: DbTransaction, input: {
    id: string;
    familyId: string;
    childId: string;
    guardianId: string;
    createdAt: Date;
    gradingMode?: string;
    responseMode?: string;
}, count: number, title?: string) {
    await tx.insert(todoTasks).values({ familyId: input.familyId, childId: input.childId, guardianId: input.guardianId, commandId: input.id, title: title ? `${title}（${count}词）` : `今日听写（${count}项）`, requirements: input.responseMode==='keyboard'?'键盘听写：完成整轮交卷与错词订正，系统保留首次输入；完成后手动提交家长审核任务奖励。':input.gradingMode === 'parent' ? '听完后上传照片交给家长逐词批改，错词继续听写订正。全部完成后，请手动提交积分审核；可附上一张订正照片。' : '完成全部听写及错题订正后，请手动提交家长审核；可附上一张订正照片。', date: todayShanghai(input.createdAt), kind: 'dictation', dictationTaskId: input.id }).onConflictDoNothing();
}
