/* Naija Wave — home: composer + For You / Following feeds.
   Videos (TikTok / Instagram / YouTube, added by link on the Videos page)
   are mixed into the For You feed — a video card after every 3 posts, and at
   least one near the top when there are fresh videos. */
import { api, auth } from '../api.js';
import { postCard, skelPosts, emptyState, errCard, toast, av, esc, openModal } from '../ui.js';
import { videoCard, bindVideoPlayers, unbindVideoPlayers } from './videos-shared.js';

export async function render(view){
  view.innerHTML=`<div class="page" style="padding-top:0">
    <div class="tabs" role="tablist">
      <button id="tabFY" class="active">For You</button>
      <button id="tabFol">Following</button>
    </div>
    <div id="composerMount"></div>
    <div id="feed"></div>
    <button id="more" class="loadmore hidden">Load more waves</button>
  </div>`;
  view.querySelector('#composerMount').appendChild(composer());

  const feed=view.querySelector('#feed'), more=view.querySelector('#more');
  let tab='foryou', page=1, hasMore=true, loading=false;
  // Videos mixed into the For You feed (fetched in batches, consumed as
  // pages load — videos are a bonus, so failures never break the feed).
  let videoQueue=[], videoOffset=0, videoHasMore=true, videoLoading=false;

  async function ensureVideos(){
    if(videoQueue.length>=3 || !videoHasMore || videoLoading) return;
    videoLoading=true;
    try{
      const d=await api.get(`/api/videos?limit=10&offset=${videoOffset}`);
      videoQueue.push(...(d.items||[]));
      videoOffset+=(d.items||[]).length;
      videoHasMore=!!d.has_more;
    }catch{ /* ignore — feed works without videos */ }
    videoLoading=false;
  }
  function nextVideo(){ return videoQueue.shift()||null; }

  async function load(reset){
    if(loading||(!reset&&!hasMore)) return;
    loading=true;
    if(reset){ page=1; hasMore=true; feed.innerHTML=skelPosts(4); more.classList.add('hidden'); videoQueue=[]; videoOffset=0; videoHasMore=true; }
    try{
      const d=await api.get(`/api/feed/${tab}?page=${page}&limit=20`);
      if(reset) feed.innerHTML='';
      if(!d.items.length && page===1){
        feed.innerHTML=emptyState('No waves yet','Follow people or be the first to post. The tide starts with you 🌊');
      }else{
        // For You: mix video cards in with the posts.
        if(tab==='foryou'){
          await ensureVideos();
          const items=[];
          let postCount=0, videoInserted=false;
          d.items.forEach(p=>{
            items.push({type:'post', data:p});
            postCount++;
            if(postCount%3===0){ const v=nextVideo(); if(v){ items.push({type:'video', data:v}); videoInserted=true; } }
          });
          // At least one video near the top on the first page, if any are fresh.
          if(page===1 && !videoInserted && videoQueue.length){
            const v=nextVideo();
            if(v) items.splice(Math.min(2, items.length), 0, {type:'video', data:v});
          }
          items.forEach(it=>{
            const t=document.createElement('div');
            t.innerHTML = it.type==='post' ? postCard(it.data) : videoCard(it.data, auth.me);
            feed.appendChild(t.firstChild);
          });
          bindVideoPlayers(feed);
          if(videoQueue.length<3 && videoHasMore) ensureVideos();
        }else{
          d.items.forEach(p=>{ const t=document.createElement('div'); t.innerHTML=postCard(p); feed.appendChild(t.firstChild); });
        }
      }
      hasMore=!!d.has_more; more.classList.toggle('hidden',!hasMore);
      page++;
    }catch(err){
      if(page===1) feed.innerHTML=errCard('Could not load your feed. '+err.message,()=>load(true));
      else toast(err.message,'err');
    }
    loading=false;
  }
  const tFY=view.querySelector('#tabFY'), tF=view.querySelector('#tabFol');
  tFY.onclick=()=>{ tab='foryou'; tFY.classList.add('active'); tF.classList.remove('active'); load(true); };
  tF.onclick=()=>{ tab='following'; tF.classList.add('active'); tFY.classList.remove('active'); load(true); };
  more.onclick=()=>load(false);
  document.addEventListener('nw:posted', onPosted);
  load(true);
  return ()=>{ document.removeEventListener('nw:posted', onPosted); unbindVideoPlayers(); };

  function onPosted(e){
    if(tab==='foryou'){ const t=document.createElement('div'); t.innerHTML=postCard(e.detail); feed.prepend(t.firstChild); }
  }
}

/* ---------- composer ---------- */
export function composer({buzz=false}={}){
  const el=document.createElement('div'); el.className='composer';
  el.innerHTML=`
    <div class="crow">${av(auth.me,'sm')}
      <textarea class="ctextarea" maxlength="500" placeholder="${buzz?'Share what\'s happening around you...':'What\'s waving?'}"></textarea>
    </div>
    <div class="cpreviews"></div>
    <div id="pollBox"></div>
    ${buzz?`<div class="field" style="margin:8px 0"><input id="czLoc" class="input" placeholder="📍 Location (e.g. Lekki, Lagos)" maxlength="80"></div>`:''}
    <div class="ctools">
      <label class="ctool" title="Add photos/video" aria-label="Add media" style="cursor:pointer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        <input type="file" id="czFile" accept="image/*,video/*" multiple hidden></label>
      <button class="ctool" id="czPoll" title="Add poll" aria-label="Add poll">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/></svg></button>
      <span class="charcount" id="czCount">500</span>
      <button class="btn primary small csend" id="czSend" disabled>Wave it</button>
    </div>`;
  const ta=el.querySelector('.ctextarea'), send=el.querySelector('#czSend'), count=el.querySelector('#czCount');
  const previews=el.querySelector('.cpreviews'), pollBox=el.querySelector('#pollBox');
  let media=[], poll=null;
  ta.addEventListener('focus',()=>el.classList.add('focus'));
  ta.addEventListener('blur',()=>el.classList.remove('focus'));
  ta.addEventListener('input',()=>{ count.textContent=500-ta.value.length; send.disabled=!ta.value.trim()&&!media.length&&!poll; });

  el.querySelector('#czFile').onchange=async e=>{
    const files=[...e.target.files].slice(0,4-media.length);
    for(const f of files){
      if(media.length>=4){ toast('Max 4 photos per wave.','err'); break; }
      if(f.type.startsWith('video')&&media.some(m=>m.kind==='video')){ toast('One video per wave.','err'); continue; }
      const tmp=document.createElement('div'); tmp.className='cprev'; tmp.innerHTML='<div class="skel" style="width:100%;height:100%"></div>';
      previews.appendChild(tmp);
      try{
        const u=await api.uploadFile(f, f.type.startsWith('video')?'video':'image');
        media.push({id:u.id,url:u.url,kind:u.kind});
        tmp.innerHTML=`${u.kind==='video'?`<video src="${esc(u.url)}" muted></video>`:`<img src="${esc(u.url)}" alt="">`}<button aria-label="Remove">✕</button>`;
        tmp.querySelector('button').onclick=()=>{ media=media.filter(m=>m.id!==u.id); tmp.remove(); send.disabled=!ta.value.trim()&&!media.length&&!poll; };
      }catch(err){ tmp.remove(); toast('Upload failed: '+err.message,'err'); }
    }
    send.disabled=!ta.value.trim()&&!media.length&&!poll;
    e.target.value='';
  };

  el.querySelector('#czPoll').onclick=()=>{
    if(poll){ poll=null; pollBox.innerHTML=''; el.querySelector('#czPoll').classList.remove('on'); send.disabled=!ta.value.trim()&&!media.length; return; }
    el.querySelector('#czPoll').classList.add('on');
    pollBox.innerHTML=`<div class="card tight mt mb">
      <input id="pq" class="input mb" placeholder="Poll question..." maxlength="140">
      <div id="popts"><input class="input mb pollin" placeholder="Option 1" maxlength="60"><input class="input mb pollin" placeholder="Option 2" maxlength="60"></div>
      <button class="btn ghost small" id="padd">+ Add option</button></div>`;
    poll={q:'',opts:['','']};
    pollBox.querySelector('#pq').oninput=e=>poll.q=e.target.value;
    pollBox.querySelector('#padd').onclick=()=>{
      if(pollBox.querySelectorAll('.pollin').length>=4){ toast('Max 4 options.','err'); return; }
      const i=document.createElement('input'); i.className='input mb pollin'; i.placeholder='Option '+(pollBox.querySelectorAll('.pollin').length+1); i.maxLength=60;
      pollBox.querySelector('#popts').appendChild(i);
    };
  };

  send.onclick=async()=>{
    const text=ta.value.trim();
    let pollPayload=null;
    if(poll){
      const q=pollBox.querySelector('#pq').value.trim();
      const opts=[...pollBox.querySelectorAll('.pollin')].map(i=>i.value.trim()).filter(Boolean);
      if(!q||opts.length<2){ toast('Poll needs a question and at least 2 options.','err'); return; }
      pollPayload={question:q,options:opts};
    }
    if(!text&&!media.length&&!pollPayload) return;
    send.disabled=true; send.textContent='Sending...';
    try{
      const body={text, media_ids:media.map(m=>m.id)};
      if(pollPayload) body.poll=pollPayload;
      if(buzz){ body.section='buzz'; const loc=el.querySelector('#czLoc')?.value.trim(); if(loc) body.location=loc; }
      const d=await api.post('/api/posts',body);
      toast(buzz?'Buzz posted — thanks for keeping the street informed!':'Wave sent 🌊','ok');
      document.dispatchEvent(new CustomEvent('nw:posted',{detail:d.post}));
      ta.value=''; previews.innerHTML=''; pollBox.innerHTML=''; poll=null;
      el.querySelector('#czPoll').classList.remove('on');
      media=[]; count.textContent='500'; send.textContent='Wave it';
    }catch(err){ toast(err.message,'err'); }
    send.disabled=false;
  };
  return el;
}

/* quote from post detail */
export function quoteSheet(post){
  const ov=openModal(`<h2>Quote this wave</h2>
    <div class="quote mb"><b>${esc(post.author?.display_name)}</b> <span class="muted small">@${esc(post.author?.username)}</span>
    <div class="small" style="margin-top:4px">${esc((post.text||'').slice(0,140))}</div></div>
    <div class="field"><textarea id="qText" class="input" maxlength="500" placeholder="Add your take..."></textarea></div>
    <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn ghost" data-close>Cancel</button>
    <button class="btn primary" id="qGo">Quote</button></div>`);
  ov.querySelector('#qGo').onclick=async()=>{
    const t=ov.querySelector('#qText').value.trim();
    if(!t){ toast('Write something first.','err'); return; }
    try{ const d=await api.post(`/api/posts/${post.id}/repost`,{quote_text:t});
      const { closeOverlay }=await import('../ui.js'); closeOverlay();
      toast('Quoted 🌊','ok'); document.dispatchEvent(new CustomEvent('nw:posted',{detail:d.post}));
      location.hash='#/home';
    }catch(err){ toast(err.message,'err'); }
  };
}
