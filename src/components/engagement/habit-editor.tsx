'use client';
import { useState } from 'react';
import type { EngagementView } from '@/modules/engagement/types';
import { habitChangeDate } from '@/modules/engagement/habit-rules';
import { todayShanghai } from '@/modules/todos/validation';
export function HabitEditor({habit,pending,error,onSave,onClose}:{habit:EngagementView['habits'][number];pending:boolean;error:string;onSave:(body:Record<string,unknown>,notice?:string)=>Promise<boolean>;onClose:()=>void}){
 const initial=habit.pendingChange?.config??habit;
 const [schedule,setSchedule]=useState(initial.schedule);
 const date=habitChangeDate(todayShanghai(),habit.startDate);
 return <div className="growth-modal-backdrop"><section className="growth-modal habit-editor" role="dialog" aria-modal="true" aria-label="编辑重复习惯"><h2>编辑重复习惯</h2><p>{date} 起按新规则安排。今天已经生成的任务、提交和奖励保持原样，延期任务也保留原规则。</p>
  <form className="growth-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void onSave({action:'edit-habit',id:habit.id,expectedRevision:habit.revision,title:f.get('title'),requirements:f.get('requirements'),schedule,weekdays:f.getAll('weekday').map(Number),weeklyTarget:Number(f.get('weeklyTarget')??3),confirmation:f.get('confirmation'),coins:Number(f.get('coins')),growth:Number(f.get('growth'))},`习惯已更新，将于${date}起生效，历史任务保持不变。`).then(ok=>{if(ok)onClose()})}}>
    <label>习惯名称<input name="title" defaultValue={initial.title} maxLength={120} required/></label><label>完成要求<textarea name="requirements" defaultValue={initial.requirements} maxLength={2000}/></label>
    <label>重复方式<select value={schedule} onChange={e=>setSchedule(e.target.value as typeof schedule)}><option value="daily">每天</option><option value="weekdays">指定星期几</option><option value="weekly">每周完成几次</option></select></label>
    {schedule==='weekdays'&&<fieldset className="weekday-options"><legend>执行日</legend>{['日','一','二','三','四','五','六'].map((d,i)=><label key={i}><input type="checkbox" name="weekday" value={i} defaultChecked={initial.weekdays.includes(i)}/>周{d}</label>)}</fieldset>}
    {schedule==='weekly'&&<label>每周次数<input name="weeklyTarget" type="number" min={1} max={7} defaultValue={initial.weeklyTarget}/><small>本周已提交和已批准次数继续计入，不因编辑清零。</small></label>}
    <label>确认方式<select name="confirmation" defaultValue={initial.confirmation}><option value="parent">家长审核后发奖</option><option value="self">孩子自行确认后发奖</option></select></label>
    <div className="growth-form-row"><label>每次星币<input type="number" name="coins" min={0} max={10000} defaultValue={initial.coins} required/></label><label>每次基础成长值<input type="number" name="growth" min={0} max={10000} defaultValue={initial.growth} required/></label></div>
    {error&&<p role="alert" className="todo-error">{error}</p>}<div className="growth-actions"><button disabled={pending}>保存后续安排</button><button type="button" className="secondary-button" disabled={pending} onClick={onClose}>取消</button></div>
  </form>
 </section></div>;
}
