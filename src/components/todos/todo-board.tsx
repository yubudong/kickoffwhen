'use client';
import Image from 'next/image';
import Link from 'next/link';
import { TaskManagementControls } from '@/components/dictation/task-management-controls';
import { DictationEvidenceSubmit } from '@/components/dictation/dictation-evidence-submit';
import { TodoSubmission } from './todo-submission';
import { downloadPdf, renderTodoPdf } from './todo-pdf';
import { createTodoRequestGuard } from '@/modules/todos/request-guard';
import { filterTodoTasks, paperSections, sortTodoTasks, todoFilterLabel, type TodoStatusFilter } from '@/modules/todos/paper';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useRef, type FormEvent, type ReactNode } from 'react';
import { dateSchema, eachTodoDate, formatTodoDay, summarizeTodos, todayShanghai, todoDateRange, type TodoView } from '@/modules/todos/validation';
type Task = {
    id: string;
    title: string;
    requirements: string;
    date: string;
    updatedAt: string;
    childName: string;
    kind: string;
    dictationTaskId: string | null;
    dictationAudioStatus: 'ready' | 'preparing' | null;
    dictationSessionStatus: string | null;
    dictationPhase?: string | null;
    gradingMode?: string | null;
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
const filters: TodoStatusFilter[] = ['all', 'remaining', 'submitted', 'approved'];
export function TodoBoard({ role, childOptions = [], childName }: {
    role: 'parent' | 'child';
    childOptions?: Array<{
        id: string;
        nickname: string;
    }>;
    childName?: string;
}) {
    const router = useRouter();
    const createCommand = useRef<string | null>(null);
    const [date, setDate] = useState(todayShanghai());
    const [childId, setChildId] = useState(childOptions[0]?.id ?? '');
    const [data, setData] = useState<Data>({ tasks: [], points: 0 });
    const [error, setError] = useState('');
    const [pending, setPending] = useState(false);
    const [editingTodo, setEditingTodo] = useState<{ id: string; expectedUpdatedAt: string } | null>(null);
    const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
    const [recordingTaskId, setRecordingTaskId] = useState<string | null>(null);
    const recordingActivity = useCallback((id: string, busy: boolean) => { setRecordingTaskId(current => busy ? id : current === id ? null : current); }, []);
    const [loaded, setLoaded] = useState(false);
    const [view, setView] = useState<TodoView>('day');
    const [createDate, setCreateDate] = useState(todayShanghai());
    const [statusFilter, setStatusFilter] = useState<TodoStatusFilter>('all');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [addOpen, setAddOpen] = useState(false);
    const [expandAll, setExpandAll] = useState(false);
    const [dayOverride, setDayOverride] = useState<Record<string, boolean>>({});
    const endpoint = `/api/${role}/todos`;
    const viewKey = `${endpoint}:${view}:${date}:${childId}`;
    const requestGuard = useRef(createTodoRequestGuard(viewKey));
    const refresh = useCallback(async (signal?: AbortSignal) => {
        const guard = requestGuard.current;
        const token = guard.begin(viewKey);
        if (token === null) return;
        const query = new URLSearchParams({ date, view, ...(role === 'parent' && childId ? { childId } : {}) });
        const response = await fetch(`${endpoint}?${query}`, { cache: 'no-store', signal });
        const value = await response.json();
        if (!guard.isCurrent(token)) return;
        if (!response.ok) throw new Error(value.error ?? '暂时无法读取清单。');
        setData(value); setLoaded(true);
    }, [date, childId, endpoint, role, view, viewKey]);
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
    async function create(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const v = new FormData(form); const targetDate = view === 'day' ? date : createDate; createCommand.current ??= crypto.randomUUID(); if (await send({ childId, date: targetDate, title: v.get('title'), requirements: v.get('requirements'), commandId: createCommand.current })) {
        form.reset();
        createCommand.current = null;
        setAddOpen(false);
    } }
    async function submit(data: FormData, t: Task) {
        data.set('id', t.id); data.set('date', t.date); data.set('number', String(t.submissionNumber));
        return send(data);
    }
    async function review(event: FormEvent<HTMLFormElement>, t: Task) { event.preventDefault(); const v = new FormData(event.currentTarget); const decision = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value'); await send({ action: 'review', id: t.id, number: t.submissionNumber, decision, bonus: Number(v.get('bonus') ?? 0), note: String(v.get('note') ?? '') }); }
    async function update(event: FormEvent<HTMLFormElement>, t: Task) {
        event.preventDefault();
        if (!editingTodo || editingTodo.id !== t.id) return;
        const values = new FormData(event.currentTarget);
        if (await send({ action: 'update', id: t.id, title: values.get('title'), requirements: values.get('requirements'), date: values.get('date'), expectedUpdatedAt: editingTodo.expectedUpdatedAt }))
            setEditingTodo(null);
    }
    async function cancel(t: Task) {
        if (await send({ action: 'cancel', id: t.id })) setConfirmCancelId(null);
    }
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
    function resetRange() { setEditingTodo(null); setConfirmCancelId(null); setDayOverride({}); setExpandAll(false); setLoaded(false); }
    function switchView(next: TodoView) {
        if (next === view) return;
        requestGuard.current.select(`${endpoint}:${next}:${date}:${childId}`);
        resetRange(); setView(next);
    }
    const counts = summarizeTodos(data.tasks);
    const parsedDate = dateSchema.safeParse(date);
    const range = parsedDate.success ? todoDateRange(parsedDate.data, view) : { from: date, to: date };
    const days = view === 'day' || !parsedDate.success ? [date] : eachTodoDate(range.from, range.to);
    const visibleTasks = sortTodoTasks(filterTodoTasks(data.tasks, statusFilter));
    const selected = data.tasks.find(task => task.id === selectedId) ?? null;
    const childLabel = childName ?? childOptions.find(child => child.id === childId)?.nickname ?? data.tasks[0]?.childName ?? '孩子';
    const rangeLabel = parsedDate.success ? (view === 'day' ? formatTodoDay(parsedDate.data) : `${view === 'week' ? '本周' : '本月'} ${formatTodoDay(range.from)} 至 ${formatTodoDay(range.to)}`) : date;
    const sections = paperSections(days, visibleTasks, day => parsedDate.success ? formatTodoDay(day) : day);
    function dayOpen(day: string) {
        if (view === 'day') return true;
        if (Object.prototype.hasOwnProperty.call(dayOverride, day)) return dayOverride[day]!;
        if (view === 'week') return true;
        return expandAll || day === date;
    }
    const groupedOpen = view !== 'day' && days.every(dayOpen);
    function toggleGroups() {
        if (groupedOpen) {
            setExpandAll(false);
            setDayOverride(view === 'month' ? {} : Object.fromEntries(days.map(day => [day, false])));
        }
        else { setExpandAll(true); setDayOverride({}); }
    }
    async function exportPdf() {
        setError('');
        try {
            const bytes = await renderTodoPdf({ childName: childLabel, rangeLabel, filterLabel: todoFilterLabel(statusFilter), sections });
            downloadPdf(bytes, `${childLabel}-待办清单-${range.from}.pdf`);
        }
        catch { setError('暂时无法导出 PDF，请改用打印。'); }
    }
    function taskFacts(t: Task) {
        const done = ['submitted', 'approved'].includes(t.status);
        const awaitingParent = t.kind === 'dictation' && t.dictationPhase === 'awaiting_parent' && t.dictationSessionStatus === 'active' && ['open', 'rejected'].includes(t.status);
        const dictationCompleted = t.kind === 'dictation' && t.dictationSessionStatus === 'completed';
        const dictationState = t.kind === 'dictation' && ['open', 'rejected'].includes(t.status)
            ? awaitingParent ? '听写已提交，等待家长批改' : dictationCompleted ? '听写已完成，待提交' : t.dictationSessionStatus === 'active' ? '进行中' : t.dictationAudioStatus === 'preparing' ? '音频准备中' : '待完成'
            : null;
        return { done, awaitingParent, dictationCompleted, dictationState };
    }
    function pointsLabel(t: Task) {
        if (t.points !== null) return `+${t.points}`;
        if (t.status === 'submitted') return '待发放';
        return '—';
    }
    function detailBody(t: Task): ReactNode {
        const { done, awaitingParent, dictationCompleted, dictationState } = taskFacts(t);
        return <>
            <p className={`todo-status status-${t.status}`}>{dictationState ?? labels[t.status]}</p>
            <p>{t.requirements || '按要求完成即可。'}</p>
            {t.reviewNote && <p className="todo-review-note">家长反馈：{t.reviewNote}</p>}
            {t.points !== null && <p className="todo-points">已获得 {t.points} 积分</p>}
            {t.attachment && <Evidence attachment={t.attachment}/>}
            {role === 'child' && !done && t.status !== 'cancelled' && (dictationCompleted ? (
                <DictationEvidenceSubmit todo={{ id: t.id, date: t.date, number: t.submissionNumber }}
                    disabled={pending || recordingTaskId !== null}
                    onSubmitted={() => void refresh().catch(() => setError('提交已保存，刷新清单失败，请手动刷新。'))} />
            ) : t.kind === 'dictation' ? (
                <button disabled={pending || recordingTaskId !== null || (t.dictationSessionStatus !== 'active' && t.dictationAudioStatus !== 'ready')}
                    onClick={() => void start(t)}>{awaitingParent ? '查看批改进度' : t.dictationSessionStatus === 'active' ? '继续听写' : t.dictationAudioStatus === 'ready' ? '开始听写' : '音频准备中'}</button>
            ) : (
                <TodoSubmission taskId={t.id} disabled={pending || (recordingTaskId !== null && recordingTaskId !== t.id)}
                    onActivityChange={recordingActivity} onSubmit={data => submit(data, t)}/>
            ))}
            {role === 'child' && done && <p>{t.status === 'submitted' ? '等待家长审核' : '已通过审核，积分已到账'}</p>}
            {role === 'parent' && t.status === 'submitted' && <ReviewForm pending={pending} onSubmit={e => void review(e, t)}/>}
            {role === 'parent' && awaitingParent && <Link href="/parent/dictation-reviews">查看照片并逐词批改</Link>}
            {role === 'parent' && t.status !== 'submitted' && <p className="muted">{t.status === 'approved' ? '审核通过，已发积分' : t.status === 'cancelled' ? '已撤回' : t.status === 'rejected' ? '等待孩子重新提交' : dictationState ?? '等待孩子完成'}</p>}
            {role === 'parent' && t.kind === 'manual' && editingTodo?.id === t.id && t.status === 'open' &&
                <form className="todo-edit" aria-label={`${t.title}的编辑表单`} onSubmit={e => void update(e, t)}>
                    <label>待办任务<input name="title" defaultValue={t.title} maxLength={120} required/></label>
                    <label>任务要求<textarea name="requirements" defaultValue={t.requirements} maxLength={2000} rows={2}/></label>
                    <label>日期<input name="date" type="date" defaultValue={t.date} required/></label>
                    <div className="todo-manual-actions"><button type="submit" disabled={pending}>保存修改</button><button type="button" className="secondary-button" disabled={pending} onClick={() => setEditingTodo(null)}>取消编辑</button></div>
                </form>}
            {role === 'parent' && t.kind === 'dictation' && t.dictationTaskId && t.status !== 'approved' && <TaskManagementControls taskId={t.dictationTaskId} onChanged={refresh}/>}
        </>;
    }
    return <section className="todo-board"><div className="todo-filters"><div className="todo-views" role="group" aria-label="查看范围">{(['day', 'week', 'month'] as const).map(item => <button key={item} type="button" aria-pressed={view === item} disabled={recordingTaskId !== null} onClick={() => switchView(item)}>{item === 'day' ? '日视图' : item === 'week' ? '周视图' : '月视图'}</button>)}</div><label>日期<input type="date" disabled={recordingTaskId !== null} value={date} onChange={e => { requestGuard.current.select(`${endpoint}:${view}:${e.target.value}:${childId}`); resetRange(); setDate(e.target.value); }} required/></label>{role === 'parent' && <label>孩子<select value={childId} onChange={e => { requestGuard.current.select(`${endpoint}:${view}:${date}:${e.target.value}`); resetRange(); setChildId(e.target.value); }}>{childOptions.map(c => <option key={c.id} value={c.id}>{c.nickname}</option>)}</select></label>}<button type="button" onClick={() => void refresh().catch(() => setError('刷新失败，请稍后重试。'))}>刷新</button><button type="button" className="secondary-button" disabled={!loaded} onClick={() => void exportPdf()}>导出 PDF</button><button type="button" className="secondary-button" disabled={!loaded} onClick={() => window.print()}>打印</button>{role === 'parent' && <button type="button" aria-expanded={addOpen} onClick={() => setAddOpen(open => !open)}>{addOpen ? '收起添加' : '添加待办'}</button>}</div>
        {view !== 'day' && parsedDate.success && <p className="todo-range muted">{view === 'week' ? '本周' : '本月'} {formatTodoDay(range.from)} 至 {formatTodoDay(range.to)}</p>}
        <div className="todo-summary" aria-live="polite"><strong>共 {counts.total} 项 · 已完成 {counts.completed} 项 · 待完成 {counts.remaining} 项 · 待审核 {data.tasks.filter(task => task.status === 'submitted').length} 项</strong><span>累计积分：{data.points}</span></div>
        <div className="todo-status-filters" role="group" aria-label="任务状态">{filters.map(filter => <button key={filter} type="button" aria-pressed={statusFilter === filter} onClick={() => setStatusFilter(filter)}>{todoFilterLabel(filter)} {filter === 'all' ? data.tasks.length : filter === 'remaining' ? counts.remaining : filter === 'submitted' ? data.tasks.filter(task => task.status === 'submitted').length : data.tasks.filter(task => task.status === 'approved').length}</button>)}</div>
        <p className="muted">提交后显示“待审核”，家长通过后显示“审核通过”并到账积分。纸上勾选不会自动同步。</p>
        {role === 'parent' && addOpen && <form className="auth-form todo-create" onSubmit={create}><h2>添加待办</h2>{view !== 'day' && <label>添加到哪一天<input type="date" value={createDate} onChange={e => setCreateDate(e.target.value)} required/></label>}{view !== 'day' && parsedDate.success && (createDate < range.from || createDate > range.to) && <p className="muted">所选日期不在当前查看范围内，添加后请切换到对应日期查看。</p>}<label>待办任务<input name="title" maxLength={120} placeholder="例如：阅读20分钟" required/></label><label>任务要求<textarea name="requirements" maxLength={2000} placeholder="说明完成标准（可选）" rows={2}/></label><p>基础积分 1 分；审核时可另加奖励积分。</p><button disabled={pending || !childId}>添加到清单</button></form>}
        {error && <p role="alert" className="todo-error">{error}</p>}
        {view !== 'day' && loaded && <button type="button" className="secondary-button todo-expand" onClick={toggleGroups}>{groupedOpen ? '全部收起' : '全部展开'}</button>}
        {!loaded ? <p>正在读取清单…</p> : view === 'day' && !data.tasks.length ? <p>这一天还没有待办任务。</p> : view === 'day' && !visibleTasks.length ? <p>当前筛选下没有待办。</p> : days.map(day => {
            const dayTasks = visibleTasks.filter(task => task.date === day);
            const heading = parsedDate.success ? formatTodoDay(day) : day;
            const remaining = dayTasks.filter(task => task.status === 'open' || task.status === 'rejected').length;
            const waiting = dayTasks.filter(task => task.status === 'submitted').length;
            const summary = dayTasks.length ? `${dayTasks.length} 项 · 待完成 ${remaining} · 待审核 ${waiting}` : '无任务';
            if (view !== 'day') return <section key={day} className="todo-day" aria-label={heading}><h3><button type="button" className="todo-day-toggle" aria-expanded={dayOpen(day)} onClick={() => setDayOverride(current => ({ ...current, [day]: !dayOpen(day) }))}>{heading} · {summary}</button></h3>{dayOpen(day) && (dayTasks.length ? taskTable(dayTasks) : <p className="muted">无任务</p>)}</section>;
            return taskTable(dayTasks);
            function taskTable(rows: Task[]) { return <div className="todo-table-wrap"><table className="todo-table"><thead><tr><th>待办任务</th><th>状态</th><th>积分</th><th>操作</th></tr></thead><tbody>{rows.map(t => {
                const { done, awaitingParent, dictationCompleted, dictationState } = taskFacts(t);
                return <tr key={t.id}><td><button type="button" className="todo-title-button" onClick={() => setSelectedId(t.id)}>{t.title}</button>{t.kind === 'dictation' && <small>听写任务</small>}<p className="todo-req">{t.requirements || '按要求完成即可。'}</p></td><td><span className={`todo-status status-${t.status}`}>{dictationState ?? labels[t.status]}</span></td><td>{pointsLabel(t)}</td><td><div className="todo-row-actions">{role === 'child' && !done && t.status !== 'cancelled' && (dictationCompleted ? <button type="button" onClick={() => setSelectedId(t.id)}>提交</button> : t.kind === 'dictation' ? <button disabled={pending || recordingTaskId !== null || (t.dictationSessionStatus !== 'active' && t.dictationAudioStatus !== 'ready')} onClick={() => void start(t)}>{awaitingParent ? '查看批改进度' : t.dictationSessionStatus === 'active' ? '继续听写' : t.dictationAudioStatus === 'ready' ? '开始听写' : '音频准备中'}</button> : <button type="button" onClick={() => setSelectedId(t.id)}>提交</button>)}{role === 'parent' && t.status === 'submitted' && <button type="button" onClick={() => setSelectedId(t.id)}>审核</button>}{role === 'parent' && t.status !== 'submitted' && <button type="button" className="secondary-button" onClick={() => setSelectedId(t.id)}>查看</button>}{role === 'parent' && t.kind === 'manual' && t.status === 'open' && <button type="button" disabled={pending || editingTodo?.id === t.id} onClick={() => { setEditingTodo({ id: t.id, expectedUpdatedAt: t.updatedAt }); setConfirmCancelId(null); setSelectedId(t.id); }}>编辑</button>}{role === 'parent' && t.kind === 'manual' && ['open', 'submitted', 'rejected'].includes(t.status) && <button type="button" className="secondary-button" disabled={pending} onClick={() => { setConfirmCancelId(t.id); setEditingTodo(null); }}>撤回</button>}{role === 'parent' && t.kind === 'manual' && confirmCancelId === t.id && ['open', 'submitted', 'rejected'].includes(t.status) && <div className="todo-cancel-confirm" role="group" aria-label={`${t.title}撤回确认`}><p>撤回后孩子将看不到这项任务。</p><button type="button" className="secondary-button" disabled={pending} onClick={() => setConfirmCancelId(null)}>保留任务</button><button type="button" disabled={pending} onClick={() => void cancel(t)}>确定撤回</button></div>}</div></td></tr>;
            })}</tbody></table></div>; }
        })}
        {selected && <div className="todo-drawer-backdrop" onClick={() => { if (recordingTaskId === null) setSelectedId(null); }}><aside className="todo-drawer" role="dialog" aria-modal="true" aria-label={selected.title} onClick={event => event.stopPropagation()}><div className="todo-drawer-head"><h2>{selected.title}</h2><button type="button" className="secondary-button" onClick={() => setSelectedId(null)}>关闭</button></div>{detailBody(selected)}</aside></div>}
        <article className="todo-paper"><h1>{childLabel}的待办清单</h1><p>{rangeLabel} · {todoFilterLabel(statusFilter)}</p><p>请在纸上勾选。完成后回到电脑提交对应任务，家长审核通过后才记录完成和积分。</p>{sections.map(section => <section key={section.label}><h2>{section.tasks.length ? section.label : `${section.label} · 无任务`}</h2>{section.tasks.map(task => <div className="todo-paper-task" key={`${section.label}-${task.title}`}><span className="todo-paper-box" aria-hidden="true"/><div><strong>{task.title}</strong><p>{task.requirements}</p></div></div>)}</section>)}</article>
        </section>;
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
