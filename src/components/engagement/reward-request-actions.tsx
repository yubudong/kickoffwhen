'use client';
import { useState } from 'react';
import type { FamilyRewardsView } from '@/modules/engagement/parent-workflows';
type Row=FamilyRewardsView['requests'][number];
type Decision={row:Row;decision:'approve'|'reject'|'complete'|'cancel'};
const labels:Record<string,string>={pending:'等待批准',approved:'待兑现',completed:'已兑现',rejected:'已拒绝',cancelled:'已取消'};
export function RewardRequestList({rows,pending,send,error}:{rows:Row[];pending:boolean;error?:string;send:(url:string,body:Record<string,unknown>,success?:string)=>Promise<boolean>}){
  const [confirm,setConfirm]=useState<Decision|null>(null);
  return <><div className="family-request-list">{rows.map(row=><article className="reward-request" key={row.request.id}>
    <div><strong>{row.childName} · {row.request.title}</strong><span className="request-state">{labels[row.request.status]}</span></div>
    <p>{row.request.price.toLocaleString()} 星币 · 申请于 {new Date(row.request.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</p>
    {row.request.note&&<p>备注：{row.request.note}</p>}
    <div className="growth-actions">{row.request.status==='pending'&&<><button disabled={pending} onClick={()=>setConfirm({row,decision:'approve'})}>批准</button><button disabled={pending} className="secondary-button" onClick={()=>setConfirm({row,decision:'reject'})}>拒绝</button></>}
    {row.request.status==='approved'&&<><button disabled={pending} onClick={()=>setConfirm({row,decision:'complete'})}>已兑现</button><button disabled={pending} className="secondary-button" onClick={()=>setConfirm({row,decision:'cancel'})}>取消并退款</button></>}</div>
  </article>)}</div>{!rows.length&&<p className="muted">暂时没有兑换记录。</p>}
  {confirm&&<div className="growth-modal-backdrop"><section className="growth-modal" role="dialog" aria-modal="true" aria-label="确认奖励处理">
    <h2>{confirm.row.childName} · {confirm.row.request.title}</h2>
    <p>{confirm.decision==='approve'?`批准后扣除已冻结的${confirm.row.request.price}星币，实际兑现后再标记完成。`:confirm.decision==='complete'?'请确认已经实际兑现这份奖励。':`本次${confirm.row.request.price}星币会退回可用余额。`}</p>
    <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void send('/api/parent/engagement',{action:'decide-reward',id:confirm.row.request.id,decision:confirm.decision,note:f.get('note')},'奖励状态已更新。').then(ok=>{if(ok)setConfirm(null)})}}>
      {error&&<p role="alert" className="todo-error">{error}</p>}<label>处理备注<input name="note" maxLength={500}/></label><div className="growth-actions"><button disabled={pending}>确认</button><button type="button" disabled={pending} className="secondary-button" onClick={()=>setConfirm(null)}>取消</button></div>
    </form>
  </section></div>}</>;
}
