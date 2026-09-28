window.ARISEQuickActions={
  search(projects,query,progress,score){
    const tokens=String(query||'').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const titles=n=>[n.title||'',...(n.children||[]).flatMap(titles)];
    return projects.flatMap(p=>(p.tasks||[]).map(g=>({pid:p.id,gid:g.id,title:g.title,project:p.name,pct:progress(g),score:score(g),haystack:[p.name,...titles(g)].join(' ').toLocaleLowerCase()}))).filter(g=>tokens.every(t=>g.haystack.includes(t))).sort((a,b)=>(a.pct===100)-(b.pct===100)||b.score-a.score||a.title.localeCompare(b.title));
  },
  create({getState,escapeHtml:esc,progressPct,score,setView,openGate,startFocus,createGate,toast}){
    const dialog=document.createElement('dialog');dialog.id='quickActions';dialog.setAttribute('aria-labelledby','quickActionsTitle');document.body.appendChild(dialog);
    let opener,query='',busy=false,closing=false,openingMotion=null;
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)');
    function motionDuration(){
      try{
        const motion=window.AriseMotion,mode=motion?.mode?.()||document.documentElement?.dataset.effects||'system';
        if(reduced?.matches||document.documentElement?.dataset.effects==='minimal'||mode==='minimal'||motion?.enabled?.()===false)return 0;
        const ms=motion?.duration?.(220)??220;
        return Number.isFinite(ms)?Math.max(0,Math.min(ms,280)):0;
      }catch(_){return 0;}
    }
    function stopOpening(){openingMotion?.cancel();openingMotion=null;dialog.classList?.remove('qa-opening');}
    reduced?.addEventListener?.('change',()=>{if(reduced.matches)stopOpening();});
    if(window.MutationObserver&&document.documentElement)new window.MutationObserver(()=>{if(!motionDuration())stopOpening();}).observe(document.documentElement,{attributes:true,attributeFilter:['data-effects']});
    function reveal(){
      stopOpening();const duration=motionDuration();if(!duration||!dialog.animate)return;
      const rect=dialog.getBoundingClientRect(),icon=document.getElementById('quickActionsOpen')?.getBoundingClientRect?.();
      const x=icon?Math.max(0,Math.min(rect.width-34,icon.left+icon.width/2-rect.left-17)):(rect.width-34)/2;
      const y=icon?Math.max(0,Math.min(rect.height-34,icon.top-rect.top)):0;
      dialog.style?.setProperty('--qa-reveal-duration',duration+'ms');dialog.classList?.add('qa-opening');
      openingMotion=dialog.animate([
        {clipPath:`inset(${y}px ${Math.max(0,rect.width-x-34)}px ${Math.max(0,rect.height-y-34)}px ${x}px round 17px)`,opacity:.85},
        {clipPath:'inset(0 round 24px)',opacity:1}
      ],{duration,easing:'cubic-bezier(.22,1,.36,1)'});
      openingMotion.onfinish=stopOpening;
    }
    let capture={title:'',project:'',due:'',open:false};
    const recent=[];
    function remember(pid,gid){const key=pid+':'+gid,index=recent.indexOf(key);if(index>=0)recent.splice(index,1);recent.unshift(key);recent.splice(8);}
    function captureDraft(){const form=dialog.querySelector('#quickCapture');if(form?.elements)capture={title:form.elements.title.value,project:form.elements.project.value,due:form.elements.due.value,open:!!dialog.querySelector('.qa-capture')?.open};}
    function close(after){
      if(closing)return;captureDraft();closing=true;stopOpening();
      dialog.close();closing=false;after?.();
    }
    const views=[['today','Today'],['calendar','Calendar'],['quests','Quest Log'],['focus','Focus'],['health','Health'],['reminders','Reminders'],['all','All Tasks'],['daily','Daily Quest'],['bucket','Bucket List']];
    function open(){
      if(closing)return;
      if(dialog.open){dialog.querySelector('#quickQuery').focus();return;}
      if(document.querySelector('dialog[open],.overlay.show'))return;
      opener=document.activeElement;
      const projects=getState().projects;
      dialog.innerHTML=`<header class="qa-head"><h2 id="quickActionsTitle">Find your next move.</h2><button type="button" class="qa-close" data-qa="close" aria-label="Close quick actions">×</button></header><label class="qa-search"><span class="qa-sr">Search tasks, subtasks and projects</span><input id="quickQuery" type="search" placeholder="Search tasks, subtasks or a section…" value="${esc(query)}" autocomplete="off"></label><div class="qa-results" id="quickResults" aria-label="Search results"></div><details class="qa-capture"><summary>＋ Capture a new gate</summary>${projects.length?`<form id="quickCapture"><label>Task title<input name="title" required maxlength="180" placeholder="What needs to happen?"></label><div class="qa-fields"><label>Dungeon<select name="project" required>${projects.length>1?'<option value="">Choose a dungeon</option>':''}${projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label><label>Due date · optional<input type="date" name="due"></label></div><p class="qa-muted">Starts at normal priority. Nothing is scheduled automatically.</p><button class="btn btn-primary" type="submit">Add gate</button><p id="quickCaptureStatus" role="status" class="qa-muted"></p></form>`:'<p class="qa-muted">Create a dungeon in Quest Log first.</p><button class="btn" data-qa-view="quests">Open Quest Log</button>'}</details><footer class="qa-muted qa-footer">↓ to results · ↑ ↓ to navigate · Enter to open · Esc to close</footer>`;
      const form=dialog.querySelector('#quickCapture');if(form?.elements){form.elements.title.value=capture.title;form.elements.due.value=capture.due;if(projects.some(p=>p.id===capture.project))form.elements.project.value=capture.project;dialog.querySelector('.qa-capture').open=capture.open;}
      renderResults();dialog.showModal();reveal();document.getElementById('quickActionsOpen')?.setAttribute('aria-expanded','true');dialog.querySelector('#quickQuery').focus();
    }
    function renderResults(){
      const matches=window.ARISEQuickActions.search(getState().projects,query,progressPct,score),navigation=views.filter(([,name])=>name.toLowerCase().includes(query.trim().toLowerCase()));
      if(!query.trim())matches.sort((a,b)=>{const ai=recent.indexOf(a.pid+':'+a.gid),bi=recent.indexOf(b.pid+':'+b.gid);return (ai<0?Infinity:ai)-(bi<0?Infinity:bi);});
      const shown=matches.slice(0,20);
      dialog.querySelector('#quickResults').innerHTML=`<div class="qa-count" role="status">${matches.length} matching gate${matches.length===1?'':'s'}${matches.length>20?' · showing first 20, refine your search':''}</div>${navigation.length?`<div class="qa-links">${navigation.map(([id,name])=>`<button type="button" data-qa-view="${id}">${name}</button>`).join('')}</div>`:''}${shown.map(t=>`<div class="qa-result"><button class="qa-open" type="button" data-qa-edit="${esc(t.pid)}" data-gate="${esc(t.gid)}"><strong>${esc(t.title)}</strong><span>${esc(t.project)} · ${t.pct}% complete${t.pct===100?' · Cleared':''}</span></button>${t.pct<100?`<button type="button" class="qa-focus" data-qa-focus="${esc(t.pid)}" data-gate="${esc(t.gid)}" aria-label="Start focus on ${esc(t.title)}">Focus →</button>`:''}</div>`).join('')||'<p class="qa-muted">No matching gates. Try a different word or capture a new task below.</p>'}`;
    }
    dialog.addEventListener('input',e=>{stopOpening();if(e.target.id==='quickQuery'){query=e.target.value;renderResults();}else captureDraft();});
    dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    dialog.addEventListener('click',e=>{
      stopOpening();
      if(closing)return;
      if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom){close();return;}}
      const t=e.target.closest('button');if(!t)return;
      if(t.dataset.qa==='close'){close();return;}
      if(t.dataset.qaView){close(()=>setView(t.dataset.qaView));return;}
      if(t.dataset.qaEdit){remember(t.dataset.qaEdit,t.dataset.gate);close(()=>openGate(t.dataset.qaEdit,t.dataset.gate));return;}
      if(t.dataset.qaFocus){remember(t.dataset.qaFocus,t.dataset.gate);close(()=>startFocus(t.dataset.qaFocus+':'+t.dataset.gate));}
    });
    dialog.addEventListener('keydown',e=>{
      stopOpening();
      if(e.isComposing||closing)return;
      const buttons=Array.from(dialog.querySelectorAll('#quickResults button'));
      if(e.target.id==='quickQuery'&&e.key==='Enter'){e.preventDefault();buttons[0]?.click();return;}
      if(['ArrowDown','ArrowUp'].includes(e.key)&&(e.target.id==='quickQuery'||buttons.includes(e.target))){e.preventDefault();const index=buttons.indexOf(e.target),next=index<0?0:index+(e.key==='ArrowDown'?1:-1);if(next<0)dialog.querySelector('#quickQuery').focus();else buttons[Math.min(next,buttons.length-1)]?.focus();}
    });
    dialog.addEventListener('submit',e=>{
      if(e.target.id!=='quickCapture')return;e.preventDefault();if(busy||closing)return;
      const form=e.target,title=form.elements.title.value.trim(),pid=form.elements.project.value,due=form.elements.due.value;
      if(!title||!getState().projects.some(p=>p.id===pid)){toast('Enter a title and choose an existing dungeon.','danger');return;}
      busy=true;const button=form.querySelector('[type=submit]');button.disabled=true;
      try{createGate(pid,title,due);form.elements.title.value='';capture={title:'',project:pid,due,open:true};dialog.querySelector('#quickCaptureStatus').textContent='Gate added. Find it in your dungeon or Today priorities.';renderResults();form.elements.title.focus();}
      catch(error){dialog.querySelector('#quickCaptureStatus').textContent='Could not add the gate. Please try again.';}
      finally{busy=false;button.disabled=false;}
    });
    dialog.addEventListener('close',()=>{stopOpening();document.getElementById('quickActionsOpen')?.setAttribute('aria-expanded','false');if(!document.querySelector('dialog[open],.overlay.show'))opener?.focus();});
    document.getElementById('quickActionsOpen')?.addEventListener('click',open);
    document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'&&!e.isComposing){e.preventDefault();if(!e.repeat)open();}});
    return {open};
  }
};
