(function(){
  'use strict';
  const dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const key=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  function valid(r){
    if(!r||typeof r.title!=='string'||!r.title.trim()||r.title.length>180||!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)||!['once','daily','weekly'].includes(r.repeat))return false;
    if(r.repeat==='once'){const d=new Date(r.date+'T12:00:00');if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Number.isFinite(+d)||key(d)!==r.date)return false;}
    return r.repeat!=='weekly'||Array.isArray(r.days)&&r.days.length>0&&r.days.every(n=>Number.isInteger(n)&&n>=0&&n<=6);
  }
  function occurrences(items,now){
    const date=new Date(now);return(Array.isArray(items)?items:[]).filter(r=>valid(r)&&r.enabled!==false&&(r.repeat==='daily'||r.repeat==='once'&&r.date===key(date)||r.repeat==='weekly'&&r.days.includes(date.getDay()))).map(r=>{const d=new Date(date),[h,m]=r.time.split(':').map(Number);d.setHours(h,m,0,0);return{key:`custom:${r.id}:${+d}`,at:+d,start:+d,title:r.title,body:r.note||'Time for your reminder.',category:'custom',sound:r.sound!==false};});
  }
  function create({getState,save,escapeHtml:esc,uid,confirm,now=()=>new Date()}){
    const root=document.getElementById('remindersSurface');if(!root)return null;let editing=null,built=false;
    const list=()=>Array.isArray(getState().customReminders)?getState().customReminders:[];
    const status=text=>{root.querySelector('#reminderStatus').textContent=text;};
    function commit(next){const s=getState(),before=s.customReminders;try{s.customReminders=next;save();return true;}catch(_){s.customReminders=before;status('Could not save. Your previous reminders are unchanged.');return false;}}
    function fields(){const f=root.querySelector('#reminderForm').elements;return f;}
    function visibility(){const f=fields();root.querySelector('#reminderDateLabel').hidden=f.repeat.value!=='once';f.date.required=f.repeat.value==='once';root.querySelector('#reminderDays').hidden=f.repeat.value!=='weekly';}
    function reset(r){editing=r?.id||null;const f=fields();f.title.value=r?.title||'';f.note.value=r?.note||'';f.time.value=r?.time||'09:00';f.repeat.value=r?.repeat||'daily';f.date.value=r?.date||key(now());f.sound.checked=r?.sound!==false;f.enabled.checked=r?.enabled!==false;root.querySelectorAll('[name="day"]').forEach(el=>el.checked=(r?.days||[1,2,3,4,5]).includes(+el.value));root.querySelector('#reminderSave').textContent=r?'Save changes':'Create reminder';visibility();}
    function renderList(){
      const date=now();root.querySelector('#reminderList').innerHTML=list().map(r=>{const expired=r.repeat==='once'&&new Date(`${r.date}T${r.time}`)<date;const schedule=r.repeat==='once'?r.date:r.repeat==='daily'?'Every day':(r.days||[]).map(n=>dayNames[n]).join(', ');return `<article class="health-card reminder-item"><div><h3>${esc(r.title)}</h3><p class="health-muted">${esc(schedule)} · ${esc(r.time)}${r.enabled===false?' · Paused':expired?' · Past':''}${r.sound===false?' · Silent':''}</p>${r.note?`<p>${esc(r.note)}</p>`:''}</div><div class="water-actions"><button class="btn btn-sm" data-edit-reminder="${esc(r.id)}">Edit</button><button class="btn btn-sm" data-pause-reminder="${esc(r.id)}">${r.enabled===false?'Resume':'Pause'}</button><button class="btn btn-sm btn-ghost" data-delete-reminder="${esc(r.id)}">Delete</button></div></article>`;}).join('')||'<p class="health-muted">No reminders yet. Add something you’d like a nudge for.</p>';
    }
    function render(){
      if(!built){root.innerHTML=`<header class="health-head"><h2>Reminders</h2><p>A little nudge for anything you want to remember.</p></header><div class="health-grid"><section class="health-card"><h3>Your next reminder</h3><form id="reminderForm"><label class="reminder-field">What should we remind you about?<input name="title" required maxlength="180" placeholder="Stretch, call someone, take a screen break…"></label><label class="reminder-field">Note · optional<textarea name="note" maxlength="500" rows="2"></textarea></label><div class="water-fields"><label>Time<input name="time" type="time" required></label><label>Repeat<select name="repeat"><option value="daily">Every day</option><option value="weekly">Selected days</option><option value="once">Once</option></select></label><label id="reminderDateLabel">Date<input name="date" type="date"></label></div><fieldset id="reminderDays"><legend>On these days</legend>${dayNames.map((d,i)=>`<label><input name="day" type="checkbox" value="${i}"> ${d}</label>`).join('')}</fieldset><label class="water-enabled"><input name="enabled" type="checkbox"> Reminder active</label><label class="water-enabled"><input name="sound" type="checkbox"> Sound (when global sound is enabled)</label><div class="water-actions"><button id="reminderSave" class="btn btn-primary" type="submit">Create reminder</button><button id="reminderCancel" class="btn" type="button">Clear / cancel</button></div></form><p id="reminderStatus" role="status" aria-live="polite"></p><p class="health-muted">Uses local time. Keep ARISE running and your Mac awake. Enable Mac notifications in Settings for system banners. Missed reminders aren’t replayed.</p></section><section><h3>Saved reminders</h3><div id="reminderList"></div></section></div>`;built=true;reset();}renderList();
    }
    root.addEventListener('change',e=>{if(e.target.name==='repeat')visibility();});
    root.addEventListener('submit',e=>{
      if(e.target.id!=='reminderForm')return;e.preventDefault();const f=fields();
      const r={id:editing||uid('reminder'),title:f.title.value.trim(),note:f.note.value.trim(),time:f.time.value,repeat:f.repeat.value,date:f.date.value,days:Array.from(root.querySelectorAll('[name="day"]:checked')).map(el=>+el.value),sound:f.sound.checked,enabled:f.enabled.checked};
      if(!valid(r)){status('Add a title, valid time and date, and at least one day for a weekly reminder.');return;}
      if(r.repeat==='once'&&new Date(`${r.date}T${r.time}`)<=now()){status('Choose a future date and time for a one-off reminder.');return;}
      if(editing&&!list().some(x=>x.id===editing)){status('This reminder no longer exists. Clear the form to create a new one.');return;}
      if(commit(editing?list().map(x=>x.id===editing?r:x):[...list(),r])){reset();renderList();status('Reminder saved.');}
    });
    root.addEventListener('click',async e=>{
      const b=e.target.closest('button');if(!b)return;if(b.id==='reminderCancel'){reset();status('Ready for a new reminder.');return;}
      const id=b.dataset.editReminder||b.dataset.pauseReminder||b.dataset.deleteReminder,r=list().find(x=>x.id===id);if(!r)return;
      if(b.dataset.editReminder){reset(r);fields().title.focus();status('Editing reminder.');}
      if(b.dataset.pauseReminder&&commit(list().map(x=>x.id===id?{...x,enabled:x.enabled===false}:x))){renderList();if(editing===id)fields().enabled.checked=r.enabled===false;}
      if(b.dataset.deleteReminder&&await confirm(`Delete “${r.title}”?`,{title:'Delete reminder',okLabel:'Delete'})){if(commit(list().filter(x=>x.id!==id))){if(editing===id)reset();renderList();status('Reminder deleted.');}}
    });
    return{render};
  }
  const api={valid,occurrences,create};if(typeof module!=='undefined'&&module.exports)module.exports=api;if(typeof window!=='undefined')window.ARISECustomReminders=api;
})();
