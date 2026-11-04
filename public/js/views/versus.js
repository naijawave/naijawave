/* Naija Wave — Naija Versus: side-by-side battles, vote + discuss. */
import { api, auth } from '../api.js';
import { skelPosts, emptyState, errCard, toast, av, esc, tick, timeAgo, fmtNum, openSheet, commentHtml, commentComposer } from '../ui.js';

export async function render(view){
  view.innerHTML=`<div class="page" style="padding-top:0">
    <div style="padding:16px 12px 4px;display:flex;align-items:center;justify-content:space-between">
      <div><h1 class="sect" style="margin:0">Naija Versus ⚔️</h1>
      <p class="small muted">Settle the debate. Pick a side, defend it.</p></div>
      <button class="btn primary small" id="newVs">+ New battle</button>
    </div>
    <div id="battles"></div>
    <button id="more" class="loadmore hidden">Load more battles</button>
  </div>`;
  const mount=view.querySelector('#battles'), more=view.querySelector('#more');
  let page=1, hasMore=true, loading=false;
  view.querySelector('#newVs').onclick=()=>newBattleSheet(()=>load(true));

  async function load(reset){
    if(loading||(!reset&&!hasMore)) return;
    loading=true;
    if(reset){ page=1; hasMore=true; mount.innerHTML=skelPosts(3); }
    try{
      const d=await api.get(`/api/versus?page=${page}&limit=10`);
      if(reset) mount.innerHTML='';
      if(!d.items.length&&page===1) mount.innerHTML=emptyState('No battles yet','Start the first showdown — Wizkid vs Burna? Jollof vs Fried rice? ⚔️');
      d.items.forEach(b=>mount.appendChild(battleCard(b)));
      hasMore=!!d.has_more; more.classList.toggle('hidden',!hasMore); page++;
    }catch(err){ if(page===1) mount.innerHTML=errCard('Could not load battles. '+err.message,()=>load(true)); }
    loading=false;
  }
  more.onclick=()=>load(false);
  load(true);
}

export function battleCard(b){
  const a=b.author||{};
  const el=document.createElement('div'); el.className='battlecard'; el.dataset.battle=b.id;
  const total=b.total_votes||1;
  const pa=Math.round((b.side_a.votes||0)/Math.max(b.total_votes,1)*100);
  el.innerHTML=`
    <div style="display:flex;gap:10px;align-items:center">
      <a href="#/profile/${esc(a.username)}">${av(a,'xs')}</a>
      <div><a href="#/profile/${esc(a.username)}" style="font-weight:700;font-size:13.5px">${esc(a.display_name)} ${tick(a.verification)}</a>
      <div class="small muted">@${esc(a.username)} · ${timeAgo(b.created_at)}</div></div>
    </div>
    <div class="vstitle" style="margin-top:8px">${esc(b.title)}</div>
    <div class="vsgrid">
      <button class="vsside ${b.my_side==='a'?'mine':''}" data-side="a">
        ${b.side_a.image_url?`<img src="${esc(b.side_a.image_url)}" alt="" loading="lazy">`:''}
        <div class="vsl">${esc(b.side_a.label)}</div><div class="vsp">${fmtNum(b.side_a.votes||0)} votes</div>
      </button>
      <div class="vsBadge">VS</div>
      <button class="vsside ${b.my_side==='b'?'mine':''}" data-side="b">
        ${b.side_b.image_url?`<img src="${esc(b.side_b.image_url)}" alt="" loading="lazy">`:''}
        <div class="vsl">${esc(b.side_b.label)}</div><div class="vsp">${fmtNum(b.side_b.votes||0)} votes</div>
      </button>
    </div>
    <div class="vssplit"><div class="a" style="width:${pa}%"></div><div class="b" style="width:${100-pa}%"></div></div>
    <div class="small muted">${fmtNum(b.total_votes||0)} votes · 💬 ${fmtNum(b.comments_count||0)}</div>
    <div class="cwrap"></div>`;
  el.querySelectorAll('[data-side]').forEach(s=>s.onclick=async()=>{
    const side=s.dataset.side;
    if(b.my_side===side){ toggleComments(el,b); return; }
    s.disabled=true;
    try{
      const d=await api.post(`/api/versus/${b.id}/vote`,{side});
      b.side_a.votes=d.side_a_votes; b.side_b.votes=d.side_b_votes; b.total_votes=d.total_votes; b.my_side=side;
      const fresh=battleCard(b); el.replaceWith(fresh); toast('Vote counted! ⚔️','ok');
    }catch(err){ toast(err.message,'err'); s.disabled=false; }
  });
  el.querySelector('.vstitle').style.cursor='pointer';
  el.querySelector('.vstitle').onclick=()=>toggleComments(el,b);
  return el;
}

let openB=null;
async function toggleComments(el,b){
  const w=el.querySelector('.cwrap');
  if(openB===b.id){ w.innerHTML=''; openB=null; return; }
  openB=b.id;
  w.innerHTML='<div class="comments" id="cc"></div>';
  const box=w.querySelector('#cc');
  box.innerHTML=skelPosts(1);
  try{
    const d=await api.get(`/api/versus/${b.id}/comments?page=1&limit=30`);
    box.innerHTML=d.items.length?'':emptyState('No takes yet','Argue your side below 👇');
    d.items.forEach(x=>{ const t=document.createElement('div'); t.innerHTML=commentHtml(x); box.appendChild(t.firstChild); });
  }catch{ box.innerHTML=errCard('Could not load comments.'); }
  box.appendChild(commentComposer(async t=>{
    const d=await api.post(`/api/versus/${b.id}/comments`,{text:t});
    const x=document.createElement('div'); x.innerHTML=commentHtml(d.comment); box.insertBefore(x.firstChild,box.lastChild);
  }));
}

function newBattleSheet(onDone){
  const ov=openSheet(`<div class="grab"></div><h2>Start a battle ⚔️</h2>
    <div class="field"><label>Battle title</label>
      <input id="vt" class="input" maxlength="120" placeholder="e.g. Who owns Afrobeats right now?"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Side A</label><input id="va" class="input" maxlength="60" placeholder="e.g. Wizkid"></div>
      <div class="field"><label>Side B</label><input id="vb" class="input" maxlength="60" placeholder="e.g. Burna Boy"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Side A image (optional)</label>
        <label class="btn ghost small block" style="cursor:pointer">Upload<input id="via" type="file" accept="image/*" hidden></label><img id="viap" class="hidden" style="border-radius:10px;margin-top:6px"></div>
      <div class="field"><label>Side B image (optional)</label>
        <label class="btn ghost small block" style="cursor:pointer">Upload<input id="vib" type="file" accept="image/*" hidden></label><img id="vibp" class="hidden" style="border-radius:10px;margin-top:6px"></div>
    </div>
    <button class="btn primary block" id="vgo">Launch battle</button>`);
  let ia=null, ib=null;
  const up=(inp,prev,set)=>{
    ov.querySelector(inp).onchange=async e=>{
      const f=e.target.files[0]; if(!f) return;
      try{ const u=await api.uploadFile(f,'image'); set(u.url);
        const p=ov.querySelector(prev); p.src=u.url; p.classList.remove('hidden');
      }catch(err){ toast('Upload failed: '+err.message,'err'); }
    };
  };
  up('#via','#viap',u=>ia=u); up('#vib','#vibp',u=>ib=u);
  ov.querySelector('#vgo').onclick=async()=>{
    const title=ov.querySelector('#vt').value.trim();
    const la=ov.querySelector('#va').value.trim(), lb=ov.querySelector('#vb').value.trim();
    if(!title||!la||!lb){ toast('Give the battle a title and both sides.','err'); return; }
    try{
      await api.post('/api/versus',{title,side_a_label:la,side_b_label:lb,side_a_image:ia||undefined,side_b_image:ib||undefined});
      const { closeOverlay }=await import('../ui.js'); closeOverlay();
      toast('Battle launched! ⚔️','ok'); onDone();
    }catch(err){ toast(err.message,'err'); }
  };
}
