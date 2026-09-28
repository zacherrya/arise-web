(function(){
  'use strict';
  const pad=n=>String(n).padStart(2,'0');
  const dayKey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const clean=(value,max=180)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
  const at=(day,time)=>{const d=new Date(`${day}T${time}:00`);return Number.isFinite(+d)?d:null;};
  function eventDate(value){
    const raw=value?.dateTime||value?.date;
    if(!raw)return null;
    const d=value.dateTime?new Date(raw):new Date(`${raw}T00:00:00`);
    return Number.isFinite(+d)?d:null;
  }
  function nextCustom(items,now){
    const candidates=[];
    for(const reminder of Array.isArray(items)?items:[]){
      if(!reminder||reminder.enabled===false||!clean(reminder.title)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(reminder.time||''))continue;
      let when=null;
      if(reminder.repeat==='once'){
        if(/^\d{4}-\d{2}-\d{2}$/.test(reminder.date||''))when=at(reminder.date,reminder.time);
      }else if(reminder.repeat==='daily'){
        when=at(dayKey(now),reminder.time);if(when&&when<=now)when.setDate(when.getDate()+1);
      }else if(reminder.repeat==='weekly'&&Array.isArray(reminder.days)&&reminder.days.length){
        for(let offset=0;offset<8;offset++){
          const day=new Date(now);day.setDate(day.getDate()+offset);if(!reminder.days.includes(day.getDay()))continue;
          const candidate=at(dayKey(day),reminder.time);if(candidate&&candidate>now){when=candidate;break;}
        }
      }
      if(when&&when>now)candidates.push({kind:'custom',title:clean(reminder.title),detail:clean(reminder.note,220)||'Reminder',at:when.toISOString()});
    }
    return candidates.sort((a,b)=>new Date(a.at)-new Date(b.at))[0]||null;
  }
  function waterNext(health,notifications,now){
    if(notifications?.water===false)return null;
    const water=health?.water;if(!water||water.enabled===false)return null;
    const interval=Number(water.interval),glasses=Number(water.glasses),start=water.start,end=water.end;
    if(!Number.isInteger(interval)||interval<15||interval>1440||!/^\d{2}:\d{2}$/.test(start||'')||!/^\d{2}:\d{2}$/.test(end||''))return null;
    const mins=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
    const first=mins(start),last=mins(end);if(first>=last||last>=1440)return null;
    for(let offset=0;offset<2;offset++){
      const day=new Date(now);day.setDate(day.getDate()+offset);
      for(let minute=first;minute<=last;minute+=interval){
        const candidate=new Date(day);candidate.setHours(Math.floor(minute/60),minute%60,0,0);
        if(candidate>now)return{kind:'water',title:'Water break',detail:`${glasses||1} glass${glasses===1?'':'es'}`,at:candidate.toISOString()};
      }
    }
    return null;
  }
  function build({events=[],customReminders=[],health={},notifications={}}={},clock=new Date()){
    const now=new Date(clock),today=dayKey(now);
    const plan=(Array.isArray(events)?events:[]).map(event=>{
      const start=eventDate(event?.start),end=eventDate(event?.end);if(!start||dayKey(start)!==today)return null;
      return{id:clean(event.id,120)||`${+start}`,title:clean(event.summary)||'Untitled',start:start.toISOString(),end:(end||start).toISOString(),allDay:!event.start?.dateTime};
    }).filter(item=>item&&(item.allDay||new Date(item.end)>now)).sort((a,b)=>new Date(a.start)-new Date(b.start)).slice(0,6);
    const custom=notifications?.custom===false?null:nextCustom(customReminders,now),water=waterNext(health,notifications,now);
    const reminders=[custom,water].filter(Boolean).sort((a,b)=>new Date(a.at)-new Date(b.at));
    return{version:1,generatedAt:now.toISOString(),day:today,events:plan,nextReminder:reminders[0]||null,water};
  }
  const api={build,nextCustom,waterNext,dayKey};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof window!=='undefined')window.ARISEWidgetSnapshot=api;
})();
