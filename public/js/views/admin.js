/* Naija Wave — founder admin dashboard (server-enforced RBAC; 403 → not authorized). */
import { api, auth } from '../api.js';
import { toast, esc, av, tick, timeAgo, fmtNum, skelPosts, emptyState, errCard, openSheet, confirmDlg } from '../ui.js';

export async function render(view){
  view.innerHTML=`<div class="page"><h1 class="sect">🛡️ Admin dashboard</h1><div id="abody">${skelPosts(3)}</div></div>`;
  const body=view.querySelector('#abody');
  // server is the authority: probe stats
  try{ await api.get('/api/admin/stats'); }
  catch(err){
    body.innerHTML=`<div class="errcard" style="background:var(--gold-dim);border-color:rgba(232,185,74,.4)">
      <h3 style="margin-bottom:8px">🔒 Not authorized</h3>
      <p>Your account doesn't have admin access. If you're the founder, make sure your account was set up with the founder setup key.</p></div>`;
    return;
  }
  body.innerHTML=`
    <div class="statgrid" id="stats"></div>
    <div class="tabs" id="atabs" role="tablist" style="position:static">
      <button data-t="users" class="active">Users</button>
      <button data-t="verify">Verification</button>
      <button data-t="reports">Reports</button>
      <button data-t="activity">Activity</button>
      <button data-t="posts">Posts</button>
    </div>
    <div id="apane"></div>`;
  const stats=body.querySelector('#stats'), pane=body.querySelector('#apane');
  try{
    const s=await api.get('/api/admin/stats');
    const cards=[['Users',s.users],['Waves (24h)',s.posts_24h],['Messages (24h)',s.messages_24h],
      ['Open reports',s.reports_open],['Pending verifications',s.verifications_pending],['Active today',s.active_today]];
    stats.innerHTML=cards.map(([l,n])=>`<div class="stat"><div class="n">${fmtNum(n??0)}</div><div class="l">${l}</div></div>`).join('');
  }catch(err){ stats.innerHTML=errCard('Could not load stats.'); }

  body.querySelectorAll('#atabs button').forEach(b=>b.onclick=()=>{
    body.querySelectorAll('#atabs button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); show(b.dataset.t);
  });
  function show(t){
    ({users:showUsers,verify:showVerify,reports:showReports,activity:showActivity,posts:showPosts})[t](pane);
  }
  show('users');
}

/* ---------- users ---------- */
async function showUsers(pane){
  pane.innerHTML=`
    <div class="searchbar" style="position:static;border:none;padding:12px 0"><input id="uq" class="input" placeholder="Search users..."></div>
    <div class="chips" id="uf"><button class="chip active" data-f="all">All</button><button class="chip" data-f="suspended">Suspended</button><button class="chip" data-f="verified">Verified</button></div>
    <div id="ulist"></div>`;
  const list=pane.querySelector('#ulist'), q=pane.querySelector('#uq');
  let filter='all', t=null;
  pane.querySelectorAll('#uf .chip').forEach(b=>b.onclick=()=>{ pane.querySelectorAll('#uf .chip').forEach(x=>x.classList.remove('active')); b.classList.add('active'); filter=b.dataset.f; load(); });
  q.oninput=()=>{ clearTimeout(t); t=setTimeout(load,400); };
  async function load(){
    list.innerHTML=skelPosts(2);
    try{
      const d=await api.get(`/api/admin/users?q=${encodeURIComponent(q.value.trim())}&filter=${filter}&page=1&limit=25`);
      const items=d.items||d.users||[];
      list.innerHTML=items.length?'':emptyState('No users found','');
      items.forEach(u=>list.appendChild(userRow(u)));
    }catch(err){ list.innerHTML=errCard('Could not load users. '+err.message,load); }
  }
  function userRow(u){
    const el=document.createElement('div'); el.className='admrow';
    el.innerHTML=`${av(u,'sm')}<div class="grow">
        <div style="font-weight:700;display:flex;gap:6px;align-items:center">${esc(u.display_name)} ${tick(u.verification)}</div>
        <div class="small muted">@${esc(u.username)} · id ${u.id}</div>
        <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap">
          ${u.suspended?'<span class="tagpill red">suspended</span>':''}
          ${u.verification&&u.verification!=='none'?`<span class="tagpill ${u.verification==='founder'?'gold':'blue'}">${esc(u.verification)}</span>`:''}
          ${u.role==='admin'?'<span class="tagpill gold">admin</span>':''}${u.is_founder?'<span class="tagpill gold">founder</span>':''}
        </div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${u.suspended?`<button class="btn ghost small" data-a="restore">Restore</button>`:`<button class="btn danger small" data-a="suspend">Suspend</button>`}
        ${(u.verification&&u.verification!=='none'&&u.verification!=='founder')?`<button class="btn ghost small" data-a="revoke">Revoke tick</button>`:''}
        ${!u.is_founder?`<button class="btn ghost small" data-a="role">${u.role==='admin'?'Remove admin':'Make admin'}</button>`:''}
      </div>`;
    el.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>userAction(u,b.dataset.a,load));
    return el;
  }
  load();
}
async function userAction(u,a,reload){
  try{
    if(a==='suspend'){
      const ov=openSheet(`<div class="grab"></div><h2>Suspend @${esc(u.username)}?</h2>
        <div class="field"><label>Reason</label><input id="sr" class="input" placeholder="Why is this account being suspended?"></div>
        <button class="btn danger block" id="sgo">Suspend account</button>`);
      ov.querySelector('#sgo').onclick=async()=>{
        const reason=ov.querySelector('#sr').value.trim()||'Policy violation';
        await api.post(`/api/admin/users/${u.id}/suspend`,{reason});
        (await import('../ui.js')).closeOverlay(); toast('Account suspended.','ok'); reload();
      };
    }else if(a==='restore'){ await api.post(`/api/admin/users/${u.id}/restore`); toast('Account restored.','ok'); reload(); }
    else if(a==='revoke'){
      const ov=openSheet(`<div class="grab"></div><h2>Revoke verification tick?</h2>
        <div class="field"><label>Reason</label><input id="rr" class="input"></div>
        <button class="btn danger block" id="rgo">Revoke tick</button>`);
      ov.querySelector('#rgo').onclick=async()=>{
        await api.post(`/api/admin/users/${u.id}/revoke-verification`,{reason:ov.querySelector('#rr').value.trim()||'Revoked by admin'});
        (await import('../ui.js')).closeOverlay(); toast('Tick revoked.','ok'); reload();
      };
    }else if(a==='role'){
      if(!await confirmDlg((u.role==='admin'?'Remove admin from @':'Make @')+u.username+'?',u.role==='admin'?'They will lose all admin powers.':'They will gain admin powers. Only the founder can do this.','Confirm')) return;
      await api.post(`/api/admin/users/${u.id}/role`,{role:u.role==='admin'?'user':'admin'});
      toast('Role updated.','ok'); reload();
    }
  }catch(err){ toast(err.message,'err'); }
}

/* ---------- verification queue ---------- */
async function showVerify(pane){
  pane.innerHTML=`<div id="vlist">${skelPosts(3)}</div>`;
  const list=pane.querySelector('#vlist');
  async function load(){
    list.innerHTML=skelPosts(2);
    try{
      const d=await api.get('/api/admin/verifications?status=pending');
      const items=d.items||d.applications||[];
      if(!items.length){ list.innerHTML=emptyState('Queue is clear','No pending verification applications. ✅'); return; }
      list.innerHTML='';
      items.forEach(a=>list.appendChild(appRow(a)));
    }catch(err){ list.innerHTML=errCard('Could not load queue. '+err.message,load); }
  }
  function appRow(a){
    const u=a.user||a.applicant||{};
    const el=document.createElement('div'); el.className='card mb';
    el.innerHTML=`
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px">${av(u,'sm')}
        <div><b>${esc(u.display_name||'')}</b> ${tick(u.verification)}<div class="small muted">@${esc(u.username||'')} · wants <span class="tagpill ${a.category==='gold'?'gold':'blue'}">${esc(a.category||'')}</span> · ${timeAgo(a.created_at)}</div></div></div>
      ${a.org_name?`<div class="small mb"><b>Org:</b> ${esc(a.org_name)}</div>`:''}
      <p style="font-size:14px;color:var(--ink2)">${esc(a.statement||'')}</p>
      <div class="small mt mb"><b>Evidence:</b><br>${(a.links||[]).map(l=>`<a class="linklike" href="${esc(l)}" target="_blank" rel="noopener">${esc(l)}</a>`).join('<br>')||'<span class="muted">none</span>'}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn primary small" data-x="blue">Approve 🔵</button>
        <button class="btn gold small" data-x="gold">Approve 🟡</button>
        <button class="btn danger small" data-x="reject">Reject</button>
      </div>`;
    el.querySelectorAll('[data-x]').forEach(b=>b.onclick=async()=>{
      const x=b.dataset.x;
      try{
        if(x==='reject'){
          const ov=openSheet(`<div class="grab"></div><h2>Reject application?</h2>
            <div class="field"><label>Note for applicant</label><textarea id="rn" class="input" placeholder="Explain why..."></textarea></div>
            <button class="btn danger block" id="rgo">Reject</button>`);
          ov.querySelector('#rgo').onclick=async()=>{
            await api.post(`/api/admin/verifications/${a.id}/reject`,{note:ov.querySelector('#rn').value.trim()});
            (await import('../ui.js')).closeOverlay(); toast('Application rejected.','ok'); load();
          };
        }else{
          if(!await confirmDlg(`Approve ${x} verification?`,`@${u.username} will get the ${x} tick. This is a manual review decision — payment never guarantees verification.`,'Approve')) return;
          await api.post(`/api/admin/verifications/${a.id}/approve`,{category:x});
          toast(`Approved with ${x} tick.`,'ok'); load();
        }
      }catch(err){ toast(err.message,'err'); }
    });
    return el;
  }
  load();
}

/* ---------- reports ---------- */
async function showReports(pane){
  pane.innerHTML=`<div id="rlist">${skelPosts(3)}</div>`;
  const list=pane.querySelector('#rlist');
  async function load(){
    list.innerHTML=skelPosts(2);
    try{
      const d=await api.get('/api/admin/reports?status=open');
      const items=d.reports||d.items||[];
      if(!items.length){ list.innerHTML=emptyState('No open reports','The streets are peaceful. ✅'); return; }
      list.innerHTML='';
      items.forEach(r=>list.appendChild(repRow(r)));
    }catch(err){ list.innerHTML=errCard('Could not load reports. '+err.message,load); }
  }
  function repRow(r){
    const el=document.createElement('div'); el.className='card mb';
    const t=r.target||{};
    el.innerHTML=`
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
        <span class="tagpill ${r.type==='user'?'gold':'blue'}">${esc(r.type||'report')}</span>
        <span class="small muted">reported by @${esc(r.reporter?.username||'?')} · ${timeAgo(r.created_at)}</span></div>
      <p style="font-size:14px"><b>Reason:</b> ${esc(r.reason||'')}</p>
      ${r.details?`<p class="small" style="color:var(--ink2)">${esc(r.details)}</p>`:''}
      ${r.type==='post'&&t.text?`<div class="quote"><span class="small muted">@${esc(t.author?.username||'?')}</span><div class="small">${esc((t.text||'').slice(0,200))}</div>
        <a class="linklike small" href="#/post/${t.id}">View wave →</a></div>`:''}
      ${r.type==='user'?`<div class="small"><a class="linklike" href="#/profile/${esc(t.username||'')}">@${esc(t.username||'')}</a></div>`:''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn ghost small" data-a="dismiss">Dismiss</button>
        ${r.type==='post'?'<button class="btn danger small" data-a="remove_content">Remove content</button>':''}
        <button class="btn danger small" data-a="suspend_user">Suspend user</button>
        <button class="btn ghost small" data-a="warn">Warn (dismiss)</button>
      </div>`;
    el.querySelectorAll('[data-a]').forEach(b=>b.onclick=async()=>{
      const a2=b.dataset.a;
      if(a2!=='dismiss'&&!await confirmDlg('Resolve report?',`Action: <b>${esc(a2.replace(/_/g,' '))}</b>`,'Confirm',a2!=='warn')) return;
      try{
        await api.post(`/api/admin/reports/${r.id}/resolve`,{action:a2});
        toast('Report resolved.','ok'); load();
      }catch(err){ toast(err.message,'err'); }
    });
    return el;
  }
  load();
}

/* ---------- activity ---------- */
async function showActivity(pane){
  pane.innerHTML=`<div id="alist">${skelPosts(3)}</div><button id="amore" class="loadmore hidden">Load more</button>`;
  const list=pane.querySelector('#alist'), more=pane.querySelector('#amore');
  let page=1, hasMore=true;
  async function load(reset){
    if(reset){ page=1; hasMore=true; list.innerHTML=skelPosts(2); }
    try{
      const d=await api.get(`/api/admin/activity?page=${page}&limit=25`);
      if(reset) list.innerHTML='';
      const items=d.items||[];
      if(!items.length&&page===1) list.innerHTML=emptyState('No activity yet','');
      list.innerHTML+=items.map(a=>`<div class="kv"><span>${esc(a.action||a.type||'')} <span class="k">— ${esc(a.actor_name||a.admin||'')}</span></span><span class="k">${timeAgo(a.created_at)}</span></div>`).join('');
      hasMore=!!d.has_more; more.classList.toggle('hidden',!hasMore); page++;
    }catch(err){ if(page===1) list.innerHTML=errCard('Could not load activity. '+err.message,()=>load(true)); }
  }
  more.onclick=()=>load(false);
  load(true);
}

/* ---------- posts: announcements + sponsor ---------- */
async function showPosts(pane){
  pane.innerHTML=`
    <div class="card mb"><h3 class="sect" style="font-size:15px">📢 New announcement</h3>
      <div class="field"><textarea id="anT" class="input" maxlength="500" placeholder="Announcement for all users..."></textarea></div>
      <button class="btn primary small" id="anGo">Publish announcement</button>
      <div id="anList" class="mt"></div></div>
    <div class="card"><h3 class="sect" style="font-size:15px">⭐ Sponsored posts</h3>
      <p class="small muted mb">Enter a wave ID to mark or unmark it as sponsored.</p>
      <div class="evlink"><input id="spId" class="input" placeholder="Wave ID, e.g. 42" inputmode="numeric">
      <button class="btn gold small" id="spGo">Mark sponsored</button>
      <button class="btn ghost small" id="spRm">Remove</button></div></div>`;
  pane.querySelector('#anGo').onclick=async()=>{
    const t=pane.querySelector('#anT').value.trim();
    if(!t){ toast('Write the announcement first.','err'); return; }
    try{ await api.post('/api/admin/announcements',{text:t}); pane.querySelector('#anT').value=''; toast('Announcement published.','ok'); loadAn(); }
    catch(err){ toast(err.message,'err'); }
  };
  async function loadAn(){
    try{
      const d=await api.get('/api/announcements');
      const items=d.items||d.announcements||[];
      pane.querySelector('#anList').innerHTML=items.slice(0,5).map(a=>`<div class="kv"><span>${esc(a.text||'').slice(0,80)}</span><span class="k">${timeAgo(a.created_at)}</span></div>`).join('')||'<p class="muted small">No announcements yet.</p>';
    }catch{}
  }
  loadAn();
  pane.querySelector('#spGo').onclick=async()=>{
    const id=pane.querySelector('#spId').value.trim();
    if(!id){ toast('Enter a wave ID.','err'); return; }
    try{ await api.post(`/api/admin/posts/${id}/sponsor`,{label:'Sponsored'}); toast('Marked as sponsored.','ok'); }
    catch(err){ toast(err.message,'err'); }
  };
  pane.querySelector('#spRm').onclick=async()=>{
    const id=pane.querySelector('#spId').value.trim();
    if(!id){ toast('Enter a wave ID.','err'); return; }
    try{ await api.del(`/api/admin/posts/${id}/sponsor`); toast('Sponsorship removed.','ok'); }
    catch(err){ toast(err.message,'err'); }
  };
}
