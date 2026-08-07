import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AuthGate from './AuthGate';
import './styles.css';
import './auth.css';
import './keve-theme.css';
import './layout-fixes.css';
import packageJson from '../package.json';
createRoot(document.getElementById('root')!).render(<StrictMode><AuthGate><App /></AuthGate></StrictMode>);
if('serviceWorker'in navigator)window.addEventListener('load',()=>{void(async()=>{
  const registration=await navigator.serviceWorker.register('/sw-v2.1.5.js',{updateViaCache:'none'});
  let lastActivity=Date.now(),reloading=false;
  const active=()=>{lastActivity=Date.now()};
  for(const event of ['pointerdown','keydown','touchstart'] as const)window.addEventListener(event,active,{passive:true});
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(reloading||document.body.dataset.appBusy==='true'||Date.now()-lastActivity<15*60_000)return;
    reloading=true;location.reload();
  });
  window.setInterval(()=>{
    if(document.visibilityState==='visible'&&document.body.dataset.appBusy!=='true'&&Date.now()-lastActivity>=15*60_000)void(async()=>{
      const response=await fetch(`/version.json?t=${Date.now()}`,{cache:'no-store'});if(!response.ok)return;
      const remote=await response.json() as {version?:string};if(remote.version&&remote.version!==packageJson.version){await registration.update();reloading=true;location.reload();}
    })().catch(()=>undefined);
  },60_000);
})()});
