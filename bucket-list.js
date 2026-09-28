(function(){
'use strict';
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const categories={travel:['Travel','↗'],adventure:['Adventure','◇'],learn:['Learn & create','✦'],life:['Life & connection','♡']};
function saveWish(state,draft,photo){
  const title=String(draft.title||'').trim();if(!title)throw Error('Give your wish a name.');
  let goal=draft.id?state.goals.find(g=>g.id===draft.id&&g.horizon==='bucket'&&!g.achievedAt&&!g.deletedAt):null;
  if(draft.id&&!goal)throw Error('This wish has changed. Close the editor and try again.');
  if(!goal){goal={id:'wish_'+crypto.randomUUID(),horizon:'bucket',createdAt:new Date().toISOString(),achievedAt:null,photos:[]};state.goals.push(goal);}
  Object.assign(goal,{title:title.slice(0,180),notes:String(draft.notes||'').trim().slice(0,1500),category:categories[draft.category]?draft.category:'life'});
  if(draft.removePhoto)goal.photos=[];
  if(photo)goal.photos=[photo];
  return goal;
}
function create({getState,save,onChanged,onWin}){
  const root=document.getElementById('bucketBoard'),api=window.ARISEAchievements;
  let draft=null,busy=false,filter='dreaming',pendingDelete=null,message='';
  const wishes=()=>getState().goals.filter(g=>g.horizon==='bucket');
  function commit(fn){
    const state=getState(),before=JSON.stringify({goals:state.goals,achievements:state.achievements});
    try{const result=fn();save();return result;}catch(e){Object.assign(state,JSON.parse(before));throw e;}
  }
  async function hydrate(){
    await Promise.all([...root.querySelectorAll('[data-wish-photo]')].map(async img=>{
      try{const record=await api.readPhoto(img.dataset.wishPhoto);if(img.isConnected&&record&&api.validPhoto(record.data))img.src=record.data;}
      catch(_){if(img.isConnected)img.alt='Inspiration photo unavailable';}
    }));
  }
  function render(){
    // Keep an in-progress upload or unsaved editor intact if another view refreshes.
    if(busy)return;
    const all=wishes(),active=all.filter(g=>!g.deletedAt),dreaming=active.filter(g=>!g.achievedAt),done=active.filter(g=>g.achievedAt),removed=all.filter(g=>g.deletedAt);
    const shown=filter==='experienced'?done:dreaming;
    root.innerHTML=`<header class="bucket-heading"><div><div class="goals-eyebrow">Bucket List · Your vision board</div><h1>A life to look forward to.</h1><p>Places to see. Things to try. Moments you want to live.<br>No deadline needed—just something that lights you up.</p></div><button class="btn btn-primary" data-wish-new>＋ Add a wish</button></header>
      <div class="bucket-toolbar" aria-label="Bucket list views"><button class="btn btn-sm" data-wish-filter="dreaming" aria-pressed="${filter==='dreaming'}">Dreaming · ${dreaming.length}</button><button class="btn btn-sm" data-wish-filter="experienced" aria-pressed="${filter==='experienced'}">Experienced · ${done.length}</button><span>Your goals above are shared across ARISE.</span></div>
      ${draft?`<form id="wishForm" class="wish-form"><h2>${draft.id?'Shape your wish':'What would you love to do?'}</h2><label class="wish-wide">Your wish<input name="title" required maxlength="180" placeholder="Go skydiving, visit Greece, learn to surf…" value="${esc(draft.title)}"></label><label>Category<select name="category">${Object.entries(categories).map(([key,[label]])=>`<option value="${key}" ${draft.category===key?'selected':''}>${label}</option>`).join('')}</select></label><label>Inspiration photo <span>Optional · JPG, PNG or WebP · up to 20 MB</span><input name="photo" type="file" accept="image/jpeg,image/png,image/webp"></label><label class="wish-wide">Why it matters to you<textarea name="notes" maxlength="1500" rows="3" placeholder="Imagine what this moment would feel like…">${esc(draft.notes)}</textarea></label>${draft.photos?.length?`<label class="wish-remove-photo"><input type="checkbox" name="removePhoto" ${draft.removePhoto?'checked':''}> Remove current inspiration photo</label>`:''}<div class="wish-wide wish-form-actions"><button type="submit" class="btn btn-primary">${draft.id?'Save wish':'Add to my board'}</button><button type="button" class="btn" data-wish-cancel>Cancel</button></div></form>`:''}
      <p id="wishStatus" class="goal-status" role="status">${esc(message)}</p>
      <div class="wish-grid">${shown.length?shown.map(g=>{const [category,glyph]=categories[g.category]||categories.life;return `<article class="wish-card wish-${esc(g.category||'life')}">${g.photos?.length?`<img class="wish-cover" data-wish-photo="${esc(g.photos[0].id)}" alt="Inspiration for ${esc(g.title)}">`:`<div class="wish-cover wish-cover-empty" aria-hidden="true">${glyph}</div>`}<div class="wish-card-body"><span class="win-horizon">${category}</span><h2>${esc(g.title)}</h2>${g.notes?`<p class="wish-note">${esc(g.notes)}</p>`:''}${g.achievedAt?`<p class="wish-date">Experienced ${esc(new Date(g.achievedAt).toLocaleDateString())}</p><button class="btn btn-sm" data-wish-memory="${esc(g.id)}">View my win ↗</button>`:`<div class="wish-card-actions"><button class="btn btn-sm" data-wish-complete="${esc(g.id)}">✓ I did it</button><button class="btn btn-sm" data-wish-edit="${esc(g.id)}" aria-label="Edit wish: ${esc(g.title)}">Edit</button><button class="wish-remove" data-wish-remove="${esc(g.id)}" aria-label="Remove wish: ${esc(g.title)}">Remove</button></div>${pendingDelete===g.id?`<div class="wish-delete-confirm"><p>Remove this wish? You can restore it below.</p><button class="btn btn-sm" data-wish-delete-cancel>Keep wish</button><button class="btn btn-sm btn-danger" data-wish-delete="${esc(g.id)}">Remove wish</button></div>`:''}`}</div></article>`}).join(''):`<div class="wish-empty"><span aria-hidden="true">✧</span><h2>${filter==='experienced'?'Your first “I did it” is ahead.':'Leave room for a little wonder.'}</h2><p>${filter==='experienced'?'When you experience a wish, its celebration will live in Shadow Army too.':'Add a place, an adventure or a lifelong dream. Make it yours with an inspiration photo.'}</p>${filter==='dreaming'?'<button class="btn" data-wish-new>Add your first wish</button>':''}</div>`}</div>
      ${removed.length?`<details class="removed-wins"><summary>Removed wishes · ${removed.length}</summary>${removed.map(g=>`<div class="removed-win-row"><span>${esc(g.title)}</span><button class="btn btn-sm" data-wish-restore="${esc(g.id)}" aria-label="Restore wish: ${esc(g.title)}">Restore wish</button></div>`).join('')}</details>`:''}`;
    hydrate();
  }
  function status(text){message=text;const el=document.getElementById('wishStatus');if(el)el.textContent=text;}
  root.addEventListener('input',e=>{if(draft&&['title','notes','category','removePhoto'].includes(e.target.name))draft[e.target.name]=e.target.type==='checkbox'?e.target.checked:e.target.value;});
  root.addEventListener('change',e=>{if(draft&&['category','removePhoto'].includes(e.target.name))draft[e.target.name]=e.target.type==='checkbox'?e.target.checked:e.target.value;if(draft&&e.target.name==='photo'){draft.selectedPhoto=e.target.files[0]||null;if(draft.selectedPhoto)status('Selected inspiration: '+draft.selectedPhoto.name);}});
  root.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&e.target.matches('#wishForm input[name=title]')){e.preventDefault();if(!e.repeat)e.target.form.requestSubmit();}});
  root.addEventListener('submit',async e=>{
    if(e.target.id!=='wishForm')return;e.preventDefault();if(busy||!draft)return;
    const form=e.target,data=new FormData(form),file=form.elements.photo.files[0]||draft.selectedPhoto,values={...draft,title:data.get('title'),category:data.get('category'),notes:data.get('notes'),removePhoto:data.get('removePhoto')==='on'};
    busy=true;form.querySelectorAll('input,textarea,select,button').forEach(el=>el.disabled=true);status(file?'Saving your inspiration photo…':'Saving your wish…');
    try{const photo=file?await api.savePhoto(file):null;commit(()=>saveWish(getState(),values,photo));draft=null;filter='dreaming';message='Wish saved. Something wonderful to look forward to.';busy=false;onChanged();root.querySelector('[data-wish-new]')?.focus();}
    catch(err){status(err.message||'Could not save your wish. Please try again.');}
    finally{busy=false;if(form.isConnected)form.querySelectorAll('input,textarea,select,button').forEach(el=>el.disabled=false);}
  });
  root.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b||busy)return;
    try{
      if(b.hasAttribute('data-wish-new')){draft={title:'',notes:'',category:'life'};message='';render();root.querySelector('[name=title]').focus();return;}
      if(b.hasAttribute('data-wish-cancel')){draft=null;render();return;}
      if(b.dataset.wishFilter){filter=b.dataset.wishFilter;pendingDelete=null;render();return;}
      if(b.dataset.wishEdit){draft={...wishes().find(g=>g.id===b.dataset.wishEdit)};render();root.querySelector('[name=title]').focus();return;}
      if(b.dataset.wishRemove){pendingDelete=b.dataset.wishRemove;render();root.querySelector('[data-wish-delete-cancel]')?.focus();return;}
      if(b.hasAttribute('data-wish-delete-cancel')){pendingDelete=null;render();return;}
      if(b.dataset.wishDelete){commit(()=>{const g=wishes().find(g=>g.id===b.dataset.wishDelete);if(g&&!g.achievedAt)g.deletedAt=new Date().toISOString();});pendingDelete=null;draft=null;message='Wish removed. You can restore it below.';onChanged();return;}
      if(b.dataset.wishRestore){commit(()=>{const g=wishes().find(g=>g.id===b.dataset.wishRestore);if(g)delete g.deletedAt;});filter='dreaming';onChanged();return;}
      if(b.dataset.wishComplete){const win=commit(()=>api.completeGoal(getState(),b.dataset.wishComplete));if(win){draft=null;onChanged();onWin(win.id,true);}return;}
      if(b.dataset.wishMemory){const win=getState().achievements.find(w=>w.goalId===b.dataset.wishMemory&&api.isActiveWin(w));if(win)onWin(win.id,false);}
    }catch(err){status(err.message||'Could not save your change. Please try again.');}
  });
  return {render};
}
window.ARISEBucketList={create,saveWish};
})();
