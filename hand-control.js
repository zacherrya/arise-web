(function(){
  'use strict';
  function create(){
    const button=document.getElementById('handControlToggle');if(!button)return null;
    const panel=document.createElement('section');panel.className='hand-panel';panel.hidden=true;panel.setAttribute('aria-label','Hand control');
    panel.innerHTML='<div class="hand-panel-head"><strong>Hand Control · Beta</strong><button type="button" class="btn btn-sm" data-hand-stop>Stop</button></div><video autoplay muted playsinline aria-label="Local camera preview"></video><p data-hand-status role="status" aria-live="polite">Camera off.</p><label>Sensitivity <input data-hand-sensitivity type="range" min="0.6" max="1.8" step="0.1" value="1"></label><p class="hand-help">Open your hand to arm. Point with your index finger, then pinch and release to click. Escape stops the camera. ARISE only; no drag or system cursor control yet.</p>';
    document.body.appendChild(panel);
    const cursor=document.createElement('div');cursor.className='hand-cursor';cursor.hidden=true;cursor.setAttribute('aria-hidden','true');document.body.appendChild(cursor);
    const video=panel.querySelector('video'),label=panel.querySelector('[data-hand-status]'),slider=panel.querySelector('[data-hand-sensitivity]'),engine=window.ARISEHandGestures.create();
    let worker=null,stream=null,active=false,starting=false,generation=0,frameHandle=0,busy=false,lastFrame=0,readyTimer=null,frameTimer=null,rejectReady=null,hover=null;
    const status=text=>{if(label.textContent!==text)label.textContent=text;};
    const sensitivity=()=>+slider.value||1;
    try{const saved=Number(localStorage.getItem('arise.handSensitivity'));if(saved>=.6&&saved<=1.8)slider.value=String(saved);}catch{}
    slider.addEventListener('input',()=>{engine.reset();try{localStorage.setItem('arise.handSensitivity',slider.value);}catch{}});
    function clearHover(){hover?.classList.remove('hand-hover');hover=null;}
    function stop(message='Hand control stopped. Camera off.'){
      generation++;active=false;starting=false;busy=false;cancelAnimationFrame(frameHandle);clearTimeout(readyTimer);clearTimeout(frameTimer);rejectReady?.(Error('Cancelled'));rejectReady=null;
      worker?.terminate();worker=null;stream?.getTracks().forEach(t=>t.stop());stream=null;video.pause();video.srcObject=null;engine.reset();cursor.hidden=true;clearHover();
      button.setAttribute('aria-pressed','false');button.title='Start hand control';status(message);
    }
    function targetAt(x,y){
      const el=document.elementFromPoint(x,y)?.closest('button,a[href],input,textarea,select,summary,[role="button"],[data-cal-event]');
      if(!el||el.closest('[inert]')||el.disabled||el.getAttribute('aria-disabled')==='true')return null;
      // Never use camera gestures to grant permissions or open local file pickers.
      if(el.matches('input[type="file"],#notificationEnable,#voiceBtn,#wakeBtn'))return null;
      const dialog=document.querySelector('dialog[open]');if(dialog&&!dialog.contains(el))return null;return el;
    }
    function result(data){
      clearTimeout(frameTimer);busy=false;
      const point=engine.update(data.landmarks,performance.now(),innerWidth,innerHeight,sensitivity());
      if(!point.visible){cursor.hidden=true;clearHover();status('Show one open hand to the camera.');return;}
      const host=document.querySelector('dialog[open]')||document.body;if(cursor.parentElement!==host)host.appendChild(cursor);
      cursor.hidden=false;cursor.style.left=point.x+'px';cursor.style.top=point.y+'px';cursor.classList.toggle('pinching',point.pinching);
      const target=targetAt(point.x,point.y);if(target!==hover){clearHover();hover=target;hover?.classList.add('hand-hover');}
      status(point.pinching?'Release your pinch to click.':point.armed?'Ready · point, pinch, release.':'Open your hand briefly to arm.');
      if(point.click&&target){
        if(target.matches('input[type="range"]')){const r=target.getBoundingClientRect(),min=Number(target.min)||0,max=Number(target.max)||100,step=Number(target.step)||1;target.value=String(min+Math.round(Math.max(0,Math.min(1,(point.x-r.left)/r.width))*(max-min)/step)*step);target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('change',{bubbles:true}));}
        else if(target.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]),textarea,select')){target.focus();status('Field selected. Use your keyboard to enter or choose a value.');}
        else target.click();
      }
    }
    async function frame(time,token){
      if(!active||token!==generation)return;
      frameHandle=requestAnimationFrame(t=>frame(t,token));
      if(busy||time-lastFrame<85||video.readyState<2)return;busy=true;lastFrame=time;
      try{const bitmap=await createImageBitmap(video,{resizeWidth:480,resizeHeight:360});if(!active||token!==generation){bitmap.close();return;}worker.postMessage({type:'frame',frame:bitmap,time},[bitmap]);frameTimer=setTimeout(()=>{if(token===generation)stop('Tracking stalled. Camera stopped; you can try again.');},6000);}catch(_){if(token===generation)stop('Camera frames could not be processed. Camera stopped.');}
    }
    async function start(){
      if(active||starting){stop();return;}
      if(!navigator.mediaDevices?.getUserMedia||!window.Worker||!window.createImageBitmap){panel.hidden=false;status('Hand control needs the updated desktop app or a supported secure browser. Camera remains off.');return;}
      starting=true;const token=++generation;panel.hidden=false;button.setAttribute('aria-pressed','true');button.title='Stop hand control';status('Loading the local hand model…');
      try{
        worker=new Worker(new URL('hand-worker.mjs',document.baseURI),{type:'module'});
        await new Promise((resolve,reject)=>{
          rejectReady=reject;readyTimer=setTimeout(()=>reject(Error('Hand model loading timed out')),25000);
          worker.onerror=()=>{if(token!==generation)return;if(starting)reject(Error('Hand tracking could not load in this app.'));else stop('Hand tracking stopped after an error. Camera off.');};
          worker.onmessage=({data})=>{if(token!==generation)return;if(data.type==='ready'){clearTimeout(readyTimer);rejectReady=null;resolve();}else if(data.type==='error'){if(starting)reject(Error('Hand model could not start.'));else stop('Hand tracking failed. Camera off.');}else if(data.type==='result'&&active)result(data);};
          worker.postMessage({type:'init'});
        });
        if(token!==generation)return;status('Allow camera access to start. Nothing is recorded.');
        const camera=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:640},height:{ideal:480}}});
        if(token!==generation){camera.getTracks().forEach(t=>t.stop());return;}
        stream=camera;video.srcObject=camera;video.muted=true;await video.play();if(token!==generation)return;
        stream.getVideoTracks().forEach(t=>t.addEventListener('ended',()=>{if(token===generation)stop('Camera disconnected. Hand control stopped.');}));
        starting=false;active=true;lastFrame=0;engine.reset();status('Show one open hand to the camera.');frameHandle=requestAnimationFrame(t=>frame(t,token));
      }catch(error){if(token===generation)stop(error.name==='NotAllowedError'?'Camera access was denied. Enable it in macOS Settings → Privacy & Security → Camera, then try again.':`${error.message||'Could not start hand tracking'} Camera off.`);}
    }
    button.addEventListener('click',()=>{void start();});
    panel.querySelector('[data-hand-stop]').addEventListener('click',()=>{stop();panel.hidden=true;});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&(active||starting)){e.preventDefault();e.stopImmediatePropagation();stop();panel.hidden=true;}},true);
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&(active||starting))stop('Paused because ARISE is hidden. Click Hand Control to restart.');});
    window.addEventListener('blur',()=>{if(active)stop('Paused because you left ARISE. Click Hand Control to restart.');});
    window.addEventListener('pagehide',()=>stop());
    return{start,stop};
  }
  window.ARISEHandControl={create};
})();
