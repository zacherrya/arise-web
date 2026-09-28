import {FilesetResolver,HandLandmarker} from './vendor/mediapipe/vision_bundle.mjs';
let detector;
self.onmessage=async({data})=>{
  try{
    if(data.type==='init'){
      const files=await FilesetResolver.forVisionTasks(new URL('./vendor/mediapipe/wasm',import.meta.url).href);
      detector=await HandLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:new URL('./vendor/mediapipe/hand_landmarker.task',import.meta.url).href,delegate:'CPU'},runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:.65,minHandPresenceConfidence:.65,minTrackingConfidence:.65});
      self.postMessage({type:'ready'});
    }else if(data.type==='frame'&&detector){
      try{const result=detector.detectForVideo(data.frame,data.time);self.postMessage({type:'result',landmarks:result.landmarks[0]||null,time:data.time});}finally{data.frame.close();}
    }
  }catch(error){self.postMessage({type:'error',message:String(error.message||error)});}
};
