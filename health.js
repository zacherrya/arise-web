(function(){
  'use strict';
  const defaults={enabled:true,interval:120,glasses:1,start:'08:00',end:'20:00'};
  const minutes=value=>/^\d{2}:\d{2}$/.test(value)&&+value.slice(0,2)<24&&+value.slice(3)<60?+value.slice(0,2)*60+(+value.slice(3)):NaN;
  function validate(s){return !!s&&typeof s.enabled==='boolean'&&Number.isInteger(s.interval)&&s.interval>=15&&s.interval<=1440&&Number.isFinite(s.glasses)&&s.glasses>=.5&&s.glasses<=10&&s.glasses*2%1===0&&Number.isFinite(minutes(s.start))&&minutes(s.end)>minutes(s.start);}
  const dateKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  function slots(s,date){if(!validate(s)||!s.enabled)return[];const result=[];for(let m=minutes(s.start);m<=minutes(s.end);m+=s.interval){const d=new Date(date);d.setHours(Math.floor(m/60),m%60,0,0);result.push(d);}return result;}
  function next(s,now){for(let day=0;day<2;day++){const d=new Date(now);d.setDate(d.getDate()+day);const found=slots(s,d).find(t=>t>now);if(found)return found;}return null;}
  function create({getState,save,toast,notify=(title,body)=>toast(`${title} · ${body}`,'xp'),now=()=>new Date()}){
    const root=document.getElementById('healthSurface');if(!root)return null;
    let started=false,timer=null,lastCheck=+now(),draftDirty=false;
    function data(){const state=getState();if(!state.health||typeof state.health!=='object')state.health={};const h=state.health;if(!validate(h.water))h.water={...defaults};if(!Array.isArray(h.drinks))h.drinks=[];return h;}
    function transact(change){const state=getState(),before=JSON.stringify(state.health);try{change(data());save();return true;}catch(_){state.health=before===undefined?undefined:JSON.parse(before);message('Could not save. Please try again.');return false;}}
    function message(text){const el=root.querySelector('#waterStatus');if(el)el.textContent=text;}
    const glasses=n=>`${n} glass${n===1?'':'es'}`;
    const time=d=>d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
    function refresh(){
      const h=data(),s=h.water,date=now(),upcoming=next(s,date),today=h.drinks.filter(d=>d.day===dateKey(date)),total=today.reduce((sum,d)=>sum+(Number(d.glasses)||0),0);
      const set=(id,text)=>{const el=root.querySelector('#'+id);if(el)el.textContent=text;};
      set('waterTotal',glasses(total));set('waterLog',`Log ${glasses(s.glasses)}`);
      const muted=getState().notifications?.water===false;
      set('waterNext',muted?'Water alerts muted':!s.enabled?'Reminders paused':upcoming?`${dateKey(upcoming)!==dateKey(date)?'Tomorrow · ':''}${time(upcoming)}`:'No reminder scheduled');
      set('waterCountdown',muted?'Enable Water reminders in Settings to receive alerts.':upcoming?`In ${Math.max(1,Math.ceil((upcoming-date)/60000))} minutes · ${glasses(s.glasses)}`:'Turn reminders on in your settings.');
      set('waterSchedule',s.enabled?slots(s,date).map(time).join(' · '):'Your saved schedule will resume when enabled.');
      const undo=root.querySelector('#waterUndo');if(undo)undo.disabled=!today.length;
    }
    function render(){
      if(draftDirty){refresh();return;}
      const s=data().water;
      root.innerHTML=`<header class="health-head"><h2>Health</h2><p>Small habits. A little more care for yourself.</p></header><div class="health-grid"><section class="health-card water-overview" aria-labelledby="waterHeading"><span class="health-kicker">HYDRATION</span><h3 id="waterHeading">Time for a glass of water.</h3><p class="health-muted">Next reminder</p><div id="waterNext" class="water-time"></div><p id="waterCountdown" class="health-muted"></p><div class="water-total"><strong id="waterTotal"></strong><span>logged today</span></div><div class="water-actions"><button class="btn btn-primary" id="waterLog" type="button"></button><button class="btn btn-ghost" id="waterUndo" type="button">Undo last glass</button></div><p id="waterStatus" role="status" aria-live="polite"></p></section><section class="health-card"><h3>Your water rhythm</h3><form id="waterForm"><label class="water-enabled"><input type="checkbox" name="enabled" ${s.enabled?'checked':''}> Enable reminders</label><div class="water-fields"><label>Every (hours)<input name="hours" type="number" min="0.25" max="24" step="0.25" value="${s.interval/60}" required></label><label>Glasses per reminder<input name="glasses" type="number" min="0.5" max="10" step="0.5" value="${s.glasses}" required></label><label>Start time<input name="start" type="time" value="${s.start}" required></label><label>End time<input name="end" type="time" value="${s.end}" required></label></div><p class="health-muted">Same-day window, in your device’s local time. Reminders start at your start time; the end time is included when it lands on the interval.</p><button class="btn btn-primary" type="submit">Save rhythm</button></form></section></div><section class="health-card health-foot"><h3>Today’s reminder times</h3><p id="waterSchedule"></p><p class="health-muted">Reminders appear inside ARISE while it is open and awake. Closed apps and sleeping devices cannot deliver these reminders. Missed reminders won’t pile up. Apple Health is not connected.</p><p class="health-muted">This is your chosen routine, not a prescribed water intake. A glass has no fixed volume here.</p></section>`;
      refresh();
    }
    root.addEventListener('input',()=>{draftDirty=true;});
    root.addEventListener('submit',e=>{
      if(e.target.id!=='waterForm')return;e.preventDefault();const f=e.target.elements;
      const s={enabled:f.enabled.checked,interval:Number(f.hours.value)*60,glasses:Number(f.glasses.value),start:f.start.value,end:f.end.value};
      if(!validate(s)){message('Use a 15-minute to 24-hour interval, 0.5–10 glasses, and an end time after the start time.');return;}
      if(transact(h=>{h.water=s;h.lastWaterReminder=null;})){draftDirty=false;lastCheck=+now();render();message('Water rhythm saved.');}
    });
    root.addEventListener('click',e=>{
      const btn=e.target.closest('button');if(!btn)return;
      if(btn.id==='waterLog'){
        if(transact(h=>{const date=now();h.drinks.push({day:dateKey(date),at:+date,glasses:h.water.glasses});const cutoff=new Date(date);cutoff.setDate(cutoff.getDate()-90);h.drinks=h.drinks.filter(d=>d.day>=dateKey(cutoff));})){refresh();message('Water logged. Nice moment to reset.');}
      }
      if(btn.id==='waterUndo'){
        if(transact(h=>{for(let i=h.drinks.length-1;i>=0;i--)if(h.drinks[i].day===dateKey(now())){h.drinks.splice(i,1);break;}})){refresh();message('Last water entry removed.');}
      }
    });
    function tick(){
      const date=now(),h=data(),s=h.water;
      const due=slots(s,date).filter(d=>+d>lastCheck&&+d<=+date&&+date-d<60000).pop();lastCheck=+date;
      const key=due?`${dateKey(due)}:${due.getHours()}:${due.getMinutes()}`:null;
      if(key&&getState().notifications?.water!==false&&h.lastWaterReminder!==key&&transact(v=>{v.lastWaterReminder=key;})){
        void notify('Water break',`${glasses(s.glasses)}. Log it in Health when you’ve had it.`);message(`Time for ${glasses(s.glasses)}. Nothing is logged automatically.`);
      }
      refresh();
    }
    function start(){if(started)return;started=true;lastCheck=+now();render();timer=setInterval(tick,15000);}
    function stop(){if(timer!==null)clearInterval(timer);timer=null;started=false;}
    return{render,start,stop,tick};
  }
  const api={defaults,validate,slots,next,dateKey,create};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof window!=='undefined')window.ARISEHealth=api;
})();
