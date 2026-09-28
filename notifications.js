(function(){
  'use strict';
  const defaults={desktop:false,sound:true,calendar:true,water:true,custom:true,lead:10,eventOverrides:true};
  function preferences(raw={}){raw=raw||{};const s={...defaults};for(const k of ['desktop','sound','calendar','water','custom','eventOverrides'])if(typeof raw[k]==='boolean')s[k]=raw[k];if(Number.isInteger(raw.lead)&&raw.lead>=0&&raw.lead<=1440)s.lead=raw.lead;return s;}
  function reminders(events,s){
    if(!s.calendar)return[];
    return events.flatMap(e=>{
      if(e.status==='cancelled'||!e.start?.dateTime)return[];
      const start=Date.parse(e.start.dateTime);if(!Number.isFinite(start))return[];
      const offsets=s.eventOverrides&&e.reminders?.useDefault===false?(e.reminders.overrides||[]).filter(r=>r.method==='popup').map(r=>r.minutes):[s.lead];
      return [...new Set(offsets)].filter(n=>Number.isInteger(n)&&n>=0&&n<=1440).map(n=>({key:`${e.id}:${start}:${n}`,at:start-n*60000,start,title:e.summary||'Calendar task'}));
    });
  }
  function create({getState,save,getEvents,toast,now=()=>Date.now()}){
    const root=document.getElementById('notificationSettings');if(!root)return null;
    let previous=now(),started=false,timer=null;
    const native=()=>{const api=window.__TAURI__?.notification;if(!api)return null;return window.__TAURI__?.core?.invoke?{...api,sendNotification:options=>window.__TAURI__.core.invoke('plugin:notification|notify',{options})}:api;};
    const settings=()=>preferences(getState().notifications);
    function status(text){const el=root.querySelector('#notificationStatus');if(el)el.textContent=text;}
    function persist(s){const state=getState(),before=state.notifications;try{state.notifications=s;save();return true;}catch(_){state.notifications=before;status('Could not save notification settings. Please try again.');return false;}}
    function render(){
      const s=settings();root.innerHTML=`<h4>Reminders & notifications</h4><label><input type="checkbox" name="desktop" ${s.desktop?'checked':''}> Mac Notification Center</label><label><input type="checkbox" name="sound" ${s.sound?'checked':''}> Play a notification sound</label><label><input type="checkbox" name="calendar" ${s.calendar?'checked':''}> Calendar task reminders</label><label><input type="checkbox" name="water" ${s.water?'checked':''}> Water reminders</label><label>Default calendar notice (minutes before)<input type="number" name="lead" value="${s.lead}" min="0" max="1440" step="1"></label><label><input type="checkbox" name="eventOverrides" ${s.eventOverrides?'checked':''}> Use individual event reminder settings when present</label><div class="water-actions"><button class="btn btn-sm" id="notificationEnable" type="button">Enable Mac notifications</button><button class="btn btn-sm" id="notificationTest" type="button">Send test</button></div><p id="notificationStatus" role="status" aria-live="polite"></p><p class="health-muted">Keep ARISE running and your Mac awake. Notifications are not scheduled after quitting. Timed calendar events only; an event set to “no reminder” stays silent when individual settings are enabled. macOS Focus, notification permissions and volume can silence alerts. No permissions are requested on launch.</p>`;
      status(!native()?'Mac notifications require the updated installed ARISE app. This web preview uses in-app reminders.':s.desktop?'Mac notifications enabled in ARISE. Use Send test to check macOS delivery.':'Mac notifications are off. In-app reminders remain available.');
      root.insertAdjacentHTML?.('beforeend',`<label><input type="checkbox" name="custom" ${s.custom?'checked':''}> Custom reminders</label>`);
    }
    async function enable(){
      const api=native();if(!api){status('Open the updated installed app to enable Mac notifications.');renderDesktopCheckbox();return;}
      try{let granted=await api.isPermissionGranted();if(!granted)granted=await api.requestPermission()==='granted';if(granted){if(persist({...settings(),desktop:true})){render();status('Enabled. Send a test; if nothing appears, check System Settings → Notifications → ARISE.');}}else{status('Permission was not granted. Enable ARISE in System Settings → Notifications.');}}catch(_){status('Could not enable notifications. Check macOS notification settings.');}renderDesktopCheckbox();
    }
    function renderDesktopCheckbox(){const input=root.querySelector('[name="desktop"]');if(input)input.checked=settings().desktop;}
    async function deliver(category,title,body,test=false,options={}){
      const s=settings();if(!test&&!s[category])return;
      toast(`${title} · ${body}`,'xp');
      if(!s.desktop){if(test)status('Enable Mac notifications first.');return;}
      const api=native();if(!api){status('Mac notifications need the updated installed app.');return;}
      try{if(!await api.isPermissionGranted()){status('macOS notification permission is off. Enable it in System Settings.');return;}await api.sendNotification({title,body,...(s.sound&&options.sound!==false?{sound:'NSUserNotificationDefaultSoundName'}:{})});if(test)status(s.sound?'Test sent with the default Mac alert sound. If silent: System Settings → Notifications → ARISE → Play sound for notification. Also check Focus and output volume.':'Test sent silently because Play a notification sound is off in ARISE.');}catch(_){status('Mac notification failed. Your in-app reminder is still available.');}
    }
    root.addEventListener('change',e=>{
      const key=e.target.name;if(!Object.hasOwn(defaults,key))return;
      if(key==='desktop'&&e.target.checked){e.target.checked=false;void enable();return;}
      const value=key==='lead'?Number(e.target.value):e.target.checked;
      if(key==='lead'&&(!e.target.value||!Number.isInteger(value)||value<0||value>1440)){status('Choose 0–1440 whole minutes.');return;}
      if(persist({...settings(),[key]:value}))status('Notification settings saved.');
    });
    root.addEventListener('click',e=>{const id=e.target.closest('button')?.id;if(id==='notificationEnable')void enable();if(id==='notificationTest')void deliver('calendar','ARISE test','Your reminders will appear here.',true);});
    function tick(){
      const date=now(),s=settings(),state=getState(),old=Array.isArray(state.notificationHistory)?state.notificationHistory:[];
      const seen=new Set(old.map(r=>r.key));
      const custom=s.custom?(window.ARISECustomReminders?.occurrences(state.customReminders,date)||[]):[];
      const due=[...reminders(getEvents(),s),...custom].filter(r=>r.at>previous&&r.at<=date&&date-r.at<60000&&!seen.has(r.key));previous=date;
      for(const r of due){
        if(seen.has(r.key))continue;seen.add(r.key);
        const before=state.notificationHistory;state.notificationHistory=[...(Array.isArray(state.notificationHistory)?state.notificationHistory:[]),{key:r.key,at:date}].filter(x=>date-x.at<7*86400000).slice(-500);
        try{save();}catch(_){state.notificationHistory=before;status('Could not save reminder history; reminder skipped to avoid duplicates.');continue;}
        void deliver(r.category||'calendar',r.title,r.body||`Starts at ${new Date(r.start).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`,false,{sound:r.sound});
      }
    }
    function start(){if(started)return;started=true;previous=now();render();timer=setInterval(tick,15000);}
    function stop(){if(timer!==null)clearInterval(timer);timer=null;started=false;}
    return{render,start,stop,tick,deliver};
  }
  const api={defaults,preferences,reminders,create};if(typeof module!=='undefined'&&module.exports)module.exports=api;if(typeof window!=='undefined')window.ARISENotifications=api;
})();
