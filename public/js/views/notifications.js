/* Naija Wave — notifications: grouped list + prefs link. */
import { api } from '../api.js';
import { skelPosts, emptyState, errCard, toast, av, esc, tick, timeAgo } from '../ui.js';

const ICONS={
  follow:['👥','var(--blue-dim)'], like:['🌊','rgba(255,92,138,.12)'], comment:['💬','var(--blue-dim)'],
  reply:['↩️','var(--blue-dim)'], repost:['🔁','var(--green-dim)'], mention:['@','var(--gold-dim)'],
  message:['✉️','var(--blue-dim)'], call_missed:['📞','var(--red-dim)'],
  verification:['✅','var(--gold-dim)'], announcement:['📢','var(--gold-dim)'],
};

export async function render(view){
  view.innerHTML=`<div class="page" style="padding-top:0">
    <div style="padding:16px 12px 8px;display:flex;align-items:center;justify-content:space-between">
      <h1 class="sect" style="margin:0">Notifications</h1>
      <div><button class="linklike small" id="nPrefs">Preferences</button>
      <button class="linklike small" id="nAll" style="margin-left:12px">Mark all read</button></div>
    </div>
    <div id="notifs"></div>
    <button id="more" class="loadmore hidden">Load more</button>
  </div>`;
  const mount=view.querySelector('#notifs'), more=view.querySelector('#more');
  let page=1, hasMore=true, loading=false;

  view.querySelector('#nPrefs').onclick=()=>location.hash='#/settings';
  view.querySelector('#nAll').onclick=async()=>{
    try{ await api.post('/api/notifications/read-all'); load(true); }catch(err){ toast(err.message,'err'); }
  };

  async function load(reset){
    if(loading||(!reset&&!hasMore)) return;
    loading=true;
    if(reset){ page=1; hasMore=true; mount.innerHTML=skelPosts(4); }
    try{
      const d=await api.get(`/api/notifications?page=${page}&limit=20`);
      if(reset) mount.innerHTML='';
      if(!d.items.length&&page===1) mount.innerHTML=emptyState('All quiet','No notifications yet. Make some waves and they\'ll come 🌊');
      d.items.forEach(n=>mount.appendChild(notifRow(n)));
      hasMore=!!d.has_more; more.classList.toggle('hidden',!hasMore); page++;
    }catch(err){ if(page===1) mount.innerHTML=errCard('Could not load notifications. '+err.message,()=>load(true)); }
    loading=false;
  }
  more.onclick=()=>load(false);
  load(true);

  function notifRow(n){
    const [icon,bg]=ICONS[n.type]||['🔔','var(--bg2)'];
    const a=n.actor;
    const b=document.createElement('button'); b.className='notif'+(n.read?'':' unread');
    b.innerHTML=`<span class="nicon" style="background:${bg}">${icon}</span>
      ${a?av(a,'xs'):''}
      <span class="ntext">${esc(n.text||'')}
        ${a?`<div style="margin-top:2px"><b>${esc(a.display_name)}</b> <span class="muted">@${esc(a.username)}</span></div>`:''}
        <div class="ntime">${timeAgo(n.created_at)}</div></span>`;
    b.onclick=async()=>{
      if(!n.read){ try{ await api.post(`/api/notifications/${n.id}/read`); }catch{} b.classList.remove('unread'); }
      if(n.post_id) location.hash='#/post/'+n.post_id;
      else if(a) location.hash='#/profile/'+a.username;
      else if(n.type==='message') location.hash='#/messages';
      else if(n.type==='verification') location.hash='#/verify';
    };
    return b;
  }
}
