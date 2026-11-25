"use client";
import { useCallback,useEffect,useRef,useState,type ReactNode } from 'react';
import { childSessionViewSchema,type ChildSessionView,type ListeningSessionView } from '@/modules/dictation/child-view-types';
import { keyboardReasonLabel } from '@/modules/dictation/keyboard-types';
import { preloadAudio,playAudioToEnd } from '@/modules/dictation/audio-playback';
import { DictationEvidenceSubmit } from './dictation-evidence-submit';
import './keyboard-dictation.css';
type Send=(type:string,extra?:Record<string,unknown>)=>Promise<ChildSessionView|null>;
export function KeyboardExperience({initialSession}:{initialSession:ChildSessionView}){
 const [session,setSession]=useState(initialSession),[pending,setPending]=useState(false),[error,setError]=useState(''),[retryLocked,setRetryLocked]=useState(false),[dirty,setDirty]=useState(false),[revoked,setRevoked]=useState(false),[reloadKey,setReloadKey]=useState(0),[leaving,setLeaving]=useState<string|null>(null);
 const latest=useRef(session),busy=useRef(false),retry=useRef<{url:string;body:string}|null>(null),allowLeave=useRef(false);
 const apply=useCallback((next:ChildSessionView)=>{const current=latest.current;if(next.version<current.version||(next.version===current.version&&(next.keyboard?.draft?.revision??0)<(current.keyboard?.draft?.revision??0)))return;latest.current=next;setSession(next)},[]);
 const execute=useCallback(async(operation:{url:string;body:string})=>{
  if(busy.current)return null;busy.current=true;setPending(true);setError('');retry.current=operation;
  try{const response=await fetch(operation.url,{method:'POST',headers:{'content-type':'application/json'},body:operation.body,cache:'no-store'});const data=await response.json();
   if(!response.ok){retry.current=null;setRetryLocked(false);if(response.status===401||response.status===404)setRevoked(true);throw new Error(data.error??'进度未保存，请读取最新进度。')}
   const next=childSessionViewSchema.parse(data.session);retry.current=null;setRetryLocked(false);apply(next);return next;
  }catch(e){if(retry.current)setRetryLocked(true);setError(e instanceof Error?e.message:'网络中断，请重试保存。');return null}finally{busy.current=false;setPending(false)}
 },[apply]);
 const send:Send=useCallback((type,extra={})=>{
  if(retry.current||busy.current)return Promise.resolve(null);const s=latest.current;const url=`/api/child/dictation/${s.sessionId}/${type==='playback'?'commands':'keyboard'}`;
  return execute({url,body:JSON.stringify({type,commandId:crypto.randomUUID(),expectedVersion:s.version,roundNumber:s.roundNumber,...extra})});
 },[execute]);
 async function reload(){
  if(dirty&&!window.confirm('当前还有未保存的输入。读取服务器进度会替换本页草稿，继续吗？'))return;
  try{const r=await fetch(`/api/child/dictation/${session.sessionId}`,{cache:'no-store'});if(!r.ok){setRevoked(true);throw new Error('任务或登录已失效。')}const data=await r.json();apply(childSessionViewSchema.parse(data.session));retry.current=null;setRetryLocked(false);setDirty(false);setReloadKey(n=>n+1);setError('')}catch(e){setError(e instanceof Error?e.message:'无法读取进度。')}
 }
 useEffect(()=>{const guard=(e:BeforeUnloadEvent)=>{if(!allowLeave.current&&(dirty||pending||retryLocked))e.preventDefault()};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard)},[dirty,pending,retryLocked]);
 useEffect(()=>{const abort=new AbortController();const timer=window.setInterval(async()=>{if(busy.current)return;try{const r=await fetch(`/api/child/dictation/${initialSession.sessionId}`,{cache:'no-store',signal:abort.signal});if(r.status===404||r.status===401){setRevoked(true);return}if(r.ok&&latest.current.phase==='awaiting_parent'){const data=await r.json();apply(childSessionViewSchema.parse(data.session))}}catch{}},5000);return()=>{abort.abort();clearInterval(timer)}},[initialSession.sessionId,apply]);
 const stats=session.keyboard?.summary,result=session.keyboard?.result;
 return <main className="page-shell dictation-shell keyboard-shell"><div className="dictation-topbar"><button disabled={pending} onClick={()=>setLeaving('/child')} type="button">← 返回今日清单</button><button disabled={pending} onClick={()=>setLeaving('/child/switch')} type="button">切换孩子</button></div>
 {error&&<div role="alert" className="keyboard-error"><p>{error}</p>{retryLocked?<button disabled={pending} onClick={()=>retry.current&&void execute(retry.current)} type="button">重试保存</button>:<button disabled={pending} onClick={()=>void reload()} type="button">读取最新进度</button>}</div>}
 {revoked?<section className="dictation-card"><h1>任务或登录已失效</h1><p>请返回今日清单，重新选择孩子或核对任务。</p><a href="/child">返回今日清单</a></section>:<>
 {session.phase==='listening'?<KeyboardEntry key={`${session.sessionId}:${session.roundNumber}:${reloadKey}`} session={session} pending={pending} locked={retryLocked} send={send} onDirty={setDirty}/>:<section className="dictation-card keyboard-results"><p className="eyebrow">英语 · 键盘听写 · {stats?.assisted?'辅助练习':'标准听写'}</p><h1>{session.phase==='completed'?'本次听写已完成':result?.pending?'等待家长复核写法':'本轮核对结果'}</h1>
 {stats&&<p className="keyboard-first-score">首次答对 <strong>{stats.firstCorrect}/{stats.total}</strong>{stats.firstPending?` · ${stats.firstPending}题待确认`:''} · {stats.corrected}个错词已订正</p>}
 <p>{session.phase==='completed'?'首次作答与每轮订正已保留。':'原始作答已保存；开始下一轮时会隐藏答案，清空输入。'}</p>
 {result?.reviewNote&&<p>家长复核：{result.reviewNote}</p>}
 {result&&<ol className="keyboard-result-list">{result.items.map((r,i)=><li key={r.itemId} className={r.correct===null?'pending':r.correct?'correct':'incorrect'}><div><strong>第{i+1}题 · {r.correct===null?'待确认':r.correct?'正确':'需要订正'}</strong><p>你的输入：<span lang="en">{r.input||'（未作答）'}</span></p><p>目标写法：<b lang="en">{r.answerText}</b></p>{r.english?.meaningZh&&<p>{r.english.meaningZh}</p>}<small>{keyboardReasonLabel[r.reason]}{r.status==='pending'&&r.correct!==null?' · 已由家长确认':''}</small></div></li>)}</ol>}
 {session.phase==='awaiting_parent'?<><p>家长确认规范写法后，再继续完成或订正。</p><button disabled={pending} onClick={()=>void reload()} type="button">查看复核进度</button></>:session.phase==='grading'?<button className="dictation-primary" disabled={pending||retryLocked} onClick={()=>{setDirty(false);void send('advance')}} type="button">{result?.items.some(r=>r.correct===false)?'隐藏答案，开始错词订正':'确认结果，完成听写'}</button>:null}
 {session.phase==='completed'&&session.todoSubmission&&['open','rejected'].includes(session.todoSubmission.status)&&<DictationEvidenceSubmit keyboard todo={session.todoSubmission} onSubmitted={()=>{if(session.phase==='completed'&&session.todoSubmission)apply({...session,todoSubmission:{...session.todoSubmission,status:'submitted',number:session.todoSubmission.number+1}})}}/>}
 {session.phase==='completed'&&session.todoSubmission?.status==='submitted'&&<p>听写已完成，等待家长审核任务奖励。</p>}{session.phase==='completed'&&session.todoSubmission?.status==='approved'&&<p>任务已审核，奖励已到账。</p>}
 </section>}
 </>}
 {leaving&&<KeyboardDialog titleId="keyboard-leave-title" onClose={()=>setLeaving(null)}><section className="confirm-card"><h2 id="keyboard-leave-title">现在离开听写吗？</h2><p>{dirty||retryLocked?'还有尚未保存的输入，请先返回等待保存；直接离开可能丢失这些输入。':'进度已保存在服务器，回来后可以继续。'}</p><div className="dictation-actions"><button autoFocus onClick={()=>setLeaving(null)} type="button">继续听写</button><button onClick={()=>{allowLeave.current=true;window.location.replace(leaving)}} type="button">确认离开</button></div></section></KeyboardDialog>}
 </main>;
}
function KeyboardEntry({session,pending,locked,send,onDirty}:{session:ListeningSessionView;pending:boolean;locked:boolean;send:Send;onDirty:(dirty:boolean)=>void}){
 const initial=session.keyboard?.draft;const [answers,setAnswers]=useState<Record<string,string>>(()=>Object.fromEntries((initial?.answers??[]).map(a=>[a.itemId,a.input]))),[cursor,setCursor]=useState(initial?.cursor??0),[saved,setSaved]=useState(()=>JSON.stringify({answers:Object.fromEntries((initial?.answers??[]).map(a=>[a.itemId,a.input])),cursor:initial?.cursor??0})),[savedLabel,setSavedLabel]=useState(initial?.savedAt?'已保存':'尚未输入'),[playing,setPlaying]=useState(false),[audioError,setAudioError]=useState(''),[checking,setChecking]=useState(false),[confirm,setConfirm]=useState(false),[online,setOnline]=useState(true);
 const current=useRef({answers,cursor}),signature=JSON.stringify({answers,cursor}),savedSignature=useRef(signature),saveBusy=useRef(false),abort=useRef<AbortController|null>(null),audio=useRef<HTMLAudioElement|null>(null),inputRef=useRef<HTMLInputElement>(null),latest=useRef(session);
 useEffect(()=>{current.current={answers,cursor};latest.current=session},[answers,cursor,session]);
 const dirty=signature!==saved;
 useEffect(()=>{onDirty(dirty);return()=>onDirty(false)},[dirty,onDirty]);
 useEffect(()=>{const offline=()=>{setOnline(false);abort.current?.abort();audio.current?.pause();setAudioError('网络已断开，播放暂停；联网后手动继续。')};const online=()=>setOnline(true);queueMicrotask(()=>setOnline(navigator.onLine));window.addEventListener('offline',offline);window.addEventListener('online',online);return()=>{abort.current?.abort();audio.current?.pause();window.removeEventListener('offline',offline);window.removeEventListener('online',online)}},[]);
 const save=useCallback(async()=>{
  if(saveBusy.current||pending||locked||!navigator.onLine)return false;const value=current.current;const sig=JSON.stringify(value);if(sig===savedSignature.current)return true;saveBusy.current=true;setSavedLabel('保存中…');
  const next=await send('draft',{draftRevision:latest.current.keyboard?.draft?.revision??0,cursor:value.cursor,answers:Object.entries(value.answers).map(([itemId,input])=>({itemId,input}))});saveBusy.current=false;
  if(next){if(next.phase==='listening')latest.current=next;savedSignature.current=sig;setSaved(sig);setSavedLabel('已保存');return true}setSavedLabel('尚未保存');return false;
 },[send,pending,locked]);
 useEffect(()=>{if(!dirty||!online||pending||locked||playing)return;const timer=setTimeout(()=>void save(),650);return()=>clearTimeout(timer)},[signature,saved,dirty,online,pending,locked,playing,save]);
 async function play(index:number){
  const item=latest.current.items[index];if(!item||playing||pending||locked||!navigator.onLine)return;
  if(latest.current.playedItemIds.includes(item.itemId)&&!latest.current.allowManualReplay){setAudioError('本任务未开放额外重听。');return}
  const firstUnplayed=latest.current.items.findIndex(i=>!latest.current.playedItemIds.includes(i.itemId));if(index>firstUnplayed&&firstUnplayed!==-1){setAudioError('请先按顺序听前面的题目。');return}
  abort.current?.abort();const controller=new AbortController();abort.current=controller;setPlaying(true);setAudioError('');const player=new Audio(item.audioUrl);audio.current=player;
  try{await preloadAudio(player,controller.signal);for(let i=0;i<latest.current.repeatCount;i++){player.currentTime=0;await playAudioToEnd(player,controller.signal)}if(!controller.signal.aborted){await send('playback',{playedItemIds:[item.itemId],sequenceFinished:false});inputRef.current?.focus()}}
  catch{if(!controller.signal.aborted)setAudioError('音频播放中断，请重试本题。')}
  finally{player.pause();setPlaying(false)}
 }
 function go(index:number){if(playing||pending||locked)return;setChecking(false);setCursor(index);inputRef.current?.focus();if(!latest.current.playedItemIds.includes(latest.current.items[index].itemId))void play(index)}
 function next(){if(!session.playedItemIds.includes(session.items[cursor].itemId)||playing||pending||locked)return;if(cursor+1<session.items.length)go(cursor+1);else setChecking(true)}
 async function submit(){if(!await save())return;setConfirm(false);const all=latest.current.items.map(i=>({itemId:i.itemId,input:current.current.answers[i.itemId]??''}));const result=await send('submit',{draftRevision:latest.current.keyboard?.draft?.revision??0,answers:all});if(result)onDirty(false)}
 const item=session.items[cursor],filled=session.items.filter(i=>(answers[i.itemId]??'').trim()).length;
 return <section className="dictation-card keyboard-entry"><p className="eyebrow">英语 · 键盘听写 · 第{session.roundNumber}轮</p><h1>{checking?'检查本轮输入':'听清楚，打出来'}</h1><div className="keyboard-progress"><strong>{checking?`已作答 ${filled}/${session.items.length}`:`第 ${cursor+1} / ${session.items.length} 题`}</strong><span role="status">{dirty?(pending?'保存中…':'尚未保存'):savedLabel}</span></div><progress aria-label="键盘听写作答进度" value={filled} max={session.items.length}/>
 {checking?<><p>这里只显示你的输入，还没有判分。可返回修改；交卷后将保留本轮原始答案。</p><ol className="keyboard-check-list">{session.items.map((i,n)=><li key={i.itemId}><span>{n+1}. <b lang="en">{answers[i.itemId]||'（未作答）'}</b></span><button type="button" disabled={pending||locked} onClick={()=>go(n)}>修改第{n+1}题</button></li>)}</ol><button className="dictation-primary" disabled={pending||locked||!online||playing} type="button" onClick={()=>setConfirm(true)}>提交本轮</button></>:<>
 <p>{item.writingHint}输入期间不提示对错。</p>{item.englishHints&&<div className="english-listening-hints">{item.englishHints.meaningZh&&<p>释义：{item.englishHints.meaningZh}</p>}{item.englishHints.exampleWithBlank&&<p lang="en">{item.englishHints.exampleWithBlank}</p>}</div>}
 <button className="keyboard-play" disabled={playing||pending||locked||!online||(session.playedItemIds.includes(item.itemId)&&!session.allowManualReplay)} type="button" onClick={()=>void play(cursor)}>{playing?'正在朗读…':session.playedItemIds.includes(item.itemId)?'重听本题（Alt+R）':'播放本题'}</button>{audioError&&<p role="alert">{audioError}</p>}
 <label className="keyboard-input-label">本题英文<input ref={inputRef} autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} lang="en" maxLength={500} disabled={locked||!online} value={answers[item.itemId]??''} onChange={e=>setAnswers(old=>({...old,[item.itemId]:e.target.value}))} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='Enter'){e.preventDefault();next()}if(e.altKey&&e.key.toLowerCase()==='r'){e.preventDefault();void play(cursor)}}}/></label>
 <div className="dictation-actions"><button disabled={cursor===0||pending||locked||playing} onClick={()=>go(cursor-1)} type="button">上一题</button><button disabled={!session.playedItemIds.includes(item.itemId)||pending||locked||playing} onClick={next} type="button">{cursor===session.items.length-1?'检查全部输入':'下一题（Enter）'}</button></div><p className="muted">不会时可留空进入下一题；全部听过后再交卷。打字速度不计分。</p>
 </>}
 {confirm&&<KeyboardDialog titleId="keyboard-submit-title" onClose={()=>{if(!pending)setConfirm(false)}}><section className="confirm-card"><h2 id="keyboard-submit-title">确认提交本轮？</h2><p>{filled<session.items.length?`还有 ${session.items.length-filled} 题未作答，会保留为空白结果。`:'全部题目已填写。'}提交后才能查看正确写法。</p><div className="dictation-actions"><button autoFocus disabled={pending} onClick={()=>setConfirm(false)} type="button">返回检查</button><button disabled={pending||locked||!online} onClick={()=>void submit()} type="button">确认交卷</button></div></section></KeyboardDialog>}
 </section>;
}

function KeyboardDialog({titleId,onClose,children}:{titleId:string;onClose:()=>void;children:ReactNode}){
 const dialog=useRef<HTMLDivElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const node=dialog.current;const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();onClose()}if(event.key==='Tab'&&node){const controls=[...node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]')];const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}};node?.querySelector<HTMLElement>('button')?.focus();document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus()}},[onClose]);
 return <div ref={dialog} className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>{children}</div>
}
