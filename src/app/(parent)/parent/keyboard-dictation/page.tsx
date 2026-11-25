import { headers } from 'next/headers';
import { requireParentActor } from '@/modules/auth/parent-access';
import { keyboardParentReports } from '@/modules/dictation/keyboard-view';
import { KeyboardParentBoard } from '@/components/dictation/keyboard-parent-board';
export default async function KeyboardReportsPage(){const actor=await requireParentActor(await headers());return <main className="page-shell"><section className="hero-card dictation-review-shell"><p className="eyebrow">家长中心 · 英语</p><h1>键盘听写复核与报告</h1><p>查看首次输入和订正；只需确认系统标出的待复核写法。</p><KeyboardParentBoard initialReports={await keyboardParentReports(actor)}/></section></main>}
