(function(){
  'use strict';
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  function create(){
    let point=null,openSince=null,armed=false,pinching=false,closeSince=null,anchor=null,lastClick=-Infinity;
    function reset(){point=null;openSince=null;armed=false;pinching=false;closeSince=null;anchor=null;}
    function update(landmarks,time,width,height,sensitivity=1){
      if(!Array.isArray(landmarks)||landmarks.length<21||landmarks.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))){reset();return{visible:false};}
      const distance=(a,b)=>Math.hypot((a.x-b.x)*4/3,a.y-b.y),palm=distance(landmarks[5],landmarks[17]);
      if(palm<.035){reset();return{visible:false};}
      const ratio=distance(landmarks[4],landmarks[8])/palm;
      const raw={x:clamp(((1-landmarks[8].x-.5)*sensitivity/.7+.5)*width,4,width-4),y:clamp(((landmarks[8].y-.5)*sensitivity/.7+.5)*height,4,height-4)};
      const was=point;point=point?{x:point.x+(raw.x-point.x)*.28,y:point.y+(raw.y-point.y)*.28}:raw;
      let click=false;
      if(ratio>.45){
        if(pinching){click=armed&&time-lastClick>650;if(click)lastClick=time;pinching=false;armed=false;openSince=time;}
        if(openSince===null)openSince=time;if(time-openSince>=350)armed=true;
        closeSince=null;
      }else if(ratio<.28){
        if(closeSince===null){closeSince=time;anchor=was||point;}
        openSince=null;if(armed&&time-closeSince>=120)pinching=true;
      }
      const position=(pinching||closeSince!==null||click)&&anchor?anchor:point;
      return{...position,visible:true,armed,pinching,click};
    }
    return{update,reset};
  }
  const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;if(typeof window!=='undefined')window.ARISEHandGestures=api;
})();
