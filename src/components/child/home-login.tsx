'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ProfileSelector } from './profile-selector';
import type { AuthorizedChild } from '@/modules/devices/service';

type Options = { state: 'paired' | 'unpaired'; children: AuthorizedChild[] };
export function HomeLogin() {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function load() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setOptions(null); setError('');
    try {
      const response = await fetch('/api/child/login-options', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('暂时无法读取孩子列表，请稍后重试。');
      const value: Options = await response.json();
      if (!controller.signal.aborted) setOptions(value);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '加载失败，请重试。');
    }
  }
  function toggle() {
    if (open) { request.current?.abort(); setOpen(false); setOptions(null); return; }
    setOpen(true); void load();
  }
  return <>
    <div className="home-login-actions">
      <Link className="primary-link" href="/sign-in">家长登录</Link>
      <button className="primary-link" type="button" aria-expanded={open} aria-controls="home-child-login" onClick={toggle}>孩子登录</button>
    </div>
    {open && <section id="home-child-login" className="home-child-login" aria-label="孩子登录">
      {error ? <><p role="alert">{error}</p><button type="button" onClick={() => void load()}>重新加载</button></> : !options ? <p role="status">正在读取已配对的孩子…</p> : options.state === 'unpaired' ? <><h2>先连接这台设备</h2><p>此浏览器尚未配对，或配对已失效。请使用家长生成的配对码连接。</p><Link className="primary-link" href="/pair">输入配对码</Link></> : options.children.length === 0 ? <><h2>暂无可选孩子</h2><p>请让家长在“家庭设备”中为这台设备授权孩子。</p><Link href="/pair">输入配对码</Link></> : <ProfileSelector availableChildren={options.children} embedded autoSelectSingle={false}/>}
    </section>}
  </>;
}
