/* Naija Wave — messages: conversations list + thread (realtime, offline queue). */
import { api, auth, sock } from '../api.js';
import { startCall } from '../calls.js';
import { toast, esc, av, tick, timeAgo, fullDate, fmtDur, openSheet, openModal, confirmDlg, menuAt, skelPosts, emptyState, errCard, presenceDot } from '../ui.js';

let activeConv=null, pollTimer=null;

/* ============ conversation list + call history tabs ============ */
export async function render(view, params){
  if(params.id) return renderThread(view, params.id);
  activeConv=null;
  view.innerHTML=`<div class="page" style="padding-top:0">
    <div style="padding:16px 12px 8px"><h1 class="sect" style="margin:0">Messages</h1></div>
    <div class="tabs" style="padding:0 12px">
      <button class="tab on" data-tab="chats">Chats</button>
      <button class="tab" data-tab="calls">Calls</button>
    </div>
    <div id="convs"></div>
    <div id="calls" class="hidden"></div>
  </div>`;
  const mount=view.querySelector('#convs'), callsMount=view.querySelector('#calls');
  const tabs=[...view.querySelectorAll('.tab')];
  tabs.forEach(t=>t.onclick=()=>{
    tabs.forEach(x=>x.classList.remove('on')); t.classList.add('on');
    const calls=t.dataset.tab==='calls';
    mount.classList.toggle('hidden',calls); callsMount.classList.toggle('hidden',!calls);
    if(calls && !callsMount.dataset.loaded) loadCalls();
  });
  mount.innerHTML=skelPosts(4);
  const onNew=()=>load();
  async function load(){
    try{
      const d=await api.get('/api/conversations');
      const list=Array.isArray(d)?d:(d.items||d.conversations||[]);
      if(!list.length){ mount.innerHTML=emptyState('No conversations yet','Find people on Explore and say hello 👋'); return; }
      mount.innerHTML='';
      list.forEach(c=>mount.appendChild(convRow(c)));
    }catch(err){ mount.innerHTML=errCard('Could not load conversations. '+err.message, load); }
  }
  async function loadCalls(){
    callsMount.dataset.loaded='1'; callsMount.innerHTML=skelPosts(4);
    try{
      const d=await api.get('/api/calls/history');
      const list=d.items||[];
      if(!list.length){ callsMount.innerHTML=emptyState('No calls yet','Voice and video calls will show up here 📞'); return; }
      callsMount.innerHTML='';
      list.forEach(c=>callsMount.appendChild(callRow(c)));
    }catch(err){ callsMount.innerHTML=errCard('Could not load call history. '+err.message, ()=>{delete callsMount.dataset.loaded; loadCalls();}); }
  }
  const offs=[sock.on('message:new',onNew),sock.on('notification',onNew)];
  await load();
  return ()=>offs.forEach(f=>f());
}

function callRow(c){
  const u=c.other_user||{};
  const missed=c.status==='missed';
  const dirIcon=c.direction==='incoming'
    ? `<span style="color:${missed?'var(--red)':'var(--green)'}">↙</span>`
    : `<span style="color:var(--ink2)">↗</span>`;
  const kindLabel=c.kind==='video'?'Video':'Voice';
  const sub=missed?`${kindLabel} · Missed`
    : c.status==='rejected'?`${kindLabel} · Declined`
    : c.status==='failed'?`${kindLabel} · Failed`
    : `${kindLabel} · ${fmtDur(c.duration_sec)}`;
  const b=document.createElement('div'); b.className='conv';
  b.innerHTML=`<a href="#/profile/${esc(u.username||'')}" style="display:flex;flex:1;gap:12px;align-items:center;text-decoration:none;color:inherit">
      <span class="avwrap">${av(u,'sm')}</span>
      <span class="cinfo"><span class="ctop"><span class="cname">${esc(u.display_name||u.username)} ${tick(u.verification)}</span>
      <span class="ctime">${c.started_at?timeAgo(c.started_at):''}</span></span>
      <span class="csub"><span class="csnip" style="${missed?'color:var(--red)':''}">${dirIcon} ${esc(sub)}</span></span></span></a>
    <button class="iconbtn" title="Call back" aria-label="Call back">📞</button>`;
  b.querySelector('.iconbtn').onclick=()=>startCall(u,'voice');
  return b;
}

function convRow(c){
  const u=c.other_user||{};
  const lm=c.last_message||{};
  const snip = lm.deleted?'🚫 Message deleted'
    : lm.kind==='voice'?`🎙️ Voice wave · ${fmtDur(lm.media?.duration)}`
    : lm.kind==='image'?'📷 Photo' : lm.kind==='video'?'🎬 Video' : lm.kind==='file'?'📎 File'
    : (lm.text||'').slice(0,60);
  const b=document.createElement('a'); b.className='conv'; b.href='#/messages/'+c.id;
  b.innerHTML=`<span class="avwrap">${av(u,'sm')}${presenceDot(u.online)}</span>
    <span class="cinfo"><span class="ctop"><span class="cname">${esc(u.display_name)} ${tick(u.verification)}</span>
    <span class="ctime">${lm.created_at?timeAgo(lm.created_at):''}</span></span>
    <span class="csub"><span class="csnip">${esc(snip)}</span>${c.unread_count?`<span class="unread">${c.unread_count}</span>`:''}</span></span>`;
  return b;
}

/* ============ thread ============ */
async function renderThread(view, convId){
  activeConv=convId;
  view.innerHTML=`<div class="thread">
    <div class="thead">
      <button class="iconbtn" id="tBack" aria-label="Back"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg></button>
      <span class="avwrap" id="tAv"></span>
      <div class="tinfo"><div class="tname" id="tName"></div><div class="tstat" id="tStat"></div></div>
      <button class="iconbtn" id="tCall" aria-label="Voice call"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.5 2.9.7a2 2 0 0 1 1.6 2z"/></svg></button>
      <button class="iconbtn" id="tVideo" aria-label="Video call"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg></button>
      <button class="iconbtn" id="tMenu" aria-label="Conversation menu"><svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg></button>
    </div>
    <div class="tmsgs" id="tmsgs"></div>
    <div id="tcomposer"></div>
  </div>`;
  const msgs=view.querySelector('#tmsgs');
  view.querySelector('#tBack').onclick=()=>location.hash='#/messages';
  let other=null, page=1, hasMore=true, loadingOld=false, oldestTop=false;

  // header
  async function loadHeader(){
    try{
      const convs=await api.get('/api/conversations');
      const list=Array.isArray(convs)?convs:(convs.items||[]);
      const c=list.find(x=>String(x.id)===String(convId));
      if(c?.other_user){ other=c.other_user; paintHeader(); }
    }catch{}
  }
  function paintHeader(){
    if(!other) return;
    view.querySelector('#tAv').innerHTML=`${av(other,'sm')}${presenceDot(other.online)}`;
    view.querySelector('#tName').innerHTML=`${esc(other.display_name)} ${tick(other.verification)}`;
    setStat(other.online?'Online':(other.last_seen?'Last seen '+timeAgo(other.last_seen):''));
  }
  function setStat(t){ view.querySelector('#tStat').textContent=t; }

  /* --- message rendering --- */
  const meId=auth.me.id;
  function dayLabel(iso){
    const d=new Date(iso), now=new Date();
    if(d.toDateString()===now.toDateString()) return 'Today';
    const y=new Date(now-864e5); if(d.toDateString()===y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  }
  function msgEl(m){
    const me=m.sender_id===meId;
    const d=document.createElement('div'); d.className='msg '+(me?'me':'them'); d.dataset.mid=m.id;
    let inner='';
    if(m.deleted){ inner=`<div class="bubble msgdeleted">🚫 This message was deleted</div>`; }
    else if(m.kind==='text'){ inner=`<div class="bubble">${esc(m.text||'')}</div>`; }
    else if(m.kind==='voice'){ inner=orbPlayerHtml(m); }
    else if(m.kind==='image'){ inner=`<div class="bubble"><img src="${esc(m.media?.url)}" loading="lazy" data-zoom="${esc(m.media?.url)}" alt=""></div>`; }
    else if(m.kind==='video'){ inner=`<div class="bubble"><video src="${esc(m.media?.url)}" controls preload="metadata" playsinline style="max-width:230px;border-radius:10px"></video></div>`; }
    else{ inner=`<div class="bubble">📎 <a href="${esc(m.media?.url)}" target="_blank" rel="noopener" style="${me?'color:#04121f':''};text-decoration:underline">File</a>${m.text?'<br>'+esc(m.text):''}</div>`; }
    const ticks = me ? `<span class="ticks ${m.status==='read'?'read':''}">${m.status==='read'?'✓✓':m.status==='delivered'?'✓✓':'✓'}</span>`:'';
    d.innerHTML=`${inner}<div class="mmeta">${timeAgo(m.created_at)} ${ticks}</div>`;
    if(!m.deleted){
      d.querySelector('.bubble').oncontextmenu=e=>{ e.preventDefault(); msgMenu(m); };
      let pt=null;
      d.querySelector('.bubble').addEventListener('touchstart',()=>{ pt=setTimeout(()=>msgMenu(m),600); },{passive:true});
      d.querySelector('.bubble').addEventListener('touchend',()=>clearTimeout(pt));
    }
    return d;
  }
  function orbPlayerHtml(m){
    const dur=m.media?.duration||0;
    return `<div class="bubble" style="padding:6px"><div class="orbplayer" data-orb="${m.id}" data-url="${esc(m.media?.url)}">
      <button class="orbmini" aria-label="Play voice wave"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
      <div style="flex:1;min-width:0"><canvas class="opwave"></canvas>
      <div class="opmeta"><span data-dur>${fmtDur(dur)}</span><button class="spd" data-spd>1x</button>
      ${window.SpeechRecognition||window.webkitSpeechRecognition?`<button class="trbtn" data-tr>Transcribe</button>`:''}</div>
      <div class="trtext hidden" data-trtext></div></div></div></div>`;
  }

  function appendMsg(m, {scroll=true}={}){
    const lastDay=[...msgs.querySelectorAll('.daydiv')].pop();
    const dl=dayLabel(m.created_at);
    if(!lastDay||lastDay.dataset.d!==dl){
      const dd=document.createElement('div'); dd.className='daydiv'; dd.dataset.d=dl; dd.textContent=dl; msgs.appendChild(dd);
    }
    msgs.appendChild(msgEl(m));
    if(scroll) msgs.scrollTop=msgs.scrollHeight;
  }

  async function loadMsgs(reset){
    if(reset){ page=1; hasMore=true; msgs.innerHTML=skelPosts(3); }
    try{
      const d=await api.get(`/api/conversations/${convId}/messages?page=${page}&limit=30`);
      if(reset) msgs.innerHTML='';
      const items=(d.items||[]).slice().reverse(); // oldest first
      items.forEach(m=>{
        const dl=dayLabel(m.created_at);
        const first=msgs.firstChild;
        const needDiv=!first||!first.classList?.contains('daydiv')||first.dataset.d!==dl;
        if(needDiv){ const dd=document.createElement('div'); dd.className='daydiv'; dd.dataset.d=dl; dd.textContent=dl; msgs.prepend(dd); }
        msgs.prepend(msgEl(m));
      });
      hasMore=!!d.has_more; page++;
      if(reset) msgs.scrollTop=msgs.scrollHeight;
      api.post(`/api/conversations/${convId}/read`).catch(()=>{});
    }catch(err){ if(reset) msgs.innerHTML=errCard('Could not load messages. '+err.message,()=>loadMsgs(true)); }
  }
  msgs.addEventListener('scroll',()=>{
    if(msgs.scrollTop<80&&hasMore&&!loadingOld){ loadingOld=true; const h=msgs.scrollHeight;
      loadMsgs(false).then(()=>{ msgs.scrollTop=msgs.scrollHeight-h; loadingOld=false; }); }
  });

  /* --- composer --- */
  const comp=document.createElement('div'); comp.className='tcomposer'; comp.style.position='relative';
  comp.innerHTML=`
    <button class="iconbtn" id="cAttach" aria-label="Attach"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.4 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.49-8.48"/></svg></button>
    <textarea class="tinput" id="cText" rows="1" placeholder="Message..." aria-label="Message"></textarea>
    <button class="wcbtn" id="cWave" aria-label="Send a Wavecast voice wave"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12c1.5-3.5 3-3.5 4.5 0s3 3.5 4.5 0 3-3.5 4.5 0 3 3.5 4.5 0"/></svg></button>
    <button class="sendbtn" id="cSend" aria-label="Send"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg></button>`;
  view.querySelector('#tcomposer').appendChild(comp);
  const ta=comp.querySelector('#cText');

  // offline queue
  const QKEY='nw_q_'+convId;
  const queue=JSON.parse(localStorage.getItem(QKEY)||'[]');
  function saveQ(){ localStorage.setItem(QKEY,JSON.stringify(queue)); }
  async function flushQueue(){
    while(queue.length){
      const q=queue[0];
      const ok=await sendViaSocket(q);
      if(!ok) break;
      queue.shift(); saveQ();
    }
    if(!queue.length) msgs.querySelectorAll('[data-pending]').forEach(e=>e.remove());
  }

  function sendViaSocket({kind,text,media_id}){
    return new Promise(res=>{
      const ok=sock.emit('message:send',{conversation_id:+convId,kind,text,media_id},ack=>{
        if(ack?.error){ toast(ack.error==='BLOCKED'?'You cannot message this user.':ack.error,'err'); res(false); return; }
        if(ack?.message){ appendMsg(ack.message); }
        res(true);
      });
      if(!ok) res(false);
      setTimeout(()=>res(false),12000); // ack timeout guard
    });
  }

  async function sendText(){
    const t=ta.value.trim(); if(!t) return;
    ta.value='';
    const ok=await sendViaSocket({kind:'text',text:t});
    if(!ok){ queue.push({kind:'text',text:t}); saveQ(); toast('Offline — message queued.','err'); }
  }
  comp.querySelector('#cSend').onclick=sendText;
  ta.onkeydown=e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendText(); } };

  // typing
  let typeT=null;
  ta.oninput=()=>{
    sock.emit('typing',{conversation_id:+convId,is_typing:true});
    clearTimeout(typeT); typeT=setTimeout(()=>sock.emit('typing',{conversation_id:+convId,is_typing:false}),2500);
  };

  // wavecast
  comp.querySelector('#cWave').onclick=async()=>{
    const { openWavecast }=await import('../wavecast.js');
    openWavecast(async (media,dur)=>{
      const ok=await sendViaSocket({kind:'voice',media_id:media.id});
      if(!ok){ queue.push({kind:'voice',media_id:media.id}); saveQ(); toast('Offline — wave queued.','err'); }
    });
  };

  // attach menu
  comp.querySelector('#cAttach').onclick=e=>{
    const r=e.currentTarget.getBoundingClientRect();
    menuAt(r.left,r.top-190,[
      {label:'📷 Photo / 🎬 Video',fn:()=>pickAndSend('image/*,video/*')},
      {label:'📎 File',fn:()=>pickAndSend('*/*')},
    ]);
  };
  function pickAndSend(accept){
    const inp=document.createElement('input'); inp.type='file'; inp.accept=accept;
    inp.onchange=async()=>{
      const f=inp.files[0]; if(!f) return;
      toast('Uploading...'); 
      try{
        const u=await api.uploadFile(f, f.type.startsWith('image')?'image':f.type.startsWith('video')?'video':'file');
        const kind=u.kind==='image'?'image':u.kind==='video'?'video':'file';
        const ok=await sendViaSocket({kind,media_id:u.id});
        if(!ok){ queue.push({kind,media_id:u.id}); saveQ(); }
      }catch(err){ toast('Upload failed: '+err.message,'err'); }
    };
    inp.click();
  }

  /* --- socket events --- */
  const onNew=m=>{
    if(String(m.conversation_id)!==String(convId)) return;
    if(m.sender_id===meId){ /* own ack already appended */ return; }
    appendMsg(m);
    sock.emit('message:delivered',{message_id:m.id});
    sock.emit('message:read',{conversation_id:+convId});
    api.post(`/api/conversations/${convId}/read`).catch(()=>{});
  };
  const onStatus=({message_id,status})=>{
    const el=msgs.querySelector(`[data-mid="${message_id}"] .ticks`);
    if(el){ el.textContent=status==='read'?'✓✓':status==='delivered'?'✓✓':'✓'; el.classList.toggle('read',status==='read'); }
  };
  const onDel=({message_id})=>{
    const el=msgs.querySelector(`[data-mid="${message_id}"]`);
    if(el){ const b=el.querySelector('.bubble'); if(b){ b.className='bubble msgdeleted'; b.textContent='🚫 This message was deleted'; } }
  };
  let typingEl=null;
  const onTyping=({user_id,is_typing})=>{
    if(other&&+user_id===+other.id){
      if(is_typing){ setStat('typing...');
        if(!typingEl){ typingEl=document.createElement('div'); typingEl.className='typingind'; typingEl.innerHTML='<i></i><i></i><i></i>'; msgs.appendChild(typingEl); msgs.scrollTop=msgs.scrollHeight; }
      }else{ setStat(other.online?'Online':''); typingEl?.remove(); typingEl=null; }
    }
  };
  const onPresence=({user_id,online})=>{
    if(other&&+user_id===+other.id){ other.online=online; paintHeader(); }
  };
  const offs=[sock.on('message:new',onNew),sock.on('message:status',onStatus),sock.on('message:deleted',onDel),
    sock.on('typing',onTyping),sock.on('presence',onPresence)];
  const onRe=sock.onNet(off=>{ if(!off) flushQueue(); });

  function msgMenu(m){
    const me=m.sender_id===meId;
    const items=[];
    if(me) items.push({label:'🗑️ Delete for everyone',danger:true,fn:async()=>{
      const {confirmDlg}=await import('../ui.js');
      if(!await confirmDlg('Delete message?','This removes it for everyone.','Delete',true)) return;
      sock.emit('message:delete',{message_id:m.id});
      onDel({message_id:m.id});
    }});
    else items.push({label:'🚫 Report message',danger:true,fn:()=>{
      openSheet(`<div class="grab"></div><h2>Report message</h2>
        <div class="field"><textarea id="mr" class="input" placeholder="What's wrong?"></textarea></div>
        <button class="btn danger block" id="mgo">Send report</button>`).querySelector('#mgo').onclick=async()=>{
        toast('Report sent.','ok'); (await import('../ui.js')).closeOverlay();
      };
    }});
    const r=msgs.getBoundingClientRect();
    menuAt(r.left+40,r.top+120,items);
  }

  /* --- header actions --- */
  view.querySelector('#tCall').onclick=async()=>{
    if(!other) return;
    (await import('../calls.js')).startCall(other,'voice');
  };
  view.querySelector('#tVideo').onclick=async()=>{
    if(!other) return;
    (await import('../calls.js')).startCall(other,'video');
  };
  view.querySelector('#tMenu').onclick=e=>{
    const r=e.currentTarget.getBoundingClientRect();
    menuAt(r.left-180,r.top+44,[
      {label:'👤 View profile',fn:()=>other&&(location.hash='#/profile/'+other.username)},
      {label:'🚫 Block user',danger:true,fn:async()=>{
        if(!await confirmDlg('Block '+(other?.display_name||'user')+'?','They won\'t be able to message or interact with you.','Block',true)) return;
        await api.post(`/api/users/${other.username}/block`); toast('User blocked.','ok'); location.hash='#/messages';
      }},
      {label:'🚨 Report user',danger:true,fn:()=>{
        const ov=openSheet(`<div class="grab"></div><h2>Report @${esc(other.username)}</h2>
          <div class="field"><label>Reason</label><input id="rr" class="input" placeholder="e.g. Harassment, scam, impersonation"></div>
          <button class="btn danger block" id="rgo">Send report</button>`);
        ov.querySelector('#rgo').onclick=async()=>{
          const reason=ov.querySelector('#rr').value.trim()||'Reported from chat';
          try{ await api.post(`/api/users/${other.username}/report`,{reason}); toast('Report sent.','ok'); }catch(err){ toast(err.message,'err'); }
          (await import('../ui.js')).closeOverlay();
        };
      }},
      {label:'🗑️ Delete conversation',danger:true,fn:async()=>{
        if(!await confirmDlg('Delete conversation?','It will be hidden from your list.','Delete',true)) return;
        await api.del(`/api/conversations/${convId}`); location.hash='#/messages';
      }},
    ]);
  };

  await loadHeader();
  await loadMsgs(true);
  if(queue.length) flushQueue();
  // deliver pending incoming
  sock.emit('message:read',{conversation_id:+convId});

  return ()=>{ offs.forEach(f=>f()); onRe(); activeConv=null; };
}

/* orb player wiring (delegated) */
let currentAudio=null, currentBtn=null;
document.addEventListener('click', async e=>{
  const orb=e.target.closest('[data-orb]');
  // speed toggle
  const spd=e.target.closest('[data-spd]');
  if(spd&&orb){ cycleSpeed(spd); e.stopPropagation(); return; }
  const tr=e.target.closest('[data-tr]');
  if(tr&&orb){ transcribe(tr,orb); e.stopPropagation(); return; }
  if(!orb) return;
  const btn=orb.querySelector('.orbmini');
  if(!e.target.closest('.orbmini')&&!e.target.closest('.opwave')) return;
  toggleOrb(orb,btn);
});
document.addEventListener('click',e=>{
  const cv=e.target.closest('.opwave');
  if(!cv) return;
  const orb=cv.closest('[data-orb]');
  if(currentAudio&&orb.dataset.url===currentAudio.dataset.url&&currentAudio.duration){
    const r=cv.getBoundingClientRect();
    currentAudio.currentTime=((e.clientX-r.left)/r.width)*currentAudio.duration;
  }
});
function cycleSpeed(btn){
  const s=['1x','1.5x','2x']; const i=(s.indexOf(btn.textContent)+1)%3;
  btn.textContent=s[i];
  if(currentAudio&&btn.closest('[data-orb]').dataset.url===currentAudio.dataset.url)
    currentAudio.playbackRate=parseFloat(s[i]);
}
function toggleOrb(orb,btn){
  const url=orb.dataset.url;
  if(currentAudio&&currentAudio.dataset.url===url&&!currentAudio.paused){ currentAudio.pause(); return; }
  if(currentAudio){ currentAudio.pause(); }
  currentBtn?.classList.remove('playing');
  const a=new Audio(url); a.dataset.url=url;
  a.playbackRate=parseFloat(orb.querySelector('[data-spd]').textContent)||1;
  currentAudio=a; currentBtn=btn;
  const cv=orb.querySelector('.opwave'), durEl=orb.querySelector('[data-dur]');
  drawWave(cv,0);
  btn.classList.add('playing');
  btn.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  a.onplay=()=>{ btn.classList.add('playing'); };
  a.onpause=()=>{ btn.classList.remove('playing');
    btn.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'; };
  a.ontimeupdate=()=>{ if(a.duration) drawWave(cv,a.currentTime/a.duration); };
  a.onended=()=>{ btn.classList.remove('playing');
    btn.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    drawWave(cv,0); currentAudio=null; currentBtn=null; };
  a.onerror=()=>toast('Could not play this wave.','err');
  a.play().catch(()=>toast('Could not play this wave.','err'));
}
function drawWave(cv,prog){
  const dpr=Math.min(devicePixelRatio||1,2);
  const w=cv.clientWidth||200,h=cv.clientHeight||34;
  cv.width=w*dpr; cv.height=h*dpr;
  const x=cv.getContext('2d'); x.scale(dpr,dpr); x.clearRect(0,0,w,h);
  const n=32,bw=w/n;
  for(let i=0;i<n;i++){
    const v=Math.abs(Math.sin(i*1.7)*0.6+Math.sin(i*0.6)*0.4);
    const bh=4+v*(h-8);
    x.fillStyle=(i/n)<=prog?'#00C2FF':'rgba(154,167,189,.45)';
    const bx=i*bw+bw*0.2;
    x.beginPath(); x.roundRect(bx,(h-bh)/2,bw*0.6,bh,3); x.fill();
  }
}
function transcribe(btn,orb){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR) return;
  const box=orb.querySelector('[data-trtext]');
  box.classList.remove('hidden'); box.textContent='🎙️ Listening...';
  btn.disabled=true;
  try{
    const rec=new SR(); rec.lang='en-NG';
    const a=new Audio(orb.dataset.url);
    rec.onresult=ev=>{
      const t=[...ev.results].map(r=>r[0].transcript).join(' ');
      box.textContent='“'+t+'”';
    };
    rec.onerror=()=>{ box.textContent='Could not transcribe this wave.'; };
    rec.onend=()=>{ btn.disabled=false; };
    // Note: SpeechRecognition uses the mic, not the audio element — we play the
    // wave aloud so the recognizer can hear it on devices where mic picks up speaker.
    a.play().catch(()=>{});
    rec.start();
    setTimeout(()=>{ try{rec.stop()}catch{}; a.pause(); },15000);
  }catch{ box.textContent='Transcription not available.'; btn.disabled=false; }
}
