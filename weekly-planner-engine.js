/* Pure, local planning: no calendar writes and no network requests. */
(function(root){
  const modes={safe:.55,balanced:.75,ambitious:.9};
  const dateKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  function propose({week,items,events=[],days=[1,2,3,4,5],start=9,end=18,capacity=35,energy='morning',mode='balanced',focusOrder=[],now=Date.now()}){
    const busy=events.map(e=>({start:+new Date(e.start?.dateTime||`${e.start?.date}T00:00:00`),end:+new Date(e.end?.dateTime||`${e.end?.date}T00:00:00`)})).filter(e=>Number.isFinite(e.start)&&e.end>e.start);
    const weekStart=+new Date(week+'T00:00:00'),weekEnd=new Date(weekStart);weekEnd.setDate(weekEnd.getDate()+7);
    const committed=busy.reduce((n,e)=>n+Math.max(0,Math.min(e.end,+weekEnd)-Math.max(e.start,weekStart))/60000,0);
    let remaining=Math.max(0,capacity*60*(modes[mode]||.75)-committed);
    const blocks=[],skipped=[],pending=items.filter(i=>i.selected!==false).map(i=>({...i}));
    const score=i=>((+i.urgency||3)*(+i.impact||3)/Math.max(1,+i.effort||3))*(i.due?Math.max(1,4-Math.max(0,(+new Date(i.due+'T23:59:59')-now)/86400000)/7):1);
    const order=id=>focusOrder.includes(id)?focusOrder.indexOf(id):Number.MAX_SAFE_INTEGER;
    pending.sort((a,b)=>order(a.id)-order(b.id)||score(b)-score(a));
    while(pending.length){
      const index=pending.findIndex(i=>!i.after||blocks.some(b=>b.id===i.after)||!pending.some(p=>p.id===i.after));
      if(index<0){skipped.push(...pending.map(i=>({...i,reason:'Circular dependency. Choose a different prerequisite.'})));break;}
      const item=pending.splice(index,1)[0],duration=+item.minutes;
      const prerequisite=item.after&&blocks.find(b=>b.id===item.after);
      if(item.after&&!prerequisite){skipped.push({...item,reason:'Prerequisite is not scheduled.'});continue;}
      if(!Number.isFinite(duration)||duration<15||duration>480){skipped.push({...item,reason:'Use a duration between 15 and 480 minutes.'});continue;}
      if(duration>remaining){skipped.push({...item,reason:'Outside this plan’s capacity. Try a lighter scope or more hours.'});continue;}
      const slots=[];
      for(let offset=0;offset<7;offset++){
        const date=new Date(weekStart);date.setDate(date.getDate()+offset);if(!days.includes(date.getDay()))continue;
        for(let minute=start*60;minute+duration<=end*60;minute+=15){
          const s=new Date(date);s.setMinutes(minute);const e=+s+duration*60000;
          if(+s<now||prerequisite&&+s<prerequisite.end+15*60000)continue;
          if(item.due&&dateKey(date)>item.due)continue;
          if(busy.some(b=>+s<b.end+15*60000&&e>b.start-15*60000))continue;
          const preferred=energy==='afternoon'?minute>=13*60:energy==='evening'?minute>=17*60:minute<12*60;
          slots.push({start:+s,end:e,weight:offset*10000+(preferred?0:2000)+minute});
        }
      }
      slots.sort((a,b)=>a.weight-b.weight);const slot=slots[0];
      if(!slot){skipped.push({...item,reason:'No free slot before the deadline within your working hours.'});continue;}
      blocks.push({...item,...slot,score:score(item)});busy.push(slot);remaining-=duration;
    }
    return {blocks,skipped,committed,planned:blocks.reduce((n,b)=>n+b.minutes,0),budget:capacity*60*(modes[mode]||.75)};
  }
  function validateAdvice(raw,items){
    const data=typeof raw==='string'?JSON.parse(raw):raw;
    if(!data||typeof data.summary!=='string'||data.summary.length>4000||!Array.isArray(data.recommendations)||data.recommendations.length>12)throw new Error('Nexus returned an invalid plan. Try again.');
    const ids=new Set(items.filter(i=>i.selected!==false).map(i=>i.id)),seen=new Set();
    for(const r of data.recommendations){
      if(!r||!ids.has(r.id)||seen.has(r.id)||typeof r.why!=='string'||typeof r.firstAction!=='string'||r.why.length>2000||r.firstAction.length>2000)throw new Error('Nexus referenced an invalid task. Your draft is unchanged.');
      seen.add(r.id);
    }
    return {summary:data.summary,recommendations:data.recommendations.map(r=>({id:r.id,why:r.why,firstAction:r.firstAction}))};
  }
  root.AriseWeeklyPlanner={propose,dateKey,validateAdvice};
  if(typeof module!=='undefined')module.exports=root.AriseWeeklyPlanner;
})(typeof window!=='undefined'?window:globalThis);
