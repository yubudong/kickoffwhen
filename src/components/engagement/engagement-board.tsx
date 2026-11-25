'use client';
import './engagement.css';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { EngagementView } from '@/modules/engagement/types';
import { shopItems, speciesNames, stageNames } from '@/modules/engagement/rules';
import { todayShanghai } from '@/modules/todos/validation';
import { CompanionArt } from './companion-art';
import { CompanionPanel } from './companion-panel';
import { canTransform } from '@/modules/engagement/companion-catalog';
type Species = keyof typeof speciesNames;
type Children = Array<{
    id: string;
    nickname: string;
}>;
const money = (n: number) => n.toLocaleString('zh-CN');
const time = (v: string) => new Date(v).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const requestLabels: Record<string, string> = { pending: '等待批准', approved: '待兑现', completed: '已兑现', rejected: '已拒绝', cancelled: '已取消' };
const entryLabels: Record<string, string> = { manual_adjustment: '家长调整', historical_points: '历史积分转入', task_reward: '完成任务', purchase: '购买物品', feed: '投喂成长', hold: '申请兑换', approve: '批准兑换', reject: '拒绝申请', cancel: '取消兑换', complete: '奖励兑现', activate: '激活祝福', equip: '装备装饰', interaction: '伙伴互动' };
export function EngagementBoard({ role, childOptions = [] }: {
    role: 'parent' | 'child';
    childOptions?: Children;
}) {
    const [childId, setChildId] = useState(childOptions[0]?.id ?? '');
    const [data, setData] = useState<EngagementView | null>(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [pending, setPending] = useState(false);
    const [tab, setTab] = useState('pet');
    const [schedule, setSchedule] = useState('daily');
    const [memory, setMemory] = useState<{
        species: Species;
        stage: number;
        appearance?: string;
    } | null>(null);
    const [confirm, setConfirm] = useState<{
        title: string;
        text: string;
        body: Record<string, unknown>;
        notice?: string;
    } | null>(null);
    const [editingReward, setEditingReward] = useState<EngagementView['rewards'][number] | null>(null);
    const commandKeys = useRef(new Map<string, string>());
    const selection = useRef(childId);
    const endpoint = `/api/${role}/engagement`;
    const refresh = useCallback(async (signal?: AbortSignal) => { if (role === 'parent' && !childId)
        return; const r = await fetch(`${endpoint}${role === 'parent' ? `?childId=${childId}` : ''}`, { cache: 'no-store', signal }); const v = await r.json(); if (!r.ok)
        throw new Error(v.error ?? '读取失败，请重试。'); if (selection.current === childId)
        setData(v); }, [childId, endpoint, role]);
    useEffect(() => { const c = new AbortController(); const run = () => void refresh(c.signal).catch(e => { if (!c.signal.aborted)
        setError(e.message); }); run(); const timer = window.setInterval(() => { if (document.visibilityState === 'visible')
        run(); }, 15000); return () => { c.abort(); window.clearInterval(timer); }; }, [refresh]);
    async function send(body: Record<string, unknown>, success = '已保存。') {
        if (pending)
            return false;
        setPending(true);
        setError('');
        setNotice('');
        const selected = childId;
        const payload = { ...body, ...(role === 'parent' ? { childId } : {}) };
        const signature = JSON.stringify(payload);
        let key = commandKeys.current.get(signature);
        if (!key) {
            key = crypto.randomUUID();
            commandKeys.current.set(signature, key);
        }
        try {
            const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, commandId: key }) });
            const v = await r.json();
            if (!r.ok)
                throw new Error(v.error ?? '操作失败。');
            if (selection.current === selected) {
                await refresh();
                setNotice(success);
            }
            commandKeys.current.delete(signature);
            return true;
        }
        catch (e) {
            if (selection.current === selected)
                setError(e instanceof Error ? e.message : '网络中断，请重试。');
            return false;
        }
        finally {
            setPending(false);
        }
    }
    async function createHabit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const form = e.currentTarget; const f = new FormData(form); if (await send({ action: 'habit', title: f.get('title'), requirements: f.get('requirements'), schedule, weekdays: f.getAll('weekday').map(Number), weeklyTarget: Number(f.get('weeklyTarget') ?? 3), startDate: f.get('startDate'), confirmation: f.get('confirmation'), coins: Number(f.get('coins')), growth: Number(f.get('growth')) }, '重复习惯已建立，当天会自动出现在待办清单。'))
        form.reset(); }
    async function saveReward(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const form = e.currentTarget; const f = new FormData(form); if (await send({ action: 'save-reward', ...(editingReward ? { id: editingReward.id } : {}), title: f.get('title'), description: f.get('description'), price: Number(f.get('price')), repeatable: f.get('repeatable') === 'yes', weeklyLimit: f.get('weeklyLimit') ? Number(f.get('weeklyLimit')) : null, active: true }, '奖励已保存，已申请的兑换价格保持不变。')) {
        form.reset();
        setEditingReward(null);
    } }
    if (role === 'parent' && !childOptions.length)
        return <p>请先在<Link href="/parent/children">孩子档案</Link>中添加孩子。</p>;
    const activeBoosts = data?.boosts.filter(b => new Date(b.expiresAt) > new Date(data.now)) ?? [];
    const totalBoost = activeBoosts.reduce((s, b) => s + b.percent, 0);
    return <div className="engagement-board">
  <header className="growth-heading"><div><p className="eyebrow">一起完成，一起长大</p><h1>{role === 'parent' ? '习惯与成长' : '我的成长伙伴'}</h1><p className="muted">把每一次认真完成，变成看得见的成长。</p></div>{role === 'parent' ? <label>孩子<select aria-label="成长孩子" value={childId} disabled={pending} onChange={e => { selection.current = e.target.value; setChildId(e.target.value); setData(null); setError(''); setNotice(''); setEditingReward(null); setConfirm(null); setMemory(null); }}>{childOptions.map(c => <option key={c.id} value={c.id}>{c.nickname}</option>)}</select></label> : <Link className="secondary-button" href="/child">返回今日待办</Link>}</header>
  {error && <p className="todo-error" role="alert">{error}</p>}{notice && <p className="growth-notice" role="status">{notice}</p>}
  {!data ? <p>正在准备伙伴的小屋…</p> : <>
   <div className="growth-balances"><div><span>可用星币</span><strong>✦ {money(data.wallet.available)}</strong><small>{data.wallet.held ? `${data.wallet.held} 星币兑换冻结中` : '现实奖励和装饰都能兑换'}</small></div><div><span>待投喂成长值</span><strong>◈ {money(data.wallet.growth)}</strong><small>不会过期，准备好再喂</small></div><div><span>伙伴累计成长</span><strong>✿ {money(data.wallet.fed)}</strong><small>{totalBoost ? `当前任务成长加成＋${totalBoost}%` : '完成任务，积累成长能量'}</small></div></div>
   <nav className="growth-tabs" aria-label="成长功能">{[['pet', '我的伙伴'], ...(role === 'parent' ? [['habits', '重复习惯']] : []), ['shop', '星币商店'], ['rewards', '家庭奖励'], ['history', '成长记录']].map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</nav>
   {tab === 'pet' && <>
    <CompanionPanel key={childId} data={data} role={role} pending={pending} onAction={send} onConfirm={setConfirm} onMemory={setMemory}/>
     <section className="growth-panel"><h2>我的背包</h2><p className="muted">装饰永久保留，祝福由你主动激活后才计时。</p><div className="growth-item-grid">{data.inventory.filter(i => i.quantity > 0).map(i => { const item = shopItems.find(s => s.key === i.itemKey); if (!item)
                return null; return <article key={i.id}><span className="item-icon">{item.type === 'boost' ? '✧' : item.type === 'food' ? '🍎' : '✿'}</span><h3>{item.name}</h3><p>{item.description}</p><small>拥有 {i.quantity} 件</small><button disabled={pending} onClick={() => setConfirm({ title: item.type === 'boost' ? '激活7天祝福' : item.type === 'food' ? '和伙伴互动' : '装备装饰', text: item.description, body: { action: 'use-item', itemKey: item.key }, notice: item.type === 'food' ? '伙伴开心地吃掉了苹果！' : '物品已使用。' })}>{item.type === 'boost' ? '激活' : item.type === 'food' ? '喂苹果' : '装备'}</button></article>; })}</div>{!data.inventory.some(i => i.quantity > 0) && <p>背包还是空的，去星币商店看看吧。</p>}{activeBoosts.length > 0 && <div className="boost-list"><h3>生效中的祝福 · 合计＋{totalBoost}%</h3>{activeBoosts.map(b => <p key={b.id}>{shopItems.find(i => i.key === b.itemKey)?.name} ＋{b.percent}% · 至 {time(b.expiresAt)}</p>)}<small>按提交时的效果计算，晚审核不影响；已有成长值不再加成。</small></div>}</section>
    <section className="growth-panel"><h2>成长相册</h2><div className="memory-list">{data.memories.map(m => <button key={m.id} onClick={() => setMemory({ species: m.species as Species, stage: m.stage })}><CompanionArt species={m.species as Species} stage={m.stage} appearance="animal"/><strong>{stageNames[m.stage]}</strong><small>{m.origin === 'upgrade' ? '升级补入 · ' : ''}{time(m.createdAt)}</small><span>重温这一刻</span></button>)}</div>{!data.memories.length && <p>孵化和每次成长都会留在这里，随时可以重温。</p>}</section>
   </>}
   {tab === 'habits' && role === 'parent' && <section className="growth-panel"><h2>自动安排，不用每天重布置</h2><form className="growth-form" onSubmit={createHabit}><label>习惯名称<input name="title" required maxLength={120} placeholder="例如：阅读20分钟"/></label><label>完成要求<textarea name="requirements" maxLength={2000}/></label><div className="growth-form-row"><label>开始日期<input name="startDate" type="date" defaultValue={todayShanghai()} required/></label><label>重复方式<select value={schedule} onChange={e => setSchedule(e.target.value)}><option value="daily">每天</option><option value="weekdays">指定星期几</option><option value="weekly">每周完成几次</option></select></label></div>{schedule === 'weekdays' && <fieldset className="weekday-options"><legend>执行日</legend>{['日', '一', '二', '三', '四', '五', '六'].map((d, i) => <label key={i}><input type="checkbox" name="weekday" value={i}/>周{d}</label>)}</fieldset>}{schedule === 'weekly' && <label>每周次数<input name="weeklyTarget" type="number" min={1} max={7} defaultValue={3}/><small>周一至周日，每天最多一次；待审核也占次数，未完成不跨周积压。</small></label>}<label>确认方式<select name="confirmation"><option value="parent">家长审核后发奖</option><option value="self">孩子自行确认后发奖</option></select></label><div className="growth-form-row"><label>每次星币<input name="coins" type="number" min={0} max={10000} defaultValue={1} required/></label><label>每次基础成长值<input name="growth" type="number" min={0} max={10000} defaultValue={10} required/></label></div><button disabled={pending || data.habits.filter(h => !h.stoppedOn).length >= 5}>建立重复习惯</button></form><h3>当前习惯 · {data.habits.filter(h => !h.stoppedOn).length}/5</h3>{data.habits.map(h => <article className="habit-row" key={h.id}><div><strong>{h.title}</strong><p>{h.schedule === 'daily' ? '每天' : h.schedule === 'weekly' ? `每周 ${h.weeklyTarget} 次` : `每周${h.weekdays.map(d => '日一二三四五六'[d]).join('、')}`} · {h.confirmation === 'self' ? '自主确认' : '家长审核'} · {h.coins} 星币 / {h.growth} 成长值</p></div>{h.stoppedOn ? <span className="muted">已停止</span> : <button className="secondary-button" disabled={pending} onClick={() => setConfirm({ title: '停止这个习惯？', text: '停止后不再自动生成，历史记录与已获得奖励保留。今天未提交的任务也会取消。', body: { action: 'stop-habit', id: h.id } })}>停止习惯</button>}</article>)}<p><Link href="/parent/todos">去今日待办跳过当次或延后一天 →</Link></p></section>}
   {tab === 'shop' && <section className="growth-panel"><h2>星币小商店</h2><p>虚拟用品可以自主购买。成长来自完成任务，食物只提供互动。</p><div className="growth-item-grid">{shopItems.map(item => { const owned = item.type === 'decoration' && data.inventory.some(i => i.itemKey === item.key && i.quantity > 0); return <article key={item.key}><span className="item-icon">{item.type === 'boost' ? '✧' : item.type === 'food' ? '🍎' : item.key === 'star-room' ? '🌌' : item.key === 'scarf' ? '🧣' : '🌙'}</span><small>{item.type === 'decoration' ? '永久装饰' : item.type === 'boost' ? '7天成长效果' : '一次互动'}</small><h3>{item.name}</h3><p>{item.description}</p><strong>✦ {item.price} 星币</strong><button disabled={pending || owned || data.wallet.available < item.price} onClick={() => setConfirm({ title: `购买${item.name}？`, text: `${item.description} 花费 ${item.price} 星币，购买后可用 ${data.wallet.available - item.price} 星币。`, body: { action: 'buy', itemKey: item.key, expectedPrice: item.price }, notice: '已放入背包。祝福需要主动激活后才开始计时。' })}>{owned ? '已拥有' : data.wallet.available < item.price ? '星币不足' : '购买'}</button></article>; })}</div></section>}
   {tab === 'rewards' && <>
    {role === 'parent' && <section className="growth-panel"><h2>{editingReward ? '编辑家庭奖励' : '设置家庭奖励'}</h2><form key={editingReward?.id ?? 'new'} className="growth-form" onSubmit={saveReward}><label>奖励名称<input name="title" defaultValue={editingReward?.title} required maxLength={120} placeholder="例如：周末一起看电影"/></label><label>使用说明<textarea name="description" defaultValue={editingReward?.description} maxLength={2000} placeholder="例如：提前一天约定时间"/></label><div className="growth-form-row"><label>所需星币<input name="price" type="number" min={1} max={1000000} defaultValue={editingReward?.price ?? 20} required/></label><label>兑换方式<select name="repeatable" defaultValue={editingReward?.repeatable === false ? 'no' : 'yes'}><option value="yes">可重复兑换</option><option value="no">每个孩子只能兑换一次</option></select></label><label>每周最多次数<input name="weeklyLimit" type="number" min={1} max={100} defaultValue={editingReward?.weeklyLimit ?? ''} placeholder="留空不限"/></label></div><button disabled={pending}>保存家庭奖励</button>{editingReward && <button type="button" className="secondary-button" onClick={() => setEditingReward(null)}>取消编辑</button>}</form></section>}
    <section className="growth-panel"><h2>一起期待的小奖励</h2><div className="growth-item-grid">{data.rewards.filter(r => r.active).map(r => <article key={r.id}><span className="item-icon">🎁</span><h3>{r.title}</h3><p>{r.description || '和家长一起约定兑现时间。'}</p><small>{r.repeatable ? '可重复兑换' : '每个孩子一次'}{r.weeklyLimit ? ` · 每周最多 ${r.weeklyLimit} 次` : ''}</small><strong>✦ {r.price} 星币</strong>{role === 'parent' ? <><button onClick={() => setEditingReward(r)}>编辑奖励</button><button className="secondary-button" disabled={pending} onClick={() => setConfirm({ title: '下架这个奖励？', text: '已有申请仍可继续处理，新的申请将停止。', body: { action: 'save-reward', ...r, active: false } })}>下架</button></> : <button disabled={pending || data.wallet.available < r.price || data.requests.some(q => q.rewardId === r.id && ['pending', 'approved'].includes(q.status))} onClick={() => setConfirm({ title: `申请${r.title}？`, text: `先冻结 ${r.price} 星币，家长批准后扣除；拒绝或取消会退回。`, body: { action: 'request-reward', rewardId: r.id, expectedPrice: r.price }, notice: '已申请，等待家长批准。' })}>申请兑换</button>}</article>)}</div>{!data.rewards.some(r => r.active) && <p>还没有可兑换的家庭奖励，请家长先添加。</p>}</section>
    <section className="growth-panel"><h2>兑换进度</h2>{data.requests.map(r => <article key={r.id} className="reward-request"><div><h3>{r.title}</h3><p>{r.price} 星币 · {requestLabels[r.status]} · {time(r.createdAt)}</p>{r.note && <p>{r.note}</p>}</div><div className="growth-actions">{role === 'parent' && r.status === 'pending' && <><button disabled={pending} onClick={() => setConfirm({ title: '批准兑换？', text: `将正式扣除已冻结的 ${r.price} 星币。`, body: { action: 'decide-reward', id: r.id, decision: 'approve' } })}>批准</button><button className="secondary-button" disabled={pending} onClick={() => void send({ action: 'decide-reward', id: r.id, decision: 'reject' })}>拒绝并退回</button></>}{role === 'parent' && r.status === 'approved' && <button disabled={pending} onClick={() => setConfirm({ title: '确认已经兑现？', text: '请实际提供奖励后再标记完成。', body: { action: 'decide-reward', id: r.id, decision: 'complete' } })}>已兑现</button>}{(r.status === 'pending' || role === 'parent' && r.status === 'approved') && <button className="secondary-button" disabled={pending} onClick={() => setConfirm({ title: '取消兑换？', text: '本次冻结或扣除的星币会全部退回。', body: { action: 'decide-reward', id: r.id, decision: 'cancel' } })}>{r.status === 'approved' ? '取消并退款' : '取消申请'}</button>}</div></article>)}{!data.requests.length && <p>兑换申请会显示在这里。</p>}</section>
   </>}
   {tab === 'history' && <section className="growth-panel"><h2>每一份努力都有记录</h2>{role === 'parent' && <details><summary>手动调整余额（必须填写原因）</summary><form className="growth-form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); setConfirm({ title: '确认调整余额？', text: `星币调整 ${f.get('coins')}，增加待投喂成长值 ${f.get('growth')}。原因：${f.get('reason')}`, body: { action: 'adjust-balance', coins: Number(f.get('coins')), growth: Number(f.get('growth')), reason: f.get('reason') } }); }}><div className="growth-form-row"><label>星币增减<input name="coins" type="number" min={-1000000} max={1000000} defaultValue={0} required/></label><label>增加成长值<input name="growth" type="number" min={0} max={1000000} defaultValue={0} required/></label></div><label>调整原因<input name="reason" maxLength={500} required/></label><button disabled={pending}>核对调整</button><small>不能扣除已冻结星币，也不减少宠物累计成长。</small></form></details>}<p className="muted">历史积分按1∶1保留为星币；投喂是成长值的转入，不会丢失累计成长。</p><div className="growth-ledger">{data.entries.map(e => <article key={e.id}><div><strong>{entryLabels[e.kind] ?? e.kind}</strong><small>{time(e.createdAt)}</small></div><p>{e.coins !== 0 && <span>{e.coins > 0 ? '+' : ''}{e.coins} 星币 </span>}{e.held !== 0 && <span>冻结 {e.held > 0 ? '+' : ''}{e.held} </span>}{e.growth !== 0 && <span>待投喂 {e.growth > 0 ? '+' : ''}{e.growth} </span>}{e.fed > 0 && <span>伙伴成长＋{e.fed}</span>}{typeof e.details.reason === 'string' && <small>原因：{e.details.reason}</small>}{e.details.itemKey ? ` · ${shopItems.find(i => i.key === e.details.itemKey)?.name ?? ''}` : ''}</p></article>)}</div>{!data.entries.length && <p>完成第一项任务，开启成长记录吧。</p>}</section>}
  </>}
  {confirm && <div className="growth-modal-backdrop"><section className="growth-modal" role="dialog" aria-modal="true" aria-label={confirm.title}><h2>{confirm.title}</h2><p>{confirm.text}</p><div className="growth-actions"><button disabled={pending} onClick={() => void send(confirm.body, confirm.notice).then(ok => { if (ok)
        setConfirm(null); })}>{pending ? '处理中…' : '确认'}</button><button className="secondary-button" disabled={pending} onClick={() => setConfirm(null)}>取消</button></div>{error && <p role="alert">{error}</p>}</section></div>}
  {memory && <div className="growth-modal-backdrop"><section className="growth-modal evolution-celebration" role="dialog" aria-modal="true" aria-label="见证伙伴成长"><p className="eyebrow">把这一刻，留在成长相册</p><h2>{memory.stage === 1 ? '你好，新伙伴！' : '每一份努力，都让我们更靠近。'}</h2><CompanionArt species={memory.species} stage={memory.stage} appearance={memory.appearance ?? 'animal'} large/><p>{speciesNames[memory.species]} · {stageNames[memory.stage]}</p>{canTransform(memory.species, memory.stage) && <button className="secondary-button" onClick={() => setMemory({ ...memory, appearance: memory.appearance === 'human' ? 'animal' : 'human' })}>{memory.appearance === 'human' ? '查看动物形态' : '预览这一阶段的人形'}</button>}<button onClick={() => setMemory(null)}>一起继续成长</button></section></div>}
 </div>;
}
