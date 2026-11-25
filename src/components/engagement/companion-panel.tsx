'use client';

import { useState } from 'react';
import './companion.css';
import type { EngagementView } from '@/modules/engagement/types';
import { canTransform, companionCatalog, maxStage, speciesKeys, speciesNames, stageNames, stages, type Species } from '@/modules/engagement/companion-catalog';
import { CompanionArt } from './companion-art';

type Confirmation = { title: string; text: string; body: Record<string, unknown>; notice?: string };
type Props = {
  data: EngagementView;
  role: 'parent' | 'child';
  pending: boolean;
  onAction: (body: Record<string, unknown>, success?: string) => Promise<boolean>;
  onConfirm: (confirmation: Confirmation) => void;
  onMemory: (memory: { species: Species; stage: number }) => void;
};

export function CompanionPanel({ data, role, pending, onAction, onConfirm, onMemory }: Props) {
  const [selected, setSelected] = useState<Species>('dragon');
  const [filter, setFilter] = useState<'all' | 'animal' | 'human'>('all');
  const [previewHuman, setPreviewHuman] = useState(false);
  const [previewStyle, setPreviewStyle] = useState<'boy' | 'girl'>('girl');
  const pet = data.pet;
  const catalog = companionCatalog[selected];

  if (!pet) return <section className="growth-panel adoption-panel">
    <h2>挑选一颗宠物蛋</h2>
    <p>八位伙伴，四个成长形态。每位成长速度相同，选择你喜欢的模样。</p>
    <div className="companion-filters" role="group" aria-label="伙伴类型">
      {([['all', '全部伙伴 · 8'], ['animal', '动物／神兽路线 · 4'], ['human', '可解锁人形 · 4']] as const).map(([value, text]) =>
        <button key={value} type="button" aria-pressed={filter === value} disabled={pending} onClick={() => { setFilter(value); if (value !== 'all' && companionCatalog[selected].canTransform !== (value === 'human')) { setSelected(speciesKeys.find(s => companionCatalog[s].canTransform === (value === 'human'))!); setPreviewHuman(false); } }}>{text}</button>)}
    </div>
    <div className="egg-options expanded-eggs">
      {speciesKeys.filter(s => filter === 'all' || companionCatalog[s].canTransform === (filter === 'human')).map(s =>
        <button type="button" key={s} aria-pressed={selected === s} disabled={pending} onClick={() => { setSelected(s); setPreviewHuman(false); }}>
          <CompanionArt species={s} stage={0}/>
          <strong>{speciesNames[s]}蛋</strong>
          <span className={`species-kind ${companionCatalog[s].canTransform ? 'transform-kind' : ''}`}>{companionCatalog[s].canTransform ? '少年期可解锁人形' : '动物／神兽成长路线'}</span>
          <span>{companionCatalog[s].personality}</span>
        </button>)}
    </div>
    <section className="companion-preview" aria-label="伙伴成长预览">
      <div className="growth-heading"><div><h3>{speciesNames[selected]}的成长故事</h3><p>{catalog.description}</p></div>
        {catalog.canTransform && <div className="growth-actions"><button type="button" aria-pressed={!previewHuman} onClick={() => setPreviewHuman(false)}>预览动物形态</button><button type="button" aria-pressed={previewHuman} onClick={() => setPreviewHuman(true)}>预览化形路线</button></div>}
      </div>
      {previewHuman && catalog.canTransform && <label className="preview-style">人形外观<select aria-label="预览人形外观" value={previewStyle} onChange={e => setPreviewStyle(e.target.value as 'boy' | 'girl')}><option value="girl">少女／成年女性</option><option value="boy">少年／成年男性</option></select></label>}
      <div className="growth-route four-stage-route">{[1, 2, 3, 4].map(stage => <article key={stage}>
        <CompanionArt species={selected} stage={stage} appearance={previewHuman ? 'human' : 'animal'} humanStyle={previewStyle}/>
        <strong>{stageNames[stage]}</strong><span>{catalog.forms[stage - 1]}</span><small>累计 {stages[stage]} 成长值{previewHuman && canTransform(selected, stage) ? ' · 人形可选' : ''}</small>
      </article>)}</div>
    </section>
    <form className="growth-inline-form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void onAction({ action: 'choose-pet', species: selected, name: f.get('name') }, '伙伴的小屋准备好了！'); }}>
      <label>伙伴的名字<input name="name" required maxLength={24} defaultValue={speciesNames[selected]} key={selected}/></label><button disabled={pending}>领养这颗蛋</button>
    </form>
    <p className="muted">蛋期可以更换；孵化后由家长确认更换，星币、成长值和通用物品都会保留。</p>
  </section>;

  const species = pet.species as Species;
  const viewed = pet.displayStage;
  const info = companionCatalog[species];
  const ready = pet.stage < maxStage && data.wallet.fed >= stages[pet.stage + 1];
  const humanAvailable = canTransform(species, viewed);
  const adult = viewed === maxStage;
  function changeDisplay(displayStage: number) {
    void onAction({ action: 'appearance', displayStage, appearance: canTransform(species, displayStage) ? pet!.appearance : 'animal', humanStyle: pet!.humanStyle }, '已切换外观，真实成长进度保持不变。');
  }
  return <section className="companion-home growth-panel">
    <div className={`companion-scene ${pet.equipped.background === 'star-room' ? 'star-room' : ''}`}>
      <div className="scene-orbit"/><div className="companion-stage-badge">{stageNames[viewed]}{viewed !== pet.stage ? ' · 回看外观' : ''}</div>
      <CompanionArt species={species} stage={viewed} name={pet.name} appearance={pet.appearance} humanStyle={pet.humanStyle} large/>
      {pet.equipped.charm && <span className="companion-charm" aria-label={pet.equipped.charm === 'scarf' ? '暖阳围巾' : '月光小灯'}>{pet.equipped.charm === 'scarf' ? '🧣' : '🌙'}</span>}
    </div>
    <div className="companion-info">
      <p className="eyebrow">{speciesNames[species]} · 成长等级 {Math.floor(data.wallet.fed / 100) + 1}</p><h2>{pet.name}</h2>
      <p className="species-route-label">{info.canTransform ? '少年期起可选择人形，也可以一直保持动物形态。' : '动物／神兽成长路线，始终保留伙伴本来的模样。'}</p>
      <p>{pet.stage === 0 ? '给蛋注入成长能量，等你亲手开启孵化。' : ready ? '新的变化准备好了，等你一起见证。' : '我会在这里等你。每一份努力，都值得被记住。'}</p>
      <label className="growth-progress-label">{pet.stage < maxStage ? `已解锁${stageNames[pet.stage]} · 下一阶段：${data.wallet.fed} / ${stages[pet.stage + 1]}` : `已解锁成年期 · 累计吸收 ${data.wallet.fed} 点成长值`}
        <progress max={pet.stage < maxStage ? stages[pet.stage + 1] : 100} value={pet.stage < maxStage ? data.wallet.fed : data.wallet.fed % 100}/>
      </label>
      {ready ? <button className="growth-primary" disabled={pending} onClick={() => { const stage = pet.stage + 1; void onAction({ action: 'evolve' }, stage === 1 ? '新的伙伴孵化了！' : '伙伴迎来了新的成长！').then(ok => { if (ok) onMemory({ species, stage }); }); }}>{pet.stage === 0 ? '开始孵化' : '见证成长'}</button> :
        <form className="growth-inline-form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void onAction({ action: 'feed', amount: Number(f.get('amount')) }, '伙伴收到了你的成长能量！'); }}>
          <label>投喂成长值<input aria-label="投喂成长值" name="amount" type="number" min={1} max={1000000} defaultValue={10} required/></label><button className="growth-primary" disabled={pending || data.wallet.growth === 0}>投喂成长值</button>
        </form>}
      <p className="muted">{pet.stage < maxStage ? '投喂会停在下一个门槛，等待你亲手开启变化。' : '已解锁成年期，之后的投喂会继续积累成长等级。'}</p>
      {pet.stage > 0 && <section className="companion-wardrobe" aria-label="外观选择">
        <label>展示年龄<select aria-label="展示年龄" value={viewed} disabled={pending} onChange={e => changeDisplay(Number(e.target.value))}>{[1, 2, 3, 4].map(stage => <option key={stage} value={stage} disabled={stage > pet.stage}>{stageNames[stage]}{stage > pet.stage ? ' · 尚未解锁' : ''}</option>)}</select></label>
        <small>可以选回已解锁的外观，不改变成长值和成长阶段。</small>
        {humanAvailable ? <div className="growth-actions"><button disabled={pending} onClick={() => void onAction({ action: 'appearance', appearance: pet.appearance === 'human' ? 'animal' : 'human', humanStyle: pet.humanStyle })}>{pet.appearance === 'human' ? `变回${speciesNames[species]}` : '化为人形'}</button>{pet.appearance === 'human' && <button disabled={pending} onClick={() => void onAction({ action: 'appearance', appearance: 'human', humanStyle: pet.humanStyle === 'girl' ? 'boy' : 'girl' })}>{adult ? '切换成年男／女形象' : '切换少年／少女形象'}</button>}</div> : info.canTransform && <p className="muted">当前年龄保持动物形态，少年期起可以选择人形。</p>}
      </section>}
      <details><summary>{pet.stage === 0 ? '更换宠物蛋' : '更换伙伴（家长操作）'}</summary>
        {pet.stage === 0 || role === 'parent' ? <form className="growth-form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); onConfirm({ title: '更换伙伴', text: '成长值、星币、已解锁年龄和通用物品都会保留。', body: { action: 'choose-pet', species: f.get('species'), name: f.get('name') } }); }}>
          <label>伙伴<select name="species" defaultValue={species}>{speciesKeys.map(s => <option key={s} value={s}>{speciesNames[s]} · {companionCatalog[s].canTransform ? '可化形' : '动物／神兽'}</option>)}</select></label><label>名字<input name="name" defaultValue={pet.name} maxLength={24} required/></label><button disabled={pending}>确认更换</button>
        </form> : <p>请家长在“习惯与成长”页面更换伙伴。</p>}
      </details>
    </div>
  </section>;
}
