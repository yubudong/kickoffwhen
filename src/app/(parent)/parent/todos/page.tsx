import { headers } from 'next/headers';
import { requireParentActor } from '@/modules/auth/parent-access';
import { listChildren } from '@/modules/families/service';
import { TodoBoard } from '@/components/todos/todo-board';
export default async function TodosPage() { const actor = await requireParentActor(await headers()); const children = await listChildren(actor); return <main className="page-shell"><section className="hero-card"><p className="eyebrow">家长中心</p><h1>今日待办清单</h1><p>给孩子布置任务，查看提交资料，审核后发放基础积分和奖励积分。</p><TodoBoard role="parent" childOptions={children}/></section></main>; }
