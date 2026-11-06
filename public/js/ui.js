/* Naija Wave — shared UI components. */
import { api, auth } from './api.js';

/* roundRect polyfill for older mobile WebViews */
if(typeof CanvasRenderingContext2D!=='undefined' && !CanvasRenderingContext2D.prototype.roundRect){
  CanvasRenderingContext2D.prototype.roundRect=function(x,y,w,h,r){
    r=Math.min(r,w/2,h/2);
    this.moveTo(x+r,y); this.arcTo(x+w,y,x+w,y+h,r); this.arcTo(x+w,y+h,x,y+h,r);
    this.arcTo(x,y+h,x,y,r); this.arcTo(x,y,x+w,y,r); this.closePath(); return this;
  };
}

/* ---------- primitives ---------- */
export const esc = s => String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const timeAgo = iso => {
  const s=(Date.now()-new Date(iso).getTime())/1000;
  if(s<10) return 'now'; if(s<60) return Math.floor(s)+'s';
  const m=s/60; if(m<60) return Math.floor(m)+'m';
  const h=m/60; if(h<24) return Math.floor(h)+'h';
  const d=h/24; if(d<7) return Math.floor(d)+'d';
  return new Date(iso).toLocaleDateString(undefined,{month:'short',day:'numeric',year:d>365?'numeric':undefined});
};
export const fullDate = iso => new Date(iso).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
export const fmtDur = sec => { sec=Math.max(0,Math.round(sec||0)); return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0'); };
export function fmtNum(n){ n=+n||0; if(n>=1e6) return (n/1e6).toFixed(1)+'M'; if(n>=1e3) return (n/1e3).toFixed(1)+'K'; return String(n); }

export function toast(msg, kind=''){
  const root=document.getElementById('toastRoot'); if(!root) return;
  const t=document.createElement('div'); t.className='toast '+kind;
  t.innerHTML=`<span>${kind==='ok'?'✅':kind==='err'?'⚠️':'ℹ️'}</span><span>${esc(msg)}</span>`;
  root.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(()=>t.remove(),320); }, 3200);
}

export function linkify(text){
  // TikTok videos -> embedded player (official iframe player, no script needed).
  // Pull the URLs out first so the generic linkifier below doesn't wrap the
  // iframe's own src URL in an <a> tag. Short links (vm.tiktok.com) are
  // resolved to full URLs when the post is created (server side).
  const tiktoks = [];
  let t = String(text ?? '');
  t = t.replace(/https?:\/\/(?:www\.)?tiktok\.com\/@[\w.-]+\/video\/(\d+)[^\s]*/g, (m, id) => {
    tiktoks.push(id);
    return '\u0000TIKTOK' + (tiktoks.length - 1) + '\u0000';
  });
  let html = esc(t)
    .replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|\s)#([\p{L}\p{N}_]+)/gu,'$1<a href="#/tag/$2">#$2</a>')
    .replace(/(^|\s)@([a-z0-9_.]+)/g,'$1<a href="#/profile/$2">@$2</a>');
  tiktoks.forEach((id, i) => {
    html = html.split('\u0000TIKTOK' + i + '\u0000').join(
      '<span class="tiktok-embed-wrap"><iframe src="https://www.tiktok.com/player/v1/' + id + '" title="TikTok video" frameborder="0" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></span>');
  });
  return html;
}

/* ---------- verification ticks (DESIGN.md) ---------- */
const TICK = {
  blue:`<svg width="17" height="17" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#2E7CF6"/><path d="M6 10.4l2.7 2.7L14 7.5" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  gold:`<svg width="17" height="17" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#E8B94A"/><path d="M6 10.4l2.7 2.7L14 7.5" stroke="#3a2a05" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  founder:`<svg width="19" height="19" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9.5" fill="#E8B94A"/><path d="M7 11.4l2.9 2.9 5.4-6" stroke="#3a2a05" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 0.6l1 2 2.2-.4-.7 2.1 2 1.2-2 1.2.7 2.1-2.2-.4-1 2-1-2-2.2.4.7-2.1-2-1.2 2-1.2-.7-2.1 2.2.4z" fill="#fff" transform="translate(0,-0.4) scale(0.72) translate(4.2,1.5)"/></svg>`,
};
let badgeCache=null;
export function tick(v){
  if(!v||v==='none') return '';
  return `<button class="tick" data-badge="${v}" aria-label="Verified badge" title="Verified">${TICK[v]||''}</button>`;
}
document.addEventListener('click', async e=>{
  const b=e.target.closest('[data-badge]'); if(!b) return;
  e.preventDefault(); e.stopPropagation();
  try{
    if(!badgeCache) badgeCache=(await api.get('/api/verification/badges')).badges;
  }catch{ toast('Could not load badge info.','err'); return; }
  const kind=b.dataset.badge, info=badgeCache[kind];
  if(!info) return;
  openSheet(`
    <div class="grab"></div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
      <span style="transform:scale(1.8)">${TICK[kind]}</span>
      <h2 style="margin:0">${esc(info.name||kind+' verified')}</h2>
    </div>
    <p style="color:var(--ink2);font-size:14.5px;line-height:1.6">${esc(info.meaning||'')}</p>
    ${info.who?`<p class="small muted" style="margin-top:10px"><b style="color:var(--ink2)">Who gets this:</b> ${esc(info.who)}</p>`:''}
    <button class="btn ghost block mt" data-close>Got it</button>`);
});

/* ---------- overlays ---------- */
export function openOverlay(html, {modal=false}={}){
  closeOverlay();
  const root=document.getElementById('overlayRoot');
  const ov=document.createElement('div'); ov.className='ov'; ov.id='activeOv';
  ov.innerHTML=`<div class="veil" data-close></div>${modal?`<div class="modal" role="dialog">${html}</div>`:`<div class="sheet" role="dialog">${html}</div>`}`;
  root.appendChild(ov);
  ov.addEventListener('click',e=>{ if(e.target.closest('[data-close]')) closeOverlay(); });
  return ov;
}
export function openSheet(html){ return openOverlay(html); }
export function openModal(html){ return openOverlay(html,{modal:true}); }
export function closeOverlay(){ document.getElementById('activeOv')?.remove(); }
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeOverlay(); });

export function confirmDlg(title, body, okLabel='Confirm', danger=false){
  return new Promise(res=>{
    const ov=openModal(`
      <h2>${esc(title)}</h2><p style="color:var(--ink2);font-size:14.5px;margin:8px 0 18px">${body}</p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn ghost" data-x>Cancel</button>
        <button class="btn ${danger?'danger':'primary'}" data-ok>${esc(okLabel)}</button>
      </div>`);
    ov.querySelector('[data-x]').onclick=()=>{closeOverlay();res(false)};
    ov.querySelector('[data-ok]').onclick=()=>{closeOverlay();res(true)};
  });
}

export function errCard(msg, retry){
  const id='r'+Math.random().toString(36).slice(2);
  setTimeout(()=>{ const b=document.getElementById(id); if(b&&retry) b.onclick=retry; },0);
  return `<div class="errcard"><p>${esc(msg)}</p><button id="${id}" class="btn ghost small">Try again</button></div>`;
}
export function skelPosts(n=4){
  let h='';
  for(let i=0;i<n;i++) h+=`<div class="skelpost"><div class="skel" style="width:44px;height:44px;border-radius:50%"></div>
    <div style="flex:1"><div class="skel" style="height:14px;width:40%;margin-bottom:8px"></div>
    <div class="skel" style="height:12px;width:90%;margin-bottom:6px"></div><div class="skel" style="height:12px;width:65%"></div></div></div>`;
  return h;
}
export function emptyState(title, body, cta=''){
  return `<div class="empty"><img class="mark" src="img/mark.svg" alt="">
    <h3>${esc(title)}</h3><p>${body}</p>${cta}</div>`;
}

/* ---------- user bits ---------- */
export const av = (u, cls='sm') =>
  `<img class="avatar ${cls}" src="${esc(u?.avatar_url||'img/mark.svg')}" alt="${esc(u?.display_name||'user')}" loading="lazy" onerror="this.src='img/mark.svg'">`;
export function userRow(u, action=''){
  return `<div class="urow">${av(u)}
    <a class="uinfo" href="#/profile/${esc(u.username)}">
      <div class="uname">${esc(u.display_name)} ${tick(u.verification)}</div>
      <div class="uuser">@${esc(u.username)}${u.bio?` · ${esc(u.bio.slice(0,42))}`:''}</div>
    </a>${action}</div>`;
}
export function followBtn(username, following){
  return `<button class="btn ${following?'ghost':'primary'} small" data-follow="${esc(username)}" data-f="${following?1:0}">${following?'Following':'Follow'}</button>`;
}
document.addEventListener('click', async e=>{
  const b=e.target.closest('[data-follow]'); if(!b) return;
  e.preventDefault();
  const u=b.dataset.follow, f=b.dataset.f==='1';
  b.disabled=true;
  try{
    const d = f ? await api.del(`/api/users/${u}/follow`) : await api.post(`/api/users/${u}/follow`);
    const now=d.following;
    b.dataset.f=now?'1':'0'; b.textContent=now?'Following':'Follow';
    b.className=`btn ${now?'ghost':'primary'} small`;
    document.querySelectorAll(`[data-fc="${CSS.escape(u)}"]`).forEach(el=>el.textContent=fmtNum(d.followers_count));
    document.dispatchEvent(new CustomEvent('nw:follow',{detail:{username:u,following:now}}));
  }catch(err){ toast(err.message,'err'); }
  b.disabled=false;
});

/* ---------- media ---------- */
export function mediaGrid(media=[]){
  if(!media.length) return '';
  const cls='n'+Math.min(media.length,4);
  return `<div class="mgrid ${cls}">`+media.map((m,i)=>{
    if(m.kind==='video') return `<video class="${i===0&&media.length===3?'m0':''}" src="${esc(m.url)}" controls preload="metadata" playsinline></video>`;
    return `<img class="${i===0&&media.length===3?'m0':''}" src="${esc(m.url)}" alt="" loading="lazy" data-zoom="${esc(m.url)}">`;
  }).join('')+`</div>`;
}
document.addEventListener('click',e=>{
  const z=e.target.closest('[data-zoom]'); if(!z) return;
  const ov=document.createElement('div'); ov.className='lightbox'; ov.setAttribute('role','dialog');
  ov.innerHTML=`<img src="${esc(z.dataset.zoom)}" alt="">`;
  ov.onclick=()=>ov.remove();
  document.body.appendChild(ov);
});

/* ---------- poll ---------- */
export function pollHtml(post, onVoted){
  const p=post.poll; if(!p) return '';
  const voted = p.my_vote!=null;
  const opts=p.options.map(o=>{
    const pct=p.total_votes?Math.round(o.votes/p.total_votes*100):0;
    return `<button class="pollopt ${voted?'voted':''} ${p.my_vote===o.id?'mine':''}" data-poll="${post.id}" data-opt="${o.id}" ${voted?'disabled':''}>
      <span class="fill" style="width:${voted?pct:0}%"></span>
      <span class="t">${esc(o.text)}</span>${voted?`<span class="p">${pct}%</span>`:''}</button>`;
  }).join('');
  return `<div class="poll"><div class="pollq">${esc(p.question)}</div>${opts}
    <div class="small muted">${fmtNum(p.total_votes)} vote${p.total_votes===1?'':'s'}</div></div>`;
}
document.addEventListener('click', async e=>{
  const b=e.target.closest('[data-poll]'); if(!b||b.disabled) return;
  b.disabled=true;
  try{
    const d=await api.post(`/api/posts/${b.dataset.poll}/poll/vote`,{option_id:+b.dataset.opt});
    const wrap=b.closest('.poll');
    const tmp={id:+b.dataset.poll, poll:d.poll};
    wrap.outerHTML=pollHtml(tmp);
  }catch(err){ toast(err.message,'err'); b.disabled=false; }
});

/* ---------- post card ---------- */
const ICONS={
  comment:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  repost:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  wave:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/><path d="M2 17c2-4 4-4 6 0s4 4 6 0 4-4 6 0" opacity=".45"/></svg>',
  share:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>',
  bookmark:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
};
export function postCard(p, {detail=false}={}){
  const a=p.author||{};
  const inner = p.repost_of ? repostInner(p) : quoteInner(p);
  const sponsored=p.is_sponsored?`<div class="sponsored">Sponsored</div>`:'';
  const ribbon = p.section==='buzz' && p.unverified ? `<div><span class="ribbon">⚠️ Community report — not confirmed</span></div>`:'';
  const loc = p.location?`<div class="locline">📍 ${esc(p.location)}</div>`:'';
  return `<article class="post" data-post="${p.id}">
    <a href="#/profile/${esc(a.username)}">${av(a)}</a>
    <div class="pbody">
      ${p.repost_of?`<div class="repostline">${ICONS.repost} <a href="#/profile/${esc(a.username)}"><b>${esc(a.display_name)}</b></a> rewaved</div>`:''}
      <div class="phead">${sponsored}
        <a class="pname" href="#/profile/${esc(a.username)}">${esc(a.display_name)} ${tick(a.verification)}</a>
        <span class="pmeta">@${esc(a.username)} · ${timeAgo(p.created_at)}</span>
      </div>
      ${inner}
      ${ribbon}${loc}
      <div class="pactions">
        <button class="pact" data-act="comment" aria-label="Comments">${ICONS.comment}<span class="cnt">${fmtNum(p.counts?.comments||0)}</span></button>
        <button class="pact repost ${p.reposted?'on':''}" data-act="repost" aria-label="Rewave">${ICONS.repost}<span class="cnt">${fmtNum(p.counts?.reposts||0)}</span></button>
        <button class="pact like ${p.liked?'on':''}" data-act="like" aria-label="Wave">${ICONS.wave}<span class="cnt">${fmtNum(p.counts?.likes||0)}</span></button>
        <button class="pact" data-act="share" aria-label="Share">${ICONS.share}</button>
        <button class="pact ${p.bookmarked?'on':''}" data-act="bookmark" aria-label="Bookmark">${ICONS.bookmark}</button>
      </div>
    </div></article>`;
}
function repostInner(p){
  const o=p.repost_of, a=o.author||{};
  return `<a class="phead" href="#/post/${o.id}" style="margin-top:4px">
      <span class="pname" style="font-size:14px">${esc(a.display_name)} ${tick(a.verification)}</span>
      <span class="pmeta">@${esc(a.username)} · ${timeAgo(o.created_at)}</span></a>
    <a href="#/post/${o.id}"><div class="ptext">${linkify(o.text||'')}</div>${mediaGrid(o.media)}</a>`;
}
function quoteInner(p){
  const q=p.quote_of ? `<div class="quote"><a href="#/post/${p.quote_of.id}">
      <span class="pname" style="font-size:13.5px">${esc(p.quote_of.author?.display_name)} ${tick(p.quote_of.author?.verification)}</span>
      <span class="pmeta">@${esc(p.quote_of.author?.username)}</span>
      <div class="ptext" style="font-size:14px">${linkify(p.quote_of.text||'')}</div></a></div>`:'';
  return `${p.text?`<a href="#/post/${p.id}"><div class="ptext">${linkify(p.text)}</div></a>`:''}${mediaGrid(p.media)}${pollHtml(p)}${q}`;
}

/* post actions (delegated, works everywhere) */
document.addEventListener('click', async e=>{
  const b=e.target.closest('[data-act]'); if(!b) return;
  const card=e.target.closest('[data-post]'); if(!card) return;
  const id=card.dataset.post, act=b.dataset.act;
  e.preventDefault();
  if(act==='like'){
    b.disabled=true;
    try{
      const d = b.classList.contains('on') ? await api.del(`/api/posts/${id}/like`) : await api.post(`/api/posts/${id}/like`);
      b.classList.toggle('on',d.liked); b.querySelector('.cnt').textContent=fmtNum(d.likes);
    }catch(err){ toast(err.message,'err'); } b.disabled=false;
  }else if(act==='bookmark'){
    try{
      const d = b.classList.contains('on') ? await api.del(`/api/posts/${id}/bookmark`) : await api.post(`/api/posts/${id}/bookmark`);
      b.classList.toggle('on',d.bookmarked); toast(d.bookmarked?'Saved to bookmarks':'Removed from bookmarks');
    }catch(err){ toast(err.message,'err'); }
  }else if(act==='repost'){
    repostSheet(id,b);
  }else if(act==='comment'){
    location.hash='#/post/'+id;
  }else if(act==='share'){
    const url=location.origin+location.pathname+'#/post/'+id;
    if(navigator.share){ navigator.share({title:'Naija Wave',url}).catch(()=>{}); }
    else{ try{ await navigator.clipboard.writeText(url); toast('Link copied','ok'); }catch{ toast(url); } }
  }
});
function repostSheet(id, btn){
  const ov=openSheet(`<div class="grab"></div><h2>Rewave</h2>
    <div class="field"><textarea id="rwText" class="input" maxlength="500" placeholder="Add your take (optional — makes it a quote)..."></textarea></div>
    <div style="display:flex;gap:10px">
      <button class="btn ghost" data-close style="flex:1">Cancel</button>
      <button class="btn primary" id="rwGo" style="flex:1">Rewave</button>
    </div>`);
  ov.querySelector('#rwGo').onclick=async()=>{
    const t=ov.querySelector('#rwText').value.trim();
    try{
      const d=await api.post(`/api/posts/${id}/repost`, t?{quote_text:t}:{});
      closeOverlay(); toast(t?'Quoted to your wave':'Rewaved','ok');
      btn.classList.add('on');
      const c=btn.querySelector('.cnt'); if(c) c.textContent=fmtNum((parseInt(c.textContent)||0)+1);
      document.dispatchEvent(new CustomEvent('nw:posted',{detail:d.post}));
    }catch(err){ toast(err.message,'err'); }
  };
}

/* ---------- comment thread ---------- */
export function commentHtml(c, depth=0){
  const a=c.author||{};
  return `<div class="comment ${depth?'creply':''}" data-comment="${c.id}">
    <a href="#/profile/${esc(a.username)}">${av(a,'xs')}</a>
    <div style="flex:1;min-width:0"><div class="cbody">
      <div class="chead"><a href="#/profile/${esc(a.username)}"><b>${esc(a.display_name)}</b></a> ${tick(a.verification)}
        <span class="muted small">@${esc(a.username)} · ${timeAgo(c.created_at)}</span></div>
      <div class="ctext">${linkify(c.text||'')}</div></div>
      <div class="cmeta">
        <button data-clike="${c.id}" class="${c.liked?'on':''}">🌊 ${fmtNum(c.likes||0)}</button>
        <button data-creply="${c.id}">Reply</button>
        ${c.replies_count?`<button data-creplies="${c.id}">View ${c.replies_count} repl${c.replies_count===1?'y':'ies'}</button>`:''}
      </div>
      <div class="cchildren"></div>
    </div></div>`;
}
export async function loadComments(postId, mount, {replyTo=null}={}){
  mount.innerHTML=skelPosts(2);
  try{
    const d=await api.get(`/api/posts/${postId}/comments?page=1&limit=30`);
    mount.innerHTML = d.items.length? '' : emptyState('No replies yet','Be the first to join the conversation 🌊');
    d.items.forEach(c=>{
      const el=document.createElement('div'); el.innerHTML=commentHtml(c); mount.appendChild(el.firstChild);
      (c.replies||[]).forEach(r=>{ const k=mount.querySelector(`[data-comment="${c.id}"] .cchildren`); const x=document.createElement('div'); x.innerHTML=commentHtml(r,1); k.appendChild(x.firstChild); });
    });
  }catch(err){ mount.innerHTML=errCard('Could not load replies. '+err.message, ()=>loadComments(postId,mount)); }
}
document.addEventListener('click', async e=>{
  const l=e.target.closest('[data-clike]');
  if(l){ try{ const d=await api.post(`/api/comments/${l.dataset.clike}/like`); l.classList.toggle('on',true); l.textContent=`🌊 ${fmtNum(d.likes??(parseInt(l.textContent.match(/\d+/)?.[0]||0)+1))}`; }catch(err){ toast(err.message,'err'); } return; }
});
export function commentComposer(onSend, placeholder='Write a reply...'){
  const f=document.createElement('form'); f.className='tcomposer'; f.style.position='static';
  f.innerHTML=`<textarea class="tinput" rows="1" maxlength="500" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}"></textarea>
    <button class="sendbtn" aria-label="Send"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg></button>`;
  f.onsubmit=async ev=>{ ev.preventDefault();
    const t=f.querySelector('textarea').value.trim(); if(!t) return;
    const btn=f.querySelector('button'); btn.disabled=true;
    try{ await onSend(t); f.querySelector('textarea').value=''; }catch(err){ toast(err.message,'err'); }
    btn.disabled=false; };
  return f;
}

/* ---------- misc ---------- */
export function presenceDot(online){ return `<span class="odot ${online?'on':''}"></span>`; }
export function menuAt(x,y,items){
  document.querySelector('.menu')?.remove();
  const m=document.createElement('div'); m.className='menu'; m.setAttribute('role','menu');
  m.style.left=Math.min(x,innerWidth-230)+'px'; m.style.top=y+'px';
  m.innerHTML=items.map((it,i)=>`<button data-mi="${i}" class="${it.danger?'danger':''}">${esc(it.label)}</button>`).join('');
  document.body.appendChild(m);
  m.onclick=ev=>{ const b=ev.target.closest('[data-mi]'); if(!b) return; m.remove(); items[+b.dataset.mi].fn?.(); };
  setTimeout(()=>document.addEventListener('click',()=>m.remove(),{once:true}),0);
  return m;
}
