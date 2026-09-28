(function(){
  'use strict';
  if(!/^https?:$/.test(location.protocol)||!!window.__TAURI_INTERNALS__)return;
  const secure=location.protocol==='https:'||['localhost','127.0.0.1'].includes(location.hostname);
  const installed=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const appleMobile=/iPhone|iPad|iPod/.test(navigator.userAgent);
  const android=/Android/.test(navigator.userAgent);
  const buttons=[document.getElementById('pwaInstall'),document.getElementById('pwaInstallSettings')].filter(Boolean);
  let installPrompt=null;
  function message(text){for(const id of ['pwaInstallHint','pwaInstallSettingsHint']){const node=document.getElementById(id);if(node)node.textContent=text}}
  function render(){for(const button of buttons){button.hidden=installed();button.textContent=appleMobile?'Add ARISE to Home Screen':'Install ARISE'}}
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;render()});
  window.addEventListener('appinstalled',()=>{installPrompt=null;render();message('ARISE is installed.')});
  for(const button of buttons)button.addEventListener('click',async()=>{
    if(!secure){message('Open ARISE from its HTTPS website to install it.');return}
    if(installPrompt){
      const prompt=installPrompt;installPrompt=null;await prompt.prompt();
      const result=await prompt.userChoice;
      message(result.outcome==='accepted'?'ARISE is being added to your device.':'You can install ARISE later from your browser menu.');
      return;
    }
    message(appleMobile
      ?'In Safari, tap Share, then Add to Home Screen. Open ARISE from its new icon to sign in.'
      :android?'In Chrome, open the browser menu and choose Install app or Add to Home Screen.'
      :'In Safari, choose File → Add to Dock. In Chrome or Edge, use the Install icon in the address bar or browser menu.');
  });
  render();
  if(secure&&'serviceWorker' in navigator)window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./service-worker.js',{scope:'./'}).catch(error=>{
      console.warn('ARISE offline shell unavailable:',error);
    });
  });
})();
