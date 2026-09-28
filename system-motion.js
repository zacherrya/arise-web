(function(){
  'use strict';
  const key='arise.effects',allowed=['minimal','system','cinematic'];
  let preference='system',notice=null,noticeTimer=null;
  const pendingNotices=[];
  const active=new Map(),media=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  try{const saved=localStorage.getItem(key);if(allowed.includes(saved))preference=saved;}catch{}
  function enabled(){return preference!=='minimal'&&!media?.matches&&!document.hidden;}
  function duration(ms){return enabled()?Math.min(900,Math.max(0,Number(ms)||0)*(preference==='cinematic'?1.2:1)):0;}
  function clear(){
    for(const [element,entry] of active){clearTimeout(entry.timer);element.classList.remove(entry.name);}active.clear();
    clearTimeout(noticeTimer);noticeTimer=null;pendingNotices.length=0;if(notice)notice.hidden=true;
  }
  function apply(){
    clear();document.documentElement.dataset.effects=enabled()?preference:'minimal';
    const select=document.getElementById('effectsMode');if(select)select.value=preference;
    const status=document.getElementById('effectsStatus');if(status)status.textContent=media?.matches?'Reduced Motion is enabled on your device. Effects are kept minimal.':preference==='minimal'?'Quiet feedback, without decorative motion.':preference==='cinematic'?'Stronger celebrations, with no sound or input delays.':'Subtle energy effects for meaningful actions.';
  }
  function setMode(value){if(!allowed.includes(value))return false;preference=value;try{localStorage.setItem(key,value);}catch{}apply();return true;}
  function pulse(element,name,ms=450){
    if(!element?.classList||!enabled())return;
    const previous=active.get(element);if(previous){clearTimeout(previous.timer);element.classList.remove(previous.name);}
    element.classList.remove(name);void element.offsetWidth;element.classList.add(name);
    const entry={name,timer:setTimeout(()=>{element.classList.remove(name);if(active.get(element)===entry)active.delete(element);},duration(ms))};active.set(element,entry);
  }
  function announce(title,detail=''){
    if(!enabled())return;
    if(noticeTimer!==null){if(pendingNotices.length<2)pendingNotices.push([title,detail]);return;}
    if(!notice){notice=document.createElement('div');notice.className='system-notice';notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');document.body.appendChild(notice);}
    clearTimeout(noticeTimer);notice.replaceChildren();
    const heading=document.createElement('strong'),description=document.createElement('span');heading.textContent=String(title);description.textContent=String(detail);notice.append(heading,description);notice.hidden=false;
    pulse(notice,'system-notice-enter',850);noticeTimer=setTimeout(()=>{
      notice.hidden=true;noticeTimer=null;const next=pendingNotices.shift();if(next)announce(...next);
    },duration(850));
  }
  window.AriseMotion={mode:()=>preference,enabled,duration,pulse,announce,setMode};
  document.getElementById('effectsMode')?.addEventListener('change',e=>setMode(e.target.value));
  media?.addEventListener?.('change',apply);
  document.addEventListener('visibilitychange',apply);
  apply();
})();
