/* Naija Wave — Street Buzz: community reports with "not confirmed" ribbons. */
import { api, auth } from '../api.js';
import { postCard, skelPosts, emptyState, errCard, toast, esc, openSheet, openModal } from '../ui.js';
import { composer } from './home.js';

const CATS=[
  {id:'',l:'All'},{id:'events',l:'🎉 Events'},{id:'traffic',l:'🚗 Traffic'},
  {id:'announcements',l:'📢 Announcements'},{id:'gist',l:'💬 Gist'},
];

export async function render(view){
  view.innerHTML=`<div class="page" style="padding-top:0">
    <div style="padding:16px 12px 4px"><h1 class="sect" style="margin:0">Street Buzz 📍</h1>
    <p class="small muted">What's happening around you — shared by the community. <b>Unverified reports are not confirmed facts.</b></p></div>
    <div class="chips" id="chips">${CATS.map((c,i)=>`<button class="chip ${i===0?'active':''}" data-c="${c.id}">${c.l}</button>`).join('')}</div>
    <div style="padding:0 12px 8px"><div class="field" style="margin:0">
      <input id="bloc" class="input" placeholder="📍 Filter by area (e.g. Ikeja, Lagos)" style="border-radius:var(--pill)"></div></div>
    <div id="cz"></div>
    <div id="posts"></div>
    <button id="more" class="loadmore hidden">Load more</button>
  </div>`;
  view.querySelector('#cz').appendChild(composer({buzz:true}));
  const posts=view.querySelector('#posts'), more=view.querySelector('#more');
  const chips=view.querySelector('#chips'), locIn=view.querySelector('#bloc');
  let cat='', page=1, hasMore=true, loading=false, lt=null;

  chips.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{
    chips.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); cat=b.dataset.c; load(true);
  });
  locIn.oninput=()=>{ clearTimeout(lt); lt=setTimeout(()=>load(true),500); };

  // report button wiring (delegated on posts)
  posts.addEventListener('click', e=>{
    const card=e.target.closest('[data-post]');
    if(!card) return;
    if(e.target.closest('[data-act]')) return; // handled globally
  });

  async function load(reset){
    if(loading||(!reset&&!hasMore)) return;
    loading=true;
    if(reset){ page=1; hasMore=true; posts.innerHTML=skelPosts(3); }
    const qs=new URLSearchParams({page,limit:20});
    if(cat) qs.set('category',cat);
    if(locIn.value.trim()) qs.set('location',locIn.value.trim());
    try{
      const d=await api.get('/api/buzz?'+qs);
      if(reset) posts.innerHTML='';
      if(!d.items.length&&page===1) posts.innerHTML=emptyState('Quiet streets','No buzz here yet. Be the first to report what\'s happening 📍');
      d.items.forEach(p=>{
        const t=document.createElement('div'); t.innerHTML=postCard(p);
        const card=t.firstChild;
        // add report affordance
        const head=card.querySelector('.phead');
        const rb=document.createElement('button');
        rb.className='linklike small'; rb.style.marginLeft='auto'; rb.textContent='Report';
        rb.onclick=ev=>{ ev.stopPropagation(); reportSheet(p.id); };
        head.appendChild(rb);
        posts.appendChild(card);
      });
      hasMore=!!d.has_more; more.classList.toggle('hidden',!hasMore); page++;
    }catch(err){ if(page===1) posts.innerHTML=errCard('Could not load Street Buzz. '+err.message,()=>load(true)); }
    loading=false;
  }
  more.onclick=()=>load(false);
  const onPosted=e=>{ if(e.detail.section==='buzz') load(true); };
  document.addEventListener('nw:posted',onPosted);
  load(true);
  return ()=>document.removeEventListener('nw:posted',onPosted);
}

function reportSheet(postId){
  const ov=openSheet(`<div class="grab"></div><h2>Report this post</h2>
    <p class="small muted mb">Help keep Street Buzz truthful. Reports go to moderators.</p>
    <div class="radioRow" id="rr">
      ${['Misinformation','Harassment','Scam / fraud','Hate speech','Spam','Other'].map((r,i)=>`<button class="radioPill ${i===0?'active':''}" data-r="${r}">${r}</button>`).join('')}
    </div>
    <div class="field mt"><label>Details (optional)</label><textarea id="rd" class="input" maxlength="500" placeholder="What’s wrong with this post?"></textarea></div>
    <button class="btn danger block" id="rgo">Send report</button>`);
  let reason='Misinformation';
  ov.querySelectorAll('[data-r]').forEach(b=>b.onclick=()=>{ ov.querySelectorAll('[data-r]').forEach(x=>x.classList.remove('active')); b.classList.add('active'); reason=b.dataset.r; });
  ov.querySelector('#rgo').onclick=async()=>{
    try{
      await api.post(`/api/posts/${postId}/report`,{reason,details:ov.querySelector('#rd').value.trim()||undefined});
      const { closeOverlay }=await import('../ui.js'); closeOverlay();
      toast('Report sent. Moderators will review it.','ok');
    }catch(err){ toast(err.message,'err'); }
  };
}
export { reportSheet };
