/* Naija Wave — verification centre: explainer, application, status tracker. */
import { api, auth } from '../api.js';
import { toast, esc, tick, openSheet, skelPosts, emptyState, errCard, timeAgo } from '../ui.js';

export async function render(view){
  view.innerHTML=`<div class="page"><h1 class="sect">Verification centre</h1>
    <div id="badges">${skelPosts(2)}</div>
    <div class="card mb mt"><h3 class="sect" style="font-size:15px">Apply for verification</h3><div id="apply"></div></div>
    <div class="card"><h3 class="sect" style="font-size:15px">My applications</h3><div id="mine">${skelPosts(1)}</div></div>
  </div>`;

  // badge explainer from server
  try{
    const d=await api.get('/api/verification/badges');
    const b=d.badges||{};
    view.querySelector('#badges').innerHTML=`
      <div class="card mb"><div style="display:flex;gap:10px;align-items:center;margin-bottom:6px">${tick('blue')}<b>${esc(b.blue?.name||'Blue verified')}</b></div>
        <p class="small" style="color:var(--ink2)">${esc(b.blue?.meaning||'')}</p>
        ${b.blue?.who?`<p class="small muted">Who: ${esc(b.blue.who)}</p>`:''}</div>
      <div class="card mb"><div style="display:flex;gap:10px;align-items:center;margin-bottom:6px">${tick('gold')}<b>${esc(b.gold?.name||'Gold verified')}</b></div>
        <p class="small" style="color:var(--ink2)">${esc(b.gold?.meaning||'')}</p>
        ${b.gold?.who?`<p class="small muted">Who: ${esc(b.gold.who)}</p>`:''}</div>
      <div class="card"><div style="display:flex;gap:10px;align-items:center;margin-bottom:6px">${tick('founder')}<b>${esc(b.founder?.name||'Founder')}</b></div>
        <p class="small" style="color:var(--ink2)">${esc(b.founder?.meaning||'')}</p></div>`;
  }catch{ view.querySelector('#badges').innerHTML=''; }

  const apply=view.querySelector('#apply');
  const v=auth.me.verification;
  if(v&&v!=='none'){
    apply.innerHTML=`<div class="statusline approved">${tick(v)} You are verified (${esc(v)}). No need to apply again.</div>`;
  }else{
    apply.innerHTML=`
      <div class="field"><label>Category</label><div class="radioRow" id="vCat">
        <button class="radioPill active" data-c="blue">🔵 Blue — individual</button>
        <button class="radioPill" data-c="gold">🟡 Gold — public figure / business</button></div></div>
      <div class="field hidden" id="vOrgW"><label>Organisation / stage name</label><input id="vOrg" class="input" maxlength="120"></div>
      <div class="field"><label>Why should this account be verified?</label>
        <textarea id="vState" class="input" maxlength="1000" placeholder="Tell us who you are and why this account is notable or at risk of impersonation..."></textarea></div>
      <div class="field"><label>Evidence links (websites, public profiles, press)</label><div id="vLinks">
        <div class="evlink"><input class="input evl" placeholder="https://..."></div></div>
        <button class="btn ghost small" id="vAdd">+ Add link</button>
        <div class="hint">No NIN, BVN, ID documents, or selfies needed — public evidence only.</div></div>
      <button class="btn primary block" id="vGo">Submit application</button>`;
    let cat='blue';
    apply.querySelectorAll('#vCat .radioPill').forEach(b=>b.onclick=()=>{
      apply.querySelectorAll('#vCat .radioPill').forEach(x=>x.classList.remove('active'));
      b.classList.add('active'); cat=b.dataset.c;
      apply.querySelector('#vOrgW').classList.toggle('hidden',cat!=='gold');
    });
    apply.querySelector('#vAdd').onclick=()=>{
      const d=document.createElement('div'); d.className='evlink';
      d.innerHTML='<input class="input evl" placeholder="https://...">';
      apply.querySelector('#vLinks').appendChild(d);
    };
    apply.querySelector('#vGo').onclick=async()=>{
      const statement=apply.querySelector('#vState').value.trim();
      const links=[...apply.querySelectorAll('.evl')].map(i=>i.value.trim()).filter(Boolean);
      const org_name=cat==='gold'?apply.querySelector('#vOrg').value.trim():undefined;
      if(statement.length<20){ toast('Tell us a bit more (at least 20 characters).','err'); return; }
      if(!links.length){ toast('Add at least one evidence link.','err'); return; }
      try{
        await api.post('/api/verification/apply',{category:cat,statement,links,org_name:org_name||undefined});
        toast('Application submitted. We\'ll review it soon.','ok');
        loadMine();
      }catch(err){ toast(err.message,'err'); }
    };
  }
  const mine=view.querySelector('#mine');
  async function loadMine(){
    try{
      const d=await api.get('/api/verification/mine');
      const app=d.application, hist=d.history||[];
      let h='';
      if(app) h+=`<div class="statusline ${app.status==='pending'?'pending':app.status==='approved'?'approved':'rejected'}">
        ${app.status==='pending'?'⏳ Pending review':app.status==='approved'?'✅ Approved':'❌ Rejected'} — ${esc(app.category)} · applied ${timeAgo(app.created_at)}</div>
        ${app.reviewer_note?`<p class="small" style="color:var(--ink2)">Reviewer note: ${esc(app.reviewer_note)}</p>`:''}`;
      else h+='<p class="muted small">No active application.</p>';
      if(hist.length) h+='<div class="divider"></div>'+hist.map(x=>`<div class="kv"><span class="k">${esc(x.category)} · ${timeAgo(x.created_at)}</span><span>${esc(x.status)}</span></div>`).join('');
      mine.innerHTML=h;
    }catch(err){ mine.innerHTML=errCard('Could not load applications.',loadMine); }
  }
  loadMine();
}
