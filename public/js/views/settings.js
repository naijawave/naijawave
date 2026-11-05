/* Naija Wave — settings: privacy, notifications, blocked/muted, password, guidelines. */
import { api, auth } from '../api.js';
import { toast, esc, av, openSheet, skelPosts, emptyState, errCard, confirmDlg, userRow } from '../ui.js';

export async function render(view){
  view.innerHTML=`<div class="page"><h1 class="sect">Settings</h1>
    <div class="card mb"><h3 class="sect" style="font-size:15px">🔒 Privacy</h3>
      <div class="field"><label>Who can message me</label><div class="radioRow" id="sMsg"></div></div>
      <div class="setrow"><div class="sinfo"><div class="st">Show online status</div><div class="sd">Let others see when you're online</div></div>
        <label class="switch"><input type="checkbox" id="sOnline"><span class="tr"></span></label></div>
      <div class="setrow"><div class="sinfo"><div class="st">Read receipts</div><div class="sd">Let senders know you've read their messages</div></div>
        <label class="switch"><input type="checkbox" id="sRead"><span class="tr"></span></label></div>
    </div>
    <div class="card mb"><h3 class="sect" style="font-size:15px">📞 Call alerts</h3>
      <div class="setrow"><div class="sinfo"><div class="st">Buzz my phone when someone calls</div><div class="sd">Works even when Naija Wave is closed. On iPhone, add Naija Wave to your Home Screen first (Share → Add to Home Screen), then turn this on.</div></div>
        <label class="switch"><input type="checkbox" id="sCallAlerts"><span class="tr"></span></label></div>
      <p class="small muted" id="sCallNote"></p></div>
    <div class="card mb"><h3 class="sect" style="font-size:15px">🔔 Notifications</h3><div id="sNotif">${skelPosts(1)}</div></div>
    <div class="card mb"><h3 class="sect" style="font-size:15px">🚫 Blocked & muted</h3>
      <div style="display:flex;gap:10px"><button class="btn ghost small" id="sBlocked">Blocked users</button>
      <button class="btn ghost small" id="sMuted">Muted users</button></div></div>
    <div class="card mb"><h3 class="sect" style="font-size:15px">🔑 Password</h3>
      <p class="small muted mb">We'll send a reset code to your email or phone.</p>
      <div class="field"><label>Your email or phone number</label><input id="pContact" class="input" placeholder="you@example.com or 0803..."></div>
      <button class="btn ghost small" id="pGo">Send reset code</button></div>
    <div class="card mb"><h3 class="sect" style="font-size:15px">📜 Community</h3>
      <button class="btn ghost small block" id="sGuide">Community guidelines</button></div>
    <button class="btn danger block" id="sLogout">Log out</button>
    <p class="center small muted mt">Naija Wave · Ride your wave 🌊</p>
  </div>`;

  const me=auth.me, prefs=me.prefs||{};
  // who can message
  const msgWrap=view.querySelector('#sMsg');
  const cur=prefs.who_can_message||'everyone';
  [['everyone','Everyone'],['followed','People I follow']].forEach(([v,l])=>{
    const b=document.createElement('button'); b.className='radioPill'+(cur===v?' active':''); b.textContent=l;
    b.onclick=async()=>{ msgWrap.querySelectorAll('.radioPill').forEach(x=>x.classList.remove('active')); b.classList.add('active');
      await savePrefs({who_can_message:v}); };
    msgWrap.appendChild(b);
  });
  view.querySelector('#sOnline').checked=prefs.show_online!==false;
  view.querySelector('#sRead').checked=prefs.read_receipts!==false;
  view.querySelector('#sOnline').onchange=e=>savePrefs({show_online:e.target.checked});
  view.querySelector('#sRead').onchange=e=>savePrefs({read_receipts:e.target.checked});
  async function savePrefs(p){
    try{ const d=await api.patch('/api/users/me',{prefs:p}); auth.me.prefs={...auth.me.prefs,...p};
      try{localStorage.setItem('nw_user',JSON.stringify(auth.me))}catch{}
      toast('Saved.','ok');
    }catch(err){ toast(err.message,'err'); }
  }

  // call alerts (Web Push) — buzzes the phone when someone calls, even with the app closed
  const caToggle = view.querySelector('#sCallAlerts');
  const caNote = view.querySelector('#sCallNote');
  try {
    const push = await import('../push.js?v=2');
    if (!push.pushSupported()) {
      caToggle.disabled = true;
      caNote.textContent = 'Push alerts are not supported on this browser.';
    } else {
      caToggle.checked = await push.isPushEnabled();
      caNote.textContent = caToggle.checked
        ? 'On — this phone will buzz when someone calls you.'
        : 'Off — turn it on and your phone will buzz for incoming calls, even with the app closed.';
      caToggle.onchange = async () => {
        caToggle.disabled = true;
        const ok = caToggle.checked ? await push.enableCallAlerts() : await push.disableCallAlerts();
        const now = await push.isPushEnabled();
        caToggle.checked = now;
        caNote.textContent = now
          ? 'On — this phone will buzz when someone calls you.'
          : 'Off — turn it on and your phone will buzz for incoming calls, even with the app closed.';
        caToggle.disabled = false;
      };
    }
  } catch { caToggle.disabled = true; caNote.textContent = 'Call alerts are unavailable right now.'; }

  // notification prefs
  const nMount=view.querySelector('#sNotif');
  const TYPES=[['follow','New followers'],['like','Waves (likes)'],['comment','Comments & replies'],['repost','Rewaves'],['mention','Mentions'],['message','Messages'],['call_missed','Missed calls'],['verification','Verification updates'],['announcement','Announcements']];
  try{
    const d=await api.get('/api/notifications/prefs');
    const np=d.prefs||{};
    nMount.innerHTML='';
    TYPES.forEach(([k,l])=>{
      const r=document.createElement('div'); r.className='setrow';
      r.innerHTML=`<div class="sinfo"><div class="st">${l}</div></div>
        <label class="switch"><input type="checkbox" ${np[k]!==false?'checked':''}><span class="tr"></span></label>`;
      r.querySelector('input').onchange=async e=>{
        try{ await api.patch('/api/notifications/prefs',{[k]:e.target.checked}); }
        catch(err){ toast(err.message,'err'); e.target.checked=!e.target.checked; }
      };
      nMount.appendChild(r);
    });
  }catch{ nMount.innerHTML='<p class="muted small">Could not load notification settings.</p>'; }

  view.querySelector('#sBlocked').onclick=()=>blockList('blocked');
  view.querySelector('#sMuted').onclick=()=>blockList('muted');
  async function blockList(kind){
    const ov=openSheet(`<div class="grab"></div><h2>${kind==='blocked'?'Blocked':'Muted'} users</h2><div id="bl">${skelPosts(2)}</div>`);
    const m=ov.querySelector('#bl');
    try{
      const d=await api.get(`/api/users/me/${kind}`).catch(()=>({items:[]}));
      const items=d.items||[];
      m.innerHTML=items.length?'':emptyState('Empty','Nobody here.');
      items.forEach(u=>{
        const row=document.createElement('div'); row.innerHTML=userRow(u,`<button class="btn ghost small">Un${kind.slice(0,-2)}</button>`);
        row.querySelector('button').onclick=async()=>{
          await api.del(`/api/users/${u.username}/${kind==='blocked'?'block':'mute'}`);
          toast('Removed.','ok'); row.remove();
        };
        m.appendChild(row);
      });
    }catch(err){ m.innerHTML=errCard('Could not load. '+err.message); }
  }

  view.querySelector('#pGo').onclick=async()=>{
    const contact=view.querySelector('#pContact').value.trim();
    if(!contact){ toast('Enter your email or phone number.','err'); return; }
    try{
      const d=await api.post('/api/auth/forgot-password',{contact});
      resetSheet(contact,d.dev_otp);
    }catch(err){ toast(err.message,'err'); }
  };
  function resetSheet(contact,devOtp){
    const ov=openSheet(`<div class="grab"></div><h2>Reset password</h2>
      <p class="small muted mb">Enter the 6-digit code sent to <b>${esc(contact)}</b>.</p>
      <div class="otpboxes" id="otpBoxes">${'<input inputmode="numeric" maxlength="1" aria-label="digit">'.repeat(6)}</div>
      ${devOtp?`<div class="devotp">Dev mode code: <b>${esc(devOtp)}</b></div>`:''}
      <div class="field mt"><label>New password (min 8 characters)</label><input id="rp1" type="password" class="input"></div>
      <div class="field"><label>Repeat new password</label><input id="rp2" type="password" class="input"></div>
      <button class="btn primary block" id="rpGo">Set new password</button>`);
    const boxes=[...ov.querySelectorAll('#otpBoxes input')];
    boxes.forEach((b,i)=>{
      b.oninput=()=>{ b.value=b.value.replace(/\D/g,'').slice(0,1); if(b.value&&i<5) boxes[i+1].focus(); };
      b.onkeydown=e=>{ if(e.key==='Backspace'&&!b.value&&i>0) boxes[i-1].focus(); };
    });
    ov.querySelector('#rpGo').onclick=async()=>{
      const code=boxes.map(b=>b.value).join('');
      const p1=ov.querySelector('#rp1').value, p2=ov.querySelector('#rp2').value;
      if(code.length<6){ toast('Enter the 6-digit code.','err'); return; }
      if(p1.length<8){ toast('Password must be at least 8 characters.','err'); return; }
      if(p1!==p2){ toast('Passwords do not match.','err'); return; }
      try{
        await api.post('/api/auth/reset-password',{contact,code,password:p1});
        (await import('../ui.js')).closeOverlay();
        toast('Password updated.','ok');
      }catch(err){ toast(err.message,'err'); }
    };
  }

  view.querySelector('#sGuide').onclick=()=>openSheet(`<div class="grab"></div><h2>Community guidelines</h2>
    <div style="font-size:14.5px;color:var(--ink2);line-height:1.7">
    <p>🌊 <b>Be real.</b> No impersonation, scams, or fake news — especially on Street Buzz.</p>
    <p>💛 <b>Be kind.</b> No harassment, hate speech, or threats. Debate ideas, not people.</p>
    <p>📍 <b>Buzz responsibly.</b> Unverified community reports are marked "not confirmed" — don't present rumours as facts.</p>
    <p>🔞 <b>Keep it 13+.</b> No explicit or graphic content.</p>
    <p>🚫 <b>No spam.</b> Don't flood feeds, mentions, or DMs.</p>
    <p style="margin-top:10px">Violations can lead to content removal or suspension. Appeals: contact support via the help email in your welcome message.</p></div>
    <button class="btn ghost block mt" data-close>Close</button>`);

  view.querySelector('#sLogout').onclick=async()=>{
    if(!await confirmDlg('Log out?','You can log back in anytime.','Log out')) return;
    try{ await api.post('/api/auth/logout'); }catch{}
    auth.logout();
  };
}
