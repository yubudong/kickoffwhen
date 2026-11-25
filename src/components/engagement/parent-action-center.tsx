'use client';
import './engagement.css';
import './parent-workflows.css';
import Link from 'next/link';
import type { ParentActionsView } from '@/modules/engagement/parent-workflows';
import { useParentView } from './use-parent-view';
import { RewardRequestList } from './reward-request-actions';
export function ParentActionCenter(){
 const {data,error,notice,pending,send,setError}=useParentView<ParentActionsView>('/api/parent/actions');
 return <div className="engagement-board parent-workflows"><header className="growth-heading"><div><p className="eyebrow">今天需要你确认的事</p><h1>家长中心</h1><p>集中处理任务审核、听写批改和家庭奖励，不遗漏孩子的努力。</p></div><div className="growth-actions"><Link href="/parent/growth" className="secondary-button">管理重复习惯</Link><Link href="/parent/rewards" className="secondary-button">全家奖励设置</Link></div></header>
  {error&&<p className="todo-error" role="alert">{error}</p>}{notice&&<p className="growth-notice" role="status">{notice}</p>}
  {!data?<p>正在整理待处理事项…</p>:<>
   <nav className="action-summary" aria-label="待处理统计">{[['tasks','任务待审核','#task-reviews'],['photos','听写待批改','#photo-reviews'],['pending','兑换待批准','#reward-approvals'],['approved','奖励待兑现','#reward-deliveries']].map(([key,title,href])=><a key={key} href={href}><span>{title}</span><strong>{data.counts[key as keyof typeof data.counts]}</strong></a>)}</nav>
   <section className="growth-panel" id="task-reviews"><h2>任务待审核 · {data.counts.tasks}</h2><p>核对本次提交，再按任务原定奖励发放。听写照片批改完成后，仍在这里审核待办奖励。</p>
    {data.tasks.map(({task,childName,attachmentId,mimeType})=><article key={task.id} className="action-task" aria-label={`${childName}的${task.title}`}><header><h3>{task.title}</h3><span>{childName} · {task.date} · 第{task.submissionNumber}次提交</span></header><p>{task.requirements||'完成后由家长确认。'}</p><p>任务奖励：{task.rewardCoins}星币 · {task.rewardGrowth}基础成长值{task.submittedBoost?` · 提交时加成${task.submittedBoost}%`:''}</p>
      {attachmentId?<a className="evidence-link" href={`/api/todo-attachments/${attachmentId}`} target="_blank" rel="noreferrer">查看{mimeType?.startsWith('image/')?'图片':mimeType?.startsWith('audio/')?'音频':'视频'}凭证 ↗</a>:<small>本次未附带凭证。</small>}
      <form className="growth-form" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget),decision=((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement).value,note=String(form.get('note')??'');if(decision==='rejected'&&!note.trim()){setError('退回任务请填写原因，方便孩子订正。');return}void send('/api/parent/todos',{action:'review',id:task.id,number:task.submissionNumber,decision,note,bonus:Number(form.get('bonus')??0)},decision==='approved'?'已审核通过，奖励已按原任务发放。':'已退回，孩子可以查看原因后重新提交。')}}>
        <div className="growth-form-row"><label>额外星币<input name="bonus" type="number" min={0} max={10000} defaultValue={0}/></label><label>审核备注<input name="note" maxLength={2000} placeholder="退回时必填原因"/></label></div><div className="growth-actions"><button name="decision" value="approved" disabled={pending}>通过并发奖</button><button name="decision" value="rejected" disabled={pending} className="secondary-button">退回修改</button></div>
      </form></article>)}{!data.tasks.length&&<p className="empty-state">没有待审核任务，孩子的努力都已收到回应。</p>}{data.counts.tasks>data.tasks.length&&<Link href="/parent/todos">这里显示前100项，前往待办清单查看更多</Link>}
   </section>
   <section className="growth-panel" id="photo-reviews"><h2>听写照片待批改 · {data.counts.photos}</h2>{data.photos.map(p=><article key={p.sessionId} className="action-task"><h3>{p.childName} · 第{p.roundNumber}轮听写</h3><p>{new Date(p.submittedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}提交</p><Link href={`/parent/dictation-reviews#review-${p.sessionId}`} className="secondary-button">查看照片并逐词批改</Link></article>)}{!data.photos.length&&<p className="empty-state">暂时没有等待批改的听写照片。</p>}</section>
   <section className="growth-panel" id="reward-approvals"><h2>兑换待批准 · {data.counts.pending}</h2><RewardRequestList rows={data.requests.filter(r=>r.request.status==='pending')} pending={pending} send={send} error={error}/></section>
   <section className="growth-panel" id="reward-deliveries"><h2>奖励待兑现 · {data.counts.approved}</h2><p>实际提供约定的奖励后，再点击“已兑现”。</p><RewardRequestList rows={data.requests.filter(r=>r.request.status==='approved')} pending={pending} send={send} error={error}/></section>
  </>}
 </div>;
}
