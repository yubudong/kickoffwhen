/* Only generic public shell files are cached. Authenticated content never enters CacheStorage. */
const SHELL_CACHE='family-learning-shell-v1';
const PUBLIC_SHELL=['/offline.html','/icons/icon-192.png','/icons/icon-512.png','/icons/apple-touch-icon.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(PUBLIC_SHELL)));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('family-learning-shell-')&&key!==SHELL_CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 if(request.mode==='navigate'){
  event.respondWith(fetch(request,{cache:'no-store',credentials:'include'}).catch(()=>caches.match('/offline.html')));
  return;
 }
 if(PUBLIC_SHELL.includes(url.pathname)&&url.search==='')event.respondWith(caches.match(url.pathname).then(cached=>cached??fetch(request)));
});
