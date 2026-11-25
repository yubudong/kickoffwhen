'use client';
import Link from 'next/link';
import { useEffect,useState } from 'react';
import type { HomeworkView,CorrectionTask } from '@/modules/todos/homework-types';
import { HomeworkUpload } from './homework-upload';
import './homework.css';
export function HomeworkInlineUpload({taskId,onSubmitted}:{taskId:string;onSubmitted:()=>void}){
 const [view,setView]=useState<HomeworkView|null>(null),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();void(async()=>{try{const r=await fetch(`/api/child/homework/${taskId}`,{cache:'no-store',signal:controller.signal});const data=await r.json();if(!r.ok)throw new Error(data.error);if(!controller.signal.aborted)setView(data)}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'无法读取作业。')}})();return()=>controller.abort()},[taskId]);
 return <div>{error&&<p role="alert">{error}</p>}{view?view.task.canSubmit?<HomeworkUpload view={view} onSubmitted={next=>{setView(next);onSubmitted()}}/>:<p>任务状态已更新，请刷新清单。</p>:!error&&<p>正在读取作业页…</p>}<Link className="hw-inline-link" href={`/child/homework/${taskId}`}>打开完整作业与订正记录 →</Link></div>;
}
export function CorrectionInbox(){
 const [tasks,setTasks]=useState<CorrectionTask[]>([]),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;const refresh=async()=>{try{const r=await fetch('/api/child/homework',{cache:'no-store',signal:controller.signal});const data=await r.json();if(r.ok&&!controller.signal.aborted){setTasks(data.tasks);setError('')}else if(!controller.signal.aborted)setError('暂时无法读取待订正作业。')}catch{if(!controller.signal.aborted)setError('待订正作业暂未刷新，联网后重试。')}if(!controller.signal.aborted)timer=setTimeout(refresh,8000)};void refresh();return()=>{controller.abort();clearTimeout(timer)}},[]);
 if(!tasks.length&&!error)return null;
 return <section className="hw-correction-inbox" aria-label="跨日期待订正作业"><h2>待订正 · {tasks.length}</h2><p>这里显示所有日期的退回作业，包含之前的任务，不会挪动原日期或重复发奖。</p>{error&&<p role="status">{error}</p>}<ul>{tasks.map(task=><li key={task.id}><Link href={`/child/homework/${task.id}`}>{task.title} · 查看批改并订正</Link><small>　原任务 {task.date}</small><p>{task.reviewNote}</p></li>)}</ul></section>;
}
