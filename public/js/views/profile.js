/* Naija Wave — profile: cover, tabs, edit, follow/message/block menu. */
import { api, auth } from '../api.js';
import { postCard, userRow, followBtn, skelPosts, emptyState, errCard, toast, av, esc, tick, timeAgo, fmtNum, openSheet, openModal, confirmDlg, menuAt } from '../ui.js';

export async function render(view,{u}){
  const username = u==='me' ? auth.me.username : u;
  const isMe = username===auth.me.username;
  view.innerHTML=`<div class="page" style="padding-top:0;max-width:680px">
    <div id="phead">${skelPosts(1)}</div>
    <div class="tabs" id="ptabs" role="tablist">
      <button data-t="posts" class="active">Waves</button>
      <button data-t="replies">Replies</button>
      <button data-t="media">Media</button>
      <button data-t="likes">Likes</button>
    </div>
    <div id="pbody"></div>
    <button id="more" class="loadmore hidden">Load more</button>
  </div>`;
  const head=view.querySelector('#phead'), body=view.querySelector('#pbody'), more=view.querySelector('#more');
  let user=null, tab='posts', page=1, hasMore=true, loading=false, viewer={};

  try{
    const d=await api.get(`/api/users/${encodeURIComponent(username)}`);
    user=d.user; viewer=d.viewer||{};
  }catch(err){
    head.innerHTML=errCard('Could not load this profile. '+err.message,()=>render(view,{u}));
    view.querySelector('#ptabs').style.display='none'; return;
  }
  paintHead();

  function paintHead(){
    const f=viewer.following;
    head.innerHTML=`
      <div class="cover" ${user.cover_url?`style="background-image:url('${esc(user.cover_url)}')"`:''}></div>
      <div class="pfhead">
        <div class="pfav">
          <img class="avatar" src="${esc(user.avatar_url||'img/mark.svg')}" alt="" style="width:92px;height:92px;border:4px solid var(--bg0)" onerror="this.src='img/mark.svg'">
          <div style="display:flex;gap:8px" class="pfedit">
            ${isMe?`<button class="btn ghost small" id="pfEdit">Edit profile</button>`
            :`${followBtn(user.username,!!f)}
              <button class="btn ghost small" id="pfMsg">Message</button>
              <button class="iconbtn" id="pfMenu" aria-label="More options" style="border:1px solid var(--line)"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg></button>`}
          </div>
        </div>
        ${user.verification==='founder'?`<div class="founderbanner">👑 Founder of Naija Wave ${tick('founder')}</div>`:''}
        <div class="pfname">${esc(user.display_name)} ${tick(user.verification)}</div>
        <div class="pfuser">@${esc(user.username)}</div>
        ${user.bio?`<div class="pfbio">${esc(user.bio)}</div>`:''}
        <div class="pfmeta">
          ${user.location?`<span>📍 ${esc(user.location)}</span>`:''}
          ${user.website?`<span>🔗 <a href="${esc(user.website.startsWith('http')?user.website:'https://'+user.website)}" target="_blank" rel="noopener">${esc(user.website.replace(/^https?:\/\//,''))}</a></span>`:''}
          <span>📅 Joined ${new Date(user.created_at).toLocaleDateString(undefined,{month:'long',year:'numeric'})}</span>
        </div>
        <div class="pfstats">
          <button id="pfFollowers"><b data-fc="${esc(user.username)}">${fmtNum(user.followers_count||0)}</b> Followers</button>
          <button id="pfFollowing"><b>${fmtNum(user.following_count||0)}</b> Following</button>
        </div>
      </div>`;
    if(isMe) head.querySelector('#pfEdit').onclick=()=>editSheet(user,paintHead);
    else{
      head.querySelector('#pfMsg').onclick=async()=>{
        try{ const d=await api.post('/api/conversations',{user_id:user.id}); location.hash='#/messages/'+d.conversation.id; }
        catch(err){ toast(err.message,'err'); }
      };
      head.querySelector('#pfMenu').onclick=e=>{
        const r=e.currentTarget.getBoundingClientRect();
        menuAt(r.left-170,r.top+44,[
          {label:viewer.muted?'🔊 Unmute @'+user.username:'🔇 Mute @'+user.username,fn:async()=>{
            try{ viewer.muted?await api.del(`/api/users/${user.username}/mute`):await api.post(`/api/users/${user.username}/mute`);
              viewer.muted=!viewer.muted; toast(viewer.muted?'Muted.':'Unmuted.','ok'); }catch(err){toast(err.message,'err')} }},
          {label:viewer.blocked?'🚫 Unblock @'+user.username:'🚫 Block @'+user.username,danger:true,fn:async()=>{
            try{ viewer.blocked?await api.del(`/api/users/${user.username}/block`):await api.post(`/api/users/${user.username}/block`);
              toast(viewer.blocked?'Unblocked.':'Blocked.','ok'); render(view,{u}); }catch(err){toast(err.message,'err')} }},
          {label:'🚨 Report @'+user.username,danger:true,fn:()=>{
            const ov=openSheet(`<div class="grab"></div><h2>Report @${esc(user.username)}</h2>
              <div class="field"><label>Reason</label><input id="ur" class="input" placeholder="e.g. Impersonation, spam, harassment"></div>
              <button class="btn danger block" id="ugo">Send report</button>`);
            ov.querySelector('#ugo').onclick=async()=>{
              try{ await api.post(`/api/users/${user.username}/report`,{reason:ov.querySelector('#ur').value.trim()||'Reported'}); toast('Report sent.','ok'); }
              catch(err){ toast(err.message,'err'); }
              (await import('../ui.js')).closeOverlay();
            };
          }},
        ]);
      };
      head.querySelector('#pfFollowers').onclick=()=>listSheet('followers');
      head.querySelector('#pfFollowing').onclick=()=>listSheet('following');
    }
    document.addEventListener('nw:follow',onF);
    function onF(e){ if(e.detail.username===user.username){ user.followers_count+=e.detail.following?1:-1;
      const b=head.querySelector(`[data-fc="${CSS.escape(user.username)}"]`); if(b) b.textContent=fmtNum(user.followers_count); } }
  }

  function listSheet(which){
    const ov=openSheet(`<div class="grab"></div><h2>${which==='followers'?'Followers':'Following'}</h2><div id="ul">${skelPosts(3)}</div>`);
    const mount=ov.querySelector('#ul');
    api.get(`/api/users/${encodeURIComponent(username)}/${which}?page=1&limit=30`)
      .then(d=>{ const items=d.items||[];
        mount.innerHTML=items.length?items.map(x=>userRow(x, x.username!==auth.me.username?followBtn(x.username,!!x.viewer_following):'')).join('')
          :emptyState('Nobody here yet',''); })
      .catch(err=>{ mount.innerHTML=errCard('Could not load. '+err.message); });
  }

  view.querySelectorAll('#ptabs button').forEach(b=>b.onclick=()=>{
    view.querySelectorAll('#ptabs button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); tab=b.dataset.t; load(true);
  });
  async function load(reset){
    if(loading||(!reset&&!hasMore)) return;
    loading=true;
    if(reset){ page=1; hasMore=true; body.innerHTML=skelPosts(3); }
    try{
      const d=await api.get(`/api/users/${encodeURIComponent(username)}/posts?type=${tab}&page=${page}&limit=20`);
      if(reset) body.innerHTML='';
      if(!d.items.length&&page===1){
        const copy={posts:['No waves yet','Nothing posted here yet.'],replies:['No replies yet','No replies from this account yet.'],
          media:['No media yet','No photos or videos yet.'],likes:['No likes yet',isMe?'Waves you like will show up here.':'No liked waves to show.']}[tab];
        body.innerHTML=emptyState(copy[0],copy[1]);
      }
      d.items.forEach(p=>{ const t=document.createElement('div'); t.innerHTML=postCard(p); body.appendChild(t.firstChild); });
      hasMore=!!d.has_more; more.classList.toggle('hidden',!hasMore); page++;
    }catch(err){ if(page===1) body.innerHTML=errCard('Could not load. '+err.message,()=>load(true)); }
    loading=false;
  }
  more.onclick=()=>load(false);
  load(true);
}

function editSheet(user,onDone){
  const ov=openSheet(`<div class="grab"></div><h2>Edit profile</h2>
    <div style="display:flex;gap:14px;align-items:center;margin-bottom:14px">
      <img id="eAv" class="avatar lg" src="${esc(user.avatar_url||'img/mark.svg')}" alt="">
      <label class="btn ghost small" style="cursor:pointer">Change photo<input id="eAvIn" type="file" accept="image/*" hidden></label>
    </div>
    <div class="field"><label>Cover image</label>
      <label class="btn ghost small" style="cursor:pointer">Upload cover<input id="eCvIn" type="file" accept="image/*" hidden></label>
      <span class="small muted" id="eCvName"></span></div>
    <div class="field"><label>Display name</label><input id="eName" class="input" maxlength="50" value="${esc(user.display_name||'')}"></div>
    <div class="field"><label>Bio</label><textarea id="eBio" class="input" maxlength="160" placeholder="Tell Naija about yourself...">${esc(user.bio||'')}</textarea></div>
    <div class="field"><label>Location</label><input id="eLoc" class="input" maxlength="60" value="${esc(user.location||'')}" placeholder="e.g. Lagos, Nigeria"></div>
    <div class="field"><label>Website</label><input id="eWeb" class="input" maxlength="120" value="${esc(user.website||'')}" placeholder="https://..."></div>
    <button class="btn primary block" id="eGo">Save changes</button>`);
  let avFile=null, cvFile=null;
  ov.querySelector('#eAvIn').onchange=e=>{ avFile=e.target.files[0]; if(avFile) ov.querySelector('#eAv').src=URL.createObjectURL(avFile); };
  ov.querySelector('#eCvIn').onchange=e=>{ cvFile=e.target.files[0]; if(cvFile) ov.querySelector('#eCvName').textContent=cvFile.name; };
  ov.querySelector('#eGo').onclick=async()=>{
    const btn=ov.querySelector('#eGo'); btn.disabled=true; btn.textContent='Saving...';
    try{
      const patch={display_name:ov.querySelector('#eName').value.trim()||user.display_name,
        bio:ov.querySelector('#eBio').value.trim(),location:ov.querySelector('#eLoc').value.trim(),
        website:ov.querySelector('#eWeb').value.trim()};
      if(avFile){ const u=await api.uploadFile(avFile,'image'); patch.avatar_url=u.url; }
      if(cvFile){ const u=await api.uploadFile(cvFile,'image'); patch.cover_url=u.url; }
      const d=await api.patch('/api/users/me',patch);
      const { auth:au }=await import('../api.js');
      au.setSession(localStorage.getItem('nw_token'),d.user);
      const { closeOverlay }=await import('../ui.js'); closeOverlay();
      toast('Profile updated ✨','ok'); onDone();
    }catch(err){ toast(err.message,'err'); btn.disabled=false; btn.textContent='Save changes'; }
  };
}
