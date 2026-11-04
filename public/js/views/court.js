/* Naija Wave — People's Court: daily dilemmas, vote + debate. */
import { api } from '../api.js';
import { skelPosts, emptyState, errCard, toast, av, esc, tick, timeAgo, fmtNum, openSheet, commentHtml, commentComposer } from '../ui.js';

export async function render(view){
  view.innerHTML=`<div class="page" style="padding-top:0">
    <div style="padding:16px 12px 4px;display:flex;align-items:center;justify-content:space-between">
      <div><h1 class="sect" style="margin:0">People's Court ⚖️</h1>
      <p class="small muted">Everyday Naija dilemmas. Vote, then defend your verdict.</p></div>
      <button class="btn primary small" id="newCase">+ New case</button>
    </div>
    <div id="cases"></div>
    <button id="more" class="loadmore hidden">Load more cases</button>
  </div>`;
  const mount=view.querySelector('#cases'), more=view.querySelector('#more');
  let page=1, hasMore=true, loading=false;

  view.querySelector('#newCase').onclick=()=>newCaseSheet(()=>load(true));

  async function load(reset){
    if(loading||(!reset&&!hasMore)) return;
    loading=true;
    if(reset){ page=1; hasMore=true; mount.innerHTML=skelPosts(3); }
    try{
      const d=await api.get(`/api/court?page=${page}&limit=10`);
      if(reset) mount.innerHTML='';
      if(!d.items.length&&page===1) mount.innerHTML=emptyState("Court's empty",'No dilemmas yet. Bring the first case to the court ⚖️');
      d.items.forEach(c=>mount.appendChild(caseCard(c)));
      hasMore=!!d.has_more; more.classList.toggle('hidden',!hasMore); page++;
    }catch(err){ if(page===1) mount.innerHTML=errCard('Could not load the court. '+err.message,()=>load(true)); }
    loading=false;
  }
  more.onclick=()=>load(false);
  load(true);
}

function endsIn(iso){
  if(!iso) return '';
  const s=(new Date(iso)-Date.now())/1000;
  if(s<=0) return 'Voting closed';
  if(s<3600) return 'Ends in '+Math.floor(s/60)+'m';
  return 'Ends in '+Math.floor(s/3600)+'h '+Math.floor(s%3600/60)+'m';
}

export function caseCard(c){
  const a=c.author||{};
  const el=document.createElement('div'); el.className='casecard'; el.dataset.case=c.id;
  el.innerHTML=`
    <div style="display:flex;gap:10px;align-items:center">
      <a href="#/profile/${esc(a.username)}">${av(a,'xs')}</a>
      <div><a href="#/profile/${esc(a.username)}" style="font-weight:700;font-size:13.5px">${esc(a.display_name)} ${tick(a.verification)}</a>
      <div class="small muted">@${esc(a.username)} · ${timeAgo(c.created_at)}</div></div>
    </div>
    <div class="caseq">${esc(c.question)}</div>
    ${c.context?`<div class="casectx">${esc(c.context)}</div>`:''}
    <div class="votezone"></div>
    <div class="endsin">${esc(endsIn(c.ends_at))} · 💬 ${fmtNum(c.comments_count||0)}</div>
    <div class="cwrap"></div>`;
  paintVotes(el,c);
  el.querySelector('.caseq').style.cursor='pointer';
  el.querySelector('.caseq').onclick=()=>toggleComments(el,c);
  return el;
}
function paintVotes(el,c){
  const z=el.querySelector('.votezone');
  const voted=c.my_vote!=null;
  z.innerHTML=c.options.map(o=>{
    const pct=c.total_votes?Math.round(o.votes/c.total_votes*100):0;
    return `<button class="pollopt voteopt ${voted?'voted':''} ${c.my_vote===o.id?'mine':''}" data-vopt="${o.id}" ${voted?'disabled':''}>
      <span class="fill" style="width:${voted?pct:0}%"></span>
      <span class="t">${esc(o.text)}</span>${voted?`<span class="p">${pct}%</span>`:''}</button>`;
  }).join('')+`<div class="small muted">${fmtNum(c.total_votes)} verdict${c.total_votes===1?'':'s'}</div>`;
  z.querySelectorAll('[data-vopt]').forEach(b=>b.onclick=async()=>{
    b.disabled=true;
    try{
      const d=await api.post(`/api/court/${c.id}/vote`,{option_id:+b.dataset.vopt});
      c.options=d.case.options; c.total_votes=d.case.total_votes; c.my_vote=+b.dataset.vopt;
      paintVotes(el,c); toast('Verdict recorded ⚖️','ok');
    }catch(err){ toast(err.message,'err'); b.disabled=false; }
  });
}
let openCase=null;
async function toggleComments(el,c){
  const w=el.querySelector('.cwrap');
  if(openCase===c.id){ w.innerHTML=''; openCase=null; return; }
  openCase=c.id;
  const w2=el.querySelector('.cwrap');
  w2.innerHTML='<div class="comments" id="cc"></div>';
  const box=w2.querySelector('#cc');
  box.innerHTML=skelPosts(1);
  try{
    const d=await api.get(`/api/court/${c.id}/comments?page=1&limit=30`);
    box.innerHTML=d.items.length?'':emptyState('No arguments yet','Drop your take below 👇');
    d.items.forEach(x=>{ const t=document.createElement('div'); t.innerHTML=commentHtml(x); box.appendChild(t.firstChild); });
  }catch(e){ box.innerHTML=errCard('Could not load comments.'); }
  box.appendChild(commentComposer(async t=>{
    const d=await api.post(`/api/court/${c.id}/comments`,{text:t});
    const x=document.createElement('div'); x.innerHTML=commentHtml(d.comment); box.insertBefore(x.firstChild, box.lastChild);
    c.comments_count=(c.comments_count||0)+1;
    el.querySelector('.endsin').innerHTML=`${esc(endsIn(c.ends_at))} · 💬 ${fmtNum(c.comments_count)}`;
  }));
}

function newCaseSheet(onDone){
  const ov=openSheet(`<div class="grab"></div><h2>Bring a case to court ⚖️</h2>
    <div class="field"><label>The dilemma (question)</label>
      <textarea id="cq" class="input" maxlength="280" placeholder="e.g. Your friend borrowed ₦50k and keeps dodging repayment. Do you forgive them?"></textarea></div>
    <div class="field"><label>Context (optional)</label>
      <textarea id="cx" class="input" maxlength="500" placeholder="Give the backstory..."></textarea></div>
    <div class="field"><label>Verdict options (2–4)</label><div id="copts">
      <input class="input mb copt" placeholder="Option A, e.g. Forgive them" maxlength="60">
      <input class="input mb copt" placeholder="Option B, e.g. Cut them off" maxlength="60"></div>
      <button class="btn ghost small" id="cadd">+ Add option</button></div>
    <button class="btn primary block" id="cgo">Open the case</button>`);
  ov.querySelector('#cadd').onclick=()=>{
    if(ov.querySelectorAll('.copt').length>=4){ toast('Max 4 options.','err'); return; }
    const i=document.createElement('input'); i.className='input mb copt'; i.maxLength=60;
    i.placeholder='Option '+String.fromCharCode(65+ov.querySelectorAll('.copt').length);
    ov.querySelector('#copts').appendChild(i);
  };
  ov.querySelector('#cgo').onclick=async()=>{
    const question=ov.querySelector('#cq').value.trim();
    const context=ov.querySelector('#cx').value.trim();
    const options=[...ov.querySelectorAll('.copt')].map(i=>i.value.trim()).filter(Boolean);
    if(!question){ toast('Write the dilemma first.','err'); return; }
    if(options.length<2){ toast('Give at least 2 verdict options.','err'); return; }
    try{
      await api.post('/api/court',{question,context:context||undefined,options});
      const { closeOverlay }=await import('../ui.js'); closeOverlay();
      toast('Case opened! The court is in session ⚖️','ok'); onDone();
    }catch(err){ toast(err.message,'err'); }
  };
}
