/* Naija Wave — app bootstrap: chrome, nav, socket wiring, badges. */
import { api, auth, sock } from './api.js';
import { initRouter, routeKey } from './router.js?v=2';
import { toast, av, esc, tick } from './ui.js';

const TABS=[
  {h:'#/home', l:'Home', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>'},
  {h:'#/pulse', l:'Pulse', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12h4l3-8 4 16 3-8h6"/></svg>', key:'#/pulse'},
  {h:'#/messages', l:'Messages', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>', badge:'msg'},
  {h:'#/notifications', l:'Alerts', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>', badge:'notif'},
  {h:'#/profile/me', l:'Profile', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>', key:'#/profile'},
];
const NAVALL=[
  ...TABS,
  {h:'#/explore', l:'Explore', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>'},
  {h:'#/court', l:"People's Court", svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M5 7l7-4 7 4"/><path d="M3 13l2-6 2 6a3.5 3.5 0 0 1-4 0z"/><path d="M17 13l2-6 2 6a3.5 3.5 0 0 1-4 0z"/><path d="M8 21h8"/></svg>'},
  {h:'#/versus', l:'Naija Versus', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3H4v18h4"/><path d="M16 3h4v18h-4"/><path d="M12 7v10"/></svg>'},
  {h:'#/buzz', l:'Street Buzz', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>'},
  {h:'#/verify', l:'Verification', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 2.4 3.4-.5.9 3.3 3 1.7-1.5 3.1 1.5 3.1-3 1.7-.9 3.3-3.4-.5L12 22l-2.4-2.4-3.4.5-.9-3.3-3-1.7L3.8 12 2.3 8.9l3-1.7.9-3.3 3.4.5z"/><path d="M9 12l2 2 4-4"/></svg>'},
  {h:'#/settings', l:'Settings', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'},
];
const ADMINITEM={h:'#/admin', l:'Admin', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'};

let isAdmin=false;
async function checkAdmin(){
  if(!auth.loggedIn()){ isAdmin=false; return; }
  try{ await api.get('/api/admin/stats'); isAdmin=true; }
  catch(e){ isAdmin = e.status!==403 ? isAdmin : false; }
}

function setActiveNav(){
  const k=routeKey();
  document.querySelectorAll('#tabbar a, #sideNav a, #drawerNav a').forEach(a=>{
    const ak=a.dataset.k||a.getAttribute('href').split('/').slice(0,3).join('/');
    a.classList.toggle('active', ak===k || (k==='#/profile' && a.dataset.k==='#/profile'));
  });
}

function buildChrome(){
  const me=auth.me, logged=auth.loggedIn();
  ['appbar','tabbar','sidebar'].forEach(id=>document.getElementById(id).classList.toggle('hidden',!logged));
  document.getElementById('rail').classList.toggle('hidden',!logged);
  if(!logged) return;
  // tabbar
  document.getElementById('tabbar').innerHTML=TABS.map(t=>`
    <a href="${t.h==='#/profile/me'?'#/profile/'+me.username:t.h}" data-k="${t.key||t.h.split('/').slice(0,2).join('/')}">
      ${t.svg}<span>${t.l}</span>${t.badge?`<span class="tbadge hidden" data-badge="${t.badge}"></span>`:''}
    </a>`).join('');
  // sidebar
  const items=[...NAVALL.slice(0,9), NAVALL[9], NAVALL[10]];
  document.getElementById('sideNav').innerHTML=items.map(t=>`
    <a href="${t.h}" data-k="${t.key||t.h}">${t.svg}<span class="lbl">${t.l}</span></a>`).join('')
    +(isAdmin?`<a href="#/admin" data-k="#/admin">${ADMINITEM.svg}<span class="lbl">Admin</span></a>`:'');
  document.getElementById('sideMe').innerHTML=`
    <a href="#/profile/${esc(me.username)}" style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">${av(me,'xs')}
    <span class="sideme-t" style="min-width:0"><span style="font-weight:700;font-size:13.5px;display:flex;gap:4px;align-items:center">${esc(me.display_name)} ${tick(me.verification)}</span>
    <span class="muted small" style="display:block;overflow:hidden;text-overflow:ellipsis">@${esc(me.username)}</span></span></a>`;
  document.getElementById('sideWaveBtn').onclick=()=>location.hash='#/home';
  // drawer
  const ditems=[...NAVALL];
  if(isAdmin) ditems.push(ADMINITEM);
  document.getElementById('drawerNav').innerHTML=ditems.map(t=>`
    <a href="${t.h}" data-k="${t.key||t.h}">${t.svg}<span>${t.l}</span></a>`).join('');
  document.getElementById('drawerName').textContent=me.display_name;
  document.getElementById('drawerUser').textContent='@'+me.username;
  document.getElementById('appbarAvatarImg').src=me.avatar_url||'img/mark.svg';
  document.getElementById('appbarAvatar').href='#/profile/'+me.username;
  setActiveNav();
  loadRail();
}

async function loadRail(){
  try{
    const [tr,sg]=await Promise.all([
      api.get('/api/hashtags/trending').catch(()=>[]),
      auth.loggedIn()?api.get('/api/users/suggested').catch(()=>({users:[]})):Promise.resolve({users:[]}),
    ]);
    const tags=Array.isArray(tr)?tr:(tr.items||[]);
    document.getElementById('railTrends').innerHTML=`<h3>Trending in Naija</h3>`+
      (tags.slice(0,5).map(t=>`<a class="trow" href="#/tag/${esc(t.tag.replace('#',''))}" style="border:none;padding:8px 0">
        <div><div class="tt">#${esc(t.tag.replace('#',''))}</div><div class="tc">${t.posts_count??''} waves${t.category?' · '+esc(t.category):''}</div></div></a>`).join('')||'<p class="muted small">Nothing trending yet.</p>');
    const users=sg.users||[];
    document.getElementById('railSuggest').innerHTML=`<h3>Who to follow</h3>`+
      (users.slice(0,3).map(u=>`<div class="urow" style="border:none;padding:8px 0">${av(u,'xs')}
        <a class="uinfo" href="#/profile/${esc(u.username)}"><div class="uname" style="font-size:13.5px">${esc(u.display_name)} ${tick(u.verification)}</div>
        <div class="uuser">@${esc(u.username)}</div></a></div>`).join('')||'<p class="muted small">No suggestions right now.</p>');
  }catch{}
}

function openDrawer(o){
  document.getElementById('drawer').classList.toggle('hidden',!o);
  document.getElementById('scrim').classList.toggle('hidden',!o);
}

async function refreshBadges(){
  if(!auth.loggedIn()) return;
  try{
    const [n,c]=await Promise.all([
      api.get('/api/notifications/unread-count').catch(()=>({count:0})),
      api.get('/api/conversations').catch(()=>[]),
    ]);
    const nb=document.querySelector('[data-badge="notif"]');
    if(nb){ nb.textContent=n.count>99?'99+':n.count; nb.classList.toggle('hidden',!n.count); }
    document.getElementById('bellDot')?.classList.toggle('hidden',!n.count);
    const unread=(Array.isArray(c)?c:[]).reduce((s,x)=>s+(x.unread_count||0),0);
    const mb=document.querySelector('[data-badge="msg"]');
    if(mb){ mb.textContent=unread>99?'99+':unread; mb.classList.toggle('hidden',!unread); }
  }catch{}
}

function wireGlobal(){
  document.getElementById('menuBtn').onclick=()=>openDrawer(true);
  document.getElementById('scrim').onclick=()=>openDrawer(false);
  document.getElementById('drawerNav').addEventListener('click',e=>{ if(e.target.closest('a')) openDrawer(false); });
  document.getElementById('drawerLogout').onclick=()=>{ openDrawer(false); auth.logout(); };
  // incoming calls + notifications via socket
  sock.on('notification', n=>{
    refreshBadges();
    if(n.type==='call_missed') toast('Missed call from '+(n.actor?.display_name||'someone'));
    else if(n.type==='verification') toast(n.text||'Verification update','ok');
    else if(n.type==='announcement') toast(n.text||'New announcement from Naija Wave');
  });
  sock.on('call:incoming', d=>{ import('./calls.js?v=2').then(m=>{ m.wireCalls(); m.handleIncoming(d); }); });
  sock.onNet(offline=>{ if(!offline){ refreshBadges(); document.dispatchEvent(new CustomEvent('nw:reconnect')); } });
  document.addEventListener('nw:posted',()=>{});
  setInterval(refreshBadges, 45000);
}

/* ---------- boot ---------- */
async function boot(){
  wireGlobal();
  if(auth.loggedIn()){
    await auth.refreshMe().catch(()=>{});
    sock.connect();
    await checkAdmin();
  }
  buildChrome();
  auth.onAuthChange(async logged=>{
    if(logged){ await auth.refreshMe().catch(()=>{}); await checkAdmin(); }
    else isAdmin=false;
    buildChrome();
    if(logged) refreshBadges();
  });
  initRouter(()=>{ setActiveNav(); openDrawer(false); });
  if(auth.loggedIn()) refreshBadges();
}
document.addEventListener('DOMContentLoaded',boot);
