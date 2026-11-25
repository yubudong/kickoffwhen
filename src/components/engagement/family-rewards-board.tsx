'use client';
import './engagement.css';
import './parent-workflows.css';
import Link from 'next/link';
import { useState } from 'react';
import type { FamilyRewardsView } from '@/modules/engagement/parent-workflows';
import { useParentView } from './use-parent-view';
import { RewardRequestList } from './reward-request-actions';
export function FamilyRewardsBoard(){
  const {data,error,notice,pending,send}=useParentView<FamilyRewardsView>('/api/parent/family-rewards');
  const [editing,setEditing]=useState<FamilyRewardsView['rewards'][number]|null>(null),[childId,setChildId]=useState('all');
  const selected=data?.balances.find(c=>c.childId===childId);
  return <div className="engagement-board parent-workflows"><header className="growth-heading"><div><p className="eyebrow">家庭公共设置</p><h1>家庭奖励</h1><p>奖励名称、价格和规则由全家共用；孩子的星币和兑换记录各自独立。</p></div><Link href="/parent" className="secondary-button">返回家长概览</Link></header>
    {error&&<p role="alert" className="todo-error">{error}</p>}{notice&&<p role="status" className="growth-notice">{notice}</p>}
    {!data?<p>正在读取家庭奖励…</p>:<>
      <section className="growth-panel" aria-label="全家共享奖励设置"><div className="shared-setting-label">全家共用 · 不随孩子筛选变化</div><h2>{editing?'编辑家庭奖励':'添加家庭奖励'}</h2>
        <form className="growth-form" key={editing?.id??'new'} onSubmit={e=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form);void send('/api/parent/engagement',{action:'save-reward',...(editing?{id:editing.id}:{}),title:f.get('title'),description:f.get('description'),price:Number(f.get('price')),repeatable:f.get('repeatable')==='yes',weeklyLimit:f.get('weeklyLimit')?Number(f.get('weeklyLimit')):null,active:f.get('active')==='on'},'全家共享奖励已保存，已申请的价格保持不变。').then(ok=>{if(ok){form.reset();setEditing(null)}})}}>
          <label>奖励名称<input name="title" maxLength={120} defaultValue={editing?.title} required/></label><label>奖励说明<textarea name="description" maxLength={2000} defaultValue={editing?.description}/></label>
          <div className="growth-form-row"><label>所需星币<input name="price" type="number" min={1} max={1000000} defaultValue={editing?.price??20} required/></label><label>可否重复<select name="repeatable" defaultValue={editing?.repeatable===false?'no':'yes'}><option value="yes">可以重复兑换</option><option value="no">每个孩子仅一次</option></select></label><label>每个孩子每周限次<input name="weeklyLimit" type="number" min={1} max={100} defaultValue={editing?.weeklyLimit??''} placeholder="留空不限次数"/></label></div>
          <label className="checkbox-label"><input name="active" type="checkbox" defaultChecked={editing?.active??true}/>允许孩子申请</label>
          <div className="growth-actions"><button disabled={pending}>{editing?'保存奖励':'添加奖励'}</button>{editing&&<button type="button" className="secondary-button" disabled={pending} onClick={()=>setEditing(null)}>取消编辑</button>}</div><small>保存影响全家可领取的目录；已有申请保留原名称和价格快照。</small>
        </form>
      </section>
      <section className="growth-panel"><h2>全家奖励清单</h2><div className="growth-item-grid">{data.rewards.map(r=><article key={r.id}><span className="shared-setting-label">{r.active?'全家可领取':'已暂停领取'}</span><h3>{r.title}</h3><p>{r.description}</p><strong>{r.price.toLocaleString()} 星币</strong><p>{r.repeatable?'可重复兑换':'每个孩子仅一次'}{r.weeklyLimit?` · 每个孩子每周${r.weeklyLimit}次`:''}</p><button disabled={pending} onClick={()=>setEditing(r)}>编辑奖励</button></article>)}</div>{!data.rewards.length&&<p>先为全家添加一份值得期待的奖励。</p>}</section>
      <section className="growth-panel" aria-label="个人余额与兑换记录"><div className="growth-heading"><div><h2>孩子的余额与兑换记录</h2><p>下面的筛选只影响个人信息，不改变上方全家奖励设置。</p></div><label>查看孩子<select aria-label="兑换记录孩子" value={childId} disabled={pending} onChange={e=>setChildId(e.target.value)}><option value="all">全部孩子</option>{data.balances.map(c=><option value={c.childId} key={c.childId}>{c.nickname}</option>)}</select></label></div>
        <div className="family-balance-grid">{(selected?[selected]:data.balances).map(c=><article key={c.childId}><h3>{c.nickname}</h3><strong>{c.available.toLocaleString()} 可用星币</strong><p>冻结 {c.held.toLocaleString()} · 待投喂成长 {c.growth.toLocaleString()}</p></article>)}</div>
        <RewardRequestList rows={data.requests.filter(r=>childId==='all'||r.request.childId===childId)} pending={pending} send={send} error={error}/>
        <small>展示最近200条家庭兑换记录。</small>
      </section>
    </>}
  </div>;
}
