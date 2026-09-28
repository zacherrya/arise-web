window.ARISETomorrow={create(api){
  const {getState,todayStr,escapeHtml:esc,progressPct,getEvents,createTask,openCalendar,scheduleTask,setView,toast}=api;
  const root=document.getElementById('tomorrowSurface');
  let busy=false;
  function date(){const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+1);return d;}
  function dateKey(){return todayStr(date());}
  function projects(){return getState().projects||[];}
  function tasks(){return projects().flatMap(p=>(p.tasks||[]).filter(g=>g.due===dateKey()&&progressPct(g)<100).map(g=>({p,g,pct:progressPct(g)})));}
  function agenda(){
    const day=date(),key=dateKey();
    return getEvents(day).filter(e=>{
      const start=new Date(e.start?.dateTime||`${e.start?.date}T00:00:00`);
      return todayStr(start)===key;
    }).sort((a,b)=>new Date(a.start?.dateTime||a.start?.date)-new Date(b.start?.dateTime||b.start?.date));
  }
  function projectOptions(selected){return projects().map(p=>`<option value="${esc(p.id)}" ${p.id===selected?'selected':''}>${esc(p.emoji||'')} ${esc(p.name)}</option>`).join('');}
  function plannedCard({p,g,pct}){
    const event=agenda().find(e=>(e.description||'').includes(`[ARISE_GATE:${p.id}:${g.id}]`));
    const when=event?.start?.dateTime?new Date(event.start.dateTime).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'Time not set';
    return `<article class="tomorrow-task"><div><span class="tomorrow-project">${esc(p.name)}</span><strong>${esc(g.title)}</strong><span>${esc(when)} · ${g.durationMin||60}m</span></div>${event?'<button type="button" class="btn btn-sm" data-tomorrow-calendar="1">View calendar</button>':`<button type="button" class="btn btn-sm" data-tomorrow-schedule="${esc(p.id+':'+g.id)}">Set time</button>`}</article>`;
  }
  function rhythmItem(e){
    const allDay=!e.start?.dateTime,start=allDay?'All day':new Date(e.start.dateTime).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    const end=!e.end?.dateTime?'':new Date(e.end.dateTime).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    return `<div class="tomorrow-rhythm-item"><time>${esc(start)}${end?' – '+esc(end):''}</time><div><strong>${esc(e.summary||'Untitled')}</strong><span>${(e.description||'').includes('[ARISE_GATE:')?'Linked task':'Calendar block'}</span></div></div>`;
  }
  function render(){
    if(!root)return;
    const day=date(),list=tasks(),events=agenda(),selected=root.querySelector?.('#tomorrowProject')?.value||projects()[0]?.id||'';
    root.innerHTML=`<header class="day-head tomorrow-head"><div><div class="day-kicker">${day.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'})}</div><h1>Give tomorrow a shape.</h1><p class="day-muted">Capture what matters now. Add a time only when you want to protect space for it.</p></div><button class="btn" data-tomorrow-calendar="1">Open calendar</button></header>
      <div class="tomorrow-layout">
        <section class="day-panel tomorrow-planner"><div class="day-kicker">Tomorrow’s task list</div><h2>Add what you need to do</h2><form id="tomorrowTaskForm">
          <label class="day-label" for="tomorrowTitle">Task</label><input id="tomorrowTitle" name="title" maxlength="180" placeholder="What needs to move forward?" required>
          <label class="day-label" for="tomorrowProject">Project</label><select id="tomorrowProject" name="project" required ${projects().length?'':'disabled'}><option value="">Choose a project</option>${projectOptions(selected)}</select>
          <div class="tomorrow-time-row"><label class="day-label" for="tomorrowTime">Time <span>optional</span><input id="tomorrowTime" name="time" type="time"></label><label class="day-label" for="tomorrowDuration">Duration<select id="tomorrowDuration" name="duration"><option value="30">30 min</option><option value="45">45 min</option><option value="60" selected>1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option></select></label></div>
          <p class="tomorrow-time-hint">Set a time and ARISE will automatically reserve it in Calendar. Leave it blank to keep the task flexible.</p>
          <button class="btn btn-primary tomorrow-add" type="submit" ${projects().length?'':'disabled'}>${busy?'Adding…':'Add to tomorrow'}</button>
          ${projects().length?'':'<p class="day-status">Create a project first, then return here to plan its tasks.</p><button class="btn" type="button" data-tomorrow-projects="1">Create a project</button>'}
        </form>
        <div class="tomorrow-list"><div class="day-row"><h2>Planned tasks</h2><span class="day-muted">${list.length} open</span></div>${list.map(plannedCard).join('')||'<div class="tomorrow-empty">Nothing committed yet. Start with one task that would make tomorrow feel successful.</div>'}</div></section>
        <aside class="day-panel tomorrow-rhythm"><div class="day-row"><div><div class="day-kicker">Day rhythm</div><h2>Tomorrow at a glance</h2></div><span class="tomorrow-date-badge">${day.toLocaleDateString([],{weekday:'short',day:'numeric'})}</span></div>${events.length?events.map(rhythmItem).join(''):'<div class="tomorrow-open-space"><span>Open day</span><strong>Your time is still yours.</strong><p>Add a time to a task when you are ready to protect that space.</p></div>'}</aside>
      </div>`;
  }
  async function submit(event){
    event.preventDefault();if(busy)return;
    const form=event.target,title=form.elements.title.value.trim(),projectId=form.elements.project.value,time=form.elements.time.value,duration=Number(form.elements.duration.value);
    busy=true;form.querySelector('button[type="submit"]').disabled=true;
    try{await createTask({title,projectId,time,duration});toast(time?'Task added and time protected in Calendar.':'Task added to tomorrow.','xp');render();setTimeout(()=>root.querySelector?.('#tomorrowTitle')?.focus(),0);}
    catch(error){toast((error&&error.message)||String(error),'danger');form.querySelector('button[type="submit"]').disabled=false;}
    finally{busy=false;}
  }
  root?.addEventListener('submit',event=>{if(event.target.id==='tomorrowTaskForm')return submit(event);});
  root?.addEventListener('click',event=>{const schedule=event.target.closest('[data-tomorrow-schedule]');if(schedule){scheduleTask?.(schedule.dataset.tomorrowSchedule);return;}if(event.target.closest('[data-tomorrow-calendar]'))(openCalendar||(()=>setView('calendar')))();if(event.target.closest('[data-tomorrow-projects]'))setView('quests');});
  return {render,dateKey,tasks,agenda};
}};
