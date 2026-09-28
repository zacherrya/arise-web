(function(){
"use strict";

/* ============ CONSTANTS ============ */
const STORE_KEY = "sl_productivity_state_v1";
const ACTIVE_USER_KEY = "arise.cloud.active-user.v1";
const CLOUD_ENABLED_PREFIX = "arise.cloud.data.enabled.v2:user:";
const GOOGLE_CALENDAR_OWNER_KEY = "arise.google.calendar-owner.v1";
const AI_KEY_OWNER_KEY = "arise.ai.key-owner.v1";
const accountStoreKey = userId => `${STORE_KEY}:user:${userId}`;
let todayUI=null,tomorrowUI=null;
let healthUI=null;
let notificationsUI=null;
let customRemindersUI=null;

/* Action-only System effects. Never called by renderers or persisted in state. */
function systemMotion(action){
  try{
    const motion=window.AriseMotion;
    if(motion?.enabled?.() && motion.mode?.()!=="minimal") action(motion);
  }catch(_){ /* Optional decoration must never interrupt an operation. */ }
}
function systemPulse(element, className, ms=700){
  if(element) systemMotion(m=>m.pulse?.(element,className,ms));
}
function systemAnnounce(title,detail){systemMotion(m=>m.announce?.(title,detail));}
const systemOpenedProjects=new Set();
function systemProjectOpened(pid){
  if(systemOpenedProjects.has(pid) || !findProject(pid)) return;
  systemOpenedProjects.add(pid);
  const node=Array.from(document.querySelectorAll('[data-select-dungeon]')).find(el=>el.dataset.selectDungeon===pid);
  systemPulse(node,"system-portal-open");
  systemPulse(document.querySelector('#dungeonDetail .tree'),"system-tree-reveal");
}
function systemProjectComplete(project){
  return project.tasks.length>0 && project.tasks.every(g=>progressPct(g)===100);
}
function systemTaskCompleted(project,gid,nid,wasProjectComplete){
  const panel=Array.from(document.querySelectorAll('#dungeonDetail .detail-panel[data-pid]')).find(el=>el.dataset.pid===project.id);
  const gate=panel && Array.from(panel.querySelectorAll('[data-gid]')).find(el=>el.dataset.gid===gid);
  if(gate){
    const node=nid && Array.from(gate.querySelectorAll('[data-nid]')).find(el=>el.dataset.nid===`${project.id}:${gid}:${nid}`);
    systemPulse(node||gate,"system-task-complete");
    systemPulse(gate.querySelector('.subtree'),"system-connectors-pulse");
    systemPulse(gate.querySelector('.gate-progress-wrap'),"system-parent-progress");
    systemPulse(panel.querySelector('.dungeon-progress'),"system-parent-progress");
  }
  if(!wasProjectComplete && systemProjectComplete(project)){
    const portal=Array.from(document.querySelectorAll('[data-select-dungeon]')).find(el=>el.dataset.selectDungeon===project.id);
    systemPulse(portal,"system-portal-cleared");
    systemAnnounce("Dungeon cleared",project.name);
  }
}
const systemNexusActivity={listening:0,thinking:0,speaking:0};
function systemNexusState(kind,active){
  systemNexusActivity[kind]=Math.max(0,systemNexusActivity[kind]+(active?1:-1));
  const current=['speaking','thinking','listening'].find(key=>systemNexusActivity[key]>0)||'idle';
  for(const id of ['nexusDrawer','nexusPanelOpen','voiceBtn']){
    const el=document.getElementById(id);if(el)el.setAttribute('data-system-nexus',current);
  }
}

const RANK_COLOR = { E:"var(--rank-e)", D:"var(--rank-d)", C:"var(--rank-c)", B:"var(--rank-b)", A:"var(--rank-a)", S:"var(--rank-s)" };
const RANK_XP = { E:5, D:10, C:20, B:35, A:55, S:85 };

const REST_POOL = [
  { text:"Drink a full glass of water", xp:2, icon:"💧" },
  { text:"Stand up and stretch for 60 seconds", xp:2, icon:"🧘" },
  { text:"Take 10 slow, deep breaths", xp:2, icon:"🌬️" },
  { text:"Tidy one thing on your desk", xp:3, icon:"🧹" },
  { text:"Write down your very next task", xp:3, icon:"📝" },
  { text:"Look at something 20ft away for 20 seconds", xp:2, icon:"👀" },
  { text:"Do 10 squats or jumping jacks", xp:4, icon:"🏃" },
  { text:"Write one thing you're grateful for", xp:3, icon:"✨" },
  { text:"Roll your shoulders and neck", xp:2, icon:"💆" },
  { text:"Step outside or open a window for fresh air", xp:3, icon:"🌤️" },
];

const WEEKDAY_MODES={};

const SHADOW_NAMES = [
  ["Ashborn","E"],["Nightclaw","D"],["Wraith Sentinel","D"],["Ironclad Revenant","C"],
  ["Hollow Fang","C"],["Grim Vanguard","B"],["Duskbringer","B"],["Voidreaper","A"],
  ["Cinder Monarch","A"],["Obsidian Warden","A"],["Ebonwing","S"],["The Silent King","S"],
  ["Frostmourn Wraith","B"],["Blackthorn","C"],["Ravenshade","D"],["Soulforge","B"],
  ["Nyx Umbra","A"],["The Undying","S"],["Cryptwalker","C"],["Moonless Fang","D"],
];

/* ============ HELPERS ============ */
function uid(p){ return p+"_"+Math.random().toString(36).slice(2,9)+Date.now().toString(36); }
function todayStr(d){ d = d || new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function computeScore(u,i,e){ return (u*i)/Math.max(1,e); }
function rankFromScore(s){ if(s>=15)return"S"; if(s>=9)return"A"; if(s>=5.5)return"B"; if(s>=3)return"C"; if(s>=1.4)return"D"; return"E"; }
function dueMultiplier(due){
  if(!due) return 1;
  const now = new Date(); now.setHours(0,0,0,0);
  const d = new Date(due+"T00:00:00");
  const days = Math.round((d-now)/86400000);
  if(days<0) return 2.0;
  if(days===0) return 1.8;
  if(days<=2) return 1.5;
  if(days<=7) return 1.15;
  return 0.95;
}
function xpForLevel(lvl){ return Math.round(100*Math.pow(lvl,1.35)); }
function titleForLevel(lvl){
  if(lvl>=40) return "S-Rank Hunter · Shadow Monarch";
  if(lvl>=25) return "A-Rank Hunter";
  if(lvl>=15) return "B-Rank Hunter";
  if(lvl>=10) return "C-Rank Hunter";
  if(lvl>=5) return "D-Rank Hunter";
  return "E-Rank Hunter";
}
function rankLetterForLevel(lvl){ return titleForLevel(lvl)[0]; }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function fmtTime(sec){ const m=Math.floor(sec/60), s=sec%60; return String(m).padStart(2,"0")+":"+String(s).padStart(2,"0"); }

/* ============ STATE ============ */
function defaultState(){
  return {
    player:{ xp:0, level:1, streak:0, lastStreakDate:null, totalCleared:0, focusSessionsTotal:0, shadowArmy:[] },
    projects:[],
    goals:[], achievements:[],
    daily:{ date: todayStr(), quests:[], penaltyPending:false, lastPenaltyMsg:null },
    pomodoro:{ mode:"focus", workMin:25, shortBreak:5, longBreak:15, everyN:4, secondsLeft:25*60, running:false, sessionCount:0, currentRest:null, timerHandle:null },
    voice:{ enabled:true, wakeEnabled:false, showTranscripts:true, voiceName:null, rate:1.0, micGranted:false },
    calendar:{ events:[], localEvents:[], recentGuestEmails:[], lastSync:null, protectDaily:false, victories:["","",""], capacityHours:35, view:"week", showCompleted:false, showBreaks:true, showWeekends:true, backlogOpen:false, drawerBacklogV2:true, creativeWeekVersion:1, routineEnabled:false, routineTemplate:[] },
    theme:"dark",
    lastAutoBackup:null,
    integrations:{ trello:{ key:"", token:"", boards:[], lastSync:null, onlyMine:true, autoSync:true, memberId:null, memberName:null } },
  };
}

let state = load();
let goalsUI=null;
let cloudSync=null;
let cloudDataController=null;
let applyingCloudState=false;
let activeDataUserId=null;
let widgetPublishTimer=null,lastWidgetSnapshot="";
if(state.calendar.drawerBacklogV2!==true){state.calendar.backlogOpen=false;state.calendar.drawerBacklogV2=true}

function normalizeState(parsed){
  try{
    if(!parsed||typeof parsed!=="object")return defaultState();
    const d = defaultState();
    return Object.assign(d, parsed, {
      player: Object.assign(d.player, parsed.player),
      daily: Object.assign(d.daily, parsed.daily),
      pomodoro: Object.assign(d.pomodoro, parsed.pomodoro, {running:false, timerHandle:null}),
      voice: Object.assign(d.voice, parsed.voice),
      calendar: Object.assign(d.calendar, parsed.calendar),
      theme: parsed.theme || d.theme,
      lastAutoBackup: parsed.lastAutoBackup || null,
      integrations: Object.assign(d.integrations, parsed.integrations),
    });
  }catch(e){ return defaultState(); }
}
function load(key=STORE_KEY){
  try{const raw=localStorage.getItem(key);return raw?normalizeState(JSON.parse(raw)):defaultState();}
  catch(e){return defaultState();}
}
function save(){
  // The legacy unscoped copy is preserved for a later, explicit import. Never
  // write account data there or queue a cloud upload before auth is ready.
  if(!activeDataUserId)return;
  const {pomodoro, ...rest} = state;
  const {timerHandle, running, ...pomoSafe} = pomodoro;
  const persisted={...rest,pomodoro:{...pomoSafe,running:false}};
  localStorage.setItem(accountStoreKey(activeDataUserId),JSON.stringify(persisted));
  queueWidgetSnapshot();
  if(!applyingCloudState)cloudDataController?.localChanged();
}
function activateCloudAccount(userId){
  if(!userId)throw Error("A verified ARISE account is required.");
  if(activeDataUserId===userId)return;
  cloudDataController?.stop();cloudDataController=null;
  const key=accountStoreKey(userId);
  // Never infer ownership of the old shared copy from a sign-in marker: an
  // earlier release could leave that copy in place across account switches.
  // Keep it untouched for a later, explicitly approved import.
  activeDataUserId=userId;
  state=load(key);
  undoStack.length=0;
  for(const id of ["trelloKey","trelloToken","openaiKey"]){const input=document.getElementById(id);if(input)input.value=""}
  selectedDungeonId=null;
  renderAll();applyTheme();
}
function clearCloudAccount(){
  cloudDataController?.stop();cloudDataController=null;
  activeDataUserId=null;state=defaultState();undoStack.length=0;selectedDungeonId=null;
  for(const id of ["trelloKey","trelloToken","openaiKey"]){const input=document.getElementById(id);if(input)input.value=""}
  renderAll();queueWidgetSnapshot();
}
function ensureCreativeWeekSetup(){
  if(state.calendar.creativeWeekVersion===1)return;
  if(!Array.isArray(state.calendar.routineTemplate))state.calendar.routineTemplate=[];
  if(!Array.isArray(state.calendar.victories))state.calendar.victories=["","",""];
  state.calendar.creativeWeekVersion=1;
  save();
}

const MIGRATE_FLAG = "sl_migrated_from_file_v1";
async function maybeMigrateFromFileOrigin(){
  if(location.protocol!=="file:")return;
  if(localStorage.getItem(MIGRATE_FLAG)) return;
  const looksFresh = state.projects.length===0 && state.player.totalCleared===0 && state.player.xp===0;
  if(!looksFresh){ localStorage.setItem(MIGRATE_FLAG,"1"); return; }
  try{
    const res = await fetch("./migrate-seed.json");
    if(res.ok){
      const seed = await res.json();
      const d = defaultState();
      state = Object.assign(d, seed, {
        player: Object.assign(d.player, seed.player),
        daily: Object.assign(d.daily, seed.daily),
        pomodoro: Object.assign(d.pomodoro, seed.pomodoro, {running:false, timerHandle:null}),
      });
      localStorage.setItem(STORE_KEY,JSON.stringify(state));
    }
  }catch(e){ /* no seed file present, nothing to migrate */ }
  localStorage.setItem(MIGRATE_FLAG,"1");
}

/* ============ DAY ROLLOVER / PENALTY ============ */
function handleDayRollover(){
  const today = todayStr();
  if(state.daily.date === today) return;
  const quests = state.daily.quests;
  if(quests.length > 0){
    const allDone = quests.every(q=>q.done);
    if(allDone){
      bumpStreak(true);
    } else {
      state.player.streak = 0;
      state.daily.penaltyPending = true;
      state.daily.lastPenaltyMsg = "Daily Quest was incomplete. Streak reset to 0.";
    }
  }
  state.daily.date = today;
  state.daily.quests = quests.map(q=>({...q, done:false}));
  save();
}
function bumpStreak(fromRollover){
  const today = todayStr();
  if(state.player.lastStreakDate === today) return;
  state.player.streak += 1;
  state.player.lastStreakDate = today;
}
function maybeCompleteDailyStreak(){
  if(state.daily.quests.length===0) return;
  const allDone = state.daily.quests.every(q=>q.done);
  if(allDone) bumpStreak(false);
}

/* ============ XP / LEVEL ============ */
function launchXPOrbs(origin, amount){
  const target=document.getElementById("xpFill")||document.querySelector(".xp-track");
  if(!target) return;
  const tr=target.getBoundingClientRect();
  const or=origin&&origin.getBoundingClientRect ? origin.getBoundingClientRect() : {left:innerWidth/2,right:innerWidth/2,top:innerHeight*.7,bottom:innerHeight*.7};
  const sx=(or.left+or.right)/2, sy=(or.top+or.bottom)/2, tx=tr.right-3, ty=(tr.top+tr.bottom)/2;
  const count=Math.max(7,Math.min(16,Math.round(amount/5)+7));
  for(let i=0;i<count;i++){
    const orb=document.createElement("i"); orb.className="xp-orb";
    const jitterX=(Math.random()-.5)*26, jitterY=(Math.random()-.5)*20;
    orb.style.left=(sx-4+jitterX)+"px"; orb.style.top=(sy-4+jitterY)+"px";
    document.body.appendChild(orb);
    const dx=tx-(sx+jitterX), dy=ty-(sy+jitterY), arc=-35-Math.random()*55;
    const anim=orb.animate([
      {transform:"translate(0,0) scale(.65)",opacity:0},
      {transform:`translate(${dx*.25}px,${dy*.18+arc}px) scale(1.2)`,opacity:1,offset:.28},
      {transform:`translate(${dx*.72}px,${dy*.68+arc*.35}px) scale(.9)`,opacity:1,offset:.72},
      {transform:`translate(${dx}px,${dy}px) scale(.15)`,opacity:0}
    ],{duration:880+Math.random()*260,delay:i*26,easing:"cubic-bezier(.2,.72,.25,1)",fill:"forwards"});
    anim.onfinish=()=>{ orb.remove(); if(i===count-1){ const track=document.querySelector(".xp-track"); track.classList.remove("xp-impact"); void track.offsetWidth; track.classList.add("xp-impact"); } };
  }
}
function awardXP(amount, label, origin){
  launchXPOrbs(origin,amount);
  state.player.xp += amount;
  let leveled = false, newLevel = state.player.level;
  while(state.player.xp >= xpForLevel(state.player.level)){
    state.player.xp -= xpForLevel(state.player.level);
    state.player.level += 1;
    leveled = true;
    newLevel = state.player.level;
  }
  toast(`+${amount} XP${label?" · "+label:""}`, "xp");
  save();
  renderHUD();
  if(leveled) showLevelUp(newLevel);
}
function removeXP(amount, label){
  let remaining=amount;
  while(remaining>state.player.xp && state.player.level>1){
    remaining-=state.player.xp;
    state.player.level-=1;
    state.player.xp=xpForLevel(state.player.level);
  }
  state.player.xp=Math.max(0,state.player.xp-remaining);
  toast(`-${amount} XP${label?" · "+label:""}`,"danger");
  save(); renderHUD();
}

/* ============ TREE HELPERS ============ */
function leafStats(node){
  if(node.children && node.children.length){
    let total=0, done=0;
    for(const c of node.children){ const s=leafStats(c); total+=s.total; done+=s.done; }
    return {total, done};
  }
  return {total:1, done:node.done?1:0};
}
function progressPct(node){
  const {total, done} = leafStats(node);
  return total===0 ? 0 : Math.round((done/total)*100);
}
function findProject(pid){ return state.projects.find(p=>p.id===pid); }
function findGate(project, gid){ return project.tasks.find(g=>g.id===gid); }
function findNode(root, id){
  if(root.id===id) return root;
  if(root.children){ for(const c of root.children){ const f=findNode(c,id); if(f) return f; } }
  return null;
}
function findParentOf(root, id){
  if(root.children){
    for(const c of root.children){
      if(c.id===id) return root;
      const f = findParentOf(c,id);
      if(f) return f;
    }
  }
  return null;
}

/* ============ UI STATE (not persisted) ============ */
let selectedDungeonId = null;
let currentView = "quests";

/* ============ RENDER: HUD ============ */
function renderHUD(){
  const p = state.player;
  document.getElementById("hudAvatar").textContent = rankLetterForLevel(p.level);
  document.getElementById("hudTitle").textContent = titleForLevel(p.level);
  document.getElementById("hudLevel").textContent = "LV. "+p.level;
  const compactRank=document.getElementById("hunterCompactRank");if(compactRank)compactRank.textContent=`Level ${p.level} · ${titleForLevel(p.level)}`;
  const need = xpForLevel(p.level);
  document.getElementById("xpFill").style.width = Math.min(100,(p.xp/need)*100)+"%";
  const compactXP=document.getElementById('hunterCompactXP'),compactFill=document.getElementById('hunterCompactXPFill');
  const levelProgress=Math.max(0,Math.min(100,(p.xp/need)*100));
  if(compactFill)compactFill.style.width=levelProgress+'%';
  if(compactXP){compactXP.setAttribute('aria-valuenow',String(Math.round(levelProgress)));compactXP.setAttribute('aria-valuetext',`${p.xp} of ${need} XP toward level ${p.level+1}`);compactXP.title=`${p.xp} / ${need} XP`;}
  document.getElementById("xpLabel").textContent = `${p.xp} / ${need} XP`;
  document.getElementById("streakN").textContent = p.streak;
  document.getElementById("clearedN").textContent = p.totalCleared;
  document.getElementById("armyN").textContent = (state.achievements||[]).filter(w=>!w.status||w.status==='achieved').length;

  const dailyLeft = state.daily.quests.filter(q=>!q.done).length;
  const badge = document.getElementById("dailyBadge");
  if(dailyLeft>0){ badge.style.display="inline-block"; badge.textContent = dailyLeft; }
  else badge.style.display="none";
}

/* ============ RENDER: DUNGEONS / QUEST LOG (portal mindmap) ============ */
function renderPortal(){
  const stage = document.getElementById("portalStage");
  const nodesBox = document.getElementById("portalNodes");
  const svg = document.getElementById("portalLines");
  const projects = state.projects;

  if(selectedDungeonId && !findProject(selectedDungeonId)) selectedDungeonId = null;
  if(!selectedDungeonId && projects.length) selectedDungeonId = projects[0].id;

  if(projects.length===0){
    stage.style.height = "220px";
    svg.innerHTML = "";
    nodesBox.innerHTML = "";
    document.getElementById("dungeonDetail").innerHTML = `<div class="empty"><div class="glyph">🌀</div>The portal is quiet.<br>Open a dungeon to begin.</div>`;
    return;
  }

  const n = projects.length;
  const containerWidth = stage.clientWidth || 600;
  const coreR = 50, nodeR = 36;
  const nodeMargin = containerWidth < 480 ? 56 : 72;
  const idealRadius = Math.max(130, Math.min(300, (n*88)/(2*Math.PI)));
  const radius = Math.min(idealRadius, Math.max(coreR+nodeR+16, containerWidth/2 - nodeMargin));
  const size = Math.round(radius*2 + nodeMargin*2);
  stage.style.height = size+"px";
  svg.setAttribute("width", containerWidth);
  svg.setAttribute("height", size);
  svg.setAttribute("viewBox", `0 0 ${containerWidth} ${size}`);
  const cx = containerWidth/2, cy = size/2;

  const core = document.getElementById("portalCore");
  core.style.left = cx+"px";
  core.style.top = cy+"px";

  const defs = `<defs><linearGradient id="portalLineGrad" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#7c5cff"/><stop offset="100%" stop-color="#4d7fff"/></linearGradient></defs>`;
  let lines = "";
  let nodes = "";

  projects.forEach((p,i)=>{
    const angle = (2*Math.PI*i/n) - Math.PI/2;
    const x = Math.round(cx + radius*Math.cos(angle));
    const y = Math.round(cy + radius*Math.sin(angle));
    const gates = p.tasks;
    const overallDone = gates.length ? Math.round(gates.reduce((a,g)=>a+progressPct(g),0)/gates.length) : 0;
    const active = p.id===selectedDungeonId;
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    const lx1 = Math.round(cx + coreR*cosA), ly1 = Math.round(cy + coreR*sinA);
    const lx2 = Math.round(x - nodeR*cosA), ly2 = Math.round(y - nodeR*sinA);
    lines += `<line x1="${lx1}" y1="${ly1}" x2="${lx2}" y2="${ly2}" class="portal-line ${active?"active":""}"/>`;
    nodes += `
    <button class="dungeon-node ${active?"active":""}" style="left:${x}px;top:${y}px;" data-select-dungeon="${p.id}">
      <div class="node-ring" style="--pct:${overallDone};--ring-color:${overallDone===100?"var(--gold)":"var(--primary)"}">
        <div class="node-ring-inner">${p.emoji}</div>
      </div>
      <div class="node-label">${escapeHtml(p.name)}</div>
      <div class="node-meta">${gates.length} gate${gates.length!==1?"s":""} · ${overallDone}%</div>
    </button>`;
  });

  svg.innerHTML = defs + lines;
  nodesBox.innerHTML = nodes;

  renderDungeonDetail();
}

function renderDungeonDetail(){
  const box = document.getElementById("dungeonDetail");
  const project = findProject(selectedDungeonId);
  if(!project){ box.innerHTML = ""; return; }
  const gates = project.tasks;
  const overallDone = gates.length ? Math.round(gates.reduce((a,g)=>a+progressPct(g),0)/gates.length) : 0;
  const sortedGates = [...gates].sort((a,b)=>{
    const sa = computeScore(a.urgency,a.impact,a.effort) * dueMultiplier(a.due);
    const sb = computeScore(b.urgency,b.impact,b.effort) * dueMultiplier(b.due);
    return sb-sa;
  });
  box.innerHTML = `
  <div class="detail-panel" data-pid="${project.id}">
    <div class="detail-head">
      <span class="dungeon-emoji">${project.emoji}</span>
      <div style="flex:none;">
        <div class="dungeon-name">${escapeHtml(project.name)}</div>
        <div class="dungeon-meta">${gates.length} gate${gates.length!==1?"s":""} · ${overallDone}% cleared</div>
      </div>
      <div class="dungeon-progress"><div class="mini-bar"><div class="mini-fill" style="width:${overallDone}%;background:linear-gradient(90deg,var(--primary-2),var(--primary));"></div></div></div>
      <div class="dungeon-actions">
        <button class="btn btn-sm" data-edit-dungeon="${project.id}" title="Rename dungeon">✎</button>
        <button class="btn btn-sm btn-primary" data-add-gate="${project.id}">+ Gate</button>
        <button class="btn btn-sm btn-danger" data-del-dungeon="${project.id}">Delete</button>
      </div>
    </div>
    <div class="detail-body">
      <div class="tree">
        ${sortedGates.length ? sortedGates.map(g=>renderGate(project.id,g)).join("") : `<div class="empty" style="padding:20px;">No gates yet. Add one to begin.</div>`}
      </div>
    </div>
  </div>`;
}

function renderGate(pid, gate){
  const score = computeScore(gate.urgency, gate.impact, gate.effort);
  const rank = rankFromScore(score);
  const pct = progressPct(gate);
  const cleared = pct===100;
  const dueInfo = dueBadge(gate.due);
  return `
  <div class="gate ${cleared?"cleared":""}" style="border-left-color:${RANK_COLOR[rank]}" data-gid="${gate.id}">
    <div class="gate-row">
      <span class="rank-badge" style="background:${RANK_COLOR[rank]}">${rank}</span>
      <span class="gate-title ${cleared?"done":""}">${escapeHtml(gate.title)}</span>
      ${gate.trelloId?'<span class="src-tag" title="Imported from Trello">Trello</span>':""}
      ${dueInfo}
      <div class="gate-toggle-actions">
        <button class="btn btn-sm" data-chatgpt-gate="${pid}:${gate.id}" title="Work on this in ChatGPT">↗ ChatGPT</button>
        <button class="btn btn-sm" data-ai-gate="${pid}:${gate.id}" title="Ask Nexus for a plan">✦</button>
        <button class="btn btn-sm" data-edit-gate="${pid}:${gate.id}" title="Edit gate">✎</button>
        <button class="btn btn-sm" data-del-gate="${pid}:${gate.id}" title="Delete gate">✕</button>
      </div>
    </div>
    <div class="gate-progress-wrap">
      <div class="mini-bar"><div class="mini-fill" style="width:${pct}%;background:${RANK_COLOR[rank]}"></div></div>
      <div class="gate-pct">${pct}%</div>
    </div>
    <div class="subtree">
      ${(gate.children||[]).map(c=>renderSub(pid, gate.id, c)).join("")}
    </div>
    <div class="add-sub-row">
      <input placeholder="Add a quest for this gate..." data-new-sub="${pid}:${gate.id}">
      <button class="btn btn-sm btn-primary" data-add-sub="${pid}:${gate.id}">Add</button>
    </div>
    ${gate.children.length===0 ? `<div style="margin-top:8px;margin-left:20px;"><button class="btn btn-sm ${cleared?"btn-ghost":"btn-primary"}" data-mark-gate="${pid}:${gate.id}">${cleared?"Cleared ✓":"Mark Gate Cleared"}</button></div>` : ""}
  </div>`;
}

function renderSub(pid, gid, node, depth){
  depth = depth||0;
  const pct = progressPct(node);
  const isLeaf = !(node.children && node.children.length);
  const done = isLeaf ? node.done : pct===100;
  let html = `
  <div class="sub" data-nid="${pid}:${gid}:${node.id}">
    <button class="check ${done?"done":""}" data-toggle-sub="${pid}:${gid}:${node.id}"></button>
    <div style="flex:1;">
      <span class="sub-title ${done?"done":""}" data-rename-sub="${pid}:${gid}:${node.id}" title="Double-click to rename">${escapeHtml(node.title)}</span>
      ${!isLeaf ? `<div class="mini-bar" style="margin-top:5px;max-width:160px;"><div class="mini-fill" style="width:${pct}%;background:var(--primary-2);"></div></div>` : ""}
    </div>
    <button class="sub-edit" data-edit-sub="${pid}:${gid}:${node.id}" title="Rename quest">✎</button>
    <button class="sub-del" data-del-sub="${pid}:${gid}:${node.id}">✕</button>
  </div>`;
  if(node.children && node.children.length){
    html += `<div class="sub-children">${node.children.map(c=>renderSub(pid,gid,c,depth+1)).join("")}</div>`;
  }
  return html;
}

function dueBadge(due){
  if(!due) return "";
  const now = new Date(); now.setHours(0,0,0,0);
  const d = new Date(due+"T00:00:00");
  const days = Math.round((d-now)/86400000);
  const urgent = days<=2;
  let label = due;
  if(days<0) label = `${Math.abs(days)}d overdue`;
  else if(days===0) label = "Due today";
  else if(days===1) label = "Due tomorrow";
  else label = `Due in ${days}d`;
  return `<span class="gate-due ${urgent?"urgent":""}">${label}</span>`;
}


/* ============ RENDER: ALL TASKS ============ */
const allFilters = { status:"active", sort:"priority", dungeon:"", q:"" };
const allOpen = new Set();

function gateMatchesQuery(gate, q){
  if(!q) return true;
  const hay = [gate.title].concat(collectTitles(gate)).join(" ").toLowerCase();
  return hay.includes(q);
}
function collectTitles(node){
  let out = [];
  (node.children||[]).forEach(c=>{ out.push(c.title); out = out.concat(collectTitles(c)); });
  return out;
}

function renderAllTasks(){
  const list = document.getElementById("allList");
  if(!list) return;

  const rows = [];
  state.projects.forEach(p=>p.tasks.forEach(g=>{
    const pct = progressPct(g);
    const base = computeScore(g.urgency,g.impact,g.effort);
    rows.push({ gate:g, project:p, pct, rank:rankFromScore(base), score:base*dueMultiplier(g.due) });
  }));

  const totalGates = rows.length;
  const doneGates = rows.filter(r=>r.pct===100).length;
  let totalQuests = 0, doneQuests = 0;
  rows.forEach(r=>{ const s = leafStats(r.gate); if(r.gate.children.length){ totalQuests += s.total; doneQuests += s.done; } });

  // dungeon filter options (rebuilt only when the set of dungeons changes)
  const dsel = document.getElementById("allDungeon");
  const wantOpts = ['<option value="">All dungeons</option>'].concat(
    state.projects.map(p=>`<option value="${p.id}">${escapeHtml(p.emoji+" "+p.name)}</option>`)).join("");
  if(dsel.innerHTML !== wantOpts){ dsel.innerHTML = wantOpts; dsel.value = allFilters.dungeon; }

  let view = rows.slice();
  if(allFilters.status==="active") view = view.filter(r=>r.pct<100);
  else if(allFilters.status==="done") view = view.filter(r=>r.pct===100);
  if(allFilters.dungeon) view = view.filter(r=>r.project.id===allFilters.dungeon);
  if(allFilters.q) view = view.filter(r=>gateMatchesQuery(r.gate, allFilters.q));

  if(allFilters.sort==="priority") view.sort((a,b)=>b.score-a.score);
  else if(allFilters.sort==="progress") view.sort((a,b)=>b.pct-a.pct);
  else if(allFilters.sort==="dungeon") view.sort((a,b)=> a.project.name.localeCompare(b.project.name) || b.score-a.score);
  else if(allFilters.sort==="due"){
    view.sort((a,b)=>{
      if(!a.gate.due && !b.gate.due) return b.score-a.score;
      if(!a.gate.due) return 1;      // undated sinks below anything with a date
      if(!b.gate.due) return -1;
      return a.gate.due.localeCompare(b.gate.due);
    });
  }

  const overdue = rows.filter(r=>r.pct<100 && r.gate.due && r.gate.due < todayStr()).length;
  const stats = `
    <div class="all-stats">
      <div class="all-stat"><div class="n">${totalGates-doneGates}</div><div class="l">Open gates</div></div>
      <div class="all-stat"><div class="n">${totalQuests-doneQuests}</div><div class="l">Open quests</div></div>
      <div class="all-stat"><div class="n" style="color:${overdue?"var(--danger)":"inherit"}">${overdue}</div><div class="l">Overdue</div></div>
      <div class="all-stat"><div class="n" style="color:var(--gold)">${doneGates}</div><div class="l">Cleared</div></div>
    </div>`;

  document.getElementById("allSummary").textContent =
    totalGates===0 ? "No gates anywhere yet — open a dungeon and add one."
    : `${view.length} of ${totalGates} gate${totalGates!==1?"s":""} shown, across ${state.projects.length} dungeon${state.projects.length!==1?"s":""}.`;

  const badge = document.getElementById("allBadge");
  const openCount = totalGates-doneGates;
  if(openCount>0){ badge.style.display="inline-block"; badge.textContent = openCount; }
  else badge.style.display="none";

  if(view.length===0){
    let msg;
    if(totalGates===0){
      msg = "No gates yet.<br>Open a dungeon and add one to see it here.";
    } else {
      // Don't leave the user staring at an empty list when the only thing
      // hiding their match is the status chip.
      let wider = rows.slice();
      if(allFilters.dungeon) wider = wider.filter(r=>r.project.id===allFilters.dungeon);
      if(allFilters.q) wider = wider.filter(r=>gateMatchesQuery(r.gate, allFilters.q));
      const hidden = wider.length;
      msg = "Nothing matches those filters."
        + (hidden ? `<br><span style="color:var(--primary-2)">${hidden} match${hidden!==1?"es":""} under a different status — try “All”.</span>` : "");
    }
    list.innerHTML = stats + `<div class="empty"><div class="glyph">🗺️</div>${msg}</div>`;
    return;
  }

  let body = "";
  if(allFilters.sort==="dungeon"){
    let current = null;
    view.forEach(r=>{
      if(r.project.id!==current){
        current = r.project.id;
        body += `<div class="all-group-head">${r.project.emoji} ${escapeHtml(r.project.name)}</div>`;
      }
      body += renderTaskRow(r, false);
    });
  } else {
    body = view.map(r=>renderTaskRow(r, true)).join("");
  }
  list.innerHTML = stats + body;
}

function renderTaskRow(r, showHome){
  const { gate, project, pct, rank } = r;
  const open = allOpen.has(gate.id);
  const subs = gate.children||[];
  const due = dueBadge(gate.due);
  const {total, done} = leafStats(gate);
  const questLabel = subs.length ? `${done}/${total} quests` : "no quests";
  return `
  <div class="tg ${pct===100?"cleared":""} ${open?"open":""}" style="border-left-color:${RANK_COLOR[rank]}">
    <div class="tg-row">
      <button class="tg-caret" data-tg-toggle="${gate.id}">${subs.length?"▶":"·"}</button>
      <span class="rank-badge" style="background:${RANK_COLOR[rank]}">${rank}</span>
      <span class="tg-title ${pct===100?"done":""}">${escapeHtml(gate.title)}</span>
      ${gate.trelloId?'<span class="src-tag" title="Imported from Trello">Trello</span>':""}
      ${due}
      ${showHome?`<span class="tg-home" data-goto-dungeon="${project.id}" title="Open this dungeon">${project.emoji} ${escapeHtml(project.name)}</span>`:""}
      <button class="btn btn-sm tg-edit" data-chatgpt-gate="${project.id}:${gate.id}" title="Work on this in ChatGPT">↗ ChatGPT</button>
      <button class="btn btn-sm tg-edit" data-ai-gate="${project.id}:${gate.id}" title="Ask Nexus for a plan">✦</button>
      <button class="btn btn-sm tg-edit" data-edit-gate="${project.id}:${gate.id}" title="Edit gate">✎</button>
    </div>
    <div class="tg-meta">
      <div class="mini-bar"><div class="mini-fill" style="width:${pct}%;background:${RANK_COLOR[rank]}"></div></div>
      <div class="tg-pct">${pct}%</div>
      <div class="tg-pct" style="width:auto;color:var(--text-faint)">${questLabel}</div>
    </div>
    <div class="tg-subs">
      ${subs.length
        ? subs.map(c=>renderSub(project.id, gate.id, c)).join("")
        : `<div class="tg-empty">No quests under this gate yet.</div>`}
    </div>
  </div>`;
}

/* ============ RENDER: DAILY ============ */
function renderDaily(){
  const banners = document.getElementById("dailyBanners");
  let bannerHtml = "";
  if(state.daily.penaltyPending){
    bannerHtml += `<div class="penalty-banner">⚠️ ${escapeHtml(state.daily.lastPenaltyMsg||"")} <button class="btn btn-sm" style="margin-left:auto;" id="btnAckPenalty">Acknowledge</button></div>`;
  }
  if(state.player.streak>0){
    bannerHtml += `<div class="streak-banner">🔥 ${state.player.streak} day streak — keep the System honored.</div>`;
  }
  banners.innerHTML = bannerHtml;

  const list = document.getElementById("dailyList");
  if(state.daily.quests.length===0){
    list.innerHTML = `<div class="empty" style="padding:24px;">No daily quests set. Add recurring habits below — workouts, reading, reviews.</div>`;
  } else {
    list.innerHTML = state.daily.quests.map(q=>`
      <div class="daily-row">
        <button class="check ${q.done?"done":""}" data-toggle-daily="${q.id}"></button>
        <span class="daily-text ${q.done?"done":""}">${escapeHtml(q.text)}</span>
        <button class="sub-del" style="opacity:.6" data-del-daily="${q.id}">✕</button>
      </div>`).join("");
  }
}

/* ============ RENDER: SHADOW ARMY ============ */
function renderArmy(){goalsUI?.renderArchive();}

/* ============ RENDER: FOCUS ============ */
function syncFocusAtmosphere(){
  document.body?.classList?.toggle('focus-atmosphere',currentView==='focus'&&state.pomodoro.running&&state.pomodoro.mode==='focus');
}
function renderFocus(){
  const p = state.pomodoro;
  syncFocusAtmosphere();
  document.getElementById("timerDisplay").textContent = fmtTime(p.secondsLeft);
  document.getElementById("timerMode").textContent = p.mode==="focus" ? "Focus Session" : (p.mode==="short"?"Short Break":"Long Break");
  document.getElementById("btnTimerToggle").textContent = p.running ? "Pause" : "Start";
  document.getElementById("focusSessionsN").textContent = p.sessionCount;
  document.getElementById("focusTotalN").textContent = state.player.focusSessionsTotal;

  const restBox = document.getElementById("restQuestBox");
  if(p.mode!=="focus" && p.currentRest){
    const r = p.currentRest;
    restBox.innerHTML = `<div class="rest-quest">
      <span style="font-size:20px;">${r.icon}</span>
      <span style="flex:1;font-size:13.5px;">${escapeHtml(r.text)}</span>
      <button class="btn btn-sm btn-primary" id="btnRestDone" ${r.done?"disabled":""}>${r.done?"Done":"+"+r.xp+" XP"}</button>
    </div>`;
  } else if(p.mode!=="focus"){
    restBox.innerHTML = `<div class="section-sub" style="margin-top:10px;">Rest quest will appear here.</div>`;
  } else {
    restBox.innerHTML = `<div class="section-sub" style="margin-top:10px;">Start a focus session — your rest quest shows up on the next break.</div>`;
  }
}

/* ============ RENDER ALL ============ */
function renderAll(){
  customRemindersUI?.render();
  healthUI?.render();
  goalsUI?.renderGoals();
  renderHUD();
  renderPortal();
  renderAllTasks();
  renderDaily();
  renderArmy();
  renderFocus();
  renderCalendar();
  todayUI?.render();
  tomorrowUI?.render();
}

/* ============ CALENDAR ============ */
let calendarCursor=new Date(),calendarAutoScrollPending=false;
let calendarSelectedDate=todayStr(), calendarDrag=null;
function weekStart(d){ const x=new Date(d); x.setHours(0,0,0,0); const day=(x.getDay()+6)%7; x.setDate(x.getDate()-day); return x; }
function calRange(){ const start=weekStart(calendarCursor),end=new Date(start); end.setDate(end.getDate()+7); return {start,end}; }
function calEventStart(e){ return new Date((e.start&&(e.start.dateTime||e.start.date))||0); }
function calEventEnd(e){ return new Date((e.end&&(e.end.dateTime||e.end.date))||calEventStart(e)); }
function calTime(d){ return d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}); }
function routineCalendarEvents(){
  if(state.calendar.routineEnabled===false)return [];
  const start=weekStart(calendarCursor),template=Array.isArray(state.calendar.routineTemplate)?state.calendar.routineTemplate:[];
  return template.map(item=>{const d=new Date(start),offset=((+item.day||0)+6)%7;d.setDate(d.getDate()+offset);const date=todayStr(d),s=new Date(`${date}T${item.start}:00`),en=new Date(`${date}T${item.end}:00`);return {id:`routine_${item.key}_${date}`,summary:item.title,description:`[ARISE_ROUTINE:${item.key}]`,start:{dateTime:s.toISOString()},end:{dateTime:en.toISOString()},reminders:{useDefault:false,overrides:[]},_routine:true,_routineKey:item.key,_category:item.category||"planning"}});
}
function findRoutine(key){return (state.calendar.routineTemplate||[]).find(item=>item.key===key)}
function updateRoutine(item,title,date,start,end){item.title=title;item.day=new Date(date+"T12:00:00").getDay();item.start=start;item.end=end}
function allCalendarEvents(){
  const byId=new Map();
  (state.calendar.events||[]).concat(localCalendarEvents(),routineCalendarEvents()).forEach(e=>{if(e&&e.id)byId.set(e.id,e)});
  return Array.from(byId.values());
}
function localCalendarEvents(){
  const {start,end}=calRange(),events=[];
  for(const series of state.calendar.localEvents||[]){
    if(series.repeat!=="daily"){events.push(series);continue;}
    const first=calEventStart(series),last=calEventEnd(series),firstDate=todayStr(first);
    const clock=d=>String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
    const dates=new Set(Object.keys(series.exceptions||{}));
    for(const d=new Date(start);d<end;d.setDate(d.getDate()+1))if(todayStr(d)>=firstDate)dates.add(todayStr(d));
    for(const date of dates){
      if(date<firstDate)continue;
      const exception=series.exceptions?.[date];if(exception?.cancelled)continue;
      const occurrence={...series,start:{dateTime:new Date(date+"T"+clock(first)+":00").toISOString()},end:{dateTime:new Date(date+"T"+clock(last)+":00").toISOString()},...exception,id:series.id+"__"+date,_seriesId:series.id,_occurrenceDate:date};
      const when=calEventStart(occurrence);if(when>=start&&when<end)events.push(occurrence);
    }
  }
  return events;
}
function updateLocalOccurrence(event,payload){
  if(!event._seriesId){const before=editableEventPayload(event);Object.assign(event,payload);return ()=>Object.assign(event,before);}
  const series=state.calendar.localEvents.find(x=>x.id===event._seriesId);
  if(!series)throw new Error("Daily series could not be found.");
  const date=event._occurrenceDate,previous=series.exceptions?.[date];
  series.exceptions=series.exceptions||{};series.exceptions[date]={...series.exceptions[date],...payload};
  return ()=>{if(previous)series.exceptions[date]=previous;else delete series.exceptions[date];};
}
function calendarGateRef(e){const m=(e.description||"").match(/\[ARISE_GATE:([^:\]]+):([^\]]+)\]/);return m?{pid:m[1],gid:m[2]}:null}
function calendarGateInfo(e){const ref=calendarGateRef(e),p=ref&&findProject(ref.pid),g=p&&findGate(p,ref.gid);return p&&g?{p,g,rank:rankFromScore(computeScore(g.urgency,g.impact,g.effort)),pct:progressPct(g)}:null}
function calendarIsBreak(e){return e._category==="break"||/(^|\s)(break|lunch|rest|walk|commute)(\s|$)/i.test(e.summary||"")}
function calendarCountsCapacity(e){return !!e.start?.dateTime&&!calendarIsBreak(e)&&e._category!=="wellbeing"}
function calendarDuration(e){return Math.max(0,Math.round((calEventEnd(e)-calEventStart(e))/60000))}
function calendarVisibleDates(){
  const start=weekStart(calendarCursor),all=Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+i);return d});
  if(state.calendar.view==="focus")return [new Date(calendarSelectedDate+"T12:00:00")];
  return state.calendar.showWeekends===false?all.filter(d=>d.getDay()!==0&&d.getDay()!==6):all;
}
function calendarFilteredEvents(){return allCalendarEvents().filter(e=>{const info=calendarGateInfo(e);if(state.calendar.showCompleted!==true&&info&&info.pct===100)return false;if(state.calendar.showBreaks===false&&calendarIsBreak(e))return false;return true})}
function renderVictories(){
  const wrap=document.getElementById("calVictories");if(!wrap)return;
  const week=todayStr(weekStart(calendarCursor)),saved=state.calendar.weeklyOutcomes?.[week];
  const wins=Array.isArray(saved)?saved.slice(0,3):Array.isArray(state.calendar.victories)?state.calendar.victories.slice(0,3):[];while(wins.length<3)wins.push("");
  wrap.innerHTML=wins.map((v,i)=>`<label class="victory-row"><span class="victory-num">${i+1}</span><input class="victory-input" data-cal-victory="${i}" value="${escapeHtml(v)}" placeholder="${i===0?"What would make this week feel meaningful?":"Add another clear outcome"}"></label>`).join("");
}
function renderCapacity(editing){
  const wrap=document.getElementById("calCapacity");if(!wrap)return;const {start,end}=calRange();
  const minutes=allCalendarEvents().filter(e=>{const d=calEventStart(e);return d>=start&&d<end&&calendarCountsCapacity(e)}).reduce((n,e)=>n+calendarDuration(e),0),hours=Math.round(minutes/6)/10,cap=Math.max(1,+state.calendar.capacityHours||35),pct=Math.round(hours/cap*100),over=hours>cap;
  wrap.innerHTML=`<div class="capacity-top"><div class="capacity-hours">${hours}<small>h planned</small></div>${editing?`<label style="font-size:10px;color:var(--text-faint)">of <input id="calCapacityInput" type="number" min="1" max="100" value="${cap}" style="width:58px;padding:4px 6px"> h</label>`:`<span style="font-size:11px;color:var(--text-faint)">of ${cap}h</span>`}</div><div class="capacity-meter"><div class="capacity-fill ${over?"warn":""}" style="width:${Math.min(100,pct)}%"></div></div><div class="capacity-note">${over?`Over capacity by ${Math.round((hours-cap)*10)/10}h. Move a lower-rank block or shorten the longest session.`:pct>85?"Nearly full. Leave one buffer block before adding more.":`You have ${Math.round((cap-hours)*10)/10}h of working space left.`}</div>`;
  if(editing){const input=document.getElementById("calCapacityInput");input.focus();input.select()}
}
function backlogTaskCard(p,g){
  const rank=rankFromScore(computeScore(g.urgency,g.impact,g.effort)),duration=g.durationMin||30+(+g.effort||3)*15,pct=progressPct(g),stats=leafStats(g);
  return `<div class="backlog-task" data-drag-gate="${p.id}:${g.id}"><div class="backlog-task-top"><span class="backlog-rank" style="background:${RANK_COLOR[rank]}">${rank}</span><span class="backlog-task-title" data-edit-cal-gate="${p.id}:${g.id}">${escapeHtml(g.title)}</span></div><div class="backlog-meta"><span>${escapeHtml(p.name)}</span><i class="backlog-dot"></i><span>${duration}m</span><i class="backlog-dot"></i><span>${stats.done}/${stats.total}</span></div><button class="backlog-schedule" data-cal-gate="${p.id}:${g.id}">Schedule</button></div>`;
}
function renderBacklog(){
  const wrap=document.getElementById("calBacklog"),workspace=document.getElementById("calendarWorkspace");if(!wrap||!workspace)return;
  const isOpen=state.calendar.backlogOpen===true;workspace.classList.toggle("backlog-open",isOpen);const open=document.getElementById("calBacklogOpen"),panel=document.getElementById("calBacklogPanel");if(open){open.setAttribute("aria-expanded",String(isOpen));open.classList.toggle("active",isOpen)}if(panel){panel.setAttribute("aria-hidden",String(!isOpen));panel.inert=!isOpen}
  const scheduled=new Set();allCalendarEvents().forEach(e=>{const r=calendarGateRef(e);if(r)scheduled.add(r.pid+":"+r.gid)});
  const groups={Priorities:[],Unscheduled:[],Ideas:[],Waiting:[]};
  state.projects.forEach(p=>(p.tasks||[]).forEach(g=>{if((progressPct(g)===100&&!state.calendar.showCompleted)||g.calendarEventId||scheduled.has(p.id+":"+g.id))return;const rank=rankFromScore(computeScore(g.urgency,g.impact,g.effort)),far=g.due&&(new Date(g.due+"T00:00:00")-new Date())>7*86400000;if(/waiting|blocked|pending/i.test(g.title)||far)groups.Waiting.push({p,g});else if(!g.due&&(rank==="D"||rank==="E"))groups.Ideas.push({p,g});else if(rank==="S"||rank==="A"||rank==="B")groups.Priorities.push({p,g});else groups.Unscheduled.push({p,g})}));
  const order=["Priorities","Unscheduled","Ideas","Waiting"],html=order.filter(k=>groups[k].length).map(k=>`<section class="backlog-section"><div class="backlog-section-head"><span>${k}</span><span class="backlog-count">${groups[k].length}</span></div>${groups[k].sort((a,b)=>computeScore(b.g.urgency,b.g.impact,b.g.effort)-computeScore(a.g.urgency,a.g.impact,a.g.effort)).map(x=>backlogTaskCard(x.p,x.g)).join("")}</section>`).join("");
  wrap.innerHTML=html||`<div class="cal-empty-backlog">Nothing waiting here.<br>Your active gates are scheduled.</div>`;
}
function calendarEventLayout(events){
  // Lay out visual intervals, not just start times: short cards also need their own lane.
  const rows=events.map(e=>{
    const st=calEventStart(e),minutes=st.getHours()*60+st.getMinutes();
    const top=Math.max(0,Math.min(1064,minutes-360));
    const height=Math.min(1080-top,Math.max(14,calendarDuration(e)-2));
    return {e,top,height,bottom:top+height,column:0,columns:1};
  }).sort((a,b)=>a.top-b.top||b.bottom-a.bottom||String(a.e.id).localeCompare(String(b.e.id)));
  let group=[],ends=[],groupEnd=-1;
  const finish=()=>{
    group.forEach(row=>{
      row.columns=ends.length;row.span=1;
      for(let next=row.column+1;next<ends.length;next++){
        if(group.some(other=>other.column===next&&other.top<row.bottom&&row.top<other.bottom))break;
        row.span++;
      }
    });
    group=[];ends=[];
  };
  for(const row of rows){
    if(row.top>=groupEnd){finish();groupEnd=-1;}
    let column=ends.findIndex(end=>end<=row.top);
    if(column<0)column=ends.length;
    row.column=column;ends[column]=row.bottom;group.push(row);groupEnd=Math.max(groupEnd,row.bottom);
  }
  finish();
  return new Map(rows.map(row=>[row.e.id,row]));
}
function calendarEventCard(e,overview,placement){
  const st=calEventStart(e),en=calEventEnd(e),info=calendarGateInfo(e),protectedGoal=(e.description||"").includes("[ARISE_DAILY:"),duration=calendarDuration(e),isBreak=calendarIsBreak(e),completed=info&&info.pct===100;
  const meeting=googleMeetLink(e)?"Meet · ":"",meta=meeting+(info?`${escapeHtml(info.rank)} · ${escapeHtml(info.p.name)} · ${duration}m · ${info.pct}%`:e._routine?`Weekly rhythm · ${duration}m`:e._seriesId?`Every day · ${duration}m`:`${duration?duration+"m":"All day"}`),routineClass=e._routine?`routine-event routine-${escapeHtml(e._category||"planning")}`:"";
  if(overview)return `<div class="overview-event ${routineClass} ${completed?"completed":""}" data-cal-event="${escapeHtml(e.id)}" role="button" tabindex="0"><div class="cal-time">${e.start&&e.start.dateTime?calTime(st):"All day"}</div><div class="cal-event-title">${protectedGoal?"◇ ":""}${escapeHtml(e.summary||"Untitled")}</div><div class="cal-event-meta">${meta}</div></div>`;
  const {top,height,column,columns,span}=placement||calendarEventLayout([e]).get(e.id),compact=height<42;
  const label=`${e.summary||"Untitled"} · ${calTime(st)}–${calTime(en)} · ${duration}m`;
  return `<div class="cal-event ${compact?"compact":""} ${columns>1?"concurrent":""} ${routineClass} ${protectedGoal?"protected":""} ${isBreak?"break-event":""} ${completed?"completed":""}" data-cal-event="${escapeHtml(e.id)}" data-cal-lane="${column+1}/${columns}" role="button" tabindex="0" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" style="top:${top}px;height:${height}px;left:calc(var(--cal-gutter) + (100% - var(--cal-gutter) - var(--cal-edge)) * ${column/columns});width:calc((100% - var(--cal-gutter) - var(--cal-edge)) * ${span/columns} - 5px)">${!compact?`<div class="cal-time">${calTime(st)}–${calTime(en)}</div>`:""}<div class="cal-event-title">${protectedGoal?"◇ ":""}${escapeHtml(e.summary||"Untitled")}</div>${height>=60?`<div class="cal-event-meta">${meta}</div>`:""}</div>`;
}
function renderCalendar(){
  const grid=document.getElementById("calGrid"); if(!grid)return;
  const focusedEvent=document.activeElement?.closest?.('[data-cal-event]')?.dataset.calEvent;
  const oldScroll=(grid.querySelector(".cal-day-body")||{}).scrollTop,dates=calendarVisibleDates(),events=calendarFilteredEvents(),{start,end}=calRange(),mobile=matchMedia("(max-width:720px)").matches;
  const focusDate=new Date(calendarSelectedDate+"T12:00:00"),focusMode=WEEKDAY_MODES[focusDate.getDay()];document.getElementById("calTitle").textContent=state.calendar.view==="focus"?`${focusDate.toLocaleDateString([],{weekday:"long",month:"long",day:"numeric"})}${focusMode?" · "+focusMode:""}`:`${start.toLocaleDateString([],{month:"short",day:"numeric"})} – ${new Date(end-1).toLocaleDateString([],{month:"short",day:"numeric",year:"numeric"})}`;
  document.querySelectorAll("[data-cal-view]").forEach(b=>b.classList.toggle("active",b.dataset.calView===state.calendar.view));
  document.getElementById("calShowCompleted").checked=state.calendar.showCompleted===true;document.getElementById("calShowBreaks").checked=state.calendar.showBreaks!==false;document.getElementById("calShowWeekends").checked=state.calendar.showWeekends!==false;
  const protect=document.getElementById("calProtect");protect.textContent=state.calendar.protectDaily?"◆":"◇";protect.title=state.calendar.protectDaily?"Daily goals protected":"Protect daily goals";const routineToggle=document.getElementById("calRoutineToggle");if(routineToggle){routineToggle.classList.toggle("active",state.calendar.routineEnabled!==false);routineToggle.textContent=state.calendar.routineEnabled===false?"Rhythm off":"Rhythm on"}
  const weekDates=Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+i);return d});document.getElementById("calDateStrip").innerHTML=weekDates.map(d=>{const ds=todayStr(d);return `<button class="cal-date-pill ${ds===calendarSelectedDate?"active":""} ${ds===todayStr()?"today":""}" data-cal-date-pill="${ds}"><span>${d.toLocaleDateString([],{weekday:"short"})}</span><b>${d.getDate()}</b></button>`}).join("");
  const renderDates=mobile&&state.calendar.view!=="focus"?weekDates:dates;grid.style.setProperty("--cal-days",renderDates.length);grid.className=state.calendar.view==="overview"?"cal-overview-grid":"cal-grid";
  const dayItems=d=>events.filter(e=>todayStr(calEventStart(e))===todayStr(d)).sort((a,b)=>calEventStart(a)-calEventStart(b));
  const allDayRows=Math.min(3,Math.max(0,...renderDates.map(d=>dayItems(d).filter(e=>!e.start?.dateTime).length)));
  grid.innerHTML=renderDates.map(d=>{
    const ds=todayStr(d),dayEvents=dayItems(d),mode=WEEKDAY_MODES[d.getDay()];
    const head=`<div class="cal-day-head"><span><em>${d.toLocaleDateString([],{weekday:"short"})}</em>${mode?`<small>${escapeHtml(mode)}</small>`:""}</span><b>${d.getDate()}</b></div>`;
    const classes=`cal-day ${ds===todayStr()?"today":""} ${ds===calendarSelectedDate?"selected mobile-active":""}`;
    if(state.calendar.view==="overview")return `<div class="${classes}" data-cal-date="${ds}">${head}${dayEvents.length?dayEvents.map(e=>calendarEventCard(e,true)).join(""):'<div class="overview-empty">Open space</div>'}</div>`;
    const timed=dayEvents.filter(e=>e.start?.dateTime),layout=calendarEventLayout(timed);
    const allDay=allDayRows?`<div class="cal-all-day" style="height:${allDayRows*29+8}px">${dayEvents.filter(e=>!e.start?.dateTime).map(e=>`<button class="cal-all-day-event" data-cal-event="${escapeHtml(e.id)}" title="${escapeHtml(e.summary||'Untitled')} · All day">${escapeHtml(e.summary||'Untitled')}</button>`).join("")}</div>`:"";
    const hours=Array.from({length:18},(_,h)=>`<span class="cal-hour-label" style="top:${h*60}px">${String(h+6).padStart(2,"0")}:00</span>`).join("");
    const now=new Date(),nowLine=ds===todayStr()&&now.getHours()>=6?`<div class="cal-now-line" style="top:${now.getHours()*60+now.getMinutes()-360}px"></div>`:"";
    return `<div class="${classes}" data-cal-date="${ds}">${head}${allDay}<div class="cal-day-body"><div class="cal-time-canvas">${hours}${nowLine}${timed.map(e=>calendarEventCard(e,false,layout.get(e.id))).join("")}</div></div></div>`;
  }).join("");
  renderVictories();renderCapacity(false);renderBacklog();if(oldScroll!=null)document.querySelectorAll(".cal-day-body").forEach(b=>b.scrollTop=oldScroll);
  if(focusedEvent)Array.from(grid.querySelectorAll('[data-cal-event]')).find(el=>el.dataset.calEvent===focusedEvent)?.focus({preventScroll:true});
}
function scrollCalendarToNow(){
  const now=new Date(),minutes=now.getHours()*60+now.getMinutes(),top=Math.max(0,Math.min(1080,minutes-390));
  document.querySelectorAll(".cal-day-body").forEach(body=>{body.scrollTop=top});
}
function googleStatusMsg(text,kind){const e=document.getElementById("googleStatus");if(e){e.textContent=text;e.className="ai-status "+(kind||"")}document.getElementById("googleCard")?.classList.toggle("is-connected",kind==="ok");updateConnectionsCount();}
/* Google Calendar runs through the Mac app's Rust commands on desktop and
   through google-web.js (Google's sign-in popup, in-memory token) on the web. */
let googleWeb=null;
function googleWebClient(){
  if(googleWeb||isDesktop())return googleWeb;
  const clientId=window.ARISEIntegrationConfig?.googleWebClientId||"";
  if(clientId&&window.ARISEGoogleWeb){googleWeb=window.ARISEGoogleWeb.create({clientId,account:()=>activeDataUserId});googleWeb.preload()}
  return googleWeb;
}
async function googleConnected(){
  if(isDesktop())return !!(await tauriInvoke("google_status"));
  const g=googleWebClient();return !!(g&&g.linked());
}
function googleCall(cmd,args,interactive=true){
  if(isDesktop())return tauriInvoke(cmd,args);
  const g=googleWebClient();
  if(!g)return Promise.reject(Error("Google Calendar isn't available on the web yet."));
  if(cmd==="google_list_events")return g.listEvents(args,interactive);
  if(cmd==="google_create_event")return g.createEvent(args,interactive);
  if(cmd==="google_update_event")return g.updateEvent(args,interactive);
  return Promise.reject(Error("Unsupported Google Calendar action."));
}
function renderGoogleWebCard(){
  const box=document.getElementById("googleWebConnect"),g=googleWebClient();
  if(!box)return;box.style.display=g?"":"none";if(!g)return;
  const linked=g.linked();
  for(const [id,show] of [["googleConnectWeb",!linked],["googleSyncWeb",linked],["googleDisconnectWeb",linked],["googleWebHint",!linked]]){const el=document.getElementById(id);if(el)el.style.display=show?"":"none"}
}
async function refreshGoogleStatus(){if(!isDesktop()){const g=googleWebClient();const on=!!(g&&g.linked());googleStatusMsg(!g?"Available in the Mac app for now.":on?"Connected":"Not connected",on?"ok":"");renderGoogleWebCard();return on}try{const ok=await tauriInvoke("google_status");googleStatusMsg(ok?"Google Calendar connected.":"Not connected.",ok?"ok":"");return ok}catch(e){googleStatusMsg("Couldn't check Google connection.","err");return false}}
async function syncGoogleCalendar(silent){
  const g=!silent&&googleWebClient();if(g&&g.linked()&&!g.hasToken())g.connect().catch(()=>{}); // open Google's popup while the tap still counts
  if(!await refreshGoogleStatus()){if(!silent)toast("Connect Google Calendar in Settings","danger");return}
  const {start,end}=calRange(); try{const data=await googleCall("google_list_events",{timeMin:start.toISOString(),timeMax:end.toISOString()},!silent);state.calendar.events=data.items||[];state.calendar.lastSync=Date.now();
    rememberGuestEmails(state.calendar.events.flatMap(event=>(event.attendees||[]).map(attendee=>attendee.email).filter(Boolean)));
    const live=new Set(state.calendar.events.concat(state.calendar.localEvents||[]).map(e=>e.id));state.projects.forEach(p=>p.tasks.forEach(g=>{if(g.calendarEventId&&!live.has(g.calendarEventId))g.calendarEventId=null}));
    const today=new Date();if(state.calendar.protectDaily&&today>=start&&today<end)await ensureProtectedGoals();save();renderCalendar();if(calendarAutoScrollPending){scrollCalendarToNow();calendarAutoScrollPending=false}if(!silent)toast("Google Calendar synced","xp");
  }catch(e){if(e&&e.code==="reauth"){googleStatusMsg("Connected · tap Sync now to refresh","ok");if(!silent)toast(e.message,"gold");return}if(!silent)toast("Calendar sync failed: "+((e&&e.message)||String(e)),"danger")}
}
function validGuestEmail(email){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}
function parseGuestEmails(value){return [...new Set(String(value||"").split(/[;,\n]+/).map(v=>v.trim().toLowerCase()).filter(Boolean))]}
function rememberGuestEmails(emails){state.calendar.recentGuestEmails=[...new Set([...emails,...(state.calendar.recentGuestEmails||[])])].slice(0,12)}
function googleMeetLink(event){return event?.hangoutLink||event?.conferenceData?.entryPoints?.find(point=>point.entryPointType==="video")?.uri||""}
function googleCalendarStamp(value){return new Date(value).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z")}
function calendarShareData(event){
  if(!event)throw new Error("Save the event before sharing it.");
  const title=event.summary||"ARISE event",meet=googleMeetLink(event),allDay=!event.start?.dateTime,start=allDay?event.start?.date:event.start.dateTime,end=allDay?(event.end?.date||todayStr(new Date(new Date(start+"T12:00:00").getTime()+86400000))):event.end?.dateTime;
  const dates=allDay?`${String(start||"").replace(/-/g,"")}/${String(end||"").replace(/-/g,"")}`:`${googleCalendarStamp(start)}/${googleCalendarStamp(end)}`;
  const cleanDescription=String(event.description||"").replace(/\[ARISE_[^\]]+\]/g,"").replace(/^Created by ARISE(?:\s*·[^\n]+)?$/i,"").trim(),details=[cleanDescription,meet&&`Google Meet: ${meet}`].filter(Boolean).join("\n\n");
  const query=new URLSearchParams({action:"TEMPLATE",text:title,dates});if(details)query.set("details",details);if(meet)query.set("location",meet);
  const addUrl=`https://calendar.google.com/calendar/render?${query}`,startDate=allDay?new Date(start+"T12:00:00"):new Date(start),when=allDay?startDate.toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long",year:"numeric"}):`${startDate.toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long",year:"numeric"})} · ${startDate.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})}–${new Date(end).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})}`;
  const text=[title,when,meet&&`Join Google Meet: ${meet}`,`Add to your Google Calendar: ${addUrl}`].filter(Boolean).join("\n");
  return {title,addUrl,text};
}
async function createGoogleEvent(title,date,start,end,description,reminder,repeat="none",meeting={}){
  const s=new Date(`${date}T${start}:00`),en=new Date(`${date}T${end}:00`);if(en<=s)throw new Error("End time must be after start time.");
  const event={summary:title,description:description||"Created by ARISE",start:{dateTime:s.toISOString()},end:{dateTime:en.toISOString()},reminders:{useDefault:false,overrides:[{method:"popup",minutes:+reminder||15}]}};
  if(repeat==="daily"){
    const zone=Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC";
    event.start.timeZone=zone;event.end.timeZone=zone;event.recurrence=["RRULE:FREQ=DAILY"];
  }
  const guests=meeting.guests||[];
  if(guests.length)event.attendees=guests.map(email=>({email}));
  if(meeting.addMeet)event.conferenceData={createRequest:{requestId:uid("meet"),conferenceSolutionKey:{type:"hangoutsMeet"}}};
  const made=await googleCall("google_create_event",{event});state.calendar.events.push(made);
  if(repeat==="daily"){
    // Fetch expanded instances instead of drawing both the master and its occurrences.
    const {start:rangeStart,end:rangeEnd}=calRange();
    try{const data=await googleCall("google_list_events",{timeMin:rangeStart.toISOString(),timeMax:rangeEnd.toISOString()});state.calendar.events=data.items||[];state.calendar.lastSync=Date.now();}
    catch(_){toast("Daily series saved. Sync Calendar to load every occurrence.","gold");}
  }
  return made;
}
function createLocalCalendarEvent(title,date,start,end,description,reminder,repeat="none",meeting={}){
  const s=new Date(`${date}T${start}:00`),en=new Date(`${date}T${end}:00`);if(en<=s)throw new Error("End time must be after start time.");const made={id:uid("localcal"),summary:title,description:description||"Created by ARISE",start:{dateTime:s.toISOString()},end:{dateTime:en.toISOString()},reminders:{useDefault:false,overrides:[{method:"popup",minutes:+reminder||15}]},_local:true};if(repeat==="daily")made.repeat="daily";state.calendar.localEvents=state.calendar.localEvents||[];state.calendar.localEvents.push(made);return made;
}
async function createCalendarEvent(title,date,start,end,description,reminder,repeat="none",meeting={}){
  // An unconnected desktop calendar is still a fully usable local planner.
  // Once connected, surface Google write errors instead of silently duplicating locally.
  const connected=await googleConnected();
  if((meeting.addMeet||meeting.guests?.length)&&!connected)throw new Error("Connect Google Calendar to add a Meet link or invite guests.");
  return connected?createGoogleEvent(title,date,start,end,description,reminder,repeat,meeting):createLocalCalendarEvent(title,date,start,end,description,reminder,repeat,meeting);
}
async function ensureProtectedGoals(){
  const date=todayStr(), existing=state.calendar.events||[];
  for(let i=0;i<state.daily.quests.length;i++){const q=state.daily.quests[i],marker=`[ARISE_DAILY:${q.id}:${date}]`;if(existing.some(e=>(e.description||"").includes(marker)))continue;
    const mins=7*60+i*40,sh=String(Math.floor(mins/60)).padStart(2,"0")+":"+String(mins%60).padStart(2,"0"),em=mins+30,eh=String(Math.floor(em/60)).padStart(2,"0")+":"+String(em%60).padStart(2,"0");
    await createCalendarEvent(`Daily Goal: ${q.text}`,date,sh,eh,marker,15);
  }
}
function openCalendarEvent(prefill){prefill=prefill||{};
  const item=prefill.id&&allCalendarEvents().find(e=>e.id===prefill.id),repeat=document.getElementById("calEventRepeat");
  repeat.value=item?.repeat==="daily"||item?.recurrence?.includes("RRULE:FREQ=DAILY")?"daily":"none";
  repeat.disabled=!!prefill.id;repeat.hidden=!!prefill.id&&!item?._seriesId;
  document.getElementById("calDeleteSeries").hidden=!item?._seriesId;
  document.getElementById("calRepeatHint").textContent=item?._seriesId?"Repeats every day. Editing, moving or deleting this item affects only this occurrence.":item?._routine?"Weekly rhythm. Changes apply to this weekly routine.":item?.recurringEventId?"Google recurring event. Changes affect this occurrence; manage the series in Google Calendar.":prefill.id?"To create a repeating event, add a new item.":"Every day repeats at this time, starting on the selected date.";
document.getElementById("calDrawerKicker").textContent=prefill.id?"Calendar item":"New item";document.getElementById("calDrawerHeading").textContent=prefill.id?"Edit schedule":"Schedule time";document.getElementById("calEventTitle").value=prefill.title||"";document.getElementById("calEventDate").value=prefill.date||calendarSelectedDate||todayStr();document.getElementById("calEventStart").value=prefill.start||"09:00";document.getElementById("calEventEnd").value=prefill.end||"10:00";document.getElementById("calEventGate").value=prefill.gate||"";document.getElementById("calEventId").value=prefill.id||"";document.getElementById("calEventSource").value=prefill.source||"";document.getElementById("calEventDelete").classList.toggle("show",!!prefill.id);document.getElementById("calShareCard").hidden=!item;const guests=(item?.attendees||[]).map(a=>a.email).filter(Boolean),meet=googleMeetLink(item),meetToggle=document.getElementById("calEventMeet");meetToggle.checked=!!meet;document.getElementById("calEventGuests").value=guests.join(", ");document.getElementById("calGuestError").textContent="";document.getElementById("calMeetingFields").hidden=!(meetToggle.checked||guests.length);const meetLink=document.getElementById("calMeetLink");meetLink.href=meet||"#";meetLink.hidden=!meet;renderRecentGuests();calendarEditorReturn=document.activeElement;const drawer=document.getElementById("calendarDetailDrawer"),back=document.getElementById("calendarDetailBackdrop");drawer.inert=false;setWorkspaceInert(true);drawer.classList.add("show");drawer.setAttribute("aria-hidden","false");back.classList.add("show");setTimeout(()=>document.getElementById("calEventTitle").focus(),100)}
function renderRecentGuests(){const wrap=document.getElementById("calRecentGuests");if(!wrap)return;const selected=new Set(parseGuestEmails(document.getElementById("calEventGuests")?.value));wrap.innerHTML=(state.calendar.recentGuestEmails||[]).filter(email=>!selected.has(email)).map(email=>`<button type="button" class="cal-recent-guest" data-add-guest="${escapeHtml(email)}">+ ${escapeHtml(email)}</button>`).join("")}
function closeCalendarDrawer(){const drawer=document.getElementById("calendarDetailDrawer"),back=document.getElementById("calendarDetailBackdrop");drawer.classList.remove("show");drawer.inert=true;drawer.setAttribute("aria-hidden","true");back.classList.remove("show");setWorkspaceInert(false);calendarEditorReturn?.focus?.()}
function editableEventPayload(e){return {summary:e.summary||"Untitled",description:e.description||"",start:e.start,end:e.end,reminders:e.reminders||{useDefault:true},...(e.recurrence?{recurrence:e.recurrence}:{}),...(e.attendees?{attendees:e.attendees}:{}),...(e.conferenceData?{conferenceData:e.conferenceData}:{})}}
function toastCalendarUndo(message,undoFn){const el=document.createElement("div");el.className="toast xp cal-undo-toast";const text=document.createElement("span");text.textContent=message;const button=document.createElement("button");button.textContent="Undo";button.onclick=async()=>{button.disabled=true;try{await undoFn();save();renderCalendar();el.remove()}catch(err){toast("Undo failed: "+((err&&err.message)||String(err)),"danger")}};el.append(text,button);document.getElementById("toasts").appendChild(el);setTimeout(()=>el.remove(),5200)}
async function moveCalendarItem(date,time,drag=calendarDrag){
  if(!drag)return;
  if(drag.type==="event"){
    const e=allCalendarEvents().find(x=>x.id===drag.id);if(!e)return;const oldPayload=JSON.parse(JSON.stringify(editableEventPayload(e))),old=calEventStart(e),oldEnd=calEventEnd(e),duration=Math.max(15*60000,oldEnd-old),next=new Date(`${date}T${time}:00`),nextEnd=new Date(next.getTime()+duration);e.start={dateTime:next.toISOString()};e.end={dateTime:nextEnd.toISOString()};
    try{if(e._seriesId){const undo=updateLocalOccurrence(e,editableEventPayload(e));save();renderCalendar();toastCalendarUndo(`Moved to ${time}`,undo);return}if(e._routine){const item=findRoutine(e._routineKey),before=JSON.parse(JSON.stringify(item)),endTime=`${String(nextEnd.getHours()).padStart(2,"0")}:${String(nextEnd.getMinutes()).padStart(2,"0")}`;updateRoutine(item,item.title,date,time,endTime);save();renderCalendar();toastCalendarUndo(`Routine moved to ${time}`,async()=>Object.assign(item,before));return}if(!e._local){const updated=await googleCall("google_update_event",{eventId:e.id,event:editableEventPayload(e)});Object.assign(e,updated)}save();renderCalendar();toastCalendarUndo(`Moved to ${time}`,async()=>{if(!e._local){const updated=await googleCall("google_update_event",{eventId:e.id,event:oldPayload});Object.assign(e,updated)}else Object.assign(e,oldPayload)})}catch(err){Object.assign(e,oldPayload);toast("Move failed: "+((err&&err.message)||String(err)),"danger");renderCalendar()}
  }else if(drag.type==="gate"){
    const p=findProject(drag.pid),g=p&&findGate(p,drag.gid);if(!g)return;const [hh,mm]=time.split(":").map(Number),endM=hh*60+mm+60,end=`${String(Math.floor(endM/60)).padStart(2,"0")}:${String(endM%60).padStart(2,"0")}`;
    try{pushUndo("scheduling that gate");const made=await createCalendarEvent(g.title,date,time,end,`[ARISE_GATE:${p.id}:${g.id}]`,15);g.calendarEventId=made.id;save();renderCalendar();if(made._local)toastCalendarUndo("Gate scheduled",async()=>{state.calendar.localEvents=state.calendar.localEvents.filter(e=>e.id!==made.id);g.calendarEventId=null});else toast("Gate scheduled","xp")}catch(err){toast("Schedule failed: "+((err&&err.message)||String(err)),"danger")}
  }
}
function parseQuickCalendar(text){
  let title=text.trim(),date=new Date(calendarSelectedDate+"T12:00:00"),now=new Date();if(/\btoday\b/i.test(title)){date=now;title=title.replace(/\btoday\b/ig,"")}else if(/\btomorrow\b/i.test(title)){date=new Date(now);date.setDate(date.getDate()+1);title=title.replace(/\btomorrow\b/ig,"")}else{const days=["sunday","monday","tuesday","wednesday","thursday","friday","saturday"],idx=days.findIndex(d=>new RegExp(`\\b${d.slice(0,3)}(?:${d.slice(3)})?\\b`,"i").test(title));if(idx>=0){date=new Date(now);let delta=(idx-date.getDay()+7)%7;if(delta===0)delta=7;date.setDate(date.getDate()+delta);title=title.replace(new RegExp(`\\b${days[idx].slice(0,3)}(?:${days[idx].slice(3)})?\\b`,"ig"),"")}}
  let duration=60,dm=title.match(/\bfor\s+(\d+(?:\.\d+)?)\s*(h(?:ours?)?|m(?:in(?:ute)?s?)?)\b/i);if(dm){duration=Math.round(+dm[1]*(dm[2].toLowerCase().startsWith("h")?60:1));title=title.replace(dm[0],"")}
  let hour=Math.min(20,Math.max(7,Math.ceil(now.getHours()+now.getMinutes()/60))),minute=0,tm=title.match(/(?:\bat\s*)?\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)||title.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/i);if(tm){hour=+tm[1];minute=+(tm[2]||0);const ap=(tm[3]||"").toLowerCase();if(ap==="pm"&&hour<12)hour+=12;if(ap==="am"&&hour===12)hour=0;title=title.replace(tm[0],"")}
  title=title.replace(/\s+/g," ").replace(/^[,\s-]+|[,\s-]+$/g,"");const start=`${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}`,total=Math.min(1439,hour*60+minute+Math.max(15,duration)),end=`${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`;return {title,date:todayStr(date),start,end};
}

/* ============ TOASTS ============ */
function toast(msg, kind){
  const el = document.createElement("div");
  el.className = "toast "+(kind||"");
  el.textContent = msg;
  document.getElementById("toasts").appendChild(el);
  setTimeout(()=>el.remove(), 2800);
}

/* ============ NONBLOCKING LEVEL UP ============ */
function showLevelUp(lvl){
  systemAnnounce("Level up",`LV. ${lvl} · ${titleForLevel(lvl)}`);
}

/* ============ VIEW SWITCH ============ */
function mountCustomReminders(view){
  const surface=document.getElementById('remindersSurface');
  const host=document.getElementById(view==='health'?'healthRemindersHost':'remindersPageHost');
  if(!surface||!host)return;
  if(surface.parentElement!==host)host.appendChild(surface);
  customRemindersUI?.render();
  const heading=surface.querySelector('.health-head h2');
  if(heading)heading.textContent=view==='health'?'Other reminders':'Reminders';
}
function setView(v){
  currentView = v;
  syncFocusAtmosphere();
  const goalsPanel=document.getElementById("goalsPanel");if(goalsPanel)goalsPanel.hidden=!["quests","all","daily","focus","bucket"].includes(v);
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active", b.dataset.view===v));
  document.querySelectorAll(".nav-btn[data-view]").forEach(b=>{if(b.dataset.view===v)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  const more=document.getElementById('navMore'),moreLabel=document.getElementById('navMoreLabel'),secondary={all:'All Tasks',daily:'Daily Quests',focus:'Focus',reminders:'Reminders',bucket:'Bucket List',army:'Achievements'};
  if(more){more.open=false;more.classList.toggle('has-selection',!!secondary[v]);}if(moreLabel)moreLabel.textContent=secondary[v]||'More';
  document.querySelectorAll(".view").forEach(el=>el.classList.toggle("active", el.id==="view-"+v));
  if(v==="calendar"&&state.calendar){state.calendar.backlogOpen=false;save();renderBacklog()}
  if(v==="today")todayUI?.render();
  if(v==="tomorrow")tomorrowUI?.render();
  if(v==="health"){healthUI?.render();mountCustomReminders(v);}
  if(v==="reminders")mountCustomReminders(v);
  if(v==="focus")todayUI?.renderFocus();
}

/* ============ MODALS ============ */
// The desktop webview never displays window.confirm()/prompt() — they return
// instantly (false / null), so every dialog silently cancelled. These replace
// them with real in-app UI.
let confirmResolver = null;
function uiConfirm(message, opts){
  opts = opts || {};
  return new Promise(resolve=>{
    const box = document.getElementById("modalConfirm");
    if(!box){ resolve(false); return; }
    document.getElementById("confirmTitle").textContent = opts.title || "Are you sure?";
    document.getElementById("confirmBody").textContent = message || "";
    const yes = document.getElementById("confirmYes");
    yes.textContent = opts.okLabel || "Confirm";
    yes.className = "btn " + (opts.danger===false ? "btn-primary" : "btn-danger");
    confirmResolver = resolve;
    box.classList.add("show");
  });
}
function settleConfirm(val){
  document.getElementById("modalConfirm").classList.remove("show");
  const r = confirmResolver; confirmResolver = null;
  if(r) r(val);
}

// Turn a title element into an inline text field. Enter saves, Escape cancels.
function inlineEdit(el, current, onSave){
  if(!el || el.dataset.editing) return;
  el.dataset.editing = "1";
  const input = document.createElement("input");
  input.type = "text";
  input.value = current;
  input.className = "inline-edit";
  el.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (commit)=>{
    if(done) return; done = true;
    const val = input.value.trim();
    input.replaceWith(el);
    delete el.dataset.editing;
    if(commit && val && val !== current) onSave(val);
  };
  input.addEventListener("keydown", ev=>{
    if(ev.key === "Enter"){ ev.preventDefault(); finish(true); }
    else if(ev.key === "Escape"){ ev.preventDefault(); finish(false); }
  });
  input.addEventListener("blur", ()=>finish(true));
}

let gateEditorReturn=null,calendarEditorReturn=null;
const gateEditorDrafts=new Map();
const gateEditorFields=['gateTitle','gateDue','gUrgency','gImpact','gEffort'];
function gateDraftKey(){return editingGate?`${editingGate.pid}:${editingGate.gid}`:`new:${pendingGateProjectId}`;}
function setWorkspaceInert(inert){const app=document.querySelector('.app'),search=document.querySelector('.top-search-anchor');if(app)app.inert=inert;if(search)search.inert=inert;}
function openModal(id){
  const box=document.getElementById(id);box.classList.add('show');
  if(id==='modalGate'){
    gateEditorReturn=document.activeElement;box.inert=false;box.setAttribute('aria-hidden','false');setWorkspaceInert(true);
    const draft=gateEditorDrafts.get(gateDraftKey());if(draft)gateEditorFields.forEach(field=>document.getElementById(field).value=draft[field]);
    const status=document.getElementById('gateEditorStatus');if(status)status.textContent=draft?'Unsaved changes restored.':'Changes stay here until you save. Escape keeps a temporary draft; Cancel discards it.';
    const priority=document.getElementById('gatePriorityDetails');if(priority)priority.open=false;
    updateGatePreview();document.getElementById('gateTitle').focus();
  }
}
function closeModal(id,discard=false){
  const box=document.getElementById(id);box.classList.remove('show');
  if(id==='modalGate'){
    if(discard)gateEditorDrafts.delete(gateDraftKey());else gateEditorDrafts.set(gateDraftKey(),Object.fromEntries(gateEditorFields.map(field=>[field,document.getElementById(field).value])));
    box.inert=true;box.setAttribute('aria-hidden','true');setWorkspaceInert(false);gateEditorReturn?.focus?.();
  }
}

let pendingGateProjectId = null;
let editingGate = null;   // {pid, gid} when the modal is editing rather than creating

function openGateEditor(pid, gid){
  const project = findProject(pid);
  const gate = project && findGate(project, gid);
  if(!gate) return;
  editingGate = { pid, gid };
  pendingGateProjectId = pid;
  document.getElementById("gateModalTitle").textContent = "Edit Gate";
  document.getElementById("gateTitle").value = gate.title;
  document.getElementById("gateDue").value = gate.due || "";
  document.getElementById("gUrgency").value = gate.urgency;
  document.getElementById("gImpact").value = gate.impact;
  document.getElementById("gEffort").value = gate.effort;
  document.getElementById("btnSaveGate").textContent = "Save changes";
  updateGatePreview();
  openModal("modalGate");
}

function updateGatePreview(){
  const u = +document.getElementById("gUrgency").value;
  const i = +document.getElementById("gImpact").value;
  const e = +document.getElementById("gEffort").value;
  document.getElementById("gUrgencyVal").textContent = u;
  document.getElementById("gImpactVal").textContent = i;
  document.getElementById("gEffortVal").textContent = e;
  const score = computeScore(u,i,e);
  const rank = rankFromScore(score);
  document.getElementById("gateScoreVal").textContent = score.toFixed(1);
  const badge = document.getElementById("gateRankBadge");
  badge.textContent = rank;
  badge.style.background = RANK_COLOR[rank];
}

/* ============ POMODORO ENGINE ============ */
function pomoTick(){
  const p = state.pomodoro;
  if(!p.running) return;
  p.secondsLeft -= 1;
  if(p.secondsLeft <= 0){
    pomoComplete();
  } else {
    renderFocus();
  }
}
function pomoComplete(earned=true){
  const p = state.pomodoro;
  if(p.mode==="focus"){
    if(earned){
      p.sessionCount += 1;
      state.player.focusSessionsTotal += 1;
      state.execution||={days:{}};state.execution.days||={};
      const date=todayStr();state.execution.days[date]||={};
      state.execution.days[date].focusSessions=(state.execution.days[date].focusSessions||0)+1;
      awardXP(8, "Focus session complete");
    }
    const isLong = earned && p.sessionCount % p.everyN === 0;
    p.mode = isLong ? "long" : "short";
    p.secondsLeft = (isLong ? p.longBreak : p.shortBreak) * 60;
    p.currentRest = { ...REST_POOL[Math.floor(Math.random()*REST_POOL.length)], done:false };
    toast(isLong ? "Long break — nice work." : "Short break.", "gold");
  } else {
    p.mode = "focus";
    p.secondsLeft = p.workMin * 60;
    p.currentRest = null;
    toast("Back to focus.", "xp");
  }
  save();
  renderFocus();
}
function pomoToggle(){
  const p = state.pomodoro;
  p.running = !p.running;
  syncFocusAtmosphere();
  document.getElementById("btnTimerToggle").textContent = p.running ? "Pause" : "Start";
}
function pomoReset(){
  const p = state.pomodoro;
  p.running = false;
  p.mode = "focus";
  p.secondsLeft = p.workMin*60;
  p.currentRest = null;
  save();
  renderFocus();
}
function pomoSkip(){
  pomoComplete(false);
}
setInterval(pomoTick, 1000);


/* ============ THEME ============ */
// Dark is the app's identity, so it stays the default regardless of the OS
// setting — light is something you opt into.
function effectiveTheme(){
  return state.theme==="light" ? "light" : "dark";
}
function applyTheme(){
  const t = effectiveTheme();
  document.documentElement.setAttribute("data-theme", t);
  const btn = document.getElementById("themeToggle");
  if(btn){
    btn.innerHTML=t==='light'?'<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>':'<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15a8.5 8.5 0 0 1-11-11A8.5 8.5 0 1 0 20 15z"/></svg>';
    btn.title = t==="light" ? "Light mode — switch to dark" : "Dark mode — switch to light";
    btn.setAttribute('aria-label',btn.title);
  }
}
function toggleTheme(){
  state.theme = effectiveTheme()==="light" ? "dark" : "light";
  save();
  applyTheme();
  const cb=document.getElementById("setLightMode");
  if(cb) cb.checked = effectiveTheme()==="light";
}

/* ============ UNDO ============ */
// Whole-state snapshots. The state object is a few KB, so this is cheap and
// automatically covers knock-on effects like XP, levels and shadow unlocks.
const undoStack = [];
const UNDO_LIMIT = 25;
let suspendUndo = false;

function snapshotState(){
  const {pomodoro, ...rest} = state;
  const {timerHandle, ...pomoSafe} = pomodoro;
  return JSON.stringify({...rest, pomodoro:pomoSafe});
}

function pushUndo(label){
  if(suspendUndo) return;
  undoStack.push({ label, snap: snapshotState() });
  if(undoStack.length > UNDO_LIMIT) undoStack.shift();
}

function undoLast(){
  if(!undoStack.length) return null;
  const { label, snap } = undoStack.pop();
  const parsed = JSON.parse(snap);
  const d = defaultState();
  suspendUndo = true;
  state = Object.assign(d, parsed, {
    player: Object.assign(d.player, parsed.player),
    daily: Object.assign(d.daily, parsed.daily),
    pomodoro: Object.assign(d.pomodoro, parsed.pomodoro, {running:false, timerHandle:null}),
    voice: Object.assign(d.voice, parsed.voice),
  });
  save();
  if(selectedDungeonId && !findProject(selectedDungeonId)) selectedDungeonId = null;
  renderAll();
  suspendUndo = false;
  return label;
}

/* ============ ACTIONS ============ */
function addProject(name, emoji){
  pushUndo("adding that dungeon");
  state.projects.push({ id:uid("proj"), name, emoji, createdAt:Date.now(), tasks:[] });
  save(); renderPortal(); renderAllTasks();
}
function deleteProject(pid, skipConfirm){
  if(!skipConfirm){
    const p = findProject(pid);
    uiConfirm(`"${p?p.name:"This dungeon"}" and everything inside it will be removed. You can undo with Cmd+Z.`,
      { title:"Delete dungeon?", okLabel:"Delete" })
      .then(ok=>{ if(ok) deleteProject(pid, true); });
    return;
  }
  pushUndo("deleting that dungeon");
  state.projects = state.projects.filter(p=>p.id!==pid);
  save(); renderPortal(); renderAllTasks();
}
function addGate(pid, title, urgency, impact, effort, due){
  pushUndo("adding that gate");
  const project = findProject(pid);
  project.tasks.push({ id:uid("gate"), title, urgency, impact, effort, due:due||null, children:[], createdAt:Date.now() });
  save(); renderPortal(); renderAllTasks();
}
function deleteGate(pid, gid){
  pushUndo("deleting that gate");
  const project = findProject(pid);
  project.tasks = project.tasks.filter(g=>g.id!==gid);
  save(); renderPortal(); renderAllTasks();
}
function markGateCleared(pid, gid, origin){
  pushUndo("clearing that gate");
  const project = findProject(pid);
  const gate = findGate(project, gid);
  if(gate.children.length>0) return;
  const wasProjectComplete=systemProjectComplete(project);
  gate.done = !gate.done;
  save();
  if(gate.done && !gate.clearAwarded){ gate.clearAwarded=true; onGateCleared(gate,origin); }
  if(!gate.done && gate.clearAwarded){
    gate.clearAwarded=false;
    state.player.totalCleared=Math.max(0,state.player.totalCleared-1);
    const rank=rankFromScore(computeScore(gate.urgency,gate.impact,gate.effort));
    removeXP(RANK_XP[rank],`Gate reopened [${rank}]`);
  }
  renderPortal(); renderAllTasks(); renderHUD();
  if(gate.done) systemTaskCompleted(project,gid,null,wasProjectComplete);
}
function addSubtask(pid, gid, title){
  pushUndo("adding that quest");
  const project = findProject(pid);
  const gate = findGate(project, gid);
  gate.children.push({ id:uid("sub"), title, done:false, children:[] });
  save(); renderPortal(); renderAllTasks();
}
function deleteSubtask(pid, gid, nid){
  pushUndo("deleting that quest");
  const project = findProject(pid);
  const gate = findGate(project, gid);
  const parent = findParentOf(gate, nid) || gate;
  parent.children = parent.children.filter(c=>c.id!==nid);
  save(); renderPortal(); renderAllTasks();
}
function toggleSubtask(pid, gid, nid, origin){
  pushUndo("that check-off");
  const project = findProject(pid);
  const gate = findGate(project, gid);
  const wasComplete = progressPct(gate)===100;
  const node = findNode(gate, nid);
  const wasProjectComplete=systemProjectComplete(project), wasNodeComplete=progressPct(node)===100;
  if(!node.children || node.children.length===0){
    node.done = !node.done;
  }
  if(node.done && !node.xpAwarded){
    node.xpAwarded=true;
    awardXP(3,"Quest cleared",origin);
  }else if(!node.done && node.xpAwarded){
    node.xpAwarded=false;
    removeXP(3,"Quest reopened");
  }
  save();
  const nowComplete = progressPct(gate)===100;
  if(!wasComplete && nowComplete){
    if(!gate.clearAwarded){ gate.clearAwarded=true; onGateCleared(gate,origin); }
  }else if(wasComplete && !nowComplete && gate.clearAwarded){
    gate.clearAwarded=false;
    state.player.totalCleared=Math.max(0,state.player.totalCleared-1);
    const rank=rankFromScore(computeScore(gate.urgency,gate.impact,gate.effort));
    removeXP(RANK_XP[rank],`Gate reopened [${rank}]`);
  }
  renderPortal(); renderAllTasks(); renderHUD();
  if(!wasNodeComplete && progressPct(node)===100) systemTaskCompleted(project,gid,nid,wasProjectComplete);
}
function onGateCleared(gate, origin){
  const score = computeScore(gate.urgency, gate.impact, gate.effort);
  const rank = rankFromScore(score);
  state.player.totalCleared += 1;
  awardXP(RANK_XP[rank], `Gate cleared [${rank}]`,origin);
  // Personal goals now create achievements; legacy shadow progress remains preserved.
  save();
}
function unlockShadow(minRank){
  const rankOrder = ["E","D","C","B","A","S"];
  const owned = new Set(state.player.shadowArmy);
  const candidates = SHADOW_NAMES
    .map((s,idx)=>({idx, name:s[0], rank:s[1]}))
    .filter(c=>!owned.has(c.idx) && rankOrder.indexOf(c.rank) <= rankOrder.indexOf(minRank));
  const pool = candidates.length ? candidates : SHADOW_NAMES.map((s,idx)=>({idx,name:s[0],rank:s[1]})).filter(c=>!owned.has(c.idx));
  if(pool.length===0) return;
  const pick = pool[Math.floor(Math.random()*pool.length)];
  state.player.shadowArmy.push(pick.idx);
  toast(`Shadow extracted: ${pick.name}`, "gold");
  save(); renderArmy();
}
function addDailyQuest(text){
  pushUndo("adding that daily quest");
  state.daily.quests.push({ id:uid("dq"), text, done:false });
  save(); renderDaily(); renderHUD();
}
function deleteDailyQuest(id){
  pushUndo("deleting that daily quest");
  state.daily.quests = state.daily.quests.filter(q=>q.id!==id);
  save(); renderDaily(); renderHUD();
}
function toggleDailyQuest(id){
  pushUndo("that daily quest");
  const q = state.daily.quests.find(q=>q.id===id);
  q.done = !q.done;
  save();
  maybeCompleteDailyStreak();
  if(q.done) awardXP(4, "Daily quest");
  renderDaily(); renderHUD();
}


/* ============ TRELLO IMPORT (read-only, one-way) ============ */
// Only ever issues GET requests, and the token we ask for is scoped `read`,
// so this cannot modify a board even if something goes wrong.
const TRELLO_API = "https://api.trello.com/1";
const DONE_LIST_RE = /\b(done|complete|completed|finished|shipped|archive)\b/i;

function trelloCfg(){
  if(!state.integrations) state.integrations = {};
  if(!state.integrations.trello) state.integrations.trello = { key:"", token:"", boards:[], lastSync:null, onlyMine:true, memberId:null, memberName:null };
  const c = state.integrations.trello;
  if(c.onlyMine === undefined) c.onlyMine = true;
  if(c.autoSync === undefined) c.autoSync = true;
  return state.integrations.trello;
}

async function trelloGet(path, params){
  const cfg = trelloCfg();
  const q = new URLSearchParams(Object.assign({ key:cfg.key, token:cfg.token }, params||{}));
  const res = await fetch(`${TRELLO_API}${path}?${q}`);
  if(res.status===401) throw new Error("Trello rejected the key or token (401). Double-check both.");
  if(!res.ok) throw new Error(`Trello returned ${res.status}.`);
  return res.json();
}

async function openExternal(url){
  if(isDesktop()){
    await tauriInvoke("open_external",{url});
    return true;
  }
  try{
    if(window.__TAURI__ && window.__TAURI__.opener && window.__TAURI__.opener.openUrl){
      await window.__TAURI__.opener.openUrl(url);
      return true;
    }
  }catch(e){}
  try{ if(window.open(url,"_blank")) return true; }catch(e){}
  return false;
}

function trelloAuthUrl(key){
  return `https://trello.com/1/authorize?expiration=never&scope=read&response_type=token&name=ARISE&key=${encodeURIComponent(key)}`;
}

/* One-click connect (web only). ARISE's own app key is public; Trello sends
   the user's read-only token back in the URL fragment. A token is accepted
   only if this device started the connect, for the same account, recently. */
const TRELLO_APP_KEY = (window.ARISEIntegrationConfig && window.ARISEIntegrationConfig.trelloAppKey) || "";
const TRELLO_PENDING_KEY = "arise.trello.pending.v1";
const TRELLO_PENDING_MAX_AGE = 10 * 60 * 1000;
let pendingTrelloToken = null;

function trelloOneClickAvailable(){ return !!TRELLO_APP_KEY && !isDesktop(); }

function setTrelloManualVisible(visible){
  for(const id of ["trelloManual", "trelloConnect"]){
    const el = document.getElementById(id);
    if(el) el.style.display = visible ? "" : "none";
  }
}

function trelloStartConnect(){
  if(!trelloOneClickAvailable()) return false;
  localStorage.setItem(TRELLO_PENDING_KEY, JSON.stringify({ account: activeDataUserId || "local", at: Date.now() }));
  const loc = window.location;
  loc.assign(`${trelloAuthUrl(TRELLO_APP_KEY)}&callback_method=fragment&return_url=${encodeURIComponent(loc.origin + loc.pathname)}`);
  return true;
}

function captureTrelloReturn(){
  const loc = window.location, hist = window.history;
  const hash = loc?.hash || "";
  if(!hist || !/^#(.*&)?(token|error)=/.test(hash)) return;
  const params = new URLSearchParams(hash.slice(1));
  let pending = null;
  try{ pending = JSON.parse(localStorage.getItem(TRELLO_PENDING_KEY) || "null"); }catch(e){}
  localStorage.removeItem(TRELLO_PENDING_KEY);
  hist.replaceState(null, "", loc.pathname + loc.search);
  if(!pending || !pending.account || !(Date.now() - pending.at < TRELLO_PENDING_MAX_AGE)) return;
  const token = params.get("token");
  pendingTrelloToken = token && /^[A-Za-z0-9]{32,128}$/.test(token)
    ? { token, account: pending.account }
    : { error: true, account: pending.account };
}

function applyPendingTrelloToken(){
  const pending = pendingTrelloToken;
  pendingTrelloToken = null;
  if(!pending || pending.account !== (activeDataUserId || "local")) return false;
  openSettings("connections");
  if(pending.error){ syncMsg("Trello didn't connect. Try Connect Trello again.", "err"); return false; }
  const cfg = trelloCfg();
  cfg.key = TRELLO_APP_KEY;
  cfg.token = pending.token;
  save();
  document.getElementById("trelloKey").value = cfg.key;
  document.getElementById("trelloToken").value = cfg.token;
  trelloLoadBoards();
  return true;
}

function syncMsg(text, kind){
  const el = document.getElementById("syncStatus");
  if(!el) return;
  el.className = "sync-status " + (kind||"");
  el.textContent = text;
}

async function trelloLoadBoards(){
  const cfg = trelloCfg();
  cfg.key = document.getElementById("trelloKey").value.trim();
  cfg.token = document.getElementById("trelloToken").value.trim();
  if(!cfg.key || !cfg.token){ syncMsg("Enter both the API key and the token first.", "err"); return; }
  save();
  syncMsg("Checking credentials…");
  try{
    const me = await trelloGet("/members/me", { fields:"id,fullName,username" });
    cfg.memberId = me.id;
    cfg.memberName = me.fullName || me.username;
    const boards = await trelloGet("/members/me/boards", { fields:"name,closed", filter:"open" });
    save();
    trelloRenderBoards(boards);
    renderTrelloState();
    syncMsg(`Connected as ${cfg.memberName}. Found ${boards.length} board${boards.length!==1?"s":""} — pick which to import.`, "ok");
  }catch(e){
    syncMsg(e.message, "err");
  }
}

function trelloRenderBoards(boards){
  const wrap = document.getElementById("trelloBoards");
  const cfg = trelloCfg();
  if(!boards.length){ wrap.innerHTML = '<div class="sync-hint">No open boards on this account.</div>'; return; }
  wrap.innerHTML = `<div class="sync-label">Boards to import</div>` + boards.map(b=>`
    <label class="board-row">
      <input type="checkbox" class="board-cb" value="${escapeHtml(b.id)}" data-name="${escapeHtml(b.name)}"
        ${cfg.boards.includes(b.id)?"checked":""}>
      <span>${escapeHtml(b.name)}</span>
    </label>`).join("") +
    `<button class="btn btn-primary btn-sm" id="trelloImport" style="margin-top:10px;">Import selected</button>`;
}

function mergeTrelloBoard(board, lists, cards, opts){
  opts = opts || {};
  const doneLists = new Set(lists.filter(l=>DONE_LIST_RE.test(l.name)).map(l=>l.id));
  let project = state.projects.find(p=>p.trelloId===board.id);
  let addedGates=0, updatedGates=0, removedGates=0;

  // Only cards assigned to you, when that filter is on.
  if(opts.memberId){
    cards = cards.filter(c=>Array.isArray(c.idMembers) && c.idMembers.includes(opts.memberId));
  }

  if(!project){
    project = { id:uid("proj"), name:board.name, emoji:guessEmoji(board.name),
                createdAt:Date.now(), tasks:[], trelloId:board.id, source:"trello" };
    state.projects.push(project);
  } else {
    project.name = board.name;
  }

  cards.forEach(card=>{
    if(card.closed) return;
    const due = card.due ? card.due.slice(0,10) : null;
    const items = (card.checklists||[]).reduce((a,cl)=>a.concat(cl.checkItems||[]), []);
    let gate = project.tasks.find(g=>g.trelloId===card.id);

    if(!gate){
      gate = { id:uid("gate"), title:card.name, urgency:3, impact:3, effort:3, due,
               children:[], createdAt:Date.now(), trelloId:card.id, sourceUrl:card.shortUrl };
      project.tasks.push(gate);
      addedGates++;
    } else {
      // Trello owns the title and due date; the priority ratings are yours,
      // so a re-sync must never clobber them.
      gate.title = card.name;
      gate.due = due;
      updatedGates++;
    }

    items.forEach(ci=>{
      let sub = gate.children.find(c=>c.trelloId===ci.id);
      if(!sub){
        gate.children.push({ id:uid("sub"), title:ci.name, done:ci.state==="complete", children:[], trelloId:ci.id });
      } else {
        sub.title = ci.name;
        sub.done = ci.state==="complete";
      }
    });

    if(items.length===0) gate.done = doneLists.has(card.idList) || !!card.dueComplete;
  });

  // Drop imported gates whose card no longer qualifies (unassigned, archived or
  // deleted). Never touches gates you created yourself — those have no trelloId.
  const liveIds = new Set(cards.filter(c=>!c.closed).map(c=>c.id));
  const before = project.tasks.length;
  project.tasks = project.tasks.filter(g=>!g.trelloId || liveIds.has(g.trelloId));
  removedGates = before - project.tasks.length;

  return { addedGates, updatedGates, removedGates, project };
}

async function trelloImport(boardIds, opts){
  opts = opts || {};
  const auto = !!opts.auto;
  if(!boardIds.length){ if(!auto) syncMsg("Select at least one board.", "err"); return; }
  const cfg = trelloCfg();
  cfg.boards = boardIds;
  // Background syncs skip the undo snapshot — otherwise a day of polling would
  // push every real action off the end of the undo stack.
  if(!auto) pushUndo("that Trello import");
  setSyncSpinning(true);
  let added=0, updated=0, removed=0, boardsDone=0;
  try{
    if(cfg.onlyMine && !cfg.memberId){
      const me = await trelloGet("/members/me", { fields:"id,fullName,username" });
      cfg.memberId = me.id; cfg.memberName = me.fullName || me.username;
    }
    const memberId = cfg.onlyMine ? cfg.memberId : null;
    const emptied = [];
    for(const id of boardIds){
      if(!auto) syncMsg(`Importing board ${boardsDone+1} of ${boardIds.length}…`);
      const [board, lists, cards] = await Promise.all([
        trelloGet(`/boards/${id}`, { fields:"name" }),
        trelloGet(`/boards/${id}/lists`, { fields:"name" }),
        trelloGet(`/boards/${id}/cards`, {
          fields:"name,due,dueComplete,idList,shortUrl,closed,idMembers",
          checklists:"all", checklist_fields:"name" })
      ]);
      const r = mergeTrelloBoard(board, lists, cards, { memberId });
      added += r.addedGates; updated += r.updatedGates; removed += r.removedGates; boardsDone++;
      if(r.project.tasks.length===0) emptied.push(r.project.id);
    }
    // A board with nothing assigned to you leaves an empty dungeon — clear it out.
    if(emptied.length) state.projects = state.projects.filter(p=>!emptied.includes(p.id));
    cfg.lastSync = Date.now();
    save();
    renderAll();
    renderTrelloState();
    const scope = memberId ? ` (only cards assigned to ${cfg.memberName})` : "";
    const changed = added || updated || removed;
    if(!auto){
      syncMsg(`Done — ${added} new, ${updated} updated${removed?`, ${removed} removed`:""}, across ${boardsDone} board${boardsDone!==1?"s":""}${scope}.`, "ok");
      toast(`Trello: +${added} new, ${updated} updated${removed?`, ${removed} removed`:""}`, "xp");
    } else if(added || removed){
      // Stay quiet unless something actually arrived or disappeared.
      toast(`Trello synced: ${added?`+${added} new`:""}${added&&removed?", ":""}${removed?`${removed} removed`:""}`, "xp");
    }
    trelloSyncFailures = 0;
  }catch(e){
    trelloSyncFailures++;
    if(!auto){
      syncMsg("Import failed: "+e.message, "err");
    } else if(trelloSyncFailures===3){
      // One nudge after repeated failures, not one per attempt.
      toast("Trello sync is failing — check the ⟳ panel", "danger");
    }
  }finally{
    setSyncSpinning(false);
  }
}

let trelloSyncFailures = 0;
let trelloTimer = null,trelloFocusListenerAdded=false;
const TRELLO_POLL_MS = 15*60*1000;

function setSyncSpinning(on){
  const b = document.getElementById("syncToggle");
  if(b) b.classList.toggle("spinning", !!on);
}

function trelloAutoReady(){
  const c = trelloCfg();
  return !!(c.autoSync && c.key && c.token && c.boards && c.boards.length);
}

function trelloAutoSync(){
  if(!document.body.classList.contains("auth-ready"))return;
  if(!trelloAutoReady()) return;
  if(!navigator.onLine) return;
  trelloImport(trelloCfg().boards, { auto:true });
}

function startTrelloAutoSync(){
  if(trelloTimer) clearInterval(trelloTimer);
  if(!trelloAutoReady()) return;
  // Catch up shortly after launch, then keep it fresh in the background.
  setTimeout(trelloAutoSync, 4000);
  trelloTimer = setInterval(trelloAutoSync, TRELLO_POLL_MS);
  // Coming back to the app after a while is a good moment to refresh.
  if(!trelloFocusListenerAdded){trelloFocusListenerAdded=true;window.addEventListener("focus", ()=>{
    const c = trelloCfg();
    if(trelloAutoReady() && (!c.lastSync || Date.now()-c.lastSync > 5*60*1000)) trelloAutoSync();
  });}
}

function cloudStatusMsg(text,kind=""){const el=document.getElementById("cloudStatus");if(el){el.textContent=text;el.className="ai-status "+kind}}
function cloudDataMsg(text,kind=""){const el=document.getElementById("cloudDataStatus");if(el){el.textContent=text;el.className="ai-status "+kind}}
function cloudDataEnabled(userId=activeDataUserId){return !!userId&&localStorage.getItem(CLOUD_ENABLED_PREFIX+userId)==="1"}
function renderCloudSettings(){
  const status=cloudSync?.status()||{},signed=!!status.signedIn;
  document.getElementById("cloudSignOut")?.toggleAttribute("hidden",!signed);
  const enabled=cloudDataEnabled();
  const enable=document.getElementById("cloudDataEnable"),disable=document.getElementById("cloudDataDisable"),now=document.getElementById("cloudDataNow");
  if(enable)enable.hidden=!signed||enabled;
  if(disable)disable.hidden=!signed||!enabled;
  if(now)now.hidden=!signed||!enabled;
  cloudStatusMsg(signed?`Signed in as ${status.email||"your account"} · ${enabled?"cloud sync on":"data on this device only"}`:"Not signed in.",signed?"ok":"");
  if(!enabled)cloudDataMsg("Cloud sync is off. Your device copy remains available.");
}
function cloudAccountChanged(){
  renderCloudSettings();
}
async function backupCloudCopies(local,remote){
  if(!isDesktop())return; // The controller also stores both copies in local recovery storage.
  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  await tauriInvoke("save_backup",{json:await backupPayload(),name:`arise-export-before-cloud-${stamp}.json`});
  if(remote?.data){
    const cloudBackup={_app:"ARISE",_version:2,_exportedAt:new Date().toISOString(),data:remote.data,memoryImages:[]};
    await tauriInvoke("save_backup",{json:JSON.stringify(cloudBackup,null,2),name:`arise-export-cloud-copy-${stamp}.json`});
  }
}
async function applyCloudData(incoming){
  if(!activeDataUserId||cloudSync.status().userId!==activeDataUserId)throw Error("The signed-in account changed during sync.");
  const before=state;
  const merged={...before,...incoming,
    integrations:before.integrations,voice:before.voice,notifications:before.notifications,
    theme:before.theme,lastAutoBackup:before.lastAutoBackup,
    health:{...(before.health||{}),...(incoming.health||{}),lastWaterReminder:before.health?.lastWaterReminder},
    calendar:{...before.calendar,...(incoming.calendar||{}),events:before.calendar.events,lastSync:before.calendar.lastSync,recentGuestEmails:before.calendar.recentGuestEmails}};
  state=normalizeState(merged);
  applyingCloudState=true;
  try{save();}catch(error){state=before;throw error}finally{applyingCloudState=false}
  selectedDungeonId=null;renderAll();applyTheme();
}
function showCloudConflict(info){
  const box=document.getElementById("cloudDataConflict"),description=document.getElementById("cloudDataConflictText"),useCloud=document.getElementById("cloudDataUseCloud");
  if(!box)return;
  box.hidden=!info;
  if(info&&description)description.textContent=info.reason==="cloud-missing"
    ?"The cloud copy disappeared, but this device still has data. Choose this device to create a new cloud copy."
    :`This device has ${info.localProjects} project(s); Supabase has ${info.cloudProjects}. Choose which complete copy to keep. Both are backed up first.`;
  if(useCloud)useCloud.hidden=!info?.remoteRevision;
}
async function startAccountDataSync(){
  const accountId=activeDataUserId;
  if(!accountId||!cloudDataEnabled(accountId)||cloudSync.status().userId!==accountId)return;
  if(cloudDataController){await cloudDataController.check(true);return;}
  try{
    cloudDataController=window.ARISECloudData.create({
      cloud:cloudSync,storage:localStorage,accountId,getLocal:()=>state,
      applyRemote:applyCloudData,backup:backupCloudCopies,
      isCurrent:id=>activeDataUserId===id&&cloudDataEnabled(id),
      onStatus:cloudDataMsg,onConflict:showCloudConflict,
    });
    await cloudDataController.start();
  }catch(error){cloudDataMsg("Sync could not start: "+error.message,"err");}
}
async function offerCloudRestore(accountId){
  if(!accountId||localStorage.getItem(CLOUD_ENABLED_PREFIX+accountId)!==null||window.ARISECloudData.hasUserData(state))return;
  try{
    const remote=await cloudSync.readState();
    if(!remote||!window.ARISECloudData.hasUserData(remote.data)||activeDataUserId!==accountId||cloudSync.status().userId!==accountId||localStorage.getItem(CLOUD_ENABLED_PREFIX+accountId)!==null)return;
    const ok=await uiConfirm('A saved ARISE plan was found for this account in Supabase. Restore it to this device and keep it in sync? A private device recovery copy is saved first.',{title:'Restore your ARISE progress?',okLabel:'Restore and sync'});
    if(activeDataUserId!==accountId||cloudSync.status().userId!==accountId)return;
    localStorage.setItem(CLOUD_ENABLED_PREFIX+accountId,ok?'1':'0');
    renderCloudSettings();
    if(ok)await startAccountDataSync();
  }catch(error){
    if(activeDataUserId===accountId)cloudDataMsg('Cloud restore check is unavailable: '+error.message,'err');
  }
}
let appServicesStarted=false;
function authMsg(message="",kind=""){const el=document.getElementById("authStatus");if(el){el.textContent=message;el.className="auth-status "+kind}}
function showAuth(stage="entry"){
  document.body.classList.remove("auth-pending","auth-ready");document.body.classList.add("auth-locked");
  stopWakeListening();healthUI?.stop?.();notificationsUI?.stop?.();
  if(trelloTimer){clearInterval(trelloTimer);trelloTimer=null}
  document.getElementById("authChecking").hidden=stage!=="checking";
  document.getElementById("authEntry").hidden=stage!=="entry";
  document.getElementById("authOfflineActions").hidden=stage!=="offline";
  if(stage==="entry")setTimeout(()=>document.getElementById("cloudEmail")?.focus(),0);
}
function unlockApp(){
  document.body.classList.remove("auth-pending","auth-locked");document.body.classList.add("auth-ready");
  authMsg();renderCloudSettings();
  queueWidgetSnapshot();
  if(!appServicesStarted){
    appServicesStarted=true;initVoice();
    setTimeout(()=>{if(document.body.classList.contains("auth-ready"))syncGoogleCalendar(true)},7000);
    setInterval(()=>{if(document.body.classList.contains("auth-ready")&&state.calendar.protectDaily)syncGoogleCalendar(true)},5*60*1000);
    setTimeout(()=>{if(document.body.classList.contains("auth-ready"))autoBackup()},6000);
    if(window.speechSynthesis){renderVoicePicker();speechSynthesis.onvoiceschanged=renderVoicePicker}
  }else if(state.voice.wakeEnabled)startWakeListening();
  startTrelloAutoSync();
  healthUI?.start();notificationsUI?.start();
}
async function finishSignIn(){
  cloudAccountChanged();
  activateCloudAccount(cloudSync.status().userId);
  localStorage.setItem(ACTIVE_USER_KEY,cloudSync.status().userId);
  unlockApp();
  if(cloudDataEnabled())void startAccountDataSync();
  else void offerCloudRestore(activeDataUserId);
  applyPendingTrelloToken();
}
async function handleCloudGoogleCallback(){
  if(isDesktop()||!window.location?.search)return false;
  const params=new URLSearchParams(window.location.search),code=params.get("code"),error=params.get("error_description")||params.get("error");
  if(!code&&!error)return false;
  const pending=sessionStorage.getItem(cloudSync.keys.GOOGLE_PKCE_KEY);
  if(!pending)return false;
  const previousId=cloudSync.status().userId;
  try{
    if(error)throw Error(error);
    await cloudSync.completeGoogleSignIn(code);
    await finishSignIn(previousId);
  }catch(e){showAuth("entry");authMsg(e.message,"err")}
  finally{params.delete("code");params.delete("error");params.delete("error_description");history.replaceState(null,"",window.location.pathname+(params.size?"?"+params.toString():"")+window.location.hash)}
  return true;
}
function expireCloudSession(){
  cloudSync?.signOut();
  localStorage.setItem("arise.cloud.enabled.v1","0");
  showAuth("entry");clearCloudAccount();authMsg("Your session expired. Sign in again to continue.","err");
}
function initCloudSync(){
  if(!window.ARISECloud)return;
  cloudSync=window.ARISECloud.create({config:window.ARISECloudConfig});
  localStorage.setItem("arise.cloud.enabled.v1","0");
  const account=cloudSync.status().userId;
  if(account)activateCloudAccount(account);else clearCloudAccount();
  renderCloudSettings();
}
async function initAuthGate(){
  try{
    if(await handleCloudGoogleCallback())return;
    if(cloudSync.status().signedIn){
      try{if(await cloudSync.restoreSession()){
        activateCloudAccount(cloudSync.status().userId);
        await finishSignIn(cloudSync.status().userId);
        return;
      }}
      catch(error){showAuth("offline");authMsg("Couldn't verify your session: "+error.message,"err");return}
    }
    localStorage.setItem("arise.cloud.enabled.v1","0");showAuth("entry");clearCloudAccount();
  }catch(error){showAuth("entry");authMsg("Sign-in is unavailable: "+error.message,"err")}
}
document.getElementById("authEmailForm")?.addEventListener("submit",async event=>{
  event.preventDefault();
  const email=document.getElementById("cloudEmail").value.trim(),password=document.getElementById("cloudPassword").value,button=document.getElementById("cloudSignIn");
  if(!email||password.length<8){authMsg("Enter your email and a password of at least 8 characters.","err");return}
  button.disabled=true;authMsg("Signing in…");
  try{const previousId=cloudSync.status().userId;await cloudSync.signIn(email,password);document.getElementById("cloudPassword").value="";await finishSignIn(previousId)}
  catch(error){showAuth("entry");authMsg(error.message,"err")}
  finally{button.disabled=false}
});
function renderSettings(){
  const set=(id,val)=>{ const el=document.getElementById(id); if(el) el.checked = !!val; };
  set("setVoiceEnabled", state.voice.enabled !== false);
  set("setWakeWord", state.voice.wakeEnabled);
  set("setShowTranscripts", state.voice.showTranscripts !== false);
  set("setLightMode", effectiveTheme()==="light");
  applyVoiceEnabled();
  renderVoicePicker();
  refreshAIStatus();
  refreshGoogleStatus();
  renderCloudSettings();
}

function renderTrelloState(){
  const cfg = trelloCfg();
  const k = document.getElementById("trelloKey");
  const t = document.getElementById("trelloToken");
  if(k && !k.value) k.value = cfg.key || (isDesktop() ? TRELLO_APP_KEY : "");
  if(t && !t.value) t.value = cfg.token || "";
  const oneClick = document.getElementById("trelloOneClick");
  const usesOwnKey = !!cfg.key && cfg.key !== TRELLO_APP_KEY;
  if(oneClick) oneClick.style.display = trelloOneClickAvailable() ? "" : "none";
  if(!trelloOneClickAvailable() || usesOwnKey) setTrelloManualVisible(true);
  const oneClickBtn = document.getElementById("trelloConnectOneClick");
  if(oneClickBtn) oneClickBtn.textContent = (cfg.token && cfg.key === TRELLO_APP_KEY) ? "Choose boards" : "Connect Trello";
  const last = document.getElementById("trelloLast");
  if(last){
    last.textContent = cfg.lastSync
      ? "Last synced " + new Date(cfg.lastSync).toLocaleString()
      : "Not synced yet.";
  }
  const resync = document.getElementById("trelloResync");
  if(resync) resync.style.display = (cfg.boards && cfg.boards.length) ? "inline-flex" : "none";
  const mine = document.getElementById("trelloOnlyMine");
  if(mine) mine.checked = !!cfg.onlyMine;
  const auto = document.getElementById("trelloAutoSync");
  if(auto) auto.checked = !!cfg.autoSync;
  const connected = !!(cfg.token && cfg.memberName);
  const who = document.getElementById("trelloWho");
  if(who){ who.textContent = connected ? `Connected as ${cfg.memberName}` : "Not connected"; who.className = "ai-status" + (connected ? " ok" : ""); }
  document.getElementById("trelloCard")?.classList.toggle("is-connected", connected);
  if(oneClickBtn) oneClickBtn.classList.toggle("btn-primary", !connected);
  if(resync) resync.classList.toggle("btn-primary", connected);
  const hint = document.getElementById("trelloOneClickHint");
  if(hint) hint.style.display = trelloOneClickAvailable() && !connected ? "" : "none";
  const toggle = document.getElementById("trelloManualToggle");
  if(toggle) toggle.style.display = trelloOneClickAvailable() ? "" : "none";
  updateConnectionsCount();
}

/* Settings: tabs on wide screens, a list you tap into on phones (see settings.css). */
const SETTINGS_TAB_KEY = "arise.settings.tab.v1";
function showSettingsTab(name, opts){
  const panel = document.querySelector("#modalSync .settings");
  const tab = panel && panel.querySelector(`[data-settings-tab="${name}"]`);
  if(!tab) return;
  panel.querySelectorAll("[data-settings-tab]").forEach(t=>{ const on = t === tab; t.setAttribute("aria-selected", on ? "true" : "false"); t.tabIndex = on ? 0 : -1; });
  panel.querySelectorAll(".st-pane").forEach(p=>{ p.hidden = p.id !== "stPane-" + name; });
  panel.classList.toggle("st-detail", !!(opts && opts.detail));
  const title = document.getElementById("settingsTitleSection");
  if(title) title.textContent = tab.querySelector(".st-tab-label")?.textContent || "";
  try{ localStorage.setItem(SETTINGS_TAB_KEY, name); }catch(e){}
  if(opts && opts.focus) tab.focus();
}
function openSettings(tab){
  const modal = document.getElementById("modalSync");
  modal?.classList.toggle("is-web", !isDesktop());
  const nav = modal?.querySelector(".st-nav");
  if(nav && !nav.dataset.keys){ nav.dataset.keys = "1"; nav.addEventListener("keydown", settingsNavKeys); }
  openModal("modalSync"); renderTrelloState(); renderSettings(); notificationsUI?.render(); refreshBackupList();
  let saved = null; try{ saved = localStorage.getItem(SETTINGS_TAB_KEY); }catch(e){}
  showSettingsTab(tab || saved || "general", { detail: !!tab });
}
function settingsNavKeys(e){
  const tabs = [...e.currentTarget.querySelectorAll("[data-settings-tab]")], i = tabs.indexOf(document.activeElement);
  if(i < 0) return;
  const next = {ArrowDown:i+1, ArrowUp:i-1, Home:0, End:tabs.length-1}[e.key];
  if(next === undefined) return;
  e.preventDefault();
  const tab = tabs[(next + tabs.length) % tabs.length];
  showSettingsTab(tab.dataset.settingsTab, { focus:true, detail:document.querySelector("#modalSync .settings")?.classList.contains("st-detail") });
}
function updateConnectionsCount(){
  const el = document.getElementById("settingsConnCount");
  if(!el) return;
  const n = (document.getElementById("trelloCard")?.classList.contains("is-connected") ? 1 : 0) + (document.getElementById("googleStatus")?.classList.contains("ok") ? 1 : 0);
  el.hidden = n === 0;
  el.textContent = n + " connected";
}

async function trelloDisconnect(){
  const ok = await uiConfirm("Imported tasks stay in ARISE, but they'll stop updating.",
    { title:"Disconnect Trello?", okLabel:"Disconnect" });
  if(!ok) return;
  state.integrations.trello = { key:"", token:"", boards:[], lastSync:null, onlyMine:true, autoSync:true, memberId:null, memberName:null };
  if(trelloTimer){ clearInterval(trelloTimer); trelloTimer = null; }
  save();
  document.getElementById("trelloKey").value = "";
  document.getElementById("trelloToken").value = "";
  document.getElementById("trelloBoards").innerHTML = "";
  renderTrelloState();
  syncMsg("Disconnected. Your imported tasks are still here.", "ok");
}


/* ============ BACKUP & RESTORE ============ */
// File I/O runs through Rust commands rather than JS plugin globals, which
// aren't exposed without a bundler.
const BACKUP_KEEP = 7;

// The global's shape varies by Tauri version/bundling, so probe for whichever
// invoke is actually present rather than assuming one path.
function getInvoke(){
  const T = window.__TAURI__;
  if(T && T.core && typeof T.core.invoke === "function") return T.core.invoke.bind(T.core);
  if(T && typeof T.invoke === "function") return T.invoke.bind(T);
  const I = window.__TAURI_INTERNALS__;
  if(I && typeof I.invoke === "function") return I.invoke.bind(I);
  return null;
}
function tauriInvoke(cmd, args){
  if(["google_status","google_list_events","google_create_event","google_update_event","google_disconnect"].includes(cmd)
    &&(!activeDataUserId||localStorage.getItem(GOOGLE_CALENDAR_OWNER_KEY)!==activeDataUserId)){
    return cmd==="google_status"?Promise.resolve(false):Promise.reject(Error("Connect Google Calendar for this ARISE account first."));
  }
  if(["ai_key_status","ai_plan_tasks","ai_weekly_plan","ai_delete_key"].includes(cmd)
    &&(!activeDataUserId||localStorage.getItem(AI_KEY_OWNER_KEY)!==activeDataUserId)){
    return cmd==="ai_key_status"?Promise.resolve(false):Promise.reject(Error("Connect Nexus AI for this ARISE account first."));
  }
  const inv = getInvoke();
  if(!inv) return Promise.reject(new Error("not-desktop"));
  return inv(cmd, args||{});
}
function isDesktop(){ return !!getInvoke(); }

function queueWidgetSnapshot(){
  if(!window.ARISEWidgetSnapshot||!isDesktop())return;
  clearTimeout(widgetPublishTimer);
  widgetPublishTimer=setTimeout(publishWidgetSnapshot,120);
}
function publishWidgetSnapshot(){
  if(!window.ARISEWidgetSnapshot||!isDesktop())return;
  const now=new Date();
  const signedIn=!!(activeDataUserId&&document.body.classList.contains("auth-ready"));
  const events=(signedIn?eventsForExecution(now):[]).filter(event=>{
    const ref=calendarGateRef(event),project=ref&&findProject(ref.pid),gate=project&&findGate(project,ref.gid);
    return !gate||progressPct(gate)<100;
  });
  const payload=window.ARISEWidgetSnapshot.build({events,customReminders:signedIn?state.customReminders:[],health:signedIn?state.health:null,notifications:signedIn?state.notifications:null},now);
  const snapshot=JSON.stringify(payload);if(snapshot===lastWidgetSnapshot)return;
  tauriInvoke('widget_update',{snapshot}).then(()=>{lastWidgetSnapshot=snapshot;}).catch(()=>{});
}
// Refresh after returning from the background as well as after edits. This
// keeps the widget current across day rollover and iOS foreground launches,
// even when the user only opens ARISE without changing anything.
document.addEventListener('visibilitychange',()=>{if(!document.hidden)queueWidgetSnapshot();});
window.addEventListener('pageshow',queueWidgetSnapshot);

/* ============ NEXUS AI ============ */
function aiTaskSnapshot(focus){
  const projects = state.projects.map(p=>({
    id:p.id, dungeon:p.name,
    gates:(p.tasks||[]).map(g=>({
      id:g.id, title:g.title, urgency:g.urgency, impact:g.impact, effort:g.effort,
      due:g.due||null, priorityScore:+(computeScore(g.urgency,g.impact,g.effort)*dueMultiplier(g.due)).toFixed(2),
      rank:rankFromScore(computeScore(g.urgency,g.impact,g.effort)), progress:progressPct(g),
      quests:(g.children||[]).map(q=>({title:q.title,done:!!q.done}))
    }))
  }));
  return JSON.stringify({today:todayStr(),focus:focus||null,projects,daily:state.daily.quests.map(q=>({title:q.text,done:!!q.done}))});
}
function aiStatus(text, kind){
  const el=document.getElementById("aiStatus");
  if(!el) return;
  el.className="ai-status "+(kind||""); el.textContent=text;
}
async function refreshAIStatus(){
  if(!isDesktop()){ aiStatus("Nexus AI is available in the Mac app for now.",""); return false; }
  try{
    const connected=await tauriInvoke("ai_key_status");
    aiStatus(connected?"Connected securely through macOS Keychain.":"Not connected.",connected?"ok":"");
    return connected;
  }catch(e){ aiStatus("Couldn't check OpenAI connection.","err"); return false; }
}
function openNexusPanel(){
  const drawer=document.getElementById("nexusDrawer"), back=document.getElementById("nexusDrawerBackdrop");
  if(drawer){ drawer.classList.add("show"); drawer.setAttribute("aria-hidden","false"); }
  if(back) back.classList.add("show");
}
function closeNexusPanel(){
  const drawer=document.getElementById("nexusDrawer"), back=document.getElementById("nexusDrawerBackdrop");
  if(drawer){ drawer.classList.remove("show"); drawer.setAttribute("aria-hidden","true"); }
  if(back) back.classList.remove("show");
}
async function runNexusAI(question, focus){
  const answer=document.getElementById("aiAnswer");
  if(!isDesktop()){
    answer.textContent="Nexus AI requires the ARISE desktop app."; return;
  }
  if(!state.projects.length){ answer.textContent="Open at least one dungeon before asking Nexus to plan your work."; return; }
  answer.classList.add("loading"); answer.textContent="Nexus is analyzing your quest log…";
  openNexusPanel();
  systemNexusState('thinking',true);
  try{
    const text=await tauriInvoke("ai_plan_tasks",{context:aiTaskSnapshot(focus),question});
    answer.textContent=text; answer.classList.remove("loading");
  }catch(e){
    answer.classList.remove("loading");
    const msg=(e&&e.message)||String(e);
    answer.textContent=msg.includes("not connected")
      ? "Connect your OpenAI API key in Settings first."
      : "Nexus couldn't complete the analysis: "+msg;
  }finally{
    systemNexusState('thinking',false);
  }
}
function flattenQuestBrief(nodes, depth){
  depth=depth||0;
  return (nodes||[]).flatMap(q=>[
    `${"  ".repeat(depth)}- [${q.done?"x":" "}] ${q.title}`,
    ...flattenQuestBrief(q.children,depth+1)
  ]);
}
function chatGPTTaskBrief(project, gate){
  const score=(computeScore(gate.urgency,gate.impact,gate.effort)*dueMultiplier(gate.due)).toFixed(2);
  return [
    "I want your help working through this task from my ARISE productivity app.",
    "",
    `Project / dungeon: ${project.name}`,
    `Main task / gate: ${gate.title}`,
    `Due date: ${gate.due||"Not set"}`,
    `Priority: ${rankFromScore(computeScore(gate.urgency,gate.impact,gate.effort))} rank (score ${score})`,
    `Urgency: ${gate.urgency}/5 · Impact: ${gate.impact}/5 · Effort: ${gate.effort}/5`,
    `Progress: ${progressPct(gate)}%`,
    "",
    "Current subtasks:",
    ...(gate.children&&gate.children.length?flattenQuestBrief(gate.children):["- None yet"]),
    "",
    "Please help me clarify the outcome, identify anything missing, and create the best practical execution plan. Start by asking only the most important questions you need, then work with me step by step rather than giving generic advice."
  ].join("\n");
}
async function copyText(text){
  if(navigator.clipboard&&navigator.clipboard.writeText){ await navigator.clipboard.writeText(text); return; }
  const area=document.createElement("textarea"); area.value=text; area.style.position="fixed"; area.style.opacity="0";
  document.body.appendChild(area); area.select(); document.execCommand("copy"); area.remove();
}
async function handoffToChatGPT(pid,gid){
  const p=findProject(pid), g=p&&findGate(p,gid); if(!g) return;
  try{
    await copyText(chatGPTTaskBrief(p,g));
    await tauriInvoke("open_chatgpt");
    toast("Task brief copied — press ⌘V in ChatGPT","xp");
  }catch(e){
    toast("Couldn't open ChatGPT: "+((e&&e.message)||String(e)),"danger");
  }
}

async function backupPayload(){
  const {pomodoro, ...rest} = state;
  const {timerHandle, ...pomoSafe} = pomodoro;
  return JSON.stringify({
    _app:"ARISE", _version:2, _exportedAt:new Date().toISOString(),
    memoryImages:await window.ARISEAchievements.exportImages([...(state.achievements||[]),...(state.goals||[])]),
    data:{...rest, pomodoro:pomoSafe}
  }, null, 2);
}
function dailyName(){
  const d=new Date(), p=n=>String(n).padStart(2,"0");
  return `arise-${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}.json`;
}
function exportName(){
  const d=new Date(), p=n=>String(n).padStart(2,"0");
  return `arise-export-${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

function dataMsg(text, kind){
  const el=document.getElementById("dataStatus");
  if(!el) return;
  el.className="sync-status "+(kind||"");
  el.textContent=text;
}

async function exportBackup(){
  try{
    const json = await backupPayload();
    if(isDesktop()){
      const path = await tauriInvoke("save_backup", { json, name: exportName() });
      dataMsg("Saved to "+path, "ok");
      await refreshBackupList();
    } else {
      const a=document.createElement("a");
      a.href=URL.createObjectURL(new Blob([json],{type:"application/json"}));
      a.download=exportName(); a.click();
      URL.revokeObjectURL(a.href);
      dataMsg("Backup downloaded.", "ok");
    }
    return true;
  }catch(e){ dataMsg("Export failed: "+e.message, "err");return false; }
}

async function applyRestore(parsed){
  const incoming = parsed && parsed.data ? parsed.data : parsed;
  if(!incoming || typeof incoming!=="object" || !Array.isArray(incoming.projects)){
    throw new Error("That doesn't look like an ARISE backup.");
  }
  const gates = incoming.projects.reduce((n,p)=>n+((p.tasks||[]).length),0);
  const ok = await uiConfirm(
    `This replaces everything currently in ARISE with ${incoming.projects.length} dungeon(s) and ${gates} gate(s). You can undo with Cmd+Z.`,
    { title:"Restore this backup?", okLabel:"Restore" });
  if(!ok) return false;
  const incomingWins=Array.isArray(incoming.achievements)?incoming.achievements:[],incomingGoals=Array.isArray(incoming.goals)?incoming.goals:[];
  const restoredRecords=await window.ARISEAchievements.importImages(parsed.memoryImages||[],[...incomingWins,...incomingGoals]);
  pushUndo("that restore");
  const d=defaultState();
  state = Object.assign(d, incoming, {
    goals:restoredRecords.slice(incomingWins.length),
    achievements:restoredRecords.slice(0,incomingWins.length),
    calendar:Object.assign(d.calendar,incoming.calendar),
    player: Object.assign(d.player, incoming.player),
    daily: Object.assign(d.daily, incoming.daily),
    pomodoro: Object.assign(d.pomodoro, incoming.pomodoro, {running:false, timerHandle:null}),
    voice: Object.assign(d.voice, incoming.voice),
    integrations: Object.assign(d.integrations, incoming.integrations),
  });
  selectedDungeonId = null;
  save(); renderAll(); applyTheme();
  return true;
}

async function restoreSelected(){
  const sel=document.getElementById("backupPick");
  try{
    if(isDesktop()){
      const name = sel && sel.value;
      if(!name){ dataMsg("No backup selected.", "err"); return; }
      const text = await tauriInvoke("read_backup", { name });
      if(await applyRestore(JSON.parse(text))){ dataMsg("Restored from "+name, "ok"); toast("Backup restored","gold"); }
      else dataMsg("Restore cancelled.");
    } else {
      const text = await new Promise((res,rej)=>{
        const inp=document.createElement("input");
        inp.type="file"; inp.accept=".json,application/json";
        inp.onchange=()=>{ const f=inp.files[0]; if(!f) return rej(new Error("No file chosen"));
          const rd=new FileReader(); rd.onload=()=>res(rd.result); rd.onerror=()=>rej(new Error("Couldn't read file")); rd.readAsText(f); };
        inp.click();
      });
      if(await applyRestore(JSON.parse(text))){ dataMsg("Restored.", "ok"); toast("Backup restored","gold"); }
      else dataMsg("Restore cancelled.");
    }
  }catch(e){ dataMsg("Restore failed: "+e.message, "err"); }
}

async function refreshBackupList(){
  const sel=document.getElementById("backupPick");
  const info=document.getElementById("backupInfo");
  if(!sel) return;
  if(!isDesktop()){
    sel.style.display="none";
    if(info) info.textContent="Auto-backup runs in the desktop app. Here you can export/import a file.";
    return;
  }
  try{
    const files = await tauriInvoke("list_backups");
    const folder = await tauriInvoke("backup_folder");
    sel.style.display = files.length ? "" : "none";
    sel.innerHTML = files.slice().reverse().map(f=>`<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("");
    if(info) info.textContent = files.length
      ? `${files.length} backup${files.length!==1?"s":""} in ${folder} · a new one is saved automatically once a day.`
      : `Backups will be saved to ${folder}, once a day.`;
  }catch(e){
    if(info) info.textContent="Couldn't read the backup folder: "+e.message;
  }
}

async function autoBackup(){
  if(!isDesktop()) return;
  const today = todayStr();
  if(state.lastAutoBackup === today) return;
  try{
    await tauriInvoke("save_backup", { json: await backupPayload(), name: dailyName() });
    state.lastAutoBackup = today;
    save();
    refreshBackupList();
  }catch(e){
    if(e && e.message!=="not-desktop"){
      dataMsg("Auto-backup failed: "+(e.message||e), "err");
      if(!state.backupWarned){ state.backupWarned = true; save(); toast("Auto-backup failed — see ⟳ panel","danger"); }
    }
  }
}

/* ============ EVENT WIRING ============ */
document.addEventListener("click", async (e)=>{
  const t = e.target;
  const settingsTab = t.closest && t.closest("[data-settings-tab]");
  if(settingsTab){ showSettingsTab(settingsTab.dataset.settingsTab, { detail:true }); return; }
  if(t.closest && t.closest("#settingsBack")){ document.querySelector("#modalSync .settings")?.classList.remove("st-detail"); return; }
  if(t.closest('#themeToggle')){toggleTheme();return;}
  if(Date.now()<calendarSuppressClickUntil&&(t.closest("[data-cal-event]")||t.closest("[data-drag-gate]")))return;

  const navBtn = t.closest(".nav-btn");
  if(navBtn){ setView(navBtn.dataset.view); if(navBtn.dataset.view==="calendar"){calendarAutoScrollPending=true;scrollCalendarToNow();syncGoogleCalendar(true)} return; }

  if(t.id==="confirmYes"){ settleConfirm(true); return; }
  if(t.id==="confirmNo"){ settleConfirm(false); return; }

  if(t.dataset.close!==undefined || t.classList.contains("overlay")){
    if(confirmResolver && (t.id==="modalConfirm" || t.closest("#modalConfirm"))){ settleConfirm(false); return; }
    document.querySelectorAll(".overlay.show").forEach(o=>{ if(o.id!=="modalConfirm") closeModal(o.id,t.hasAttribute('data-discard-gate')); });
    if(confirmResolver) settleConfirm(false);
    return;
  }

  const delDungeonEarly = t.closest("[data-del-dungeon]");
  if(delDungeonEarly){ deleteProject(delDungeonEarly.dataset.delDungeon); return; }

  const addGateBtnEarly = t.closest("[data-add-gate]");
  if(addGateBtnEarly){
    pendingGateProjectId = addGateBtnEarly.dataset.addGate;
    editingGate = null;
    document.getElementById("gateModalTitle").textContent = "New Gate";
    document.getElementById("btnSaveGate").textContent = "Add Gate";
    document.getElementById("gateTitle").value = "";
    document.getElementById("gateDue").value = "";
    document.getElementById("gUrgency").value = 3;
    document.getElementById("gImpact").value = 3;
    document.getElementById("gEffort").value = 3;
    updateGatePreview();
    openModal("modalGate");
    return;
  }

  const selectDungeon = t.closest("[data-select-dungeon]");
  if(selectDungeon){
    selectedDungeonId = selectDungeon.dataset.selectDungeon;
    renderPortal(); renderAllTasks();
    systemProjectOpened(selectedDungeonId);
    return;
  }

  if(t.id==="btnAddDungeon"){ openModal("modalDungeon"); return; }
  if(t.id==="btnSaveDungeon"){
    const name = document.getElementById("dungeonName").value.trim();
    if(!name){ return; }
    const emoji = document.getElementById("dungeonEmoji").value;
    addProject(name, emoji);
    document.getElementById("dungeonName").value = "";
    closeModal("modalDungeon");
    selectedDungeonId = state.projects[state.projects.length-1].id;
    renderPortal(); renderAllTasks();
    return;
  }

  if(t.id==="btnSaveGate"){
    if(t.disabled)return;
    const beforeProjects=JSON.parse(JSON.stringify(state.projects)),beforeUndo=undoStack.slice();t.disabled=true;
    try{
    const title = document.getElementById("gateTitle").value.trim();
    if(!title || !pendingGateProjectId){const status=document.getElementById('gateEditorStatus');if(status)status.textContent='Give this task a title before saving.';document.getElementById('gateTitle').focus();return;}
    const u = +document.getElementById("gUrgency").value;
    const i = +document.getElementById("gImpact").value;
    const ef = +document.getElementById("gEffort").value;
    const due = document.getElementById("gateDue").value || null;
    if(editingGate){
      const proj = findProject(editingGate.pid);
      const g = proj && findGate(proj, editingGate.gid);
      if(!g)throw Error('This gate is no longer available.');
      if(g){
        pushUndo("that gate edit");
        g.title = title; g.urgency = u; g.impact = i; g.effort = ef; g.due = due;
        save();
      }
      selectedDungeonId = pendingGateProjectId;
      closeModal("modalGate",true);
      editingGate = null;
      renderPortal(); renderAllTasks();
      toast("Gate updated", "xp");
      return;
    }
    addGate(pendingGateProjectId, title, u, i, ef, due);
    selectedDungeonId = pendingGateProjectId;
    closeModal("modalGate",true);
    renderPortal(); renderAllTasks();
    return;
    }catch(error){state.projects=beforeProjects;undoStack.splice(0,undoStack.length,...beforeUndo);const status=document.getElementById('gateEditorStatus');if(status)status.textContent='Could not save. Your changes remain in the editor; please try again.';}
    finally{t.disabled=false;}
  }

  const editDungeonBtn = t.closest("[data-edit-dungeon]");
  if(editDungeonBtn){
    const pid = editDungeonBtn.dataset.editDungeon;
    const p = findProject(pid);
    const el = document.querySelector(`.detail-panel[data-pid="${pid}"] .dungeon-name`);
    if(p && el){
      inlineEdit(el, p.name, val=>{
        pushUndo("that rename");
        p.name = val; save(); renderPortal(); renderAllTasks();
      });
    }
    return;
  }

  const editGateBtn = t.closest("[data-edit-gate]");
  if(editGateBtn){
    const [pid,gid] = editGateBtn.dataset.editGate.split(":");
    openGateEditor(pid,gid);
    return;
  }

  const delGate = t.closest("[data-del-gate]");
  if(delGate){
    const [pid,gid] = delGate.dataset.delGate.split(":");
    deleteGate(pid,gid);
    return;
  }

  const markGate = t.closest("[data-mark-gate]");
  if(markGate){
    const [pid,gid] = markGate.dataset.markGate.split(":");
    markGateCleared(pid,gid,markGate);
    return;
  }

  const addSub = t.closest("[data-add-sub]");
  if(addSub){
    const [pid,gid] = addSub.dataset.addSub.split(":");
    const input = document.querySelector(`[data-new-sub="${pid}:${gid}"]`);
    const text = input.value.trim();
    if(!text) return;
    addSubtask(pid,gid,text);
    return;
  }

  const toggleSub = t.closest("[data-toggle-sub]");
  if(toggleSub){
    const [pid,gid,nid] = toggleSub.dataset.toggleSub.split(":");
    toggleSubtask(pid,gid,nid,toggleSub);
    return;
  }

  const editSub = t.closest("[data-edit-sub]");
  if(editSub){
    const [pid,gid,nid] = editSub.dataset.editSub.split(":");
    startQuestRename(pid,gid,nid);
    return;
  }

  const delSub = t.closest("[data-del-sub]");
  if(delSub){
    const [pid,gid,nid] = delSub.dataset.delSub.split(":");
    deleteSubtask(pid,gid,nid);
    return;
  }

  if(t.id==="btnAddDaily"){
    const input = document.getElementById("dailyInput");
    const text = input.value.trim();
    if(!text) return;
    addDailyQuest(text);
    input.value = "";
    return;
  }

  const toggleDaily = t.closest("[data-toggle-daily]");
  if(toggleDaily){ toggleDailyQuest(toggleDaily.dataset.toggleDaily); return; }

  const delDaily = t.closest("[data-del-daily]");
  if(delDaily){ deleteDailyQuest(delDaily.dataset.delDaily); return; }

  if(t.id==="btnAckPenalty"){
    state.daily.penaltyPending = false;
    save(); renderDaily();
    return;
  }

  if(t.id==="btnTimerToggle"){ pomoToggle(); return; }
  if(t.id==="btnTimerReset"){ pomoReset(); return; }
  if(t.id==="btnTimerSkip"){ pomoSkip(); return; }

  if(t.id==="btnRestDone"){
    const p = state.pomodoro;
    if(p.currentRest && !p.currentRest.done){
      p.currentRest.done = true;
      awardXP(p.currentRest.xp, "Rest quest");
      save(); renderFocus();
    }
    return;
  }

  const tgToggle = t.closest("[data-tg-toggle]");
  if(tgToggle){
    const id = tgToggle.dataset.tgToggle;
    if(allOpen.has(id)) allOpen.delete(id); else allOpen.add(id);
    renderAllTasks();
    return;
  }
  const gotoD = t.closest("[data-goto-dungeon]");
  if(gotoD){
    selectedDungeonId = gotoD.dataset.gotoDungeon;
    setView("quests");
    renderPortal();
    systemProjectOpened(selectedDungeonId);
    return;
  }
  const aiGate = t.closest("[data-ai-gate]");
  if(aiGate){
    const [pid,gid]=aiGate.dataset.aiGate.split(":");
    const p=findProject(pid), g=p&&findGate(p,gid);
    if(g) runNexusAI(`Help me complete the gate "${g.title}". Break it into small concrete next actions and tell me exactly what to do first.`,{dungeon:p.name,gate:g.title});
    return;
  }
  const chatGPTGate = t.closest("[data-chatgpt-gate]");
  if(chatGPTGate){
    const [pid,gid]=chatGPTGate.dataset.chatgptGate.split(":");
    await handoffToChatGPT(pid,gid); return;
  }
  const chip = t.closest("#allStatusChips .chip");
  if(chip){
    allFilters.status = chip.dataset.status;
    document.querySelectorAll("#allStatusChips .chip").forEach(c=>c.classList.toggle("active", c===chip));
    renderAllTasks();
    return;
  }

  if(t.closest('#syncToggle')){ openSettings(); return; }
  if(t.id==="googleConnect"){
    const clientId=document.getElementById("googleClientId").value.trim(),clientSecret=document.getElementById("googleClientSecret").value.trim();
    if(!clientId||!clientSecret){googleStatusMsg("Enter both OAuth fields.","err");return}googleStatusMsg("Complete Google sign-in in your browser…");t.disabled=true;
    try{
      if(localStorage.getItem(GOOGLE_CALENDAR_OWNER_KEY)!==activeDataUserId){
        const ok=await uiConfirm("Connecting Google Calendar here replaces the Calendar connection for any other ARISE account on this Mac. Their ARISE data stays separate.",{title:"Connect Calendar for this account?",okLabel:"Connect Calendar"});
        if(!ok){t.disabled=false;return}
      }
      await tauriInvoke("google_connect",{clientId,clientSecret});localStorage.setItem(GOOGLE_CALENDAR_OWNER_KEY,activeDataUserId);document.getElementById("googleClientSecret").value="";googleStatusMsg("Google Calendar connected.","ok");await syncGoogleCalendar(true)
    }catch(e){googleStatusMsg("Connection failed: "+((e&&e.message)||String(e)),"err")}t.disabled=false;return;
  }
  if(t.id==="googleConnectWeb"){
    const g=googleWebClient();if(!g)return;
    const pending=g.connect(); // first thing in the tap, so the browser allows Google's popup
    t.disabled=true;googleStatusMsg("Waiting for Google…","");
    try{await pending;googleStatusMsg("Connected","ok");renderGoogleWebCard();await syncGoogleCalendar(true);toast("Google Calendar connected","xp")}
    catch(err){googleStatusMsg((err&&err.message)||String(err),"err")}
    t.disabled=false;return;
  }
  if(t.id==="googleSyncWeb"){await syncGoogleCalendar(false);return}
  if(t.id==="googleDisconnectWeb"){
    const g=googleWebClient();if(!g)return;
    const ok=await uiConfirm("ARISE will stop showing your Google events. Nothing in your Google Calendar is changed.",{title:"Disconnect Google Calendar?",okLabel:"Disconnect"});
    if(!ok)return;
    g.disconnect();state.calendar.events=[];save();renderCalendar();googleStatusMsg("Not connected","");renderGoogleWebCard();return;
  }
  if(t.id==="googleDisconnect"){
    if(localStorage.getItem(GOOGLE_CALENDAR_OWNER_KEY)!==activeDataUserId){googleStatusMsg("No Google Calendar is connected to this ARISE account.");return}
    await tauriInvoke("google_disconnect");localStorage.removeItem(GOOGLE_CALENDAR_OWNER_KEY);state.calendar.events=[];save();renderCalendar();googleStatusMsg("Disconnected.");return
  }
  const googleSignInButton=t.closest("#cloudGoogleSignIn");
  if(googleSignInButton){
    googleSignInButton.disabled=true;authMsg("Opening Google sign-in…");
    try{
      if(isDesktop()){
        const {challenge}=await cloudSync.googleAuthorizationUrl("http://127.0.0.1");
        const code=await tauriInvoke("cloud_google_auth",{challenge,supabaseUrl:cloudSync.status().url});
        const previousId=cloudSync.status().userId;
        await cloudSync.completeGoogleSignIn(code);await finishSignIn(previousId);
      }else{
        const current=window.location;
        if(current.protocol!=="https:"&&!(["localhost","127.0.0.1"].includes(current.hostname)))throw Error("Google sign-in needs the live HTTPS app or localhost.");
        const redirect=current.origin+current.pathname;
        const {url}=await cloudSync.googleAuthorizationUrl(redirect);
        current.assign(url);
      }
    }catch(error){showAuth("entry");authMsg(error.message,"err")}finally{googleSignInButton.disabled=false}
    return;
  }
  if(t.id==="cloudCreate"){
    const email=document.getElementById("cloudEmail").value.trim(),password=document.getElementById("cloudPassword").value;if(!email||password.length<8){authMsg("Enter your email and a password of at least 8 characters.","err");return}t.disabled=true;authMsg("Creating your account…");try{const previousId=cloudSync.status().userId,result=await cloudSync.signUp(email,password);document.getElementById("cloudPassword").value="";if(result.access_token)await finishSignIn(previousId);else authMsg("Check your email to confirm the account, then sign in.","ok")}catch(error){showAuth("entry");authMsg(error.message,"err")}t.disabled=false;return;
  }
  if(t.id==="cloudResend"){
    const email=document.getElementById("cloudEmail").value.trim();if(!email){authMsg("Enter the email you used for ARISE first.","err");return}t.disabled=true;authMsg("Sending a new confirmation email…");try{await cloudSync.resendConfirmation(email);authMsg("Confirmation sent. Check your inbox and spam folder.","ok")}catch(error){authMsg(error.message,"err")}t.disabled=false;return;
  }
  if(t.id==="cloudDataEnable"){
    if(!activeDataUserId||cloudSync.status().userId!==activeDataUserId)return;
    const ok=await uiConfirm("ARISE will sync this account’s projects, tasks, local calendar plans, goals, progress and health reminders to Supabase. API keys, passwords and device settings stay here. A local backup is saved first.",{title:"Turn on cloud sync?",okLabel:"Turn on sync"});
    if(!ok)return;
    t.disabled=true;
    try{
      await backupCloudCopies(window.ARISECloudData.copyForCloud(state),null);
      localStorage.setItem(CLOUD_ENABLED_PREFIX+activeDataUserId,"1");
      renderCloudSettings();await startAccountDataSync();
    }catch(error){cloudDataMsg("Could not enable sync: "+error.message,"err")}
    finally{t.disabled=false}
    return;
  }
  if(t.id==="cloudDataDisable"){
    cloudDataController?.stop();cloudDataController=null;
    localStorage.setItem(CLOUD_ENABLED_PREFIX+activeDataUserId,"0");
    showCloudConflict(null);renderCloudSettings();return;
  }
  if(t.id==="cloudDataNow"){
    t.disabled=true;try{await startAccountDataSync()}finally{t.disabled=false}return;
  }
  if(t.id==="cloudDataUseDevice"||t.id==="cloudDataUseCloud"){
    const choice=t.id==="cloudDataUseDevice"?"device":"cloud";
    const ok=await uiConfirm(choice==="device"?"Use this device’s complete copy for this account? The current cloud copy will be backed up before it is replaced.":"Use the complete Supabase copy for this account? Your current device copy will be backed up before it is replaced.",{title:"Resolve sync copies?",okLabel:choice==="device"?"Use this device":"Use Supabase"});
    if(!ok)return;
    t.disabled=true;try{await cloudDataController?.choose(choice)}catch(error){cloudDataMsg(error.message,"err")}finally{t.disabled=false}return;
  }
  if(t.id==="cloudSignOut"||t.id==="authBackToSignIn"){
    cloudSync.signOut();
    localStorage.setItem("arise.cloud.enabled.v1","0");
    if(t.id==="cloudSignOut"){closeModal("modalSync");stopWakeListening();healthUI?.stop?.();notificationsUI?.stop?.();if(trelloTimer){clearInterval(trelloTimer);trelloTimer=null}}
    showAuth("entry");clearCloudAccount();renderCloudSettings();authMsg(t.id==="cloudSignOut"?"Signed out. Your account data remains private on this device.":"");return;
  }
  if(t.id==="authRetry"){
    t.disabled=true;showAuth("checking");authMsg("Checking your account…");
    try{if(await cloudSync.restoreSession()){
      activateCloudAccount(cloudSync.status().userId);
      await finishSignIn(cloudSync.status().userId);
    }else showAuth("entry")}
    catch(error){showAuth("offline");authMsg(error.message,"err")}finally{t.disabled=false}return;
  }
  if(t.id==="authContinueOffline"){
    if(cloudSync.status().signedIn&&activeDataUserId===cloudSync.status().userId){unlockApp();cloudStatusMsg("Working from this account’s device copy while offline.","ok")}
    return;
  }
  if(t.id==="calPrev"){const step=state.calendar.view==="focus"?1:7;calendarCursor.setDate(calendarCursor.getDate()-step);if(state.calendar.view==="focus")calendarSelectedDate=todayStr(calendarCursor);renderCalendar();syncGoogleCalendar(true);return}
  if(t.id==="calNext"){const step=state.calendar.view==="focus"?1:7;calendarCursor.setDate(calendarCursor.getDate()+step);if(state.calendar.view==="focus")calendarSelectedDate=todayStr(calendarCursor);renderCalendar();syncGoogleCalendar(true);return}
  if(t.id==="calToday"){calendarCursor=new Date();calendarSelectedDate=todayStr();calendarAutoScrollPending=true;renderCalendar();scrollCalendarToNow();syncGoogleCalendar(true);return}
  if(t.id==="calSync"){await syncGoogleCalendar(false);return}
  if(t.id==="calAdd"){openCalendarEvent();return}
  if(t.id==="calEventMeet"){document.getElementById("calMeetingFields").hidden=!t.checked;return}
  const recentGuest=t.closest("[data-add-guest]");if(recentGuest){const input=document.getElementById("calEventGuests"),emails=parseGuestEmails(input.value);if(!emails.includes(recentGuest.dataset.addGuest))emails.push(recentGuest.dataset.addGuest);input.value=emails.join(", ");renderRecentGuests();return}
  if(t.id==="calShareCopy"||t.id==="calShareGoogle"){
    const event=allCalendarEvents().find(item=>item.id===document.getElementById("calEventId").value);if(!event)return;
    try{const share=calendarShareData(event);if(t.id==="calShareCopy"){await copyText(share.text);toast("Invite copied — ready to paste","xp")}else{const opened=await openExternal(share.addUrl);if(!opened)throw new Error("No browser was available.")}}catch(error){toast("Couldn't share: "+((error&&error.message)||String(error)),"danger")}return;
  }
  if(t.id==="calDrawerClose"||t.id==="calendarDetailBackdrop"){closeCalendarDrawer();return}
  if(t.id==="calBacklogOpen"){state.calendar.backlogOpen=true;save();renderBacklog();return}
  if(t.id==="calBacklogToggle"||t.id==="calBacklogBackdrop"){state.calendar.backlogOpen=false;save();renderBacklog();return}
  if(t.id==="calRoutineToggle"){state.calendar.routineEnabled=state.calendar.routineEnabled===false;save();renderCalendar();toast(state.calendar.routineEnabled?"Weekly rhythm restored":"Weekly rhythm hidden",state.calendar.routineEnabled?"xp":"gold");return}
  if(t.id==="calCapacityEdit"){renderCapacity(true);return}
  const viewBtn=t.closest("[data-cal-view]");if(viewBtn){state.calendar.view=viewBtn.dataset.calView;save();renderCalendar();if(state.calendar.view!=="overview")scrollCalendarToNow();return}
  const datePill=t.closest("[data-cal-date-pill]");if(datePill){calendarSelectedDate=datePill.dataset.calDate;calendarCursor=new Date(calendarSelectedDate+"T12:00:00");renderCalendar();scrollCalendarToNow();return}
  const calEvent=t.closest("[data-cal-event]");if(calEvent){const ev=allCalendarEvents().find(x=>x.id===calEvent.dataset.calEvent);if(ev){const st=calEventStart(ev),en=calEventEnd(ev);openCalendarEvent({id:ev.id,source:ev._routine?"routine":ev._local?"local":"google",title:ev.summary,date:todayStr(st),start:String(st.getHours()).padStart(2,"0")+":"+String(st.getMinutes()).padStart(2,"0"),end:String(en.getHours()).padStart(2,"0")+":"+String(en.getMinutes()).padStart(2,"0"),gate:(calendarGateRef(ev)||{}).pid?calendarGateRef(ev).pid+":"+calendarGateRef(ev).gid:""})}return}
  const calCanvas=t.closest(".cal-time-canvas");if(calCanvas){const day=t.closest("[data-cal-date]"),time=dragPlacement(t.closest(".cal-day-body"),e.clientY),[hh,mm]=time.split(":").map(Number),endM=hh*60+mm+60;calendarSelectedDate=day.dataset.calDate;openCalendarEvent({date:calendarSelectedDate,start:time,end:`${String(Math.floor(endM/60)).padStart(2,"0")}:${String(endM%60).padStart(2,"0")}`});return}
  const calDay=t.closest("[data-cal-date]");if(calDay){calendarSelectedDate=calDay.dataset.calDate;renderCalendar();return}
  const editCalGate=t.closest("[data-edit-cal-gate]");if(editCalGate){const [pid,gid]=editCalGate.dataset.editCalGate.split(":");openGateEditor(pid,gid);return}
  if(t.id==="calProtect"){state.calendar.protectDaily=!state.calendar.protectDaily;save();if(state.calendar.protectDaily){try{await ensureProtectedGoals();toast("Daily goals protected","gold")}catch(e){toast("Connect Google Calendar first","danger")}}renderCalendar();return}
  const calGate=t.closest("[data-cal-gate]");if(calGate){const [pid,gid]=calGate.dataset.calGate.split(":"),p=findProject(pid),g=p&&findGate(p,gid);if(g){const duration=g.durationMin||30+(+g.effort||3)*15,start="09:00",total=9*60+duration;openCalendarEvent({title:g.title,date:g.due||calendarSelectedDate||todayStr(),start,end:`${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`,gate:`${pid}:${gid}`})}return}
  if(t.id==="calEventSave"){
    const title=document.getElementById("calEventTitle").value.trim(),date=document.getElementById("calEventDate").value,start=document.getElementById("calEventStart").value,end=document.getElementById("calEventEnd").value,rem=document.getElementById("calEventReminder").value,gateRef=document.getElementById("calEventGate").value,eventId=document.getElementById("calEventId").value,repeat=document.getElementById("calEventRepeat").value;
    const addMeet=document.getElementById("calEventMeet").checked,guests=parseGuestEmails(document.getElementById("calEventGuests").value),invalid=guests.filter(email=>!validGuestEmail(email)),guestError=document.getElementById("calGuestError");
    if(eventId&&(addMeet||guests.length)&&document.getElementById("calEventSource").value!=="google"){toast("Google Meet and guest invitations need a Google Calendar event.","danger");return}
    guestError.textContent=invalid.length?`Check ${invalid.join(", ")}`:"";if(!title||!date||!start||!end||invalid.length)return;t.disabled=true;try{if(eventId){const old=allCalendarEvents().find(e=>e.id===eventId),before=JSON.parse(JSON.stringify(editableEventPayload(old))),routineItem=old._routine&&findRoutine(old._routineKey),routineBefore=routineItem&&JSON.parse(JSON.stringify(routineItem)),s=new Date(`${date}T${start}:00`),en=new Date(`${date}T${end}:00`);if(en<=s)throw new Error("End time must be after start time.");const payload={...editableEventPayload(old),summary:title,description:(old&&old.description)||"",start:{...old.start,dateTime:s.toISOString()},end:{...old.end,dateTime:en.toISOString()},reminders:{useDefault:false,overrides:[{method:"popup",minutes:+rem}]},attendees:guests.map(email=>({email}))};if(addMeet&&!googleMeetLink(old))payload.conferenceData={createRequest:{requestId:uid("meet"),conferenceSolutionKey:{type:"hangoutsMeet"}}};let undoLocal;if(old._routine)updateRoutine(routineItem,title,date,start,end);else if(old._local)undoLocal=updateLocalOccurrence(old,payload);else{const updated=await googleCall("google_update_event",{eventId,event:payload});Object.assign(old,updated)}rememberGuestEmails(guests);save();closeCalendarDrawer();renderCalendar();toastCalendarUndo("Schedule updated",async()=>{if(old._routine)Object.assign(routineItem,routineBefore);else if(old._local)undoLocal();else Object.assign(old,await googleCall("google_update_event",{eventId,event:before}))})}else{pushUndo("adding that calendar item");const description=gateRef?`[ARISE_GATE:${gateRef}]`:"Created by ARISE",localTomorrow=document.getElementById("calEventSource").value==="tomorrow",made=localTomorrow?createLocalCalendarEvent(title,date,start,end,description,rem,repeat):await createCalendarEvent(title,date,start,end,description,rem,repeat,{addMeet,guests});rememberGuestEmails(guests);if(gateRef){const [pid,gid]=gateRef.split(":"),p=findProject(pid),g=p&&findGate(p,gid);if(g){g.calendarEventId=made.id;g.plannedStart=start}}save();closeCalendarDrawer();renderCalendar();if(made._local)toastCalendarUndo("Added to your plan",async()=>{state.calendar.localEvents=state.calendar.localEvents.filter(e=>e.id!==made.id);if(gateRef){const [pid,gid]=gateRef.split(":"),p=findProject(pid),g=p&&findGate(p,gid);if(g)g.calendarEventId=null}});else toast(addMeet?"Meet created and shown in ARISE":"Added to Google Calendar","xp")}}catch(err){toast(((err&&err.message)||String(err)),"danger")}t.disabled=false;return;
  }
  if(t.id==="calDeleteSeries"){
    const occurrence=allCalendarEvents().find(e=>e.id===document.getElementById("calEventId").value);
    if(!occurrence?._seriesId)return;
    const index=state.calendar.localEvents.findIndex(e=>e.id===occurrence._seriesId);if(index<0)return;
    const series=state.calendar.localEvents[index];
    const ref=calendarGateRef(series),project=ref&&findProject(ref.pid),gate=project&&findGate(project,ref.gid),oldLink=gate?.calendarEventId;
    if(gate)gate.calendarEventId=null;
    state.calendar.localEvents.splice(index,1);save();closeCalendarDrawer();renderCalendar();
    toastCalendarUndo("Daily series removed",async()=>{state.calendar.localEvents.splice(index,0,series);if(gate)gate.calendarEventId=oldLink;});return;
  }
  if(t.id==="calEventDelete"){
    const id=document.getElementById("calEventId").value,ev=allCalendarEvents().find(x=>x.id===id);if(!ev)return;
    if(ev._seriesId){const undo=updateLocalOccurrence(ev,{cancelled:true});save();closeCalendarDrawer();renderCalendar();toastCalendarUndo("Occurrence removed",undo);return}
    if(ev._routine){const index=state.calendar.routineTemplate.findIndex(x=>x.key===ev._routineKey),copy=JSON.parse(JSON.stringify(state.calendar.routineTemplate[index]));state.calendar.routineTemplate.splice(index,1);save();closeCalendarDrawer();renderCalendar();toastCalendarUndo("Routine removed",async()=>state.calendar.routineTemplate.splice(Math.max(0,index),0,copy));return}
    if(!ev._local){toast("Remove connected events in Google Calendar; ARISE will sync the change.","danger");return}
    const copy=JSON.parse(JSON.stringify(ev)),index=state.calendar.localEvents.findIndex(x=>x.id===id),ref=calendarGateRef(ev);state.calendar.localEvents.splice(index,1);if(ref){const p=findProject(ref.pid),g=p&&findGate(p,ref.gid);if(g)g.calendarEventId=null}save();closeCalendarDrawer();renderCalendar();toastCalendarUndo("Item removed",async()=>{state.calendar.localEvents.splice(Math.max(0,index),0,copy);if(ref){const p=findProject(ref.pid),g=p&&findGate(p,ref.gid);if(g)g.calendarEventId=copy.id}});return
  }
  if(t.id==="nexusPanelOpen"){ openNexusPanel(); return; }
  if(t.id==="nexusPanelClose" || t.id==="nexusDrawerBackdrop"){ closeNexusPanel(); return; }
  if(t.id==="aiPlanDay"){ runNexusAI("Plan my day. Choose the three most valuable active tasks and give me an achievable order."); return; }
  if(t.id==="aiQuickWin"){ runNexusAI("Find the best meaningful task I can finish or substantially advance in 20 minutes."); return; }
  if(t.id==="aiUnblock"){ runNexusAI("Identify the task most likely to be stuck or unclear and help me unblock it with very small next actions."); return; }
  if(t.id==="aiAsk"){
    const input=document.getElementById("aiQuestion"), q=input.value.trim();
    if(q){ runNexusAI(q); input.value=""; }
    return;
  }
  if(t.id==="aiConnect"){
    const input=document.getElementById("openaiKey"), key=input.value.trim();
    if(!key){ aiStatus("Paste your OpenAI API key first.","err"); return; }
    aiStatus("Saving securely and testing…"); t.disabled=true;
    try{
      if(localStorage.getItem(AI_KEY_OWNER_KEY)!==activeDataUserId){
        const ok=await uiConfirm("Connecting Nexus AI here replaces the API key for any other ARISE account on this Mac. Their ARISE data stays separate.",{title:"Connect Nexus for this account?",okLabel:"Connect Nexus"});
        if(!ok){t.disabled=false;return}
      }
      await tauriInvoke("ai_save_key",{key});localStorage.setItem(AI_KEY_OWNER_KEY,activeDataUserId);input.value="";
      await tauriInvoke("ai_plan_tasks",{context:"{\"projects\":[]}",question:"Reply with exactly: Nexus connected."});
      aiStatus("Connected securely through macOS Keychain.","ok");
    }catch(err){ aiStatus("Connection failed: "+((err&&err.message)||String(err)),"err"); }
    t.disabled=false; return;
  }
  if(t.id==="aiDisconnect"){
    try{ if(localStorage.getItem(AI_KEY_OWNER_KEY)!==activeDataUserId){aiStatus("No Nexus key is connected to this ARISE account.");return}await tauriInvoke("ai_delete_key");localStorage.removeItem(AI_KEY_OWNER_KEY);aiStatus("Disconnected."); }
    catch(err){ aiStatus((err&&err.message)||String(err),"err"); }
    return;
  }
  if(t.id==="btnExportBackup"){ exportBackup(); return; }
  if(t.id==="btnRevealBackups"){
    tauriInvoke("backup_folder").then(p=>openExternal("file://"+encodeURI(p)))
      .catch(()=>dataMsg("Only available in the desktop app.","err"));
    return;
  }
  if(t.id==="btnImportBackup"){ restoreSelected(); return; }
  if(t.id==="trelloKeyLink"){
    e.preventDefault();
    openExternal("https://trello.com/power-ups/admin").then(ok=>{
      if(!ok) syncMsg("Open this in your browser: trello.com/power-ups/admin", "err");
    });
    return;
  }
  if(t.id==="trelloTokenLink"){
    e.preventDefault();
    const key = document.getElementById("trelloKey").value.trim();
    if(!key){ syncMsg("Paste your API key first — the token link is built from it.", "err"); return; }
    openExternal(trelloAuthUrl(key)).then(ok=>{
      if(!ok) syncMsg("Couldn't open the browser. Copy this URL: "+trelloAuthUrl(key), "err");
    });
    return;
  }
  if(t.id==="trelloConnectOneClick"){
    const cfg = trelloCfg();
    if(cfg.token && cfg.key === TRELLO_APP_KEY){
      document.getElementById("trelloKey").value = cfg.key;
      document.getElementById("trelloToken").value = cfg.token;
      trelloLoadBoards();
    } else if(!trelloStartConnect()){
      syncMsg("One-click connect isn't available here. Use your own key below.", "err");
    }
    return;
  }
  if(t.id==="trelloManualToggle"){
    e.preventDefault();
    const manual = document.getElementById("trelloManual");
    setTrelloManualVisible(!!manual && manual.style.display === "none");
    return;
  }
  if(t.id==="trelloConnect"){ trelloLoadBoards(); return; }
  if(t.id==="trelloImport"){
    const ids = Array.from(document.querySelectorAll(".board-cb:checked")).map(c=>c.value);
    trelloImport(ids);
    return;
  }
  if(t.id==="trelloResync"){ trelloImport(trelloCfg().boards||[]); return; }
  if(t.id==="trelloDisconnect"){ trelloDisconnect(); return; }

  if(t.id==="cheatToggle"){ showCheatSheet(); renderVoicePicker(); return; }
  if(t.id==="voiceTest"){
    speak("Ready when you are. What would you like?");
    return;
  }
  if(t.id==="cheatClose"){ showCheatSheet(false); return; }

  if(t.id==="btnLevelupClose"){
    document.getElementById("levelupOverlay").classList.remove("show");
    return;
  }
});

function startQuestRename(pid, gid, nid){
  const project = findProject(pid);
  const gate = project && findGate(project, gid);
  const node = gate && findNode(gate, nid);
  if(!node) return;
  const el = document.querySelector(`[data-rename-sub="${pid}:${gid}:${nid}"]`);
  if(!el) return;
  inlineEdit(el, node.title, val=>{
    pushUndo("that rename");
    node.title = val;
    save(); renderPortal(); renderAllTasks();
  });
}

document.addEventListener("dblclick",(e)=>{
  const r = e.target.closest("[data-rename-sub]");
  if(!r) return;
  const [pid,gid,nid] = r.dataset.renameSub.split(":");
  startQuestRename(pid,gid,nid);
});

document.addEventListener("keydown", (e)=>{
  const gatePanel=document.getElementById('modalGate'),calendarPanel=document.getElementById('calendarDetailDrawer'),panel=gatePanel?.classList.contains('show')?gatePanel:calendarPanel?.classList.contains('show')?calendarPanel:null;
  if(panel&&!confirmResolver){
    if(e.key==='Escape'){e.preventDefault();if(panel===gatePanel)closeModal('modalGate');else closeCalendarDrawer();return;}
    if(e.key==='Tab'){
      const controls=Array.from(panel.querySelectorAll('button:not([disabled]),input:not([type="hidden"]):not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex="0"]')).filter(el=>el.getClientRects().length);
      const first=controls[0],last=controls[controls.length-1];if(first&&last){if(e.shiftKey&&(document.activeElement===first||!panel.contains(document.activeElement))){e.preventDefault();last.focus();}else if(!e.shiftKey&&(document.activeElement===last||!panel.contains(document.activeElement))){e.preventDefault();first.focus();}}
    }
    if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&!e.isComposing){e.preventDefault();document.getElementById(panel===gatePanel?'btnSaveGate':'calEventSave').click();return;}
  }
  const calendarItem=e.target?.closest?.('[data-cal-event][role="button"]');
  if(calendarItem&&(e.key==='Enter'||e.key===' ')&&!e.isComposing){e.preventDefault();calendarItem.click();return;}
  if(e.key==='Escape'){const more=document.getElementById('navMore');if(more?.open){more.open=false;more.querySelector('summary').focus();return;}}
  if(e.key==='Escape'){const hunter=document.getElementById('hunterOverview');if(hunter?.open){hunter.open=false;hunter.querySelector('summary').focus();return;}}
  if(e.key==="Escape"&&calendarPointer){e.preventDefault();clearCalendarDrag();return;}
  if(e.key==="Escape" && document.getElementById("calendarDetailDrawer").classList.contains("show")){ closeCalendarDrawer(); return; }
  if(e.key==="Escape" && document.getElementById("nexusDrawer").classList.contains("show")){ closeNexusPanel(); return; }
  if(e.key==="Enter" && !e.isComposing && document.activeElement && document.activeElement.id==="calQuickInput"){
    e.preventDefault();
    document.getElementById("calQuickForm").requestSubmit();
    return;
  }
  if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==="z"){
    const tag = (document.activeElement && document.activeElement.tagName)||"";
    if(tag!=="INPUT" && tag!=="TEXTAREA"){
      e.preventDefault();
      const label = undoLast();
      toast(label ? `Undone — reversed ${label}` : "Nothing to undo", label?"xp":"danger");
      return;
    }
  }
  if(e.key==="Enter"){
    if(document.activeElement && document.activeElement.id==="dailyInput"){ document.getElementById("btnAddDaily").click(); }
    if(document.activeElement && document.activeElement.matches("[data-new-sub]")){
      const attr = document.activeElement.getAttribute("data-new-sub");
      document.querySelector(`[data-add-sub="${attr}"]`).click();
    }
    if(document.activeElement && document.activeElement.id==="aiQuestion"){ document.getElementById("aiAsk").click(); }
  }
});

let calendarQuickAddSubmitting=false;
async function submitCalendarQuickAdd(){
  if(calendarQuickAddSubmitting)return;
  const input=document.getElementById("calQuickInput"),form=document.getElementById("calQuickForm"),submit=form.querySelector('button[type="submit"]'),parsed=parseQuickCalendar(input.value);
  if(!parsed.title){toast("Add a title to schedule this item","danger");return}
  calendarQuickAddSubmitting=true;submit.disabled=true;
  try{pushUndo("quick-adding that calendar item");const made=await createCalendarEvent(parsed.title,parsed.date,parsed.start,parsed.end,"Created by ARISE · Quick add",15);save();input.value="";calendarSelectedDate=parsed.date;calendarCursor=new Date(parsed.date+"T12:00:00");renderCalendar();if(made._local)toastCalendarUndo(`${parsed.title} · ${parsed.start}`,async()=>{state.calendar.localEvents=state.calendar.localEvents.filter(x=>x.id!==made.id)});else toast(`Scheduled ${parsed.title}`,"xp")}
  catch(err){toast(((err&&err.message)||String(err)),"danger")}
  finally{calendarQuickAddSubmitting=false;submit.disabled=false}
}

document.addEventListener("submit",async e=>{
  if(e.target.id!=="calQuickForm")return;
  e.preventDefault();
  await submitCalendarQuickAdd();
});

function dragPlacement(body,clientY){const r=body.getBoundingClientRect(),canvas=body.querySelector(".cal-time-canvas"),full=canvas?canvas.offsetHeight:1080,y=Math.max(0,Math.min(full-1,clientY-r.top+body.scrollTop)),mins=Math.max(360,Math.min(1425,360+Math.round(y/15)*15));return `${String(Math.floor(mins/60)).padStart(2,"0")}:${String(mins%60).padStart(2,"0")}`}
let calendarPointer=null,calendarHoverDay=null,calendarHoverTime=null,calendarSuppressClickUntil=0,calendarDragFrame=0,calendarLatestPoint=null;
let calendarDragPreview=null,calendarDropPreview=null;
function createCalendarDragPreview(){
  const source=calendarPointer.source;
  calendarDragPreview=document.createElement("div");
  calendarDragPreview.className="cal-drag-preview";
  if(calendarPointer.bounds.width>0)calendarDragPreview.style.width=Math.min(calendarPointer.bounds.width,Math.max(1,window.innerWidth-16))+"px";
  calendarDragPreview.setAttribute("aria-hidden","true");
  const title=document.createElement("div"),time=document.createElement("div");
  title.className="cal-drag-preview-title";time.className="cal-drag-preview-time";
  title.textContent=(source.querySelector(".cal-event-title,.backlog-task-title")||source).textContent.trim();
  time.textContent="Move onto a day to schedule";
  calendarDragPreview.append(title,time);document.body.appendChild(calendarDragPreview);
  calendarDropPreview=document.createElement("div");calendarDropPreview.className="cal-drop-preview";
  calendarDropPreview.setAttribute("aria-hidden","true");
}
function clearCalendarDrag(){
  const pointer=calendarPointer;calendarPointer=null;
  if(calendarDragFrame)cancelAnimationFrame(calendarDragFrame);
  calendarDragFrame=0;calendarLatestPoint=null;
  calendarDragPreview?.remove();calendarDropPreview?.remove();calendarDragPreview=null;calendarDropPreview=null;
  pointer?.source.classList.remove("cal-drag-source");
  if(pointer){try{pointer.source.releasePointerCapture(pointer.pointerId)}catch(_){}}
  calendarHoverDay?.classList.remove("drag-over");
  calendarHoverDay=null;calendarHoverTime=null;calendarDrag=null;
  document.body.classList.remove("cal-dragging");
  document.getElementById("calDragTime").classList.remove("show");
  if(pointer?.moved)calendarSuppressClickUntil=Date.now()+400;
}
function updateCalendarDragVisual(){
  calendarDragFrame=0;if(!calendarPointer||!calendarLatestPoint||!calendarDragPreview)return;
  const {x,y}=calendarLatestPoint;
  const width=calendarDragPreview.offsetWidth,height=calendarDragPreview.offsetHeight;
  calendarDragPreview.style.left=Math.max(8,Math.min(window.innerWidth-width-8,x-calendarPointer.grabX))+"px";
  calendarDragPreview.style.top=Math.max(8,Math.min(window.innerHeight-height-8,y-calendarPointer.grabY))+"px";
  const under=document.elementFromPoint(x,y),day=under?.closest("[data-cal-date]"),body=under?.closest(".cal-day-body");
  if(calendarHoverDay&&calendarHoverDay!==day)calendarHoverDay.classList.remove("drag-over");
  if(!day||!body){
    calendarHoverDay=null;calendarHoverTime=null;calendarDropPreview?.remove();
    calendarDragPreview.classList.add("outside");
    calendarDragPreview.querySelector(".cal-drag-preview-time").textContent="Move onto a day to schedule";
    document.getElementById("calDragTime").textContent="Choose a day";return;
  }
  calendarDragPreview.classList.remove("outside");day.classList.add("drag-over");calendarHoverDay=day;
  const r=body.getBoundingClientRect(),oldScroll=body.scrollTop;
  if(y<r.top+42)body.scrollTop-=10;else if(y>r.bottom-42)body.scrollTop+=10;
  calendarHoverTime=dragPlacement(body,y);
  const indicator=document.getElementById("calDragTime");indicator.textContent=calendarHoverTime;indicator.classList.add("show");
  const date=new Date(day.dataset.calDate+"T12:00:00").toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"});
  calendarDragPreview.querySelector(".cal-drag-preview-time").textContent=date+" · "+calendarHoverTime;
  const canvas=body.querySelector(".cal-time-canvas"),[h,m]=calendarHoverTime.split(":").map(Number),top=h*60+m-360;
  calendarDropPreview.style.top=top+"px";
  calendarDropPreview.style.height=Math.max(14,Math.min(calendarPointer.duration-2,1080-top))+"px";
  canvas.appendChild(calendarDropPreview);
  if(body.scrollTop!==oldScroll)calendarDragFrame=requestAnimationFrame(updateCalendarDragVisual);
}
document.addEventListener("pointerdown",e=>{
  if(calendarPointer||e.button!==0||e.target.closest("button,input,select"))return;
  const ev=e.target.closest("[data-cal-event]"),gate=e.target.closest("[data-drag-gate]");if(!ev&&!gate)return;
  const source=ev||gate,event=ev&&allCalendarEvents().find(item=>item.id===ev.dataset.calEvent);
  if(event&&!event.start?.dateTime)return;
  const bounds=source.getBoundingClientRect();
  calendarPointer={x:e.clientX,y:e.clientY,grabX:e.clientX-bounds.left,grabY:e.clientY-bounds.top,bounds:{width:bounds.width,height:bounds.height},source,moved:false,pointerId:e.pointerId,duration:event?Math.max(15,calendarDuration(event)):60};
  if(ev)calendarDrag={type:"event",id:ev.dataset.calEvent};else{const [pid,gid]=gate.dataset.dragGate.split(":");calendarDrag={type:"gate",pid,gid};}
  try{source.setPointerCapture(e.pointerId)}catch(_){}
});
document.addEventListener("pointermove",e=>{
  if(!calendarPointer||!calendarDrag||e.pointerId!==calendarPointer.pointerId)return;
  if(!calendarPointer.moved&&Math.hypot(e.clientX-calendarPointer.x,e.clientY-calendarPointer.y)<4)return;
  if(!calendarPointer.moved){
    calendarPointer.moved=true;document.body.classList.add("cal-dragging");calendarPointer.source.classList.add("cal-drag-source");createCalendarDragPreview();
  }
  e.preventDefault();calendarLatestPoint={x:e.clientX,y:e.clientY};
  if(!calendarDragFrame)calendarDragFrame=requestAnimationFrame(updateCalendarDragVisual);
});
document.addEventListener("pointerup",async e=>{
  if(!calendarPointer||e.pointerId!==calendarPointer.pointerId)return;
  const moved=calendarPointer.moved;
  if(moved){if(calendarDragFrame)cancelAnimationFrame(calendarDragFrame);calendarLatestPoint={x:e.clientX,y:e.clientY};updateCalendarDragVisual();}
  const day=calendarHoverDay,time=calendarHoverTime,drag=calendarDrag;
  clearCalendarDrag();
  if(moved&&day&&time){calendarSelectedDate=day.dataset.calDate;await moveCalendarItem(day.dataset.calDate,time,drag);}
});
document.addEventListener("pointercancel",e=>{if(calendarPointer?.pointerId===e.pointerId)clearCalendarDrag()});
document.addEventListener("lostpointercapture",e=>{if(calendarPointer?.pointerId===e.pointerId)clearCalendarDrag()});
document.addEventListener("dragstart",e=>{if(e.target.closest("[data-cal-event],[data-drag-gate]"))e.preventDefault()});
window.addEventListener("blur",()=>{if(calendarPointer)clearCalendarDrag()});

document.addEventListener("input",(e)=>{
  if(["gUrgency","gImpact","gEffort"].includes(e.target.id)) updateGatePreview();
  if(e.target.id==="allSearch"){ allFilters.q = e.target.value.trim().toLowerCase(); renderAllTasks(); return; }
  if(e.target.matches("[data-cal-victory]")){const key=todayStr(weekStart(calendarCursor));state.calendar.weeklyOutcomes||={};state.calendar.weeklyOutcomes[key]||=(state.calendar.victories||["","",""]).slice();state.calendar.weeklyOutcomes[key][+e.target.dataset.calVictory]=e.target.value;save();return}
  if(e.target.id==="voiceRate"){
    state.voice.rate = parseFloat(e.target.value);
    document.getElementById("voiceRateVal").textContent = state.voice.rate.toFixed(1)+"x";
    save();
  }
});

document.addEventListener("change",(e)=>{
  if(e.target.id==="calCapacityInput"){state.calendar.capacityHours=Math.max(1,Math.min(100,+e.target.value||35));save();renderCapacity(false);return}
  if(e.target.id==="calShowCompleted"){state.calendar.showCompleted=e.target.checked;save();renderCalendar();return}
  if(e.target.id==="calShowBreaks"){state.calendar.showBreaks=e.target.checked;save();renderCalendar();return}
  if(e.target.id==="calShowWeekends"){state.calendar.showWeekends=e.target.checked;save();renderCalendar();return}
  if(e.target.id==="setVoiceEnabled"){
    state.voice.enabled = e.target.checked;
    if(!e.target.checked) state.voice.wakeEnabled = false;
    save(); applyVoiceEnabled();
    const wb=document.getElementById("wakeToggle");
    if(wb) applyWakeToggleUI(wb);
    renderSettings();
    return;
  }
  if(e.target.id==="setWakeWord"){
    state.voice.wakeEnabled = e.target.checked;
    save();
    const wb=document.getElementById("wakeToggle");
    if(wb) applyWakeToggleUI(wb);
    if(e.target.checked){ wakeBlocked=false; startWakeListening(); } else stopWakeListening();
    return;
  }
  if(e.target.id==="setShowTranscripts"){
    state.voice.showTranscripts = e.target.checked;
    save();
    return;
  }
  if(e.target.id==="setLightMode"){
    state.theme = e.target.checked ? "light" : "dark";
    save(); applyTheme();
    return;
  }
  if(e.target.id==="trelloAutoSync"){
    trelloCfg().autoSync = e.target.checked;
    save();
    startTrelloAutoSync();
    syncMsg(e.target.checked
      ? "Auto-sync on — refreshes at launch and every 15 minutes."
      : "Auto-sync off — use Sync now to refresh manually.", "ok");
    return;
  }
  if(e.target.id==="trelloOnlyMine"){
    trelloCfg().onlyMine = e.target.checked;
    save();
    syncMsg(e.target.checked
      ? "Filtering to cards assigned to you. Run Sync now to apply."
      : "Importing all cards on the selected boards. Run Sync now to apply.", "ok");
    return;
  }
  if(e.target.id==="allSort"){ allFilters.sort = e.target.value; renderAllTasks(); return; }
  if(e.target.id==="allDungeon"){ allFilters.dungeon = e.target.value; renderAllTasks(); return; }
  if(e.target.id==="voiceSelect"){
    state.voice.voiceName = e.target.value;
    save();
    speak("This is my voice now.");
  }
});

/* ============ VOICE ASSISTANT ============ */
const VOICE_EMOJI_MAP = [
  [/fitness|workout|gym|exercise|health/, "💪"],
  [/study|read|learn|school|exam|course/, "📚"],
  [/money|finance|budget|invest|saving/, "💰"],
  [/work|job|career|client|business/, "💼"],
  [/art|design|creative|paint|draw/, "🎨"],
  [/home|house|clean|move/, "🏠"],
  [/mind|mental|therapy|meditat/, "🧠"],
];
function guessEmoji(name){
  const lower = name.toLowerCase();
  for(const [re,emoji] of VOICE_EMOJI_MAP){ if(re.test(lower)) return emoji; }
  return "🗡️";
}

const VOICE_NUM_WORDS = {one:1,two:2,three:3,four:4,five:5,six:6,seven:7};
function parseVoiceNum(str, def){
  if(str==null) return def;
  const s = String(str).trim().toLowerCase();
  if(VOICE_NUM_WORDS[s]!=null) return Math.min(5,VOICE_NUM_WORDS[s]);
  const n = parseInt(s,10);
  return isNaN(n) ? def : Math.max(1,Math.min(5,n));
}
function titleCaseVoice(s){
  return s.replace(/\s+/g," ").trim().replace(/\b\w/g, c=>c.toUpperCase());
}
function stripFillerEnd(s){
  return (s||"").replace(/[.,!?]+$/,"").trim();
}

function findProjectByName(query){
  if(!query) return null;
  const q = query.toLowerCase().trim();
  let best=null, bestScore=0;
  state.projects.forEach(p=>{
    const pn = p.name.toLowerCase();
    let score=0;
    if(pn===q) score=100;
    else if(pn.includes(q)||q.includes(pn)) score=60;
    else{
      const qt = new Set(q.split(/\s+/));
      score = pn.split(/\s+/).filter(w=>qt.has(w)).length*15;
    }
    if(score>bestScore){bestScore=score;best=p;}
  });
  return bestScore>0 ? best : null;
}

function findGateByName(query, preferProjectId){
  if(!query) return null;
  const q = query.toLowerCase().trim();
  function scoreGate(g){
    const gn = g.title.toLowerCase();
    if(gn===q) return 100;
    if(gn.includes(q)||q.includes(gn)) return 60;
    const qt = new Set(q.split(/\s+/));
    return gn.split(/\s+/).filter(w=>qt.has(w)).length*15;
  }
  let best=null, bestScore=0, bestProject=null;
  const preferred = preferProjectId ? findProject(preferProjectId) : null;
  const ordered = preferred ? [preferred, ...state.projects.filter(p=>p.id!==preferProjectId)] : state.projects;
  ordered.forEach(p=>{
    p.tasks.forEach(g=>{
      let s = scoreGate(g);
      if(p.id===preferProjectId) s += 5;
      if(s>bestScore){bestScore=s;best=g;bestProject=p;}
    });
  });
  return bestScore>0 ? {gate:best, project:bestProject} : null;
}

function findSubtaskByName(query, preferProjectId, preferGateId){
  if(!query) return null;
  const q = query.toLowerCase().trim();
  function scoreNode(n){
    const nt = n.title.toLowerCase();
    if(nt===q) return 100;
    if(nt.includes(q)||q.includes(nt)) return 60;
    const qt = new Set(q.split(/\s+/));
    return nt.split(/\s+/).filter(w=>qt.has(w)).length*15;
  }
  let best=null, bestScore=0, bestProject=null, bestGate=null;
  const preferred = preferProjectId ? findProject(preferProjectId) : null;
  const ordered = preferred ? [preferred, ...state.projects.filter(p=>p.id!==preferProjectId)] : state.projects;
  function walk(node, project, gate){
    if(!node.children || !node.children.length) return;
    node.children.forEach(c=>{
      let s = scoreNode(c);
      if(project.id===preferProjectId) s += 5;
      if(preferGateId && gate.id===preferGateId) s += 20;
      if(s>bestScore){ bestScore=s; best=c; bestProject=project; bestGate=gate; }
      walk(c, project, gate);
    });
  }
  ordered.forEach(p=>{ p.tasks.forEach(g=>walk(g,p,g)); });
  return bestScore>0 ? {node:best, project:bestProject, gate:bestGate} : null;
}

function parseDueFromText(text){
  const now = new Date();
  if(/\bdue today\b/.test(text)) return todayStr();
  if(/\bdue tomorrow\b/.test(text)){ const d=new Date(now); d.setDate(d.getDate()+1); return todayStr(d); }
  const m = text.match(/\bdue in (\d+|one|two|three|four|five|six|seven) days?\b/);
  if(m){
    const n = VOICE_NUM_WORDS[m[1]] || parseInt(m[1],10);
    const d = new Date(now); d.setDate(d.getDate()+n); return todayStr(d);
  }
  return null;
}

function showVoiceMsg(text, kind, isTranscript){
  if(isTranscript && state.voice.showTranscripts === false) return;
  const panel = document.getElementById("voicePanel");
  const el = document.createElement("div");
  el.className = "voice-msg "+(kind||"");
  el.textContent = text;
  panel.appendChild(el);
  while(panel.children.length>4) panel.removeChild(panel.firstChild);
  setTimeout(()=>{
    el.classList.add("fadeout");
    setTimeout(()=>el.remove(), 320);
  }, 7000);
}

// Apple's novelty/robot voices are useless for an assistant — hide them.
const NOVELTY_VOICES = /^(bad news|good news|bahh|bells|boing|bubbles|cellos|jester|organ|trinoids|whisper|wobble|zarvox|albert|fred|junior|kathy|ralph|superstar|grandma|grandpa|deranged|hysterical|princess|bruce|pipe organ)/i;
// Preferred defaults, best-sounding first. Falls through to whatever exists.
const VOICE_PREFERENCE = ["Samantha","Sandy","Shelley","Reed","Karen","Moira","Tessa","Daniel"];

function availableVoices(){
  if(!window.speechSynthesis) return [];
  return speechSynthesis.getVoices()
    .filter(v=>/^en/i.test(v.lang) && !NOVELTY_VOICES.test(v.name));
}

function pickVoice(){
  const voices = availableVoices();
  if(!voices.length) return null;
  if(state.voice.voiceName){
    const saved = voices.find(v=>v.name===state.voice.voiceName);
    if(saved) return saved;
  }
  for(const want of VOICE_PREFERENCE){
    // Prefer an Enhanced/Premium variant of the same voice when present.
    const hit = voices.find(v=>v.name.toLowerCase().startsWith(want.toLowerCase()));
    if(hit) return hit;
  }
  return voices[0];
}

let systemSpeechEnd=null;
function speak(text, onDone){
  if(state.voice.enabled === false){ if(onDone) onDone(); return; }
  showVoiceMsg(text, "reply");
  if(!window.speechSynthesis){ if(onDone) onDone(); return; }
  try{
    if(systemSpeechEnd) systemSpeechEnd();
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if(v){ u.voice = v; u.lang = v.lang; }
    u.rate = state.voice.rate || 1.0;
    u.pitch = 1.0;   // was 0.85 — the artificial drop made it sound droning
    let started=false,ended=false;
    const finish=()=>{
      if(ended)return;ended=true;
      if(started)systemNexusState('speaking',false);
      if(systemSpeechEnd===finish)systemSpeechEnd=null;
    };
    systemSpeechEnd=finish;
    u.onstart=()=>{if(!ended&&!started){started=true;systemNexusState('speaking',true);}};
    u.onend=u.onerror=()=>{finish();if(onDone)onDone();};
    window.speechSynthesis.speak(u);
  }catch(e){ if(systemSpeechEnd)systemSpeechEnd();if(onDone) onDone(); }
}

function renderVoicePicker(){
  const sel = document.getElementById("voiceSelect");
  if(!sel) return;
  const voices = availableVoices();
  if(!voices.length){ sel.innerHTML = '<option>Loading voices…</option>'; return; }
  const current = pickVoice();
  sel.innerHTML = voices.map(v=>{
    const label = v.name.replace(/\s*\(English \(([^)]+)\)\)/, " · $1");
    return `<option value="${escapeHtml(v.name)}"${current&&v.name===current.name?" selected":""}>${escapeHtml(label)}</option>`;
  }).join("");
  const rate = document.getElementById("voiceRate");
  if(rate){ rate.value = state.voice.rate || 1.0; document.getElementById("voiceRateVal").textContent = (state.voice.rate||1).toFixed(1)+"x"; }
}

function speakTopPriorities(){
  const all = [];
  state.projects.forEach(p=>{
    p.tasks.forEach(g=>{
      if(progressPct(g)===100) return;
      const baseScore = computeScore(g.urgency,g.impact,g.effort);
      all.push({g, p, score: baseScore*dueMultiplier(g.due), rank: rankFromScore(baseScore)});
    });
  });
  if(all.length===0){
    speak("Your quest log is empty. Say, create a dungeon called, to open one.");
    return;
  }
  all.sort((a,b)=>b.score-a.score);
  const top = all.slice(0,3);
  const parts = top.map((t,i)=> `${i===0?"First":i===1?"Then":"After that"}, ${t.rank} rank: ${t.g.title}, in ${t.p.name}.`);
  speak("Here's what needs your attention. " + parts.join(" "));
  selectedDungeonId = top[0].p.id;
  renderPortal(); renderAllTasks();
}

function voiceCompleteGate(project, gate){
  if(gate.children.length===0){
    markGateCleared(project.id, gate.id);
  } else {
    const wasProjectComplete=systemProjectComplete(project);
    function markAllDone(node){
      if(node.children && node.children.length) node.children.forEach(markAllDone);
      else node.done = true;
    }
    const wasComplete = progressPct(gate)===100;
    gate.children.forEach(markAllDone);
    save();
    if(!wasComplete && progressPct(gate)===100) onGateCleared(gate);
    selectedDungeonId = project.id;
    renderPortal(); renderAllTasks(); renderHUD();
    if(!wasComplete) systemTaskCompleted(project,gate.id,null,wasProjectComplete);
  }
}

/* ============ CONVERSATIONAL ENGINE ============ */
// `convo` holds a partially-filled request while we ask follow-up questions,
// so the user never has to phrase a whole command perfectly in one breath.
let convo = null;
let lastTouched = { projectId:null, gateId:null };

const CANCEL_RE = /^(cancel|never\s?mind|nevermind|forget it|stop|quit|exit|abort)\b/i;
const YES_RE = /^(yes|yeah|yep|yup|sure|ok|okay|confirm|do it|go ahead|affirmative)\b/i;
const NO_RE  = /^(no|nope|nah|don'?t|do not|cancel|stop)\b/i;

// Speech transcripts arrive padded with politeness and hedging. Strip it so
// "um, can you please add a quest..." parses the same as "add a quest...".
function normalizeUtterance(s){
  let t = (s||"").trim();
  t = t.replace(/^[\s,]*(um+|uh+|er+|hmm+|okay|ok|so|well|hey|yo)[\s,]+/i, "");
  t = t.replace(/^(nexus|hey nexus)[\s,]+/i, "");
  t = t.replace(/^(could you|can you|would you|will you|please|i want to|i'd like to|i would like to|let'?s|lets|i need to|help me)\s+/i, "");
  t = t.replace(/\s+please$/i, "");
  t = t.replace(/[.,!?]+$/,"");
  return t.trim();
}

// People say "to the X gate" as often as "to gate X" — accept either, plus
// bare names with no preposition at all.
function extractTarget(rest, kindWords){
  if(!rest) return { name:null, target:null };
  let s = rest.trim();
  const kinds = kindWords.join("|");
  let m = s.match(new RegExp(`^(.*?)\\s+(?:to|in|on|under|for|inside|into)\\s+(?:the\\s+)?(?:${kinds})\\s+(.+)$`, "i"));
  if(m) return { name:m[1].trim(), target:m[2].trim() };
  m = s.match(new RegExp(`^(.*?)\\s+(?:to|in|on|under|for|inside|into)\\s+(?:the\\s+)?(.+?)\\s+(?:${kinds})$`, "i"));
  if(m) return { name:m[1].trim(), target:m[2].trim() };
  m = s.match(new RegExp(`^(.*?)\\s+(?:to|in|on|under|for|inside|into)\\s+(?:the\\s+)?(.+)$`, "i"));
  if(m) return { name:m[1].trim(), target:m[2].trim() };
  return { name:s, target:null };
}

function stripCalled(s){
  return (s||"").replace(/^(?:called|named|titled|that says|saying)\s+/i,"").trim();
}

function allGates(){
  const out = [];
  state.projects.forEach(p=>p.tasks.forEach(g=>out.push({gate:g, project:p})));
  return out;
}

// Brand names like "Etchd" or "KARD" are never transcribed the way they're
// spelled — speech hears "etched", "card". So match on how a word *sounds*,
// not how it's written.
function phoneticKey(str){
  const t = String(str).toLowerCase().replace(/[^a-z\s]/g," ").replace(/\s+/g," ").trim();
  return t.split(" ").map(w=>{
    if(!w) return "";
    let x = w
      .replace(/([a-z])\1+/g,"$1")
      .replace(/^kn|^gn|^pn|^wr/,"n")
      .replace(/tch/g,"ch")
      .replace(/sch|ch|sh/g,"X")
      .replace(/ph/g,"f")
      .replace(/ck|q|k/g,"k")
      .replace(/c(?=[eiy])/g,"s")
      .replace(/c/g,"k")
      .replace(/dg(?=[eiy])/g,"j")
      .replace(/gh/g,"")
      .replace(/z/g,"s")
      .replace(/v/g,"f")
      .replace(/y/g,"i");
    x = x[0] + x.slice(1).replace(/[aeiou]/g,"");
    return x.replace(/(.)\1+/g,"$1");
  }).filter(Boolean).join(" ");
}

function levDist(a,b){
  const m=a.length,n=b.length;
  if(!m) return n; if(!n) return m;
  let prev=Array.from({length:n+1},(_,i)=>i), cur=new Array(n+1);
  for(let i=1;i<=m;i++){
    cur[0]=i;
    for(let j=1;j<=n;j++) cur[j]=Math.min(prev[j]+1, cur[j-1]+1, prev[j-1]+(a[i-1]===b[j-1]?0:1));
    const tmp=prev; prev=cur; cur=tmp;
  }
  return prev[n];
}
function similarity(a,b){
  if(!a||!b) return 0;
  return 1 - levDist(a,b)/Math.max(a.length,b.length);
}

function scoreName(candidate, q){
  const c = String(candidate).toLowerCase().trim();
  const s = String(q).toLowerCase().trim();
  if(!c || !s) return 0;
  if(c===s) return 100;

  const pc = phoneticKey(c), ps = phoneticKey(s);
  if(pc && pc===ps) return 94;                       // sounds identical
  if(c.startsWith(s)||s.startsWith(c)) return 78;
  if(c.includes(s)||s.includes(c)) return 62;
  if(pc && ps && (pc.includes(ps)||ps.includes(pc))) return 58;

  const qt = new Set(s.split(/\s+/).filter(Boolean));
  const overlap = c.split(/\s+/).filter(w=>qt.has(w)).length;
  let best = overlap*18;

  const pSim = similarity(pc, ps);
  if(pSim >= 0.62) best = Math.max(best, Math.round(30 + (pSim-0.62)/0.38*40));
  const rSim = similarity(c, s);
  if(rSim >= 0.70) best = Math.max(best, Math.round(30 + (rSim-0.70)/0.30*35));
  return best;
}

// Returns every plausible match, not just the best one, so we can ask the user
// to choose instead of silently guessing wrong.
function matchProjects(q){
  if(!q) return [];
  return state.projects
    .map(p=>({item:p, score:scoreName(p.name,q)}))
    .filter(x=>x.score>0)
    .sort((a,b)=>b.score-a.score);
}
function matchGates(q, preferProjectId){
  if(!q) return [];
  return allGates()
    .map(x=>({item:x, score:scoreName(x.gate.title,q) + (x.project.id===preferProjectId?6:0)}))
    .filter(x=>x.score>0)
    .sort((a,b)=>b.score-a.score);
}
function matchSubtasks(q, preferGateId){
  if(!q) return [];
  const out = [];
  state.projects.forEach(p=>p.tasks.forEach(g=>{
    (function walk(node){
      (node.children||[]).forEach(c=>{
        const s = scoreName(c.title,q) + (g.id===preferGateId?6:0);
        if(s>0) out.push({item:{node:c, gate:g, project:p}, score:s});
        walk(c);
      });
    })(g);
  }));
  return out.sort((a,b)=>b.score-a.score);
}

// Ambiguous when the runner-up is nearly as good as the winner.
function isAmbiguous(list){
  return list.length>1 && (list[0].score - list[1].score) < 20;
}

function askFollowUp(question, slot, extra){
  convo = Object.assign({ missingSlot:slot }, convo||{}, extra||{});
  convo.missingSlot = slot;
  inCommandFlow = true;
  speak(question, ()=>{ startCommandCapture(); });
}

function clearConvo(){ convo = null; }

function showCheatSheet(on){
  const el = document.getElementById("cheatSheet");
  if(!el) return;
  el.classList.toggle("show", on===undefined ? !el.classList.contains("show") : !!on);
}

function speakList(items, max){
  const shown = items.slice(0, max||3);
  if(shown.length===1) return shown[0];
  return shown.slice(0,-1).join(", ") + ", or " + shown[shown.length-1];
}

/* ---------- intent executors (each tolerates missing slots) ---------- */

function doSetRating(slots){
  const val = parseVoiceNum(slots.value, null);
  if(!val){ clearConvo(); return speak("Give me a number from 1 to 5."); }
  let hit;
  if(slots.target){
    const hits = matchGates(slots.target, selectedDungeonId);
    if(!hits.length){ clearConvo(); return speak(`I couldn't find a gate called ${slots.target}.`); }
    hit = hits[0].item;
  } else if(lastTouched.gateId){
    const p = findProject(lastTouched.projectId);
    const g = p && findGate(p, lastTouched.gateId);
    if(g) hit = { gate:g, project:p };
  }
  if(!hit){
    convo = { intent:"setRating", slots };
    return askFollowUp(`Which gate should I set ${slots.field} to ${val} on?`, "target");
  }
  pushUndo("that rating change");
  hit.gate[slots.field] = val;
  save();
  lastTouched.projectId = hit.project.id; lastTouched.gateId = hit.gate.id;
  selectedDungeonId = hit.project.id;
  renderPortal(); renderAllTasks();
  clearConvo();
  const rank = rankFromScore(computeScore(hit.gate.urgency, hit.gate.impact, hit.gate.effort));
  speak(`${hit.gate.title} — ${slots.field} set to ${val}. Now rank ${rank}.`);
}

function doCreateDungeon(slots){
  if(!slots.name){
    convo = { intent:"createDungeon", slots };
    return askFollowUp("What should the dungeon be called?", "name");
  }
  const name = titleCaseVoice(slots.name);
  addProject(name, guessEmoji(name));
  const p = state.projects[state.projects.length-1];
  selectedDungeonId = p.id;
  lastTouched.projectId = p.id;
  renderPortal(); renderAllTasks();
  clearConvo();
  speak(`Dungeon "${name}" opened. Say "add a gate" to put a task in it.`);
}

function doAddGate(slots){
  if(!slots.title){
    convo = { intent:"addGate", slots };
    return askFollowUp("What's the gate called?", "title");
  }
  if(!slots.projectId){
    if(state.projects.length===0){
      clearConvo();
      return speak("You have no dungeons yet. Say \"create a dungeon\" first.");
    }
    if(slots.projectQuery){
      const hits = matchProjects(slots.projectQuery);
      if(hits.length===0){
        convo = { intent:"addGate", slots:{...slots, projectQuery:null} };
        return askFollowUp(`I couldn't find a dungeon called ${slots.projectQuery}. Which dungeon should it go in? You have ${speakList(state.projects.map(p=>p.name))}.`, "projectQuery");
      }
      if(isAmbiguous(hits)){
        convo = { intent:"addGate", slots:{...slots, projectQuery:null} };
        return askFollowUp(`Did you mean ${speakList(hits.map(h=>h.item.name))}?`, "projectQuery");
      }
      slots.projectId = hits[0].item.id;
    } else if(state.projects.length===1){
      slots.projectId = state.projects[0].id;
    } else {
      // Never silently file it under whatever happens to be on screen — a
      // misfiled task is worse than one extra question.
      const cur = findProject(selectedDungeonId);
      convo = { intent:"addGate", slots };
      const hint = cur ? ` You're in ${cur.name} — say "this one", or name another.` : ` You have ${speakList(state.projects.map(p=>p.name))}.`;
      return askFollowUp(`Which dungeon should "${titleCaseVoice(slots.title)}" go in?${hint}`, "projectQuery");
    }
  }
  const project = findProject(slots.projectId);
  if(!project){ clearConvo(); return speak("That dungeon no longer exists."); }
  const title = titleCaseVoice(slots.title);
  const u = slots.urgency||3, i = slots.impact||3, e = slots.effort||3;
  addGate(project.id, title, u, i, e, slots.due||null);
  selectedDungeonId = project.id;
  lastTouched.projectId = project.id;
  lastTouched.gateId = project.tasks[project.tasks.length-1].id;
  renderPortal(); renderAllTasks();
  clearConvo();
  const rank = rankFromScore(computeScore(u,i,e));
  const rated = (slots.urgency||slots.impact||slots.effort) ? "" : " I gave it medium priority — say \"set urgency to 5\" to change that.";
  speak(`Gate "${title}" added to ${project.name}, ranked ${rank}.${rated}`);
}

function doAddQuest(slots){
  if(!slots.text){
    convo = { intent:"addQuest", slots };
    return askFollowUp("What's the quest?", "text");
  }
  if(!slots.gateId){
    const gates = allGates();
    if(gates.length===0){
      clearConvo();
      return speak("There are no gates yet. Say \"add a gate\" first, then I can put quests under it.");
    }
    if(slots.gateQuery){
      const hits = matchGates(slots.gateQuery, selectedDungeonId);
      if(hits.length===0){
        convo = { intent:"addQuest", slots:{...slots, gateQuery:null} };
        return askFollowUp(`I couldn't find a gate called ${slots.gateQuery}. Which gate? You have ${speakList(gates.map(g=>g.gate.title))}.`, "gateQuery");
      }
      if(isAmbiguous(hits)){
        convo = { intent:"addQuest", slots:{...slots, gateQuery:null} };
        return askFollowUp(`Did you mean ${speakList(hits.map(h=>h.item.gate.title))}?`, "gateQuery");
      }
      slots.gateId = hits[0].item.gate.id;
      slots.projectId = hits[0].item.project.id;
    } else if(gates.length===1){
      slots.gateId = gates[0].gate.id; slots.projectId = gates[0].project.id;
    } else {
      const scoped = selectedDungeonId ? gates.filter(g=>g.project.id===selectedDungeonId) : [];
      const pool = scoped.length ? scoped : gates;
      convo = { intent:"addQuest", slots };
      return askFollowUp(`Which gate should that go under? ${pool.length<=4 ? "You have "+speakList(pool.map(g=>g.gate.title),4)+"." : "Say the gate name."}`, "gateQuery");
    }
  }
  const project = findProject(slots.projectId);
  const gate = project && findGate(project, slots.gateId);
  if(!gate){ clearConvo(); return speak("That gate no longer exists."); }
  const text = titleCaseVoice(slots.text);
  addSubtask(project.id, gate.id, text);
  selectedDungeonId = project.id;
  lastTouched.projectId = project.id; lastTouched.gateId = gate.id;
  renderPortal(); renderAllTasks();
  clearConvo();
  speak(`Added "${text}" under ${gate.title}.`);
}

function doAddDaily(slots){
  if(!slots.text){
    convo = { intent:"addDaily", slots };
    return askFollowUp("What's the daily quest?", "text");
  }
  const text = titleCaseVoice(slots.text);
  addDailyQuest(text);
  setView("daily");
  clearConvo();
  speak(`Daily quest "${text}" added.`);
}

function doDelete(slots){
  const kind = slots.kind;
  const label = kind==="dungeon" ? "dungeon" : kind==="gate" ? "gate" : "quest";
  if(!slots.query){
    convo = { intent:"delete", slots };
    return askFollowUp(`Which ${label} should I delete?`, "query");
  }
  let hits;
  if(kind==="dungeon") hits = matchProjects(slots.query);
  else if(kind==="gate") hits = matchGates(slots.query, selectedDungeonId);
  else hits = matchSubtasks(slots.query, lastTouched.gateId);

  if(hits.length===0){
    convo = { intent:"delete", slots:{...slots, query:null} };
    return askFollowUp(`I couldn't find a ${label} called ${slots.query}. What's the exact name?`, "query");
  }
  if(isAmbiguous(hits)){
    const names = hits.map(h=> kind==="dungeon" ? h.item.name : kind==="gate" ? h.item.gate.title : h.item.node.title);
    convo = { intent:"delete", slots:{...slots, query:null} };
    return askFollowUp(`Did you mean ${speakList(names)}?`, "query");
  }
  const hit = hits[0].item;
  const name = kind==="dungeon" ? hit.name : kind==="gate" ? hit.gate.title : hit.node.title;
  const warn = kind==="dungeon" ? " That deletes everything inside it." : "";
  convo = { intent:"confirmDelete", slots:{ kind, hit, name } };
  return askFollowUp(`Delete the ${label} "${name}"?${warn} Say yes or no.`, "confirm");
}

function performDelete(kind, hit, name){
  if(kind==="dungeon"){
    deleteProject(hit.id, true);
    if(selectedDungeonId===hit.id) selectedDungeonId = null;
    renderPortal(); renderAllTasks();
  } else if(kind==="gate"){
    deleteGate(hit.project.id, hit.gate.id);
  } else {
    deleteSubtask(hit.project.id, hit.gate.id, hit.node.id);
  }
  speak(`"${name}" deleted.`);
}

function doComplete(slots){
  if(!slots.query){
    convo = { intent:"complete", slots };
    return askFollowUp("Which gate did you finish?", "query");
  }
  const hits = matchGates(slots.query, selectedDungeonId);
  if(hits.length===0){
    const subs = matchSubtasks(slots.query, lastTouched.gateId);
    if(subs.length && !isAmbiguous(subs)){
      const s = subs[0].item;
      if(!s.node.done) toggleSubtask(s.project.id, s.gate.id, s.node.id);
      clearConvo();
      return speak(`Checked off "${s.node.title}".`);
    }
    convo = { intent:"complete", slots:{...slots, query:null} };
    return askFollowUp(`I couldn't find anything called ${slots.query}. What's the name?`, "query");
  }
  if(isAmbiguous(hits)){
    convo = { intent:"complete", slots:{...slots, query:null} };
    return askFollowUp(`Did you mean ${speakList(hits.map(h=>h.item.gate.title))}?`, "query");
  }
  const hit = hits[0].item;
  voiceCompleteGate(hit.project, hit.gate);
  clearConvo();
  speak(`${hit.gate.title} cleared.`);
}

/* ---------- fresh-intent parsing ---------- */

function parseIntent(lower){
  let m;

  // Checked before "delete", so "delete that" reads as undo rather than a
  // fresh delete with a nonsense target.
  if(/^(undo|revert|scratch that|take that back|go back)\b/.test(lower)
     || /^(actually,? )?(undo|delete|remove|cancel) (that|it|the last one|this)\b/.test(lower)
     || /^(actually,? )?(never ?mind|nevermind) (that|it)\b/.test(lower)) return { intent:"undo", slots:{} };

  if(/^(help|what can i say|list commands|commands|what can you do)\b/.test(lower)) return { intent:"help", slots:{} };
  if(/high priorit|top priorit|what should i do|what'?s next|next task|what to do|prioriti/.test(lower)) return { intent:"priorities", slots:{} };
  if(/how am i doing|what'?s my level|my progress|status report|my stats/.test(lower)) return { intent:"status", slots:{} };

  if(/(?:show|see|list|what'?s on)\b.*\b(all|every|everything|all tasks|all my tasks|all gates|my plate|on my plate)\b/.test(lower)
     || /^(all tasks|everything|show everything|my tasks|what do i have on)\b/.test(lower)) return { intent:"navigate", slots:{ target:"all tasks" } };

  m = lower.match(/(?:show|open|go to|switch to|take me to)(?: me| my)?\s+(?:the\s+)?(all tasks|daily quests?|dailies|quest log|dungeons?|focus|pomodoro|timer|bucket list|shadow army|shadows)\b/);
  if(m) return { intent:"navigate", slots:{ target:m[1] } };
  if(/(?:start|begin)(?: a| the)? (?:focus session|focus|pomodoro|timer)\b/.test(lower)) return { intent:"startFocus", slots:{} };

  m = lower.match(/(?:create|start|make|new|open|add)(?:\s+a|\s+an|\s+the)?\s+(?:dungeon|project)\s*(.*)$/)
      || lower.match(/(?:create|start|make|new)(?:\s+a|\s+an|\s+the)?\s+(.+?)\s+(?:dungeon|project)$/);
  if(m) return { intent:"createDungeon", slots:{ name: stripCalled(m[1]) || null } };

  m = lower.match(/(?:delete|remove|get rid of)(?:\s+the|\s+a)?\s+(dungeon|project|gate|quest|task|daily quest)\s*(.*)$/);
  if(m){
    const kindWord = m[1];
    const kind = /dungeon|project/.test(kindWord) ? "dungeon" : /gate/.test(kindWord) ? "gate" : "quest";
    return { intent:"delete", slots:{ kind, query: stripCalled(m[2]) || null } };
  }

  m = lower.match(/(?:add|create|make|new)(?:\s+a|\s+an|\s+the)?\s+(?:daily quest|daily habit|daily|habit)\s*(.*)$/);
  if(m){
    let rest = stripCalled(m[1]).replace(/^to\s+/i,"");
    return { intent:"addDaily", slots:{ text: rest || null } };
  }

  // "add a gate called X" and "add X gate" are both common phrasings.
  m = lower.match(/(?:add|create|make|new)(?:\s+a|\s+an|\s+the)?\s+gate\s*(.*)$/)
      || lower.match(/(?:add|create|make|new)(?:\s+a|\s+an|\s+the)?\s+(.+?)\s+gate$/);
  if(m){
    let rest = stripCalled(m[1]);
    const due = parseDueFromText(rest);
    rest = rest.replace(/\bdue (today|tomorrow|in \w+ days?)\b/ig,"").trim();
    let urgency=null, impact=null, effort=null;
    const um = rest.match(/urgency\s+(?:of\s+|to\s+)?(\w+)/i); if(um){ urgency=parseVoiceNum(um[1],3); rest=rest.replace(um[0],""); }
    const im = rest.match(/impact\s+(?:of\s+|to\s+)?(\w+)/i); if(im){ impact=parseVoiceNum(im[1],3); rest=rest.replace(im[0],""); }
    const em = rest.match(/effort\s+(?:of\s+|to\s+)?(\w+)/i); if(em){ effort=parseVoiceNum(em[1],3); rest=rest.replace(em[0],""); }
    rest = rest.replace(/[,\s]+$/,"").trim();
    const { name, target } = extractTarget(rest, ["dungeon","project"]);
    return { intent:"addGate", slots:{ title: stripCalled(name)||null, projectQuery: target, urgency, impact, effort, due } };
  }

  m = lower.match(/(?:add|create|make|new)(?:\s+a|\s+an|\s+the)?\s+(?:quest|task|subtask|step|to-?do)\s*(.*)$/)
      || lower.match(/(?:add|create|make|new)(?:\s+a|\s+an|\s+the)?\s+(.+?)\s+(?:quest|task|subtask)$/);
  if(m){
    const rest = stripCalled(m[1]);
    const { name, target } = extractTarget(rest, ["gate","task"]);
    return { intent:"addQuest", slots:{ text: stripCalled(name)||null, gateQuery: target } };
  }

  m = lower.match(/^(?:set|change|make)\s+(?:the\s+)?(urgency|impact|effort)\s+(?:of\s+(.+?)\s+)?(?:to\s+)?(\w+)$/);
  if(m) return { intent:"setRating", slots:{ field:m[1], target:m[2]||null, value:m[3] } };

  m = lower.match(/(?:mark|complete|finish|clear|check off|tick off|done with)\s+(?:the\s+)?(?:gate\s+)?(.+?)(?:\s+as\s+(?:done|cleared|complete|finished))?$/);
  if(m) return { intent:"complete", slots:{ query: stripCalled(m[1]) || null } };

  return null;
}

function runIntent(intent, slots){
  switch(intent){
    case "undo": {
      clearConvo();
      const label = undoLast();
      return speak(label ? `Undone — reversed ${label}.` : "There's nothing to undo yet.");
    }
    case "help": return doHelp();
    case "priorities": clearConvo(); return speakTopPriorities();
    case "status": {
      clearConvo();
      const p = state.player;
      return speak(`You're level ${p.level}, ${titleForLevel(p.level)}. ${p.xp} experience toward the next level. ${p.streak} day streak. ${p.totalCleared} gates cleared. ${(state.achievements||[]).filter(w=>!w.status||w.status==='achieved').length} achievements in your Shadow Army.`);
    }
    case "navigate": {
      clearConvo();
      const t = slots.target;
      let view="quests", label="the quest log";
      if(/all/.test(t)){ view="all"; label="all tasks"; }
      else if(/daily|dailies/.test(t)){ view="daily"; label="daily quests"; }
      else if(/focus|pomodoro|timer/.test(t)){ view="focus"; label="focus"; }
      else if(/bucket/.test(t)){ view="bucket"; label="your bucket list"; }
      else if(/shadow/.test(t)){ view="army"; label="the shadow army"; }
      setView(view);
      return speak(`Opening ${label}.`);
    }
    case "startFocus": {
      clearConvo(); setView("focus");
      if(!state.pomodoro.running) pomoToggle();
      save(); renderFocus();
      return speak("Focus session started.");
    }
    case "setRating":     return doSetRating(slots);
    case "createDungeon": return doCreateDungeon(slots);
    case "addGate":       return doAddGate(slots);
    case "addQuest":      return doAddQuest(slots);
    case "addDaily":      return doAddDaily(slots);
    case "delete":        return doDelete(slots);
    case "complete":      return doComplete(slots);
  }
}

function doHelp(){
  clearConvo();
  showCheatSheet(true);
  speak("Here are some things you can say. Create a dungeon. Add a gate. Add a quest. Delete a gate. What's next. How am I doing. If you leave out details, I'll just ask you for them.");
}

/* ---------- main entry ---------- */

function handleVoiceCommand(raw){
  const t = normalizeUtterance(raw);
  const lower = t.toLowerCase();
  showVoiceMsg(`“${raw.trim()}”`, "heard", true);

  if(!t){
    if(convo) return askFollowUp("I didn't catch that. Could you say it again?", convo.missingSlot);
    return speak("I didn't catch that.");
  }

  // Mid-conversation: this utterance answers the question we just asked.
  if(convo){
    if(CANCEL_RE.test(lower)){ clearConvo(); return speak("Cancelled."); }

    if(convo.intent==="confirmDelete"){
      if(YES_RE.test(lower)){
        const {kind, hit, name} = convo.slots;
        clearConvo();
        return performDelete(kind, hit, name);
      }
      if(NO_RE.test(lower)){ clearConvo(); return speak("Left it alone."); }
      return askFollowUp("Say yes to delete it, or no to keep it.", "confirm");
    }

    // Let a clearly-new command interrupt an unfinished one.
    const fresh = parseIntent(lower);
    if(fresh && fresh.intent!==convo.intent){ clearConvo(); return runIntent(fresh.intent, fresh.slots); }

    const slot = convo.missingSlot;
    const slots = Object.assign({}, convo.slots);
    const answer = stripCalled(t);
    if(/^(this|this one|current|the current one|here|that one|same one)$/i.test(answer)){
      if(slot==="projectQuery" && selectedDungeonId){ slots.projectId = selectedDungeonId; slots.projectQuery = null; }
      else if(slot==="gateQuery" && lastTouched.gateId){ slots.gateId = lastTouched.gateId; slots.projectId = lastTouched.projectId; slots.gateQuery = null; }
      else slots[slot] = answer;
    } else {
      slots[slot] = answer;
    }
    const intent = convo.intent;
    convo = { intent, slots };
    return runIntent(intent, slots);
  }

  const parsed = parseIntent(lower);
  if(parsed) return runIntent(parsed.intent, parsed.slots);

  speak("I didn't catch a command there. Say \"help\" to hear what I understand.");
}

let voiceRecognition = null;
let voiceListening = false;
let wakeRecognition = null;
let wakeActive = false;
let wakeBlocked = false;
let inCommandFlow = false;
let permissionHintShown = false;
// No lead-in word required — "hey nexus", "k nexus", "just nexus", bare
// "nexus" all trigger. Wider net, but a misheard wake phrase is cheap to
// dismiss while a missed one is annoying, so bias toward catching it.
const WAKE_RE = /\b(nexus|nexis|nexas|nexxus|next\s*us|nex\s*us)\b/i;

function maybeShowPermissionHint(){
  // The old Safari-web-app wording no longer applies: this is a signed native
  // app, so macOS asks once and remembers it.
  if(permissionHintShown) return;
  permissionHintShown = true;
  if(state.voice.micGranted) return;
  showVoiceMsg("If macOS asks for microphone or speech access, choose Allow — it only asks once.", "reply");
}

function startCommandCapture(){
  if(state.voice.enabled === false) return;
  if(!voiceRecognition) return;
  maybeShowPermissionHint();
  // The wake listener holds the mic; releasing it isn't instant, so hand over
  // with a beat of delay or the new session gets an "aborted" error.
  const wasWake = wakeActive;
  stopWakeListening();
  const go = ()=>{ try{ voiceRecognition.start(); }catch(e){} };
  if(wasWake) setTimeout(go, 250); else go();
}

function endCommandFlow(){
  // Mid-conversation the mic is about to reopen for the user's answer, so
  // don't tear the flow down or hand the mic back to the wake listener.
  if(convo) return;
  inCommandFlow = false;
  if(state.voice.wakeEnabled) setTimeout(startWakeListening, 350);
}

function applyVoiceEnabled(){
  const on = state.voice.enabled !== false;
  const dock = document.querySelector(".voice-dock");
  if(dock) dock.style.display = on ? "" : "none";
  if(!on){
    try{ if(voiceListening && voiceRecognition) voiceRecognition.stop(); }catch(e){}
    stopWakeListening();
    if(systemSpeechEnd)systemSpeechEnd();
    if(window.speechSynthesis) window.speechSynthesis.cancel();
    clearConvo();
    inCommandFlow = false;
  }
  const sub = document.getElementById("voiceSubSettings");
  if(sub) sub.classList.toggle("disabled", !on);
}

function initVoice(){
  const btn = document.getElementById("voiceBtn");
  const wakeBtn = document.getElementById("wakeToggle");
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){
    btn.classList.add("unsupported");
    btn.title = "Voice isn't supported in this browser";
    wakeBtn.classList.add("unsupported");
    wakeBtn.title = "Voice isn't supported in this browser";
    return;
  }

  voiceRecognition = new SR();
  voiceRecognition.continuous = false;
  voiceRecognition.interimResults = false;
  voiceRecognition.lang = "en-US";

  voiceRecognition.onstart = ()=>{
    if(!state.voice.micGranted){ state.voice.micGranted = true; save(); }
    voiceListening = true;
    systemNexusState('listening',true);
    btn.classList.add("listening");
    showVoiceMsg("Listening…", "heard");
  };
  voiceRecognition.onend = ()=>{
    if(voiceListening)systemNexusState('listening',false);
    voiceListening = false;
    btn.classList.remove("listening");
    if(inCommandFlow) endCommandFlow();
  };
  voiceRecognition.onerror = (e)=>{
    if(voiceListening)systemNexusState('listening',false);
    voiceListening = false;
    btn.classList.remove("listening");
    if(e.error==="not-allowed" || e.error==="service-not-allowed"){
      showVoiceMsg("Microphone access was blocked. Allow it in Settings for this app.", "error");
    } else if(e.error==="no-speech"){
      showVoiceMsg("Didn't hear anything.", "error");
    } else if(e.error==="aborted"){
      showVoiceMsg("Listening was interrupted — try the mic again.", "error");
    } else {
      showVoiceMsg("Voice error: "+e.error, "error");
    }
    // Don't strand a half-finished conversation waiting on an answer that
    // never came — retry the question once, then let it go.
    if(convo && (e.error==="no-speech" || e.error==="aborted")){
      if(convo.retried){
        const q = convo.missingSlot;
        clearConvo();
        showVoiceMsg("Cancelled — I stopped waiting for an answer.", "heard");
        inCommandFlow = false;
        if(state.voice.wakeEnabled) setTimeout(startWakeListening, 350);
        return;
      }
      convo.retried = true;
      const slot = convo.missingSlot;
      speak("Still there? " + (slot==="confirm" ? "Say yes or no." : "Say it again, or say cancel."), ()=>startCommandCapture());
      return;
    }
    if(convo){ clearConvo(); }
    if(inCommandFlow) endCommandFlow();
  };
  voiceRecognition.onresult = (e)=>{
    const transcript = e.results[0][0].transcript;
    handleVoiceCommand(transcript);
  };

  btn.addEventListener("click", ()=>{
    if(voiceListening){ voiceRecognition.stop(); return; }
    const wasWakeActive = wakeActive;
    stopWakeListening();
    inCommandFlow = true;
    // Stopping the wake-word listener doesn't release the mic instantly —
    // starting the manual one right away can abort it mid-handoff.
    if(wasWakeActive) setTimeout(startCommandCapture, 250);
    else startCommandCapture();
  });

  initWakeWord(wakeBtn);

  wakeBtn.addEventListener("click", ()=>{
    state.voice.wakeEnabled = !state.voice.wakeEnabled;
    save();
    applyWakeToggleUI(wakeBtn);
    if(state.voice.wakeEnabled){
      wakeBlocked = false;
      showVoiceMsg('Wake word armed. Say "Hey Nexus" any time.', "reply");
      startWakeListening();
    } else {
      showVoiceMsg("Wake word off.", "heard");
      stopWakeListening();
    }
  });
  applyWakeToggleUI(wakeBtn);
  applyVoiceEnabled();
  if(state.voice.enabled !== false && state.voice.wakeEnabled) startWakeListening();

  // Page Visibility can be unreliable inside a standalone web-app shell, so
  // pause/resume off plain window focus/blur instead — simpler, more universal.
  window.addEventListener("blur", ()=>{ stopWakeListening(); });
  window.addEventListener("focus", ()=>{
    if(state.voice.wakeEnabled && !inCommandFlow) startWakeListening();
  });
  document.addEventListener("visibilitychange", ()=>{
    if(document.hidden){
      stopWakeListening();
    } else if(state.voice.wakeEnabled && !inCommandFlow){
      startWakeListening();
    }
  });
}

function applyWakeToggleUI(wakeBtn){
  const cb=document.getElementById("setWakeWord");
  if(cb) cb.checked = !!state.voice.wakeEnabled;
  wakeBtn.classList.toggle("on", state.voice.wakeEnabled);
  wakeBtn.textContent = state.voice.wakeEnabled ? '🎧 Wake Word: On ("Hey Nexus")' : "🎧 Wake Word: Off";
}

function initWakeWord(wakeBtn){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  wakeRecognition = new SR();
  // Safari appears to accept `continuous` but never actually deliver results in
  // that mode — single-shot sessions chained back-to-back via onend is what
  // reliably produces results (confirmed: the manual mic button, which is
  // single-shot, works; continuous mode never fired onresult at all).
  // interimResults matched the manual mic button's config too (false) — with
  // it set true here, the wake recognizer never fired onresult at all in
  // testing, even though it was clearly listening (armed glow, real audio).
  wakeRecognition.continuous = false;
  wakeRecognition.interimResults = false;
  wakeRecognition.lang = "en-US";

  wakeRecognition.onresult = (e)=>{
    if(inCommandFlow) return;
    const text = e.results[e.results.length-1][0].transcript;
    if(WAKE_RE.test(text)){ triggerWake(); return; }
    if(text.trim()){
      showVoiceMsg('(heard while armed) "'+text.trim()+'"', "heard", true);
    }
  };
  wakeRecognition.onerror = (e)=>{
    wakeActive = false;
    if(e.error==="not-allowed" || e.error==="service-not-allowed"){
      if(!wakeBlocked){
        showVoiceMsg("Microphone access was blocked, so the wake word can't listen. Allow it in Settings, then turn Wake Word off and on again.", "error");
      }
      wakeBlocked = true;
      return;
    }
    if(state.voice.wakeEnabled && !inCommandFlow) setTimeout(startWakeListening, 800);
  };
  wakeRecognition.onend = ()=>{
    wakeActive = false;
    if(state.voice.wakeEnabled && !inCommandFlow) setTimeout(startWakeListening, 300);
  };
  const btn = document.getElementById("voiceBtn");
  wakeRecognition.onstart = ()=>{
    if(!state.voice.micGranted){ state.voice.micGranted = true; save(); }
    wakeActive = true; btn.classList.add("wake-armed");
  };
}

function startWakeListening(){
  if(!document.body.classList.contains("auth-ready"))return;
  if(state.voice.enabled === false) return;
  if(!wakeRecognition || !state.voice.wakeEnabled || inCommandFlow || wakeActive || wakeBlocked) return;
  maybeShowPermissionHint();
  try{
    wakeRecognition.start();
  }catch(e){
    if(e.name !== "InvalidStateError"){
      showVoiceMsg("Couldn't start wake listening: "+e.message, "error");
    }
  }
}
function stopWakeListening(){
  document.getElementById("voiceBtn").classList.remove("wake-armed");
  if(!wakeRecognition) return;
  try{ wakeRecognition.stop(); }catch(e){}
  wakeActive = false;
}

function triggerWake(){
  if(inCommandFlow) return;
  inCommandFlow = true;
  stopWakeListening();
  showVoiceMsg('"Hey Nexus"', "heard", true);
  speak("What would you like?", ()=>{
    startCommandCapture();
  });
}

// Self-healing: if a restart ever silently drops (no onend/onerror fired),
// this notices within a few seconds and starts it back up.
setInterval(()=>{
  if(document.body.classList.contains("auth-ready")&&state.voice.wakeEnabled && !inCommandFlow && !wakeActive) startWakeListening();
}, 4000);

/* ============ INIT ============ */
function init(){
  // one-off tidy of keys left behind by an earlier diagnostic build
  try{ localStorage.removeItem("__diag"); localStorage.removeItem("__diag2"); }catch(e){}
  if(!Array.isArray(state.goals))state.goals=[];
  if(!Array.isArray(state.achievements))state.achievements=[];
  goalsUI=window.ARISEAchievements.create({getState:()=>state,save,onChanged:renderHUD,confirm:uiConfirm});
  initCloudSync();
  ensureCreativeWeekSetup();
  applyTheme();
  handleDayRollover();
  state.pomodoro.secondsLeft = state.pomodoro.secondsLeft || state.pomodoro.workMin*60;
  renderAll();
  save();
  initAuthGate();
}
function eventsForExecution(date){const cursor=calendarCursor;try{calendarCursor=new Date(date);return allCalendarEvents();}finally{calendarCursor=cursor;}}
async function startTaskFocus(ref){
  const [pid,gid]=ref.split(':'),project=findProject(pid),gate=project&&findGate(project,gid);
  if(!gate||progressPct(gate)===100)return;
  const p=state.pomodoro;
  if(p.taskRef===ref&&p.mode==='focus'){setView('focus');if(!p.running)pomoToggle();save();return;}
  if(p.running||p.mode!=='focus'||p.secondsLeft!==p.workMin*60){
    const ok=await uiConfirm('Start a fresh focus session for this task? Your current timer will be reset, without awarding completion XP.',{title:'Switch focus?',okLabel:'Start new session'});if(!ok)return;
  }
  pomoReset();p.taskRef=ref;pomoToggle();save();setView('focus');renderFocus();
}
function openNextExecutionWeek(){calendarCursor=weekStart(new Date());calendarCursor.setDate(calendarCursor.getDate()+7);calendarSelectedDate=todayStr(calendarCursor);setView('calendar');renderCalendar();document.getElementById('planWeekOpen')?.click();}
document.addEventListener('click',event=>{for(const id of ['navMore','hunterOverview']){const node=document.getElementById(id);if(node?.open&&!node.contains(event.target))node.open=false;}});
todayUI=window.ARISEToday?.create({getState:()=>state,todayStr,escapeHtml,computeScore,dueMultiplier,progressPct,getEvents:eventsForExecution,save,setView,startFocus:startTaskFocus,completeTask:(pid,gid,nid)=>nid?toggleSubtask(pid,gid,nid):markGateCleared(pid,gid),toast,weekStart,renderCalendar,toastCalendarUndo,openNextWeek:openNextExecutionWeek});
async function createTomorrowGate(input){
  const project=findProject(input.projectId),title=String(input.title||'').trim(),minutes=Math.max(15,Math.min(480,Number(input.duration)||30));
  if(!project)throw Error('Choose a project for this task.');
  if(!title||title.length>180)throw Error('Enter a task name under 180 characters.');
  const tomorrow=new Date();tomorrow.setHours(12,0,0,0);tomorrow.setDate(tomorrow.getDate()+1);const date=todayStr(tomorrow);
  const gate={id:uid('gate'),title,urgency:+input.urgency||3,impact:+input.impact||3,effort:+input.effort||3,due:date,durationMin:minutes,plannedStart:input.time||null,children:[],createdAt:Date.now()};
  pushUndo('planning tomorrow');project.tasks.push(gate);
  let event=null;
  try{
    if(input.time){
      const [hour,minute]=input.time.split(':').map(Number),endTotal=hour*60+minute+minutes;
      if(!Number.isFinite(hour)||!Number.isFinite(minute)||endTotal>=24*60)throw Error('That task would run past midnight. Choose an earlier time or shorter duration.');
      const end=`${String(Math.floor(endTotal/60)).padStart(2,'0')}:${String(endTotal%60).padStart(2,'0')}`;
      // Plan Tomorrow always creates an ARISE-owned block. It therefore appears
      // immediately, survives offline use and syncs to every signed-in ARISE device.
      event=createLocalCalendarEvent(title,date,input.time,end,`[ARISE_GATE:${project.id}:${gate.id}]`,15);
      gate.calendarEventId=event.id;
    }
    save();renderPortal();renderAllTasks();renderCalendar();todayUI?.render();return gate;
  }catch(error){
    if(event)state.calendar.localEvents=state.calendar.localEvents.filter(item=>item.id!==event.id);
    project.tasks=project.tasks.filter(item=>item.id!==gate.id);
    save();renderPortal();renderAllTasks();renderCalendar();throw error;
  }
}
function openTomorrowCalendar(){
  const tomorrow=new Date();tomorrow.setHours(12,0,0,0);tomorrow.setDate(tomorrow.getDate()+1);
  calendarCursor=new Date(tomorrow);calendarSelectedDate=todayStr(tomorrow);calendarAutoScrollPending=true;setView('calendar');renderCalendar();scrollCalendarToNow();
}
function scheduleTomorrowGate(ref){
  const [pid,gid]=ref.split(':'),project=findProject(pid),gate=project&&findGate(project,gid);if(!gate)return;
  const tomorrow=new Date();tomorrow.setHours(12,0,0,0);tomorrow.setDate(tomorrow.getDate()+1);const date=todayStr(tomorrow),start=gate.plannedStart||'09:00',minutes=gate.durationMin||60,total=Number(start.slice(0,2))*60+Number(start.slice(3,5))+minutes,end=`${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
  calendarCursor=new Date(tomorrow);calendarSelectedDate=date;setView('calendar');renderCalendar();openCalendarEvent({title:gate.title,date,start,end,gate:ref,source:'tomorrow'});
}
tomorrowUI=window.ARISETomorrow?.create({getState:()=>state,todayStr,escapeHtml,progressPct,getEvents:eventsForExecution,createTask:createTomorrowGate,openCalendar:openTomorrowCalendar,scheduleTask:scheduleTomorrowGate,setView,toast});
window.ARISEWeeklyPlannerUI?.create({getState:()=>state,getCursor:()=>calendarCursor,escapeHtml,todayStr,weekStart,allCalendarEvents,calendarGateRef,progressPct,save,uid,toast,renderCalendar,toastCalendarUndo,calTime,isDesktop,tauriInvoke});
function quickCreateGate(pid,title,due){
  if(!findProject(pid)||!title.trim()||title.length>180)throw Error('Invalid task details');
  const before=JSON.parse(JSON.stringify(state.projects)),undoBefore=undoStack.slice();
  try{addGate(pid,title.trim(),3,3,3,due||null);}
  catch(error){state.projects=before;undoStack.splice(0,undoStack.length,...undoBefore);throw error;}
}
window.ARISEQuickActions?.create({getState:()=>state,escapeHtml,progressPct,score:g=>computeScore(g.urgency,g.impact,g.effort)*dueMultiplier(g.due),setView,openGate:openGateEditor,startFocus:startTaskFocus,createGate:quickCreateGate,toast});
function reminderEvents(){
  const date=new Date(),tomorrow=new Date(date);tomorrow.setDate(tomorrow.getDate()+1);
  return [...eventsForExecution(date),...eventsForExecution(tomorrow)].filter(e=>{const ref=calendarGateRef(e),project=ref&&findProject(ref.pid),gate=project&&findGate(project,ref.gid);return !gate||progressPct(gate)<100;});
}
notificationsUI=window.ARISENotifications?.create({getState:()=>state,save,toast,getEvents:reminderEvents});
customRemindersUI=window.ARISECustomReminders?.create({getState:()=>state,save,escapeHtml,uid,confirm:uiConfirm});
healthUI=window.ARISEHealth?.create({getState:()=>state,save,toast,notify:(title,body)=>notificationsUI?notificationsUI.deliver('water',title,body):toast(`${title} · ${body}`)});
window.ARISEHandControl?.create();
captureTrelloReturn();
maybeMigrateFromFileOrigin().finally(init);

})();
