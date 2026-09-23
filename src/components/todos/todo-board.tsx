'use client';
import Image from 'next/image';
import { TaskManagementControls } from '@/components/dictation/task-management-controls';
import { TodoSubmission } from './todo-submission';
import { createTodoRequestGuard } from '@/modules/todos/request-guard';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useRef, type FormEvent } from 'react';
import { summarizeTodos, todayShanghai } from '@/modules/todos/validation';
type Task = {
    id: string;
    title: string;
    requirements: string;
    date: string;
    childName: string;
    kind: string;
    dictationTaskId: string | null;
    status: string;
    submissionNumber: number;
    reviewNote: string;
    points: number | null;
    attachment: {
        id: string;
        mimeType: string;
    } | null;
};
type Data = {
    tasks: Task[];
    points: number;
};
const labels: Record<string, string> = { open: '待完成', submitted: '待审核', approved: '审核通过', rejected: '审核未通过，请重新完成', cancelled: '已撤回' };
export function TodoBoard({ role, childOptions = [] }: {
    role: 'parent' | 'child';
    childOptions?: Array<{
        id: string;
        nickname: string;
    }>;
}) {
    const router = useRouter();
    const createCommand = useRef<string | null>(null);
    const [date, setDate] = useState(todayShanghai());
    const [childId, setChildId] = useState(childOptions[0]?.id ?? '');
    const [data, setData] = useState<Data>({ tasks: [], points: 0 });
    const [error, setError] = useState('');
    const [pending, setPending] = useState(false);
    const [recordingTaskId, setRecordingTaskId] = useState<string | null>(null);
    const recordingActivity = useCallback((id: string, busy: boolean) => { setRecordingTaskId(current => busy ? id : current === id ? null : current); }, []);
    const [loaded, setLoaded] = useState(false);
    const endpoint = `/api/${role}/todos`;
    const viewKey = `${endpoint}:${date}:${childId}`;
    const requestGuard = useRef(createTodoRequestGuard(viewKey));
    const refresh = useCallback(async (signal?: AbortSignal) => {
        const guard = requestGuard.current;
        const token = guard.begin(viewKey);
        if (token === null) return;
        const query = new URLSearchParams({ date, ...(role === 'parent' && childId ? { childId } : {}) });
        const response = await fetch(`${endpoint}?${query}`, { cache: 'no-store', signal });
        const value = await response.json();
        if (!guard.isCurrent(token)) return;
        if (!response.ok) throw new Error(value.error ?? '暂时无法读取清单。');
        setData(value); setLoaded(true);
    }, [date, childId, endpoint, role, viewKey]);
    useEffect(() => {
        requestGuard.current.select(viewKey);
        const controller = new AbortController();
        let timer: number | undefined;
        const run = async () => {
            try { await refresh(controller.signal); }
            catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '加载失败'); }
            finally { if (!controller.signal.aborted) timer = window.setTimeout(run, 5000); }
        };
        void run();
        return () => { controller.abort(); window.clearTimeout(timer); };
    }, [refresh, viewKey]);
    async function send(body: FormData | Record<string, unknown>) { setPending(true); setError(''); try {
        const r = await fetch(endpoint, { method: 'POST', ...(body instanceof FormData ? { body } : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
        const v = await r.json();
        if (!r.ok)
            throw new Error(v.error ?? '操作未成功');
        await refresh();
        return true;
    }
    catch (e) {
        setError(e instanceof Error ? e.message : '网络中断，请重试。');
        return false;
    }
    finally {
        setPending(false);
    } }
    async function create(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const v = new FormData(form); createCommand.current ??= crypto.randomUUID(); if (await send({ childId, date, title: v.get('title'), requirements: v.get('requirements'), commandId: createCommand.current })) {
        form.reset();
        createCommand.current = null;
    } }
    async function submit(data: FormData, t: Task) {
        data.set('id', t.id); data.set('date', t.date); data.set('number', String(t.submissionNumber));
        return send(data);
    }
    async function review(event: FormEvent<HTMLFormElement>, t: Task) { event.preventDefault(); const v = new FormData(event.currentTarget); const decision = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value'); await send({ action: 'review', id: t.id, number: t.submissionNumber, decision, bonus: Number(v.get('bonus') ?? 0), note: String(v.get('note') ?? '') }); }
    async function start(t: Task) { setPending(true); setError(''); try {
        const r = await fetch(`/api/child/tasks/${t.dictationTaskId}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        const v = await r.json();
        if (!r.ok)
            throw new Error(v.error === 'AUDIO_NOT_READY' ? '音频正在准备，请稍后再试。' : '暂时无法进入听写，请刷新重试。');
        router.push(`/child/dictation/${v.session.sessionId}`);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : '操作失败');
        setPending(false);
    } }
    const counts = summarizeTodos(data.tasks);
    const sorted = [...data.tasks].sort((a, b) => Number(['submitted', 'approved'].includes(a.status)) - Number(['submitted', 'approved'].includes(b.status)));
    return <section className="todo-board"><div className="todo-filters"><label>日期<input type="date" disabled={recordingTaskId !== null} value={date} onChange={e => { requestGuard.current.select(`${endpoint}:${e.target.value}:${childId}`); setLoaded(false); setDate(e.target.value); }} required/></label>{role === 'parent' && <label>孩子<select value={childId} onChange={e => { requestGuard.current.select(`${endpoint}:${date}:${e.target.value}`); setLoaded(false); setChildId(e.target.value); }}>{childOptions.map(c => <option key={c.id} value={c.id}>{c.nickname}</option>)}</select></label>}<button type="button" onClick={() => void refresh().catch(() => setError('刷新失败，请稍后重试。'))}>刷新</button></div>
 <div className="todo-summary" aria-live="polite"><strong>共 {counts.total} 项 · 已完成 {counts.completed} 项 · 待完成 {counts.remaining} 项 · 待审核 {data.tasks.filter(task => task.status === 'submitted').length} 项</strong><span>累计积分：{data.points}</span></div>
 <p className="muted">提交后显示“待审核”，家长通过后显示“审核通过”并到账积分。</p>
 {role === 'parent' && <form className="auth-form todo-create" onSubmit={create}><h2>添加待办</h2><label>待办任务<input name="title" maxLength={120} placeholder="例如：阅读20分钟" required/></label><label>任务要求<textarea name="requirements" maxLength={2000} placeholder="说明完成标准（可选）" rows={2}/></label><p>基础积分 1 分；审核时可另加奖励积分。</p><button disabled={pending || !childId}>添加到清单</button></form>}
 {error && <p role="alert" className="todo-error">{error}</p>}
 {!loaded ? <p>正在读取清单…</p> : !data.tasks.length ? <p>这一天还没有待办任务。</p> : <div className="todo-table-wrap"><table className="todo-table"><thead><tr><th>待办任务</th><th>任务要求</th><th>操作</th></tr></thead><tbody>{sorted.map(t => {
                const done = ['submitted', 'approved'].includes(t.status);
                return <tr key={t.id} className={done ? 'todo-done' : ''}><td><div className="todo-name"><input type="checkbox" checked={done} readOnly aria-label={`${t.title}${done ? '已提交' : '待完成'}`}/>{done ? <s>{t.title}</s> : <strong>{t.title}</strong>}</div><span className={`todo-status status-${t.status}`}>{labels[t.status]}</span>{t.kind === 'dictation' && <small>听写任务</small>}{t.points !== null && <p className="todo-points">已获得 {t.points} 积分</p>}</td><td><p className="todo-requirements">{t.requirements || '按要求完成即可。'}</p>{t.reviewNote && <p className="todo-review-note">家长反馈：{t.reviewNote}</p>}{t.attachment && <Evidence attachment={t.attachment}/>}</td><td>
 {role === 'child' && !done && (t.kind === 'dictation' && t.status === 'open' ? <button disabled={pending || recordingTaskId !== null} onClick={() => void start(t)}>开始听写</button> : <TodoSubmission taskId={t.id} disabled={pending || (recordingTaskId !== null && recordingTaskId !== t.id)} onActivityChange={recordingActivity} onSubmit={data => submit(data, t)}/>)}
 {role === 'child' && done && <span>{t.status === 'submitted' ? '等待家长审核' : '已通过审核，积分已到账'}</span>}
 {role === 'parent' && t.status === 'submitted' && <ReviewForm pending={pending} onSubmit={e => void review(e, t)}/>}
 {role === 'parent' && t.status !== 'submitted' && <span>{t.status === 'approved' ? '审核通过，已发积分' : t.status === 'cancelled' ? '已撤回' : t.status === 'rejected' ? '等待孩子重新提交' : '等待孩子完成'}</span>}
 {role === 'parent' && t.kind === 'dictation' && t.dictationTaskId && t.status !== 'approved' && <TaskManagementControls taskId={t.dictationTaskId} onChanged={refresh}/>}
 </td></tr>;
            })}</tbody></table></div>}</section>;
}
function ReviewForm({ pending, onSubmit }: {
    pending: boolean;
    onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) { const [bonus, setBonus] = useState(0); return <form className="todo-review" onSubmit={onSubmit}><label>奖励积分<input type="number" name="bonus" min={0} max={10000} step={1} value={bonus} onChange={e => setBonus(Number(e.target.value))} required/></label><small>基础 1 分＋奖励 {bonus || 0} 分</small><label>审核意见<textarea name="note" maxLength={2000} placeholder="退回时必填" rows={2}/></label><button disabled={pending} name="decision" value="approved">通过并发放 {1 + (bonus || 0)} 积分</button><button disabled={pending} name="decision" value="rejected" className="secondary-button">退回，不发积分</button></form>; }
function Evidence({ attachment }: {
    attachment: {
        id: string;
        mimeType: string;
    };
}) { const url = `/api/todo-attachments/${attachment.id}`; return <div className="todo-evidence">{attachment.mimeType.startsWith('image/') ? <a href={url} target="_blank" rel="noreferrer"><Image unoptimized width={400} height={300} style={{ height: "auto", objectFit: "contain" }} src={url} alt="完成任务的图片"/></a> : attachment.mimeType.startsWith('audio/') ? <audio controls preload="metadata" src={url}/> : <video controls preload="metadata" src={url}/>}</div>; }
