'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
type InstallEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
function subscribeOnline(listener:()=>void){window.addEventListener('online',listener);window.addEventListener('offline',listener);return()=>{window.removeEventListener('online',listener);window.removeEventListener('offline',listener)}}
export function PwaControls(){
 const online=useSyncExternalStore(subscribeOnline,()=>navigator.onLine,()=>true);
 const deferred=useRef<InstallEvent|null>(null),registration=useRef<ServiceWorkerRegistration|null>(null),reload=useRef(false);
 const [help,setHelp]=useState(false),[waiting,setWaiting]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{
  const install=(e:Event)=>{e.preventDefault();deferred.current=e as InstallEvent};window.addEventListener('beforeinstallprompt',install);
  let disposed=false;
  const controller=()=>{if(reload.current)window.location.reload()};
  if('serviceWorker' in navigator&&window.isSecureContext){
   navigator.serviceWorker.addEventListener('controllerchange',controller);
   void navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).then(reg=>{
    if(disposed)return;registration.current=reg;if(reg.waiting)setWaiting(true);
    reg.addEventListener('updatefound',()=>{const worker=reg.installing;worker?.addEventListener('statechange',()=>{if(!disposed&&worker.state==='installed'&&navigator.serviceWorker.controller)setWaiting(true)})});
   }).catch(()=>{if(!disposed)setMessage('主屏幕服务暂不可用，联网刷新后重试。')});
  }
  return()=>{disposed=true;window.removeEventListener('beforeinstallprompt',install);if('serviceWorker' in navigator)navigator.serviceWorker.removeEventListener('controllerchange',controller)};
 },[]);
 async function install(){if(deferred.current){await deferred.current.prompt();await deferred.current.userChoice;deferred.current=null}else setHelp(true)}
 async function update(){if(!online){setMessage('请先恢复网络后再更新。');return}if(!window.confirm('更新会刷新页面。请先保存正在进行的听写、批改或编辑，确认后继续。'))return;const reg=registration.current;if(reg?.waiting){reload.current=true;reg.waiting.postMessage({type:'SKIP_WAITING'})}else{await reg?.update().catch(()=>{});window.location.reload()}}
 return <>{!online&&<aside className="pwa-offline-layer" role="dialog" aria-modal="true" aria-label="离线隐私提示"><div><h2>网络暂时断开</h2><p>页面内容已暂时隐藏，听写会暂停。联网后可以回到原页面，不会自动提交或发奖。</p><p>请保留当前页面，恢复网络后核对状态再重试。没有将孩子资料、照片、答案或音频存入离线缓存。</p><button type="button" onClick={()=>setMessage(navigator.onLine?'网络已恢复，正在返回原页面。':'网络仍不可用，恢复后会自动显示原页面。')}>检查网络状态</button>{message&&<p role="status">{message}</p>}</div></aside>}
  <footer className="pwa-controls"><button type="button" onClick={()=>void install()}>添加到主屏幕</button><button type="button" onClick={()=>void update()}>{waiting?'发现新版本，点击更新':'检查并更新'}</button>{message&&<span role="status">{message}</span>}</footer>
  {help&&<div className="pwa-dialog-backdrop"><section className="pwa-dialog" role="dialog" aria-modal="true" aria-label="添加到主屏幕"><h2>像应用一样打开</h2><p>iPhone / iPad：用Safari打开本站，点“分享”，再选“添加到主屏幕”。</p><p>Android / Chrome：打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。电脑Chrome也可使用地址栏的安装入口。</p><p>离线只显示通用提示，不缓存孩子资料、照片、答案或音频。更新由你主动确认，不会在听写中自动刷新。</p><button type="button" onClick={()=>setHelp(false)}>知道了</button></section></div>}
 </>;
}
