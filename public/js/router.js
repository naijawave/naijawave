/* Naija Wave — hash router with route guards. */
import { auth } from './api.js';

const routes=[
  { p:'#/welcome', v:()=>import('./views/auth.js'), pub:true },
  { p:'#/home', v:()=>import('./views/home.js') },
  { p:'#/explore', v:()=>import('./views/explore.js') },
  { p:'#/pulse', v:()=>import('./views/pulse.js') },
  { p:'#/court', v:()=>import('./views/court.js') },
  { p:'#/versus', v:()=>import('./views/versus.js') },
  { p:'#/buzz', v:()=>import('./views/buzz.js') },
  { p:'#/messages', v:()=>import('./views/messages.js?v=2') },
  { p:'#/messages/:id', v:()=>import('./views/messages.js?v=2') },
  { p:'#/notifications', v:()=>import('./views/notifications.js') },
  { p:'#/profile/:u', v:()=>import('./views/profile.js') },
  { p:'#/post/:id', v:()=>import('./views/post.js') },
  { p:'#/tag/:tag', v:()=>import('./views/tag.js') },
  { p:'#/settings', v:()=>import('./views/settings.js') },
  { p:'#/verify', v:()=>import('./views/verify.js') },
  { p:'#/admin', v:()=>import('./views/admin.js'), admin:true },
];

function match(hash){
  const h=hash.split('?')[0];
  for(const r of routes){
    const rp=r.p.split('/'), hp=h.split('/');
    if(rp.length!==hp.length) continue;
    const params={};
    let ok=true;
    for(let i=0;i<rp.length;i++){
      if(rp[i].startsWith(':')) params[rp[i].slice(1)]=decodeURIComponent(hp[i]);
      else if(rp[i]!==hp[i]){ ok=false; break; }
    }
    if(ok) return { r, params };
  }
  return null;
}

let currentCleanup=null;
export function navigate(h){ location.hash=h; }

export function initRouter(onRoute){
  async function render(){
    if(currentCleanup){ try{currentCleanup()}catch{}; currentCleanup=null; }
    const view=document.getElementById('view');
    let hash=location.hash||'#/home';
    const m=match(hash);
    if(!m){ navigate(auth.loggedIn()?'#/home':'#/welcome'); return; }
    if(!m.r.pub && !auth.loggedIn()){ navigate('#/welcome'); return; }
    if(m.r.pub && auth.loggedIn() && m.r.p==='#/welcome'){ navigate('#/home'); return; }
    view.scrollTop=0; window.scrollTo(0,0);
    onRoute?.(m.r.p, m.params);
    try{
      const mod=await m.r.v();
      currentCleanup = await mod.render(view, m.params) || null;
    }catch(err){
      console.error(err);
      const { errCard }=await import('./ui.js');
      view.innerHTML=`<div class="page">${errCard('Something went wrong loading this page.', render)}</div>`;
    }
  }
  window.addEventListener('hashchange',render);
  render();
}
export function routeKey(){ return (location.hash||'#/home').split('?')[0].split('/').slice(0,2).join('/'); }
