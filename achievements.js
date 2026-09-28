(function(){
"use strict";
const escape=s=>String(s||"").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=()=>"win_"+crypto.randomUUID();
const photoLimit=8;
let dbPromise;
function database(){
  if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open('arise_memories_v1',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('images',{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(new Error('Photo storage is unavailable. Your achievement is still saved.'));
    request.onblocked=()=>reject(new Error('Close other ARISE windows, then try adding photos again.'));
  }).catch(error=>{dbPromise=null;throw error});
  return dbPromise;
}
async function imageRecord(key,record){
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('images',record?'readwrite':'readonly'),store=tx.objectStore('images');
    const request=record?store.put(record):store.get(key);let result;
    request.onsuccess=()=>{result=request.result};
    tx.oncomplete=()=>resolve(result);
    tx.onerror=tx.onabort=()=>reject(new Error('Could not save this photo. Check available storage and try again.'));
  });
}
function validPhoto(data){return typeof data==='string'&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data)&&data.length<=2000000;}
const recordPhotos=record=>[...(record.photos||[]),...(record.savedGoal?.photos||[])];
async function exportImages(achievements){
  const images=[];
  for(const key of new Set((achievements||[]).flatMap(win=>recordPhotos(win).map(p=>p.id)))){
    const record=await imageRecord(key);
    if(!record)throw new Error('A memory photo is missing. Re-add it before exporting a complete backup.');
    images.push(record);
  }
  return images;
}
async function importImages(images,achievements){
  const refs=new Set((achievements||[]).flatMap(win=>recordPhotos(win).map(p=>p.id)));
  const entries=new Map((images||[]).map(record=>[record.id,record]));
  for(const key of refs){
    const record=entries.get(key);
    if(record){if(!validPhoto(record.data))throw new Error('This backup contains an invalid memory photo.');}
    else if(!await imageRecord(key))throw new Error('This backup is missing memory photos. Restore a complete ARISE export.');
  }
  // Never overwrite an existing image used by an undo snapshot.
  const remap=new Map();
  for(const key of refs){const record=entries.get(key);if(record){const newId=id();await imageRecord(newId,{id:newId,data:record.data});remap.set(key,newId);}}
  const mapped=photos=>(photos||[]).map(p=>({...p,id:remap.get(p.id)||p.id}));
  return (achievements||[]).map(win=>({...win,photos:mapped(win.photos),...(win.savedGoal?{savedGoal:{...win.savedGoal,photos:mapped(win.savedGoal.photos)}}:{})}));
}
async function compressPhoto(file){
  if(!/^image\/(jpeg|png|webp)$/.test(file.type))throw new Error('Choose a JPG, PNG or WebP photo. Convert HEIC photos to JPG first.');
  if(file.size>20*1024*1024)throw new Error('Choose photos smaller than 20 MB each.');
  const url=URL.createObjectURL(file),img=new Image();
  try{
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('This photo could not be read.'));img.src=url;});
    if(!img.naturalWidth||!img.naturalHeight)throw new Error('This photo has no image data.');
    const scale=Math.min(1,1440/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
    let data=canvas.toDataURL('image/jpeg',.8);
    if(data.length>1500000)data=canvas.toDataURL('image/jpeg',.55);
    if(!validPhoto(data))throw new Error('This photo is too detailed to store. Try a smaller copy.');
    return data;
  }finally{URL.revokeObjectURL(url);}
}
const isActiveWin=win=>!win.status||win.status==='achieved';
async function savePhoto(file){const photoId=id(),data=await compressPhoto(file);await imageRecord(photoId,{id:photoId,data});return {id:photoId,name:file.name};}
function changeWinStatus(state,winId,status,when=new Date().toISOString()){
  const win=state.achievements.find(w=>w.id===winId);
  if(!win||!isActiveWin(win)||!['reopened','deleted'].includes(status))return null;
  let goal=state.goals.find(g=>g.id===win.goalId);
  if(!goal){goal={id:win.goalId||id(),title:win.title,horizon:win.horizon,createdAt:win.achievedAt};win.goalId=goal.id;state.goals.push(goal);}
  win.status=status;win.removedAt=when;
  if(status==='reopened')goal.achievedAt=null;
  else{win.savedGoal={...goal};state.goals=state.goals.filter(g=>g.id!==goal.id);}
  return win;
}
function restoreWin(state,winId){
  const win=state.achievements.find(w=>w.id===winId);
  if(!win||isActiveWin(win)||state.achievements.some(w=>w.id!==winId&&w.goalId===win.goalId&&isActiveWin(w)))return null;
  let goal=state.goals.find(g=>g.id===win.goalId);
  if(!goal){goal={...win.savedGoal,id:win.goalId||id(),title:win.title,horizon:win.horizon,createdAt:win.savedGoal?.createdAt||win.achievedAt};win.goalId=goal.id;state.goals.push(goal);}
  goal.achievedAt=win.achievedAt;win.status='achieved';delete win.removedAt;delete win.savedGoal;
  return win;
}
function completeGoal(state,goalId,when=new Date().toISOString()){
  const goal=state.goals.find(g=>g.id===goalId);
  if(!goal||goal.deletedAt||goal.achievedAt||state.achievements.some(w=>w.goalId===goalId&&isActiveWin(w)))return null;
  const existing=state.achievements.find(w=>w.goalId===goalId&&w.status==='reopened');
  const win=existing||{id:id(),goalId:goal.id,photos:[]};
  Object.assign(win,{title:goal.title,horizon:goal.horizon,achievedAt:when,status:'achieved'});delete win.removedAt;
  goal.achievedAt=when;if(!existing)state.achievements.push(win);return win;
}
function create({getState,save,onChanged,confirm}){
  let draft=null,openedWin=null,photoBusy=false,focusBefore=null,inertBefore=[],confettiTimer,pendingAction=null;
  let bucketUI=null;
  const panel=document.getElementById('goalsPanel'),archive=document.getElementById('armyGrid'),overlay=document.getElementById('winOverlay');
  const state=()=>getState();
  const winById=key=>state().achievements.find(w=>w.id===key);
  const dateText=value=>new Date(value).toLocaleDateString([],{day:'numeric',month:'long',year:'numeric'});
  function commit(change){
    const s=state(),before=JSON.stringify({goals:s.goals,achievements:s.achievements});
    try{const result=change();save();onChanged();return result;}
    catch(error){Object.assign(s,JSON.parse(before));throw new Error('Could not save your change. Free some storage and try again.');}
  }
  function error(message){const el=openedWin?document.getElementById('winStatus'):document.getElementById('goalStatus');if(el)el.textContent=message;}
  function goalRow(g){return `<div class="life-goal-row"><button class="goal-achieve" data-achieve="${escape(g.id)}" aria-label="Mark ${escape(g.title)} achieved" title="Mark achieved">✓</button><span>${escape(g.title)}</span><button class="goal-edit" data-edit-goal="${escape(g.id)}" aria-label="Edit ${escape(g.title)}">Edit</button></div>`;}
  function renderGoals(){
    bucketUI?.render();
    panel.innerHTML=`<div class="goals-heading"><div><div class="goals-eyebrow">Your next chapter</div><h2>Goals worth showing up for.</h2></div><button class="btn btn-sm" data-new-goal>＋ Add goal</button></div><div class="life-goals-grid">${['short','long'].map(h=>{const goals=state().goals.filter(g=>!g.achievedAt&&g.horizon===h);return `<section><h3>${h==='short'?'Short-term goals':'Long-term goals'} <span>${goals.length}</span></h3><p class="goal-horizon">${h==='short'?'Under 1 year':'1–5 years'}</p>${goals.length?goals.map(goalRow).join(''):`<p class="goal-empty">${h==='short'?'What would you like to achieve in under a year?':'What would you like to achieve in the next 1–5 years?'}</p>`}</section>`}).join('')}</div>${draft?`<form id="lifeGoalForm" class="life-goal-form"><label>Goal<input name="title" maxlength="180" required value="${escape(draft.title)}" placeholder="Something that matters to you"></label><label>Horizon<select name="horizon"><option value="short" ${draft.horizon==='short'?'selected':''}>Short term · Under 1 year</option><option value="long" ${draft.horizon==='long'?'selected':''}>Long term · 1–5 years</option></select></label><div class="goal-form-actions"><button class="btn btn-primary" type="submit">${draft.id?'Save goal':'Add goal'}</button><button class="btn" type="button" data-cancel-goal>Cancel</button>${draft.id?'<button class="btn btn-danger" type="button" data-delete-goal>Delete</button>':''}</div></form>`:''}<p id="goalStatus" class="goal-status" role="status"></p>`;
  }
  async function hydratePhotos(root){
    await Promise.all([...root.querySelectorAll('[data-memory-photo]')].map(async img=>{
      try{const record=await imageRecord(img.dataset.memoryPhoto);if(record&&validPhoto(record.data)&&img.isConnected)img.src=record.data;else if(img.isConnected)img.alt='Photo unavailable — restore a complete backup';}
      catch(_){if(img.isConnected)img.alt='Photo storage is unavailable';}
    }));
  }
  function renderArchive(){
    const wins=state().achievements.filter(isActiveWin).sort((a,b)=>new Date(b.achievedAt)-new Date(a.achievedAt));
    const removed=state().achievements.filter(w=>!isActiveWin(w));
    document.getElementById('armySummary').textContent=wins.length?`${wins.length} meaningful win${wins.length===1?'':'s'}. Your effort, remembered.`:'A home for the things you made happen.';
    archive.className='wins-grid';
    archive.innerHTML=wins.length?wins.map(w=>`<button class="win-card" data-open-win="${escape(w.id)}">${w.photos?.length?`<img class="win-cover" data-memory-photo="${escape(w.photos[0].id)}" alt="Memory of ${escape(w.title)}">`:'<div class="win-cover win-cover-empty" aria-hidden="true">✦</div>'}<div class="win-card-body"><span class="win-horizon">${w.horizon==='bucket'?'Bucket list experience':w.horizon==='long'?'Long-term achievement':'Short-term achievement'}</span><h3>${escape(w.title)}</h3><time datetime="${escape(w.achievedAt)}">${escape(dateText(w.achievedAt))}</time><span class="win-photo-count">${w.photos?.length||0} ${(w.photos?.length||0)===1?"memory":"memories"} · Open win ↗</span></div></button>`).join(''):'<div class="wins-empty"><span>✦</span><h3>Your story is still being written.</h3><p>Set a goal in Quest Log, All Tasks, Daily Quest or Focus. Mark it achieved when you’re ready—your win and its memories will live here.</p></div>';
    if(removed.length)archive.insertAdjacentHTML('beforeend',`<details class="removed-wins"><summary>Removed wins · ${removed.length}</summary><p>These don’t count as achievements. Photos are kept so you can recover mistakes, even after restarting ARISE.</p>${removed.map(w=>`<div class="removed-win-row"><span>${escape(w.title)}<small>${w.status==='reopened'?'Returned to active goals':'Deleted entry'}</small></span><button class="btn btn-sm" data-restore-win="${escape(w.id)}" aria-label="Restore achievement: ${escape(w.title)}">Restore win</button></div>`).join('')}</details>`);
    hydratePhotos(archive);
  }
  function render(){renderGoals();renderArchive();}
  function stopConfetti(){clearTimeout(confettiTimer);document.getElementById('winConfetti').replaceChildren();}
  function celebrate(){
    stopConfetti();if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const layer=document.getElementById('winConfetti');
    for(let i=0;i<85;i++){const bit=document.createElement('i');bit.style.cssText=`left:${Math.random()*100}%;background:${['#aa8cf4','#ddbb76','#8fb8d8','#c997af','#a3c6a4'][i%5]};animation-delay:${Math.random()*.7}s;animation-duration:${2.6+Math.random()*1.7}s;--drift:${Math.random()*240-120}px;--spin:${Math.random()*1000-500}deg`;layer.appendChild(bit);}
    confettiTimer=setTimeout(stopConfetti,5200);
  }
  function renderWin(){
    const win=winById(openedWin);if(!win)return;
    document.getElementById('winTitle').textContent=win.title;
    document.getElementById('winDate').textContent=dateText(win.achievedAt);
    document.getElementById('winPhotos').innerHTML=(win.photos||[]).map(p=>`<img data-memory-photo="${escape(p.id)}" alt="${escape(p.name||'Achievement memory')}">`).join('');
    document.getElementById('winPhotoCount').textContent=`${win.photos?.length||0} of ${photoLimit} photos · JPG, PNG or WebP`;
    document.getElementById('winAddPhotos').disabled=photoBusy||(win.photos?.length||0)>=photoLimit;
    document.getElementById('winReopen').disabled=photoBusy;
    document.getElementById('winDelete').disabled=photoBusy;
    hydratePhotos(document.getElementById('winPhotos'));
  }
  function openWin(key,isNew){
    if(!winById(key))return;
    focusBefore=document.activeElement;openedWin=key;overlay.hidden=false;
    inertBefore=[...document.body.children].filter(el=>el!==overlay&&el.id!=='winConfetti').map(el=>[el,el.hasAttribute('inert'),el.getAttribute('aria-hidden')]);
    inertBefore.forEach(([el])=>{el.setAttribute('inert','');el.setAttribute('aria-hidden','true');});
    document.getElementById('winKicker').textContent=isNew?'Achievement unlocked':'A win to remember';
    resetWinAction();
    document.getElementById('winStatus').textContent='';renderWin();document.getElementById('winClose').focus();if(isNew)celebrate();
  }
  function closeWin(){
    if(photoBusy){error('Your photos are still saving. Please wait a moment.');return;}
    overlay.hidden=true;openedWin=null;stopConfetti();inertBefore.forEach(([el,hadInert,aria])=>{if(!hadInert)el.removeAttribute('inert');if(aria===null)el.removeAttribute('aria-hidden');else el.setAttribute('aria-hidden',aria);});inertBefore=[];
    if(focusBefore?.isConnected)focusBefore.focus();else (panel.hidden?document.querySelector('[data-view="army"]'):panel.querySelector('[data-new-goal]'))?.focus();
  }
  function resetWinAction(){pendingAction=null;document.getElementById('winActionConfirm').hidden=true;document.getElementById('winManage').hidden=false;}
  function askWinAction(action){
    if(photoBusy)return;pendingAction=action;stopConfetti();
    document.getElementById('winManage').hidden=true;document.getElementById('winActionConfirm').hidden=false;
    document.getElementById('winActionText').textContent=action==='reopened'?'Not there yet? This returns the goal to your active goals and removes it from your win count. Your photos will be kept for when you achieve it.':'Delete this test entry? It will leave Shadow Army and its goal will be removed. You can recover the win and photos from Removed wins.';
    const bucket=winById(openedWin)?.horizon==='bucket';
    if(bucket)document.getElementById('winActionText').textContent=action==='reopened'?'Not experienced yet? This returns the wish to your Bucket List. Your memories and inspiration photo are kept.':'Remove this experience and its wish? You can recover both from Removed wins in Shadow Army.';
    document.getElementById('winActionApply').textContent=action==='reopened'?(bucket?'Return to bucket list':'Return to goals'):'Delete entry';
    document.getElementById('winActionCancel').focus();
  }
  document.getElementById('winReopen').onclick=()=>askWinAction('reopened');
  document.getElementById('winDelete').onclick=()=>askWinAction('deleted');
  document.getElementById('winActionCancel').onclick=()=>{resetWinAction();document.getElementById('winReopen').focus();};
  document.getElementById('winActionApply').onclick=()=>{
    if(!pendingAction||photoBusy)return;
    try{const changed=commit(()=>changeWinStatus(state(),openedWin,pendingAction));if(changed){closeWin();draft=null;render();const recovery=archive.querySelector('.removed-wins');if(recovery)recovery.open=true;}}
    catch(e){error(e.message);}
  };
  panel.addEventListener('input',e=>{if(draft&&e.target.name)draft[e.target.name]=e.target.value;});
  panel.addEventListener('change',e=>{if(draft&&e.target.name)draft[e.target.name]=e.target.value;});
  panel.addEventListener('keydown',e=>{
    if(e.key==='Enter'&&!e.isComposing&&e.target.matches('#lifeGoalForm input')){
      e.preventDefault();if(!e.repeat)e.target.form.requestSubmit();
    }
  });
  panel.addEventListener('submit',e=>{
    if(e.target.id!=='lifeGoalForm')return;e.preventDefault();
    const data=new FormData(e.target),title=String(data.get('title')||'').trim(),horizon=data.get('horizon')==='long'?'long':'short';if(!title)return;
    try{commit(()=>{if(draft.id){const g=state().goals.find(g=>g.id===draft.id);if(g&&!g.achievedAt)Object.assign(g,{title,horizon});}else state().goals.push({id:id(),title,horizon,createdAt:new Date().toISOString(),achievedAt:null});});draft=null;renderGoals();panel.querySelector('[data-new-goal]').focus();}catch(e){error(e.message);}
  });
  panel.addEventListener('click',async e=>{
    const button=e.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-new-goal')){draft={title:'',horizon:'short'};renderGoals();panel.querySelector('[name=title]').focus();}
    if(button.hasAttribute('data-cancel-goal')){draft=null;renderGoals();}
    if(button.dataset.editGoal){const g=state().goals.find(g=>g.id===button.dataset.editGoal);draft={...g};renderGoals();panel.querySelector('[name=title]').focus();}
    if(button.hasAttribute('data-delete-goal')&&draft?.id){const key=draft.id;if(await confirm('Delete this active goal? Your completed achievements will stay in Shadow Army.',{title:'Delete goal?',okLabel:'Delete'})){try{commit(()=>{state().goals=state().goals.filter(g=>g.id!==key||g.achievedAt);});draft=null;renderGoals();}catch(e){error(e.message);}}}
    if(button.dataset.achieve){try{const win=commit(()=>completeGoal(state(),button.dataset.achieve));if(win){draft=null;render();openWin(win.id,true);}}catch(e){error(e.message);}}
  });
  archive.addEventListener('click',e=>{
    const restore=e.target.closest('[data-restore-win]');
    if(restore){try{const win=commit(()=>restoreWin(state(),restore.dataset.restoreWin));if(win){render();openWin(win.id,false);}}catch(e){document.getElementById('armySummary').textContent=e.message;}return;}
    const card=e.target.closest('[data-open-win]');if(card)openWin(card.dataset.openWin,false);
  });
  document.getElementById('winClose').onclick=closeWin;
  document.getElementById('winDone').onclick=closeWin;
  overlay.addEventListener('click',e=>{if(e.target===overlay)closeWin();});
  document.addEventListener('keydown',e=>{
    if(!openedWin)return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();if(pendingAction){resetWinAction();document.getElementById('winReopen').focus();}else closeWin();}
    if(e.key==='Tab'){
      const items=[...overlay.querySelectorAll('button:not([disabled]),input:not([disabled])')].filter(el=>!el.closest('[hidden]')&&el.type!=='file');
      const first=items[0],last=items[items.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
    // Do not let global app shortcuts mutate the background while a win is open.
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopImmediatePropagation();}
  },true);
  document.getElementById('winAddPhotos').onclick=()=>document.getElementById('winPhotoInput').click();
  document.getElementById('winPhotoInput').addEventListener('change',async e=>{
    const files=[...e.target.files];e.target.value='';const key=openedWin,win=winById(key);if(!win||!files.length||photoBusy)return;
    if(files.length+(win.photos?.length||0)>photoLimit){error(`Choose up to ${photoLimit-(win.photos?.length||0)} more photos.`);return;}
    photoBusy=true;renderWin();error('Saving your memories…');
    try{
      const added=[];
      for(const file of files){const photoId=id(),data=await compressPhoto(file);await imageRecord(photoId,{id:photoId,data});added.push({id:photoId,name:file.name});}
      commit(()=>{const target=winById(key);if(!target)throw new Error('Achievement no longer exists');target.photos=(target.photos||[]).concat(added);});
      renderArchive();error('Memories saved. You can revisit them in Shadow Army.');
    }catch(e){error(e.message);}finally{photoBusy=false;if(openedWin===key)renderWin();}
  });
  bucketUI=window.ARISEBucketList.create({getState,save,onChanged:()=>{onChanged();renderGoals();renderArchive();},onWin:(key,isNew)=>openWin(key,isNew)});
  return {render,renderGoals,renderArchive,openWin};
}
window.ARISEAchievements={create,exportImages,importImages,completeGoal,validPhoto,isActiveWin,changeWinStatus,restoreWin,savePhoto,readPhoto:imageRecord};
})();
