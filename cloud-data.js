(function(root){
  'use strict';
  const PREFIX='arise.cloud.data.v2:user:';
  const DEVICE_KEY='arise.cloud.device.v1';
  const RETRY_MS=60_000;

  function copyForCloud(value){
    // Explicit allowlist: never upload integrations, keys, notifications, or device settings.
    const source=value||{},data={};
    for(const field of ['player','projects','goals','achievements','daily','calendar','health','customReminders','pomodoro']){
      if(source[field]!==undefined)data[field]=JSON.parse(JSON.stringify(source[field]));
    }
    if(data.pomodoro){data.pomodoro.running=false;delete data.pomodoro.timerHandle;}
    if(data.calendar){delete data.calendar.events;delete data.calendar.lastSync;delete data.calendar.recentGuestEmails;}
    if(data.health)delete data.health.lastWaterReminder;
    return data;
  }
  function stable(value){
    if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
    return JSON.stringify(value);
  }
  const fingerprint=value=>stable(copyForCloud(value));
  function hasUserData(data){
    const s=data||{};
    return !!((s.projects||[]).length||(s.goals||[]).length||(s.achievements||[]).length||
      (s.customReminders||[]).length||(s.calendar?.localEvents||[]).length||
      (s.health?.drinks||[]).length||
      (s.player?.xp||0)||(s.player?.totalCleared||0));
  }
  function create(options){
    const {cloud,storage,accountId,getLocal,applyRemote,backup,onStatus=()=>{},onConflict=()=>{},isCurrent=()=>true}=options;
    const metaKey=PREFIX+accountId,backupKey=metaKey+':recovery';
    let running=false,busy=false,pending=false,debounce=null,interval=null,conflict=null,failures=0,retryAfter=0,generation=0;
    let deviceId=storage.getItem(DEVICE_KEY);
    if(!deviceId){deviceId=options.deviceId||root.crypto?.randomUUID?.();if(!deviceId)throw Error('A secure device ID is required for sync.');storage.setItem(DEVICE_KEY,deviceId);}
    const current=epoch=>running&&generation===epoch&&isCurrent(accountId)&&cloud.status().userId===accountId;
    function meta(){try{return JSON.parse(storage.getItem(metaKey)||'null');}catch(_){return null;}}
    function saveMeta(row,data){storage.setItem(metaKey,JSON.stringify({revision:Number(row.revision),fingerprint:fingerprint(data)}));}
    function status(text,kind=''){onStatus(text,kind);}
    function setConflict(remote,reason){
      conflict={remote,reason,local:copyForCloud(getLocal())};
      onConflict({reason,remoteRevision:remote?.revision??null,localProjects:conflict.local.projects?.length||0,cloudProjects:remote?.data?.projects?.length||0});
      status('Two different copies need your choice. Sync is paused.','warn');
    }
    async function preserve(remote){
      const local=copyForCloud(getLocal());
      // Preserve both sides before any replacement, including a cloud-side overwrite.
      storage.setItem(backupKey,JSON.stringify({savedAt:new Date().toISOString(),local,remote}));
      await backup(local,remote);
    }
    async function check(force=false){
      if(!running||conflict)return;
      if(busy){pending=true;return;}
      if(!force&&Date.now()<retryAfter)return;
      const epoch=generation;busy=true;
      try{
        status('Checking Supabase…');
        const remote=await cloud.readState();
        if(!current(epoch))return;
        const local=copyForCloud(getLocal()),localFingerprint=fingerprint(local),m=meta();
        const remoteFingerprint=remote?fingerprint(remote.data):null;
        if(!remote){
          if(m?.revision>0){setConflict(null,'cloud-missing');return;}
          const result=await cloud.pushState(0,local,deviceId);
          if(!current(epoch))return;
          saveMeta(result,local);failures=0;status('Synced to Supabase.','ok');return;
        }
        if(!m){
          if(localFingerprint===remoteFingerprint){saveMeta(remote,local);status('Synced to Supabase.','ok');return;}
          if(!hasUserData(local)){
            await preserve(remote);
            if(!current(epoch))return;
            if(fingerprint(getLocal())!==localFingerprint){setConflict(remote,'both-changed');return;}
            await applyRemote(copyForCloud(remote.data));
            if(!current(epoch))return;
            saveMeta(remote,remote.data);status('Restored your cloud copy.','ok');return;
          }
          setConflict(remote,'first-sync');return;
        }
        if(Number(remote.revision)!==Number(m.revision)){
          if(localFingerprint===remoteFingerprint){saveMeta(remote,local);status('Synced to Supabase.','ok');return;}
          if(localFingerprint!==m.fingerprint){setConflict(remote,'both-changed');return;}
          await preserve(remote);
          if(!current(epoch))return;
          if(fingerprint(getLocal())!==localFingerprint){setConflict(remote,'both-changed');return;}
          await applyRemote(copyForCloud(remote.data));
          if(!current(epoch))return;
          saveMeta(remote,remote.data);status('Updated from Supabase.','ok');return;
        }
        if(remoteFingerprint!==m.fingerprint){
          if(localFingerprint===remoteFingerprint){saveMeta(remote,local);status('Synced to Supabase.','ok');return;}
          if(localFingerprint!==m.fingerprint){setConflict(remote,'both-changed');return;}
          await preserve(remote);
          if(!current(epoch))return;
          if(fingerprint(getLocal())!==localFingerprint){setConflict(remote,'both-changed');return;}
          await applyRemote(copyForCloud(remote.data));
          if(!current(epoch))return;
          saveMeta(remote,remote.data);status('Updated from Supabase.','ok');return;
        }
        if(localFingerprint===m.fingerprint){status('Synced to Supabase.','ok');return;}
        const result=await cloud.pushState(remote.revision,local,deviceId);
        if(!current(epoch))return;
        saveMeta(result,local);status('Synced to Supabase.','ok');
      }catch(error){
        if(!current(epoch))return;
        if(error.syncConflict){
          try{const remote=await cloud.readState();if(current(epoch))setConflict(remote,'both-changed');}
          catch(readError){status('Cloud changed, but it could not be checked: '+readError.message,'err');}
        }else{
          failures++;retryAfter=Date.now()+Math.min(15*RETRY_MS,RETRY_MS*2**Math.min(failures-1,4));
          status('Sync paused: '+error.message+' Your device copy is safe.','err');
        }
      }finally{
        busy=false;
        if(pending&&current(epoch)&&!conflict){pending=false;schedule();}
      }
    }
    function schedule(){
      if(!running||conflict)return;
      if(debounce)clearTimeout(debounce);
      debounce=setTimeout(()=>{debounce=null;void check();},1800);
    }
    async function choose(which){
      if(!conflict||busy||!running)throw Error('There is no active sync choice.');
      const selected=conflict,epoch=generation;busy=true;
      try{
        await preserve(selected.remote);
        if(!current(epoch))return;
        if(which==='device'){
          const local=copyForCloud(getLocal());
          const result=await cloud.pushState(selected.remote?.revision||0,local,deviceId);
          if(!current(epoch))return;
          saveMeta(result,local);
        }else if(which==='cloud'&&selected.remote){
          const latest=await cloud.readState();
          if(!current(epoch))return;
          if(!latest||latest.revision!==selected.remote.revision||fingerprint(latest.data)!==fingerprint(selected.remote.data)){
            setConflict(latest,'both-changed');
            throw Error('The cloud copy changed while you were choosing. Review the latest copy before trying again.');
          }
          await applyRemote(copyForCloud(selected.remote.data));
          if(!current(epoch))return;
          saveMeta(selected.remote,selected.remote.data);
        }else throw Error('There is no cloud copy to use.');
        conflict=null;onConflict(null);status('Synced to Supabase.','ok');
      }catch(error){
        if(current(epoch)&&error.syncConflict){
          try{setConflict(await cloud.readState(),'both-changed');}
          catch(_){status('The cloud copy changed again. Both copies are preserved; try Sync now later.','err');}
        }else if(current(epoch))status('Sync choice failed: '+error.message+' Both copies are still preserved.','err');
        throw error;
      }finally{busy=false;}
    }
    async function start(){
      if(running)return;
      running=true;generation++;failures=0;retryAfter=0;
      interval=setInterval(()=>{if(root.navigator?.onLine!==false)void check();},60_000);
      await check(true);
    }
    function stop(){
      running=false;generation++;pending=false;conflict=null;
      if(debounce)clearTimeout(debounce);debounce=null;
      if(interval)clearInterval(interval);interval=null;
      onConflict(null);
    }
    return {start,stop,check,localChanged:schedule,choose,status:()=>({running,busy,conflict:!!conflict,revision:meta()?.revision||0})};
  }
  const api={create,copyForCloud,fingerprint,hasUserData};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.ARISECloudData=api;
})(typeof window!=='undefined'?window:globalThis);
