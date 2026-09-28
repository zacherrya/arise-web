/* ARISE's offline app shell. Never cache Supabase, OAuth, or user data. */
const CACHE_NAME='arise-shell-2026-09-28-v3';
const CACHE_PREFIX='arise-shell-';
const SHELL=[
  './','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png',
  './achievements.css','./auth.css','./weekly-planner.css','./today.css','./tomorrow.css',
  './quick-actions.css','./ui-polish.css','./system-motion.css','./system-events.css',
  './health.css','./hand-control.css','./settings.css',
  './achievements.js','./bucket-list.js','./weekly-planner-engine.js','./weekly-planner.js',
  './today.js','./tomorrow.js','./quick-actions.js','./system-motion.js','./health.js',
  './notifications.js','./custom-reminders.js','./widget-snapshot.js','./hand-gestures.js',
  './hand-control.js','./cloud-config.js','./cloud-sync.js','./google-web.js','./cloud-data.js','./app.js','./pwa.js'
];
const shellURLs=new Set(SHELL.map(path=>new URL(path,self.registration.scope).href));

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys
    .filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE_NAME)
    .map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{
      const scopePath=new URL('./',self.registration.scope).pathname;
      if(response.ok&&(url.pathname===scopePath||url.pathname===scopePath+'index.html')){
        const copy=response.clone();event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put('./index.html',copy)));
      }
      return response;
    }).catch(()=>caches.match('./index.html')));
    return;
  }
  if(!shellURLs.has(url.href))return;
  event.respondWith(fetch(request).then(response=>{
    if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put(request,copy)));}
    return response;
  }).catch(()=>caches.match(request)));
});
