window.ARISEWeekInsights={summarize({start,today,days,tasks}){
  const dates=Array.from({length:7},(_,i)=>{const d=new Date(start+'T12:00:00');d.setDate(d.getDate()+i);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;});
  const rows=dates.map(date=>{const r=date<=today?days[date]||{}:{};return {date,future:date>today,sessions:Math.max(0,Number(r.focusSessions)||0),tracked:r.focusSessions!==undefined,reviewed:!!r.reviewedAt,reflection:r.reviewedAt?String(r.reflection||''):'',carry:r.reviewedAt?[...new Set(r.nextCarry||[])]:[]};});
  const counts=new Map();rows.forEach(r=>r.carry.forEach(id=>counts.set(id,(counts.get(id)||0)+1)));
  return {rows,sessions:rows.reduce((n,r)=>n+r.sessions,0),reviews:rows.filter(r=>r.reviewed).length,trackedDays:rows.filter(r=>r.tracked).length,repeated:tasks.filter(t=>t.pct<100&&(counts.get(t.id)||0)>=2).map(t=>({id:t.id,title:t.title,count:counts.get(t.id)})).sort((a,b)=>b.count-a.count)};
}};
window.ARISEToday={create(api){
  const {getState,todayStr,escapeHtml:esc,computeScore,dueMultiplier,progressPct,getEvents,save,setView,startFocus,completeTask,toast,weekStart}=api;
  const root=document.getElementById('todaySurface'),focus=document.getElementById('focusTaskContext');
  let catchup=null,reviewDate=null,insightOffset=0;
  const uiMemory=new Map();
  function controlKey(el){
    if(el.id)return '#'+el.id;
    const task=el.closest?.('.day-task');
    const owner=task?.querySelector('[data-day-start]')?.dataset.dayStart||'';
    return owner+'|'+el.tagName+'|'+JSON.stringify(el.dataset||{})+'|'+(el.tagName==='DETAILS'?el.querySelector('summary')?.textContent:el.tagName==='SUMMARY'?el.textContent:'');
  }
  function preserveUI(container,update){
    if(!container?.querySelectorAll){update();return;}
    const active=document.activeElement,inside=container.contains?.(active),key=inside?controlKey(active):null;
    const selection=inside?[active.selectionStart,active.selectionEnd]:null;
    const scrolls=[];for(let el=container;el;el=el.parentElement)scrolls.push([el,el.scrollTop,el.scrollLeft]);
    const x=window.scrollX,y=window.scrollY;
    const memory=uiMemory.get(container)||new Map();
    const fields=()=>Array.from(container.querySelectorAll('details,input,textarea,select,button,summary'));
    if(!reviewDate||reviewDate===day())fields().forEach(el=>{
      if(el.tagName==='DETAILS')memory.set(controlKey(el),{open:el.open});
      else if(el.matches?.('#dayReflection,[data-day-carry],[data-snooze-date],[data-snooze-reason]'))memory.set(controlKey(el),{value:el.value,checked:el.checked});
    });
    uiMemory.set(container,memory);update();
    fields().forEach(el=>{const saved=memory.get(controlKey(el));if(!saved)return;if('open'in saved)el.open=saved.open;else{el.value=saved.value;el.checked=saved.checked;}});
    if(key){const target=fields().find(el=>controlKey(el)===key);if(target){target.focus?.({preventScroll:true});if(selection?.[0]!=null)try{target.setSelectionRange(...selection);}catch{}}else{const heading=container.querySelector('h2');if(heading){heading.tabIndex=-1;heading.focus?.({preventScroll:true});}}}
    scrolls.forEach(([el,top,left])=>{el.scrollTop=top;el.scrollLeft=left;});
    if(Number.isFinite(y)&&window.scrollTo)window.scrollTo(x,y);
  }
  function foldSections(){
    if(!root.querySelector)return;
    const review=root.querySelector('#dayReflection')?.closest('.day-panel');
    const weekly=root.querySelector('#dayWeeklyInsights > .day-panel');
    const snoozed=root.querySelector('.day-snoozed-panel');
    [[review,'dayReviewFold','Review your day'],[weekly,'dayInsightsFold','Weekly insights'],[snoozed,'daySnoozedFold','Set-aside tasks']].forEach(([panel,id,label])=>{
      if(!panel||panel.querySelector('#'+id))return;const details=document.createElement('details'),summary=document.createElement('summary');details.id=id;details.className='day-section-fold';summary.textContent=label;details.appendChild(summary);while(panel.firstChild)details.appendChild(panel.firstChild);panel.appendChild(details);
    });
  }
  const day=()=>todayStr();
  function execution(){const state=getState();state.execution||={days:{}};state.execution.days||={};return state.execution;}
  function record(date=day()){return execution().days[date]||{};}
  const isSnoozed=g=>!!g.snoozedUntil&&g.snoozedUntil>day();
  function tomorrow(){const date=new Date(day()+'T12:00:00');date.setDate(date.getDate()+1);return todayStr(date);}
  function snoozeControls(t){return `<details class="day-snooze"><summary>Not now? Set this aside</summary><p class="day-muted">Hide from Today’s top three until the chosen date. Deadlines and calendar blocks stay unchanged${t.g.due?'; this gate is due '+esc(t.g.due):''}.</p><label class="day-label">Bring back on<input type="date" data-snooze-date min="${tomorrow()}" value="${tomorrow()}" required></label><label class="day-label">Reason · optional<input type="text" data-snooze-reason maxlength="300" placeholder="Waiting for feedback, or a better time…"></label><button type="button" class="btn btn-sm" data-day-snooze="${esc(t.id)}">Snooze from Today</button></details>`;}
  function snoozedCard(){const paused=tasks().filter(t=>t.pct<100&&isSnoozed(t.g));if(!paused.length)return '';return `<section class="day-panel day-snoozed-panel"><h2>Set aside, not forgotten.</h2><p class="day-muted">These gates return to Today’s priority pool on their return date. You can bring them back sooner.</p>${paused.map(t=>`<div class="day-agenda"><div><strong>${esc(t.g.title)}</strong><p class="day-muted">Returns ${esc(t.g.snoozedUntil)}${t.g.due?' · Due '+esc(t.g.due):''}${t.g.snoozeReason?'<br>'+esc(t.g.snoozeReason):''}</p>${t.g.due&&t.g.due<t.g.snoozedUntil?'<p class="day-muted">Its deadline falls before the return date. Snoozing does not extend the deadline.</p>':''}</div><button type="button" class="btn btn-sm" data-day-resume="${esc(t.id)}">Bring back</button></div>`).join('')}</section>`;}
  function setSnooze(id,date,reason=''){
    const task=tasks().find(t=>t.id===id);if(!task||task.pct===100)return false;
    if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(+new Date(date+'T12:00:00'))||todayStr(new Date(date+'T12:00:00'))!==date||date<=day())){toast('Choose a return date after today.','danger');return false;}
    const before={until:task.g.snoozedUntil,reason:task.g.snoozeReason};
    if(date){task.g.snoozedUntil=date;task.g.snoozeReason=String(reason).trim().slice(0,300);}else{delete task.g.snoozedUntil;delete task.g.snoozeReason;}
    try{save();render();toast(date?'Set aside until '+date:'Back in your priority pool.','xp');return true;}
    catch(error){if(before.until===undefined)delete task.g.snoozedUntil;else task.g.snoozedUntil=before.until;if(before.reason===undefined)delete task.g.snoozeReason;else task.g.snoozeReason=before.reason;toast('Could not save this change. Please try again.','danger');return false;}
  }
  function leaves(g){return (g.children||[]).flatMap(n=>n.children?.length?leaves(n):[n]);}
  function tasks(){return getState().projects.flatMap(p=>(p.tasks||[]).map(g=>({p,g,id:p.id+':'+g.id,pct:progressPct(g),score:computeScore(g.urgency,g.impact,g.effort)*dueMultiplier(g.due)})));}
  function agenda(){const date=day();return getEvents(new Date(date+'T12:00:00')).filter(e=>{const s=new Date(e.start?.dateTime||`${e.start?.date}T00:00:00`),end=new Date(e.end?.dateTime||`${e.end?.date}T00:00:00`);const start=new Date(date+'T00:00:00'),next=new Date(start);next.setDate(next.getDate()+1);return s<next&&end>start;}).sort((a,b)=>new Date(a.start.dateTime||a.start.date)-new Date(b.start.dateTime||b.start.date));}
  function recommendations(){
    const carries=record().carry||[],events=agenda();
    return tasks().filter(t=>t.pct<100&&!isSnoozed(t.g)).map(t=>({...t,scheduled:events.some(e=>(e.description||'').includes(`[ARISE_GATE:${t.id}]`)),carried:carries.includes(t.id)})).sort((a,b)=>Number(b.carried)-Number(a.carried)||Number(b.scheduled)-Number(a.scheduled)||b.score-a.score).slice(0,3);
  }
  function why(t){return [t.carried?'Chosen in your previous daily review':t.scheduled?'Already planned for today':'Highest remaining priority',t.g.due?(t.g.due<day()?'overdue since '+t.g.due:t.g.due===day()?'due today':'due '+t.g.due):'no deadline',`priority ${t.score.toFixed(1)}`].join(' · ');}
  function weeklyCard(){
    const start=weekStart(new Date(day()+'T12:00:00'));start.setDate(start.getDate()+insightOffset*7);
    const data=window.ARISEWeekInsights.summarize({start:todayStr(start),today:day(),days:execution().days,tasks:tasks().map(t=>({id:t.id,title:t.g.title,pct:t.pct}))});
    return `<section class="day-panel"><div class="day-row"><div><div class="day-kicker">Weekly perspective</div><h2 style="margin-top:6px">Small steps add up.</h2></div><div class="day-row"><button class="btn btn-sm" data-day-week="-1" aria-label="Previous insights week">‹</button><span class="day-muted">${start.toLocaleDateString([],{month:'short',day:'numeric'})}</span><button class="btn btn-sm" data-day-week="1" aria-label="Next insights week" ${insightOffset===0?'disabled':''}>›</button></div></div><div class="day-week-stats"><div><strong>${data.sessions}</strong><span>recorded focus sessions</span></div><div><strong>${data.reviews}</strong><span>daily reviews saved</span></div></div><div class="day-week-days">${data.rows.map(r=>`<div class="day-week-day ${r.future?'future':''}"><span>${new Date(r.date+'T12:00:00').toLocaleDateString([],{weekday:'short'})}</span><strong>${r.future?'—':r.tracked?r.sessions:'—'}</strong><small>${r.future?'Upcoming':r.reviewed?'Reviewed':r.tracked?'Recorded':'No record'}</small></div>`).join('')}</div><p class="day-muted">Counts include completed timers recorded since Today was added. “—” means no session record, not a failed day. Skipped timers do not count.</p>${data.repeated.length?`<div class="day-note"><strong>A smaller next step might help</strong>${data.repeated.map(t=>`<p>${esc(t.title)} · carried forward in ${t.count} reviews. Consider reducing its scope or making time for the first step.</p>`).join('')}</div>`:''}<details class="day-week-notes"><summary>Read this week’s reflections</summary>${data.rows.filter(r=>r.reflection.trim()).map(r=>`<article><div class="day-kicker">${esc(r.date)}</div><p>${esc(r.reflection)}</p></article>`).join('')||'<p class="day-muted">Your saved daily reflections will appear here. Drafts stay private to the daily review.</p>'}</details><button class="btn" data-day-action="next-week">Plan next week →</button><p class="day-muted">Opens a draft for next week. Nothing is automatically rescheduled.</p></section>`;
  }
  function checks(t){const nodes=leaves(t.g);return nodes.length?nodes.map(n=>`<label class="day-check"><input type="checkbox" data-day-complete="${esc(t.id)}" data-node="${esc(n.id)}" ${n.done?'checked':''}><span>${esc(n.title)}</span></label>`).join(''):`<label class="day-check"><input type="checkbox" data-day-complete="${esc(t.id)}" ${t.pct===100?'checked':''}><span>Mark this gate complete</span></label>`;}
  function taskCard(t,i){return `<article class="day-task"><div class="day-index">${String(i+1).padStart(2,'0')} / ${esc(t.p.name)}</div><h3>${esc(t.g.title)}</h3><p class="day-muted">${esc(why(t))}</p><progress class="day-meter" value="${t.pct}" max="100" aria-label="${esc(t.g.title)} progress">${t.pct}%</progress><div class="day-row"><span class="day-muted">${t.pct}% complete · ${t.g.durationMin||30+(+t.g.effort||3)*15}m estimate</span><button class="btn btn-primary btn-sm" data-day-start="${esc(t.id)}">Start this task →</button></div><details><summary>See next steps</summary>${checks(t)}</details>${snoozeControls(t)}</article>`;}
  function render(){
    if(reviewDate&&reviewDate!==day())uiMemory.clear();
    preserveUI(root,renderContent);
  }
  function renderContent(){
    if(!root)return;const list=recommendations(),events=agenda(),rec=record();reviewDate=day();
    root.innerHTML=`<header class="day-head"><div><div class="day-kicker">${new Date(day()+'T12:00:00').toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'})}</div><h1>One thing at a time.</h1><p class="day-muted">A clear next move. Room to focus. Permission to adjust.</p></div><button class="btn" data-day-action="calendar">Open calendar</button></header><div class="day-layout"><div class="day-stack"><section class="day-panel"><div class="day-row"><h2>Your next three</h2><span class="day-muted">${rec.focusSessions||0} focus sessions today</span></div>${list.map(taskCard).join('')||'<p class="day-muted">No open gates. Enjoy the space, or choose your next project.</p><button class="btn" data-day-action="quests">Open quest log</button>'}</section><section class="day-panel"><h2>Plans change. That’s okay.</h2><p class="day-muted">Preview new times for unfinished, missed gate blocks. Only one-off local ARISE blocks can move; routines and connected calendar events stay put.</p><button class="btn" data-day-action="catchup">Running behind?</button><div id="dayCatchup" class="day-catchup" aria-live="polite"></div></section></div><aside class="day-stack"><section class="day-panel"><h2>Today’s rhythm</h2>${events.length?events.map(e=>`<div class="day-agenda"><time>${e.start.dateTime?new Date(e.start.dateTime).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'All day'}</time><strong>${esc(e.summary||'Untitled')}</strong></div>`).join(''):'<p class="day-muted">Your calendar has open space today.</p>'}<p class="day-muted">Calendar completion is not inferred from time passing.</p></section><section class="day-panel"><h2>Close the day gently.</h2><p class="day-muted">Reflect, then choose up to three gates to bring forward. This does not move calendar blocks.</p><label class="day-label" for="dayReflection">What moved forward? What needs a different approach?</label><textarea id="dayReflection" maxlength="2000" placeholder="A small win still counts…">${esc(rec.reviewDraft?.reflection??rec.reflection??'')}</textarea><label class="day-label">Tomorrow’s focus</label>${tasks().filter(t=>t.pct<100).map(t=>`<label class="day-check"><input type="checkbox" data-day-carry="${esc(t.id)}" ${(rec.reviewDraft?.carry||rec.nextCarry||[]).includes(t.id)?'checked':''}><span>${esc(t.g.title)}</span></label>`).join('')||'<p class="day-muted">Nothing unfinished to carry forward.</p>'}<button class="btn btn-primary" data-day-action="review">${rec.reviewedAt?'Update review':'Save daily review'}</button><div id="dayReviewStatus" class="day-status" role="status">${rec.reviewedAt?'Review saved. You can update it anytime.':''}</div></section><section class="day-panel"><h2>Rest is part of the plan.</h2><p class="day-muted">Your focus timer offers optional stretches, water and other restorative breaks. Earn XP for completed work—not for opening screens or skipping timers.</p></section></aside></div>`;
    root.insertAdjacentHTML?.('beforeend',`<div id="dayWeeklyInsights" class="day-week-wrap">${weeklyCard()}</div>`);
    root.insertAdjacentHTML?.('beforeend',snoozedCard());
    foldSections();
    catchup=null;renderFocus();
  }
  function renderFocus(){preserveUI(focus,()=>{if(!focus)return;const ref=getState().pomodoro.taskRef,t=tasks().find(t=>t.id===ref);focus.innerHTML=t?`<div class="day-panel"><div class="day-row"><div><div class="day-kicker">Current focus · ${esc(t.p.name)}</div><h2>${esc(t.g.title)}</h2></div><button class="btn btn-sm" data-day-action="today">Back to Today</button></div><p class="day-muted">Finish a session for focus XP. Check off actual work separately.</p>${checks(t)}</div>`:'';});}
  function refreshInsights(){const pane=document.getElementById('dayWeeklyInsights');if(pane)preserveUI(pane,()=>{pane.innerHTML=weeklyCard();foldSections();});}
  function missed(){const now=Date.now(),all=tasks();return agenda().filter(e=>e._local&&!e._seriesId&&!e.repeat&&e.start?.dateTime&&new Date(e.end.dateTime)<now).flatMap(e=>{const t=all.find(t=>(e.description||'').includes(`[ARISE_GATE:${t.id}]`)&&t.pct<100&&!isSnoozed(t.g));return t?[{...t,event:e}]:[];});}
  function makeCatchup(){
    const candidates=missed(),date=day(),prefs=getState().calendar.weeklyDrafts?.[todayStr(weekStart(new Date()))]||{};
    const events=getEvents(new Date(date+'T12:00:00')),ids=new Set(candidates.map(t=>t.event.id));
    const input={week:todayStr(weekStart(new Date())),items:candidates.map(t=>({id:t.event.id,title:t.g.title,minutes:Math.round((new Date(t.event.end.dateTime)-new Date(t.event.start.dateTime))/60000),due:t.g.due,urgency:t.g.urgency,impact:t.g.impact,effort:t.g.effort})),events:events.filter(e=>!ids.has(e.id)),days:prefs.days||[1,2,3,4,5],start:prefs.start??9,end:prefs.end??18,capacity:prefs.capacity||getState().calendar.capacityHours||35,energy:prefs.energy||'morning',mode:prefs.mode||'balanced',now:Date.now()};
    const result=window.AriseWeeklyPlanner.propose(input);
    return {result,candidates,fingerprint:JSON.stringify([input, date])};
  }
  function preview(){catchup=makeCatchup();const {result}=catchup;document.getElementById('dayCatchup').innerHTML=`<div class="day-note">${result.blocks.length?'Proposed moves later this week. Nothing has changed yet.':'No eligible blocks fit later this week. Use Calendar to adjust dates or your weekly capacity.'}</div>${result.blocks.map(b=>`<div class="day-agenda"><strong>${esc(b.title)}</strong><span>${new Date(b.start).toLocaleString([],{weekday:'short',hour:'2-digit',minute:'2-digit'})}</span></div>`).join('')}${result.skipped.map(b=>`<p class="day-muted">${esc(b.title)} — ${esc(b.reason)}</p>`).join('')}${result.blocks.length?'<button class="btn btn-primary" data-day-action="apply-catchup">Approve these moves</button>':''}`;}
  function applyCatchup(){
    if(!catchup)return;const fresh=makeCatchup();
    if(fresh.fingerprint!==catchup.fingerprint||JSON.stringify(fresh.result.blocks)!==JSON.stringify(catchup.result.blocks)){preview();toast('Your schedule changed. Review the updated proposal.','gold');return;}
    const before=[];try{
      for(const b of fresh.result.blocks){const event=getState().calendar.localEvents.find(e=>e.id===b.id);if(!event)throw Error('A block is no longer available.');before.push({id:event.id,start:{...event.start},end:{...event.end}});event.start={dateTime:new Date(b.start).toISOString()};event.end={dateTime:new Date(b.end).toISOString()};}
      save();render();api.renderCalendar();api.toastCalendarUndo('Catch-up plan applied',()=>{for(const old of before){const event=getState().calendar.localEvents.find(e=>e.id===old.id);if(event){event.start=old.start;event.end=old.end;}}render();});
    }catch(e){for(const old of before){const event=getState().calendar.localEvents.find(e=>e.id===old.id);if(event){event.start=old.start;event.end=old.end;}}toast('Could not save the moves. Your original blocks are unchanged.','danger');}
  }
  function saveReview(){
    if(reviewDate!==day()){render();toast('A new day has started. Please review today’s plan.','gold');return;}
    const selected=Array.from(root.querySelectorAll('[data-day-carry]:checked')).map(e=>e.dataset.dayCarry);if(selected.length>3){toast('Choose up to three gates for tomorrow.','gold');return;}
    const tomorrow=new Date(day()+'T12:00:00');tomorrow.setDate(tomorrow.getDate()+1);const next=todayStr(tomorrow),before=JSON.parse(JSON.stringify(execution().days));
    execution().days[day()]={...record(),reflection:document.getElementById('dayReflection').value.slice(0,2000),nextCarry:selected,reviewedAt:Date.now()};execution().days[next]={...record(next),carry:selected};delete execution().days[day()].reviewDraft;
    try{save();document.getElementById('dayReviewStatus').textContent='Review saved. Tomorrow’s focus is ready.';refreshInsights();}catch(e){execution().days=before;toast('Review could not be saved. Please try again.','danger');}
  }
  function click(e){const t=e.target.closest('button');if(!t)return;
    if(t.dataset.dayWeek){insightOffset=Math.min(0,insightOffset+Number(t.dataset.dayWeek));refreshInsights();return;}
    if(t.dataset.daySnooze){const box=t.closest('.day-snooze');setSnooze(t.dataset.daySnooze,box.querySelector('[data-snooze-date]').value,box.querySelector('[data-snooze-reason]').value);return;}
    if(t.dataset.dayResume){setSnooze(t.dataset.dayResume,null);return;}
    if(t.dataset.dayStart){startFocus(t.dataset.dayStart);renderFocus();return;}
    const action=t.dataset.dayAction;if(['calendar','quests','today'].includes(action))setView(action);
    if(action==='next-week')api.openNextWeek?.();
    if(action==='catchup')preview();if(action==='apply-catchup')applyCatchup();if(action==='review')saveReview();
  }
  function change(e){const id=e.target.dataset.dayComplete;if(!id)return;const task=tasks().find(t=>t.id===id);if(!task)return;completeTask(task.p.id,task.g.id,e.target.dataset.node);render();}
  function saveReviewDraft(e){
    if(e.target.id!=='dayReflection'&&e.target.dataset.dayCarry===undefined)return;
    if(reviewDate!==day())return;
    const rec=record();const draft={reflection:document.getElementById('dayReflection').value.slice(0,2000),carry:Array.from(root.querySelectorAll('[data-day-carry]:checked')).map(e=>e.dataset.dayCarry)};
    execution().days[day()]={...rec,reviewDraft:draft};
    try{save();document.getElementById('dayReviewStatus').textContent='Draft saved. Save your review to choose tomorrow’s focus.';}catch(error){execution().days[day()]=rec;toast('Could not save your review draft.','danger');}
  }
  root?.addEventListener('input',saveReviewDraft);
  root?.addEventListener('click',click);root?.addEventListener('change',change);focus?.addEventListener('click',click);focus?.addEventListener('change',change);
  return {render,renderFocus,recommendations,makeCatchup,setSnooze};
}};
