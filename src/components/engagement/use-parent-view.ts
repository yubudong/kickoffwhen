'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
export function useParentView<T>(endpoint: string) {
  const [data,setData]=useState<T|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState(false);
  const busy=useRef(false),keys=useRef(new Map<string,string>());
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    const r=await fetch(endpoint,{cache:'no-store',signal});const v=await r.json();if(!r.ok)throw new Error(v.error??'读取失败，请重试。');setData(v);
  },[endpoint]);
  useEffect(()=>{const c=new AbortController();const run=()=>void refresh(c.signal).catch(e=>{if(!c.signal.aborted)setError(e.message)});run();const id=window.setInterval(()=>{if(document.visibilityState==='visible')run()},15000);return()=>{c.abort();clearInterval(id)}},[refresh]);
  async function send(url:string,body:Record<string,unknown>,success='已保存。') {
    if(busy.current)return false;busy.current=true;setPending(true);setError('');setNotice('');
    const signature=JSON.stringify([url,body]);let commandId=keys.current.get(signature);if(!commandId){commandId=crypto.randomUUID();keys.current.set(signature,commandId)}
    try{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,commandId})});const v=await r.json();if(!r.ok)throw new Error(v.error??'操作失败，请刷新后重试。');await refresh();keys.current.delete(signature);setNotice(success);return true}
    catch(e){setError(e instanceof Error?e.message:'网络中断，请重试。');return false}
    finally{busy.current=false;setPending(false)}
  }
  return {data,error,notice,pending,send,refresh,setError};
}
