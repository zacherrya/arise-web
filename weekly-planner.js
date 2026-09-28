/* Weekly drafts are device-local; approval is the only scheduling action. */
window.ARISEWeeklyPlannerUI={create({getState,getCursor,escapeHtml,todayStr,weekStart,allCalendarEvents,calendarGateRef,progressPct,save,uid,toast,renderCalendar,toastCalendarUndo,calTime,isDesktop,tauriInvoke}){
  const engine=window.AriseWeeklyPlanner,esc=escapeHtml;
  const dialog=document.createElement('dialog');dialog.id='weeklyPlanner';dialog.setAttribute('aria-labelledby','wpTitle');document.body.appendChild(dialog);
  let draft,week,step=0,proposal,opener,aiBusy=false,aiError='',aiGeneration=0;
  let previewSignature=null,previewMotions=[];
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  function motionDuration(){
    try{
      const motion=window.AriseMotion,mode=motion?.mode?.()||document.documentElement?.dataset.effects||'system';
      if(reduced?.matches||document.documentElement?.dataset.effects==='minimal'||mode==='minimal'||motion?.enabled?.()===false)return 0;
      const ms=motion?.duration?.(160)??160;
      return Number.isFinite(ms)?Math.max(0,Math.min(ms,200)):0;
    }catch(_){return 0;}
  }
  function cancelPreviewMotion(){for(const animation of previewMotions)animation.cancel();previewMotions=[];}
  reduced?.addEventListener?.('change',()=>{if(reduced.matches)cancelPreviewMotion();});
  if(window.MutationObserver&&document.documentElement)new window.MutationObserver(()=>{if(!motionDuration())cancelPreviewMotion();}).observe(document.documentElement,{attributes:true,attributeFilter:['data-effects']});
  function revealPreview(){
    // Compare the displayed proposal, not renders (Nexus status updates also render).
    const signature=JSON.stringify(proposal.blocks);
    if(signature===previewSignature)return;
    previewSignature=signature;
    // The summary and approval disclaimer live inside this native dialog's top layer.
    // Do not use the global notice: a body-level banner would be behind the modal.
    const duration=motionDuration();if(!duration)return;
    const blocks=Array.from(dialog.querySelectorAll?.('.wp-block')||[]);
    blocks.forEach((block,index)=>{
      if(!block.animate)return;
      const animation=block.animate([{opacity:.65,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{
        duration,delay:Math.min(index,5)*Math.min(20,duration/8),easing:'cubic-bezier(.22,1,.36,1)'
      });
      previewMotions.push(animation);
      animation.onfinish=()=>{previewMotions=previewMotions.filter(active=>active!==animation);};
    });
  }
  const aiFingerprint=()=>JSON.stringify([draft.items,draft.wins,draft.capacity,draft.mode,draft.energy,draft.days,draft.start,draft.end]);
  const persist=()=>{getState().calendar.weeklyDrafts||={};getState().calendar.weeklyDrafts[week]=draft;save();};
  function availableItems(){
    const scheduled=new Set(allCalendarEvents().map(calendarGateRef).filter(Boolean).map(r=>r.pid+':'+r.gid));
    return getState().projects.flatMap(p=>(p.tasks||[]).filter(g=>progressPct(g)<100&&!g.calendarEventId&&!scheduled.has(p.id+':'+g.id)).map(g=>({id:p.id+':'+g.id,pid:p.id,gid:g.id,title:g.title,project:p.name,minutes:g.durationMin||30+(+g.effort||3)*15,due:g.due||'',urgency:g.urgency,impact:g.impact,effort:g.effort,selected:true,after:''})));
  }
  function open(){
    opener=document.activeElement;week=todayStr(weekStart(getCursor()));
    const saved=getState().calendar.weeklyDrafts?.[week];
    draft=saved?JSON.parse(JSON.stringify(saved)):{notes:'',wins:(getState().calendar.weeklyOutcomes?.[week]||getState().calendar.victories||['','','']).slice(0,3),days:[1,2,3,4,5],start:9,end:18,capacity:getState().calendar.capacityHours||35,energy:'morning',mode:'balanced',items:[]};
    // Refresh existing gates without resurrecting removed or already scheduled ones.
    draft.items=[...availableItems().map(i=>({...i,...draft.items.find(old=>old.id===i.id),title:i.title})),...draft.items.filter(i=>i.idea)];
    step=0;proposal=null;previewSignature=null;aiBusy=false;aiError='';aiGeneration++;render();dialog.showModal();
  }
  const button=(text,action,primary=false)=>`<button type="button" class="btn ${primary?'btn-primary':''}" data-wp="${action}">${text}</button>`;
  function render(){
    cancelPreviewMotion();
    dialog.innerHTML=`<header class="wp-head"><div><div class="wp-eyebrow">Weekly War Room · ${esc(new Date(week+'T12:00:00').toLocaleDateString([],{month:'short',day:'numeric'}))}</div><h2 id="wpTitle">Make room for what matters.</h2></div><button class="wp-close" data-wp="close" aria-label="Save draft and close">×</button></header><div class="wp-body"><nav class="wp-steps" aria-label="Planning progress">${['Capture','Shape your week','Review your plan'].map((s,i)=>`<span class="${step===i?'active':''}" ${step===i?'aria-current="step"':''}>${i+1} · ${s}</span>`).join('')}</nav>${step===0?capture():step===1?shape():review()}</div><footer class="wp-foot"><small>Private draft · No changes until approval</small><div class="wp-row">${step?button('Back','back'):''}${button(step===0?'Shape my week →':step===1?'Preview plans →':'Approve plan',step===2?'approve':'next',true)}</div></footer>`;
    if(step===2&&!proposal.blocks.length)dialog.querySelector('[data-wp=approve]').disabled=true;
    if(step===2){dialog.querySelector('.wp-steps').insertAdjacentHTML('afterend',nexusCard());revealPreview();}
  }
  function nexusCard(){
    const advice=draft.aiAdvice;
    return `<section class="wp-nexus" aria-label="Nexus weekly coach"><div class="wp-row"><div><h3>✦ A second pair of eyes.</h3><p class="wp-hint">Nexus can connect your weekly outcomes to the right next steps.</p></div>${button(aiBusy?'Thinking…':'Ask Nexus','nexus')}</div><p class="wp-hint">Sends selected task titles, estimates, priorities, deadlines and weekly outcomes to OpenAI using your desktop connection. Calendar titles and unselected notes are not sent. API usage may be charged.</p><div role="status" aria-live="polite">${aiBusy?'Nexus is reviewing your week. You can keep planning.':esc(aiError)}</div>${advice?`<p>${esc(advice.summary)}</p><ol>${advice.recommendations.map(r=>`<li><strong>${esc(draft.items.find(i=>i.id===r.id)?.title||'Task no longer available')}</strong><p>${esc(r.why)}</p><small>Start here: ${esc(r.firstAction)}</small></li>`).join('')}</ol>${button(draft.focusOrder?.length?'Focus order applied':'Use this focus order','apply-nexus')}${draft.focusOrder?.length?button('Use priority formula','clear-nexus'):''}`:''}</section>`;
  }
  async function askNexus(){
    if(aiBusy)return;
    if(!isDesktop()){aiError='Open the installed ARISE app to use Nexus. Local planning works here without a connection.';render();return;}
    if(!draft.items.some(i=>i.selected)){aiError='Select at least one commitment first.';render();return;}
    aiBusy=true;aiError='';const token=++aiGeneration;
    const signature=aiFingerprint();
    const context=JSON.stringify({week,outcomes:draft.wins,capacityHours:draft.capacity,pace:draft.mode,energy:draft.energy,alreadyCommittedHours:proposal.committed/60,items:draft.items.filter(i=>i.selected).map(({id,title,minutes,due,urgency,impact,effort,after})=>({id,title,minutes,due,urgency,impact,effort,after}))});render();
    try{
      if(!await tauriInvoke('ai_key_status'))throw new Error('Connect Nexus in Settings → OpenAI first, then try again.');
      const result=await tauriInvoke('ai_weekly_plan',{context});
      if(token!==aiGeneration)return;
      if(signature!==aiFingerprint())throw new Error('Your draft changed while Nexus was thinking. Ask again for an up-to-date suggestion.');
      draft.aiAdvice=engine.validateAdvice(result,draft.items);persist();
    }catch(error){if(token===aiGeneration)aiError=(error?.message||String(error)).slice(0,500);}
    finally{if(token===aiGeneration){aiBusy=false;if(dialog.open)render();}}
  }
  function capture(){return `<div class="wp-grid"><div><h3>Clear your head.</h3><p class="wp-hint">Ideas, loose ends, things you want to move forward. One per line. You’ll choose what belongs in the week next.</p><label>Brain dump<textarea data-field="notes" placeholder="Outline the next video\nResearch a new project\nBook time to think">${esc(draft.notes)}</textarea></label></div><div><h3>Three meaningful outcomes.</h3><p class="wp-hint">What would make this week feel successful? Keep the result specific and achievable.</p><div class="wp-stack">${draft.wins.map((w,i)=>`<label>Outcome ${i+1}<input data-win="${i}" value="${esc(w)}" placeholder="${['A first draft ready to share','One project moved forward','Space protected for myself'][i]}"></label>`).join('')}</div></div></div>`;}
  function shape(){return `<h3>A week that fits your life.</h3><p class="wp-hint">Existing events and routines stay untouched. Fifteen-minute breathing spaces are protected around every block.</p><div class="wp-grid"><div class="wp-stack"><label>Weekly capacity, including existing commitments<input data-field="capacity" type="number" min="1" max="100" value="${draft.capacity}"></label><div class="wp-row"><label>Start hour<input data-field="start" type="number" min="0" max="23" value="${draft.start}"></label><label>Finish hour<input data-field="end" type="number" min="1" max="24" value="${draft.end}"></label></div></div><div class="wp-stack"><label>Your strongest focus window<select data-field="energy">${['morning','afternoon','evening'].map(e=>`<option ${draft.energy===e?'selected':''} value="${e}">${e[0].toUpperCase()+e.slice(1)}</option>`).join('')}</select></label><div class="wp-days">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d,i)=>`<label><input type="checkbox" data-day="${i}" ${draft.days.includes(i)?'checked':''}>${d}</label>`).join('')}</div></div></div><h3 style="margin-top:28px">Choose your commitments</h3><p class="wp-hint">Gates are ranked using urgency × impact ÷ effort, with a deadline boost. Ideas start at normal priority. Adjust minutes, deadlines and prerequisites here.</p>${draft.items.length?draft.items.map(i=>`<div class="wp-item"><input type="checkbox" data-item="${esc(i.id)}" data-prop="selected" aria-label="Include ${esc(i.title)}" ${i.selected?'checked':''}><div>${esc(i.title)}<small>${esc(i.project||'New idea · local calendar block')}</small><select style="margin-top:8px" data-item="${esc(i.id)}" data-prop="after" aria-label="Prerequisite for ${esc(i.title)}"><option value="">No prerequisite</option>${draft.items.filter(x=>x.id!==i.id).map(x=>`<option value="${esc(x.id)}" ${i.after===x.id?'selected':''}>After: ${esc(x.title)}</option>`).join('')}</select></div><label>Minutes<input type="number" min="15" max="480" step="15" data-item="${esc(i.id)}" data-prop="minutes" value="${i.minutes}"></label><label>Deadline<input type="date" data-item="${esc(i.id)}" data-prop="due" value="${esc(i.due||'')}"></label></div>`).join(''):'<p class="wp-hint">No unscheduled gates. Go back and capture an idea to get started.</p>'}`;}
  function generate(){proposal=engine.propose({week,...draft,events:allCalendarEvents()});}
  function review(){
    generate();return `<h3>Choose your pace.</h3><p class="wp-hint">A local, rules-based proposal—not an AI prediction. Review the actual blocks before adding anything.</p><div class="wp-modes">${[['safe','Safe','55% capacity · more breathing room'],['balanced','Balanced','75% capacity · steady progress'],['ambitious','Ambitious','90% capacity · a focused push']].map(([id,title,desc])=>`<button class="wp-mode" data-mode="${id}" aria-pressed="${draft.mode===id}"><strong>${title}</strong><span>${desc}</span></button>`).join('')}</div><div class="wp-summary">${proposal.blocks.length} new blocks · ${(proposal.planned/60).toFixed(1)}h added · ${(proposal.committed/60).toFixed(1)}h already committed<br>Remaining capacity is kept free. Nothing already on your calendar will be moved.</div>${proposal.blocks.map(b=>`<div class="wp-block"><time>${new Date(b.start).toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'})}<br>${calTime(new Date(b.start))}–${calTime(new Date(b.end))}</time><div><strong>${esc(b.title)}</strong><small>${b.minutes} minutes · ${b.after?'after prerequisite':b.due?'deadline '+esc(b.due):'priority '+b.score.toFixed(1)}</small></div><button class="btn btn-sm" data-remove="${esc(b.id)}" aria-label="Remove ${esc(b.title)} from plan">Remove</button></div>`).join('')||'<p class="wp-hint">No blocks fit yet. Go back to adjust your hours, days or task durations.</p>'}${proposal.skipped.length?`<details style="margin-top:20px"><summary class="wp-warning">${proposal.skipped.length} items need a different week or scope</summary>${proposal.skipped.map(b=>`<p class="wp-warning"><b>${esc(b.title)}</b> — ${esc(b.reason)}</p>`).join('')}</details>`:''}<p class="wp-hint" style="margin-top:20px">Approval adds local ARISE calendar blocks only. New ideas become blocks, not new dungeons. Use Back to edit duration, deadline or order; move blocks in Calendar after approval.</p>`;
  }
  function captureIdeas(){
    const lines=[...new Set(draft.notes.split('\n').map(s=>s.trim()).filter(Boolean))];
    draft.items=draft.items.filter(i=>!i.idea||lines.includes(i.title));
    for(const title of lines)if(!draft.items.some(i=>i.idea&&i.title===title))draft.items.push({id:uid('idea'),title,idea:true,minutes:45,urgency:3,impact:3,effort:3,selected:true,due:'',after:''});
  }
  function validate(){
    if(!draft.days.length||![draft.capacity,draft.start,draft.end].every(v=>Number.isFinite(+v))||+draft.capacity<1||+draft.capacity>100||+draft.start<0||+draft.end>24||+draft.start>=+draft.end){toast('Choose working days, 1–100 hours of capacity, and a finish hour after the start.','danger');return false;}
    if(draft.items.some(i=>i.selected&&(!Number.isFinite(+i.minutes)||i.minutes<15||i.minutes>480))){toast('Each selected block needs 15–480 minutes.','danger');return false;}return true;
  }
  function approve(){
    if(!validate())return;
    const available=new Set(availableItems().map(i=>i.id));
    if(draft.items.some(i=>i.selected&&!i.idea&&!available.has(i.id))){draft.items=draft.items.filter(i=>i.idea||available.has(i.id));persist();render();toast('Some gates changed or were already scheduled. Please review the updated plan.','gold');return;}
    // Revalidate against live calendar getState() and elapsed time before any mutation.
    const previous=JSON.stringify(proposal.blocks.map(b=>[b.id,b.start,b.end]));generate();
    if(previous!==JSON.stringify(proposal.blocks.map(b=>[b.id,b.start,b.end]))){render();toast('Your calendar changed. Please review the refreshed proposal.','gold');return;}
    if(!proposal.blocks.length)return;
    const before=JSON.parse(JSON.stringify(getState().calendar));const ids=new Set();
    try{
      const batch=uid('weekplan');
      for(const block of proposal.blocks){
        const id=uid('localcal');ids.add(id);
        getState().calendar.localEvents||=[];
        getState().calendar.localEvents.push({id,summary:block.title,start:{dateTime:new Date(block.start).toISOString()},end:{dateTime:new Date(block.end).toISOString()},description:block.pid?`[ARISE_GATE:${block.pid}:${block.gid}]`:'Weekly planning idea',_local:true,_planBatch:batch,reminders:{useDefault:false,overrides:[{method:'popup',minutes:15}]}});
      }
      getState().calendar.weeklyOutcomes||={};getState().calendar.weeklyOutcomes[week]=draft.wins.slice();
      getState().calendar.capacityHours=+draft.capacity;
      delete getState().calendar.weeklyDrafts?.[week];save();cancelPreviewMotion();dialog.close();renderCalendar();
      toastCalendarUndo('Weekly plan added',()=>{getState().calendar.localEvents=getState().calendar.localEvents.filter(e=>!ids.has(e.id));getState().calendar.weeklyOutcomes=before.weeklyOutcomes;getState().calendar.victories=before.victories;getState().calendar.capacityHours=before.capacityHours;});
    }catch(error){getState().calendar=before;toast('Could not save the plan. Your calendar was left unchanged.','danger');}
  }
  dialog.addEventListener('input',e=>{
    delete draft.aiAdvice;delete draft.focusOrder;
    const t=e.target;if(t.dataset.field)draft[t.dataset.field]=['capacity','start','end'].includes(t.dataset.field)?+t.value:t.value;
    if(t.dataset.win!==undefined)draft.wins[+t.dataset.win]=t.value;
    if(t.dataset.day!==undefined){const d=+t.dataset.day;draft.days=draft.days.filter(v=>v!==d);if(t.checked)draft.days.push(d);}
    if(t.dataset.item){const item=draft.items.find(i=>i.id===t.dataset.item);if(item)item[t.dataset.prop]=t.dataset.prop==='selected'?t.checked:t.dataset.prop==='minutes'?+t.value:t.value;}
    try{persist();}catch(_){toast('Draft could not be saved. Device storage may be full.','danger');}
  });
  dialog.addEventListener('click',e=>{
    const t=e.target.closest('button');if(!t)return;
    if(t.dataset.wp==='nexus'){askNexus();return;}
    if(t.dataset.wp==='apply-nexus'){draft.focusOrder=engine.validateAdvice(draft.aiAdvice,draft.items).recommendations.map(r=>r.id);persist();render();return;}
    if(t.dataset.wp==='clear-nexus'){delete draft.focusOrder;persist();render();return;}
    if(t.dataset.wp==='close'){persist();cancelPreviewMotion();dialog.close();}
    if(t.dataset.wp==='back'){step--;render();}
    if(t.dataset.wp==='next'){if(step===0)captureIdeas();if(step===1&&!validate())return;persist();step++;render();}
    if(t.dataset.mode){draft.mode=t.dataset.mode;persist();render();}
    if(t.dataset.remove){draft.items.find(i=>i.id===t.dataset.remove).selected=false;delete draft.aiAdvice;delete draft.focusOrder;aiGeneration++;aiBusy=false;persist();render();}
    if(t.dataset.wp==='approve')approve();
  });
  dialog.addEventListener('cancel',()=>{persist();cancelPreviewMotion();});
  dialog.addEventListener('close',()=>{cancelPreviewMotion();aiGeneration++;aiBusy=false;opener?.focus();});
  document.getElementById('planWeekOpen').addEventListener('click',open);
}};
