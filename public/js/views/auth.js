/* Naija Wave — welcome / auth: login, register (contact+OTP+profile steps). */
import { api, auth } from '../api.js';
import { toast, esc } from '../ui.js';

export async function render(view){
  view.innerHTML=`<div class="welcome"><div class="wcard">
    <div class="wlogo"><img src="img/logo.svg" alt="Naija Wave"><div class="tag">Ride your wave. 🇳🇬</div></div>
    <div class="authtabs" role="tablist">
      <button id="tabLogin" class="active">Log in</button>
      <button id="tabReg">Create account</button>
    </div>
    <div id="authBody"></div>
    <p class="fineprint">OTP confirms you control this email or phone number — it is not an ID check. Naija Wave never asks for NIN, BVN or ID documents.</p>
  </div></div>`;

  const body=view.querySelector('#authBody');
  const tL=view.querySelector('#tabLogin'), tR=view.querySelector('#tabReg');
  tL.onclick=()=>{ tL.classList.add('active'); tR.classList.remove('active'); loginForm(body); };
  tR.onclick=()=>{ tR.classList.add('active'); tL.classList.remove('active'); regStep1(body); };
  loginForm(body);
}

/* ---------- login ---------- */
function loginForm(body){
  body.innerHTML=`
    <div class="field"><label>Email or phone number</label>
      <input id="lContact" class="input" placeholder="you@example.com or 0803..." autocomplete="username"></div>
    <div class="field"><label>Password</label>
      <input id="lPass" type="password" class="input" placeholder="Your password" autocomplete="current-password"></div>
    <div class="err small" id="lErr" style="color:var(--red);margin-bottom:10px"></div>
    <button class="btn primary block" id="lGo">Log in</button>
    <div class="center mt"><button class="linklike small" id="lForgot">Forgot password?</button></div>`;
  body.querySelector('#lForgot').onclick=()=>forgotFlow(body);
  const go=async()=>{
    const contact=body.querySelector('#lContact').value.trim();
    const password=body.querySelector('#lPass').value;
    const err=body.querySelector('#lErr'); err.textContent='';
    if(!contact||!password){ err.textContent='Enter your email/phone and password.'; return; }
    const btn=body.querySelector('#lGo'); btn.disabled=true; btn.textContent='Logging in...';
    try{
      const d=await api.post('/api/auth/login',{contact,password});
      auth.setSession(d.token,d.user);
      toast('Welcome back, '+d.user.display_name+'! 🌊','ok');
      location.hash='#/home';
    }catch(e){
      if(e.code==='NOT_VERIFIED'){ err.innerHTML='This account isn\'t verified yet. <button class="linklike" id="lVerifyNow">Verify now</button>';
        body.querySelector('#lVerifyNow').onclick=()=>otpStep(body,{contact},'login'); }
      else if(e.code==='SUSPENDED') err.textContent='This account has been suspended. Contact support if you think this is a mistake.';
      else err.textContent=e.message;
    }
    btn.disabled=false; btn.textContent='Log in';
  };
  body.querySelector('#lGo').onclick=go;
  body.querySelector('#lPass').onkeydown=e=>{ if(e.key==='Enter') go(); };
}

function forgotFlow(body){
  body.innerHTML=`
    <h2 class="sect">Reset password</h2>
    <div class="field"><label>Email or phone number</label><input id="fContact" class="input" placeholder="you@example.com or 0803..."></div>
    <div class="err small" id="fErr" style="color:var(--red);margin-bottom:10px"></div>
    <button class="btn primary block" id="fGo">Send reset code</button>
    <div class="center mt"><button class="linklike small" id="fBack">← Back to login</button></div>`;
  body.querySelector('#fBack').onclick=()=>loginForm(body);
  body.querySelector('#fGo').onclick=async()=>{
    const contact=body.querySelector('#fContact').value.trim();
    const err=body.querySelector('#fErr'); err.textContent='';
    if(!contact){ err.textContent='Enter your email or phone number.'; return; }
    try{
      const d=await api.post('/api/auth/forgot-password',{contact});
      resetStep(body,contact,d.dev_otp);
    }catch(e){ err.textContent=e.message; }
  };
}
function resetStep(body,contact,devOtp){
  body.innerHTML=`
    <h2 class="sect">Enter reset code</h2>
    <p class="small muted mb">We sent a 6-digit code to <b>${esc(contact)}</b>.</p>
    <div class="otpboxes" id="otpBoxes">${'<input inputmode="numeric" maxlength="1" aria-label="digit">'.repeat(6)}</div>
    ${devOtp?`<div class="devotp">Dev mode code: <b>${esc(devOtp)}</b></div>`:''}
    <div class="field mt"><label>New password (min 8 characters)</label>
      <input id="np1" type="password" class="input"><input id="np2" type="password" class="input mt" placeholder="Repeat new password"></div>
    <div class="err small" id="fErr" style="color:var(--red);margin-bottom:10px"></div>
    <button class="btn primary block" id="fReset">Reset password</button>`;
  wireOtp(body);
  body.querySelector('#fReset').onclick=async()=>{
    const code=readOtp(body), p1=body.querySelector('#np1').value, p2=body.querySelector('#np2').value;
    const err=body.querySelector('#fErr'); err.textContent='';
    if(code.length<6){ err.textContent='Enter the 6-digit code.'; return; }
    if(p1.length<8){ err.textContent='Password must be at least 8 characters.'; return; }
    if(p1!==p2){ err.textContent='Passwords do not match.'; return; }
    try{ await api.post('/api/auth/reset-password',{contact,code,password:p1});
      toast('Password reset. Log in with your new password.','ok'); loginForm(body);
    }catch(e){ err.textContent=e.message; }
  };
}

/* ---------- registration ---------- */
function regStep1(body){
  body.innerHTML=`
    <div class="steps"><i class="on"></i><i></i><i></i></div>
    <div class="seg"><button id="ctEmail" class="active">Email</button><button id="ctPhone">Phone</button></div>
    <div class="field"><label id="ctLabel">Email address</label>
      <input id="rContact" class="input" placeholder="you@example.com"></div>
    <div class="field"><label>Password (min 8 characters)</label>
      <input id="rPass" type="password" class="input" placeholder="Choose a strong password" autocomplete="new-password"></div>
    <div class="err small" id="rErr" style="color:var(--red);margin-bottom:10px"></div>
    <button class="btn primary block" id="rGo">Continue</button>`;
  let ct='email';
  const cE=body.querySelector('#ctEmail'), cP=body.querySelector('#ctPhone');
  cE.onclick=()=>{ ct='email'; cE.classList.add('active'); cP.classList.remove('active');
    body.querySelector('#ctLabel').textContent='Email address'; body.querySelector('#rContact').placeholder='you@example.com'; };
  cP.onclick=()=>{ ct='phone'; cP.classList.add('active'); cE.classList.remove('active');
    body.querySelector('#ctLabel').textContent='Phone number'; body.querySelector('#rContact').placeholder='0803 123 4567'; };
  body.querySelector('#rGo').onclick=()=>{
    const contact=body.querySelector('#rContact').value.trim();
    const password=body.querySelector('#rPass').value;
    const err=body.querySelector('#rErr'); err.textContent='';
    if(!contact){ err.textContent='Enter your '+(ct==='email'?'email address':'phone number')+'.'; return; }
    if(password.length<8){ err.textContent='Password must be at least 8 characters.'; return; }
    regStep2(body,{contact,contact_type:ct,password});
  };
}

function regStep2(body,draft){
  body.innerHTML=`
    <div class="steps"><i class="on"></i><i class="on"></i><i></i></div>
    <div class="field"><label>Choose a username</label>
      <input id="rUser" class="input" placeholder="e.g. adaeze_waves" maxlength="20" autocapitalize="off" spellcheck="false">
      <div class="hint">3–20 chars: lowercase letters, numbers, _ and .</div></div>
    <div class="field"><label>Display name</label>
      <input id="rName" class="input" placeholder="e.g. Adaeze Okafor" maxlength="50"></div>
    <div class="field"><label>Date of birth</label>
      <input id="rDob" type="date" class="input" max="${new Date().toISOString().slice(0,10)}">
      <div class="hint">You must be at least 13 to join Naija Wave.</div></div>
    <div class="field"><label>Profile picture (optional)</label>
      <div class="avpick"><img id="rAvPrev" class="avatar lg" src="img/mark.svg" alt="">
      <label class="btn ghost small" style="cursor:pointer">Upload photo<input id="rAv" type="file" accept="image/*" hidden></label></div></div>
    <div class="err small" id="rErr" style="color:var(--red);margin-bottom:10px"></div>
    <button class="btn primary block" id="rGo">Create account</button>
    <div class="center mt"><button class="linklike small" id="rBack">← Back</button></div>`;
  body.querySelector('#rBack').onclick=()=>regStep1(body);
  let avatarFile=null;
  body.querySelector('#rAv').onchange=e=>{
    avatarFile=e.target.files[0];
    if(avatarFile) body.querySelector('#rAvPrev').src=URL.createObjectURL(avatarFile);
  };
  body.querySelector('#rGo').onclick=async()=>{
    const username=body.querySelector('#rUser').value.trim().toLowerCase();
    const display_name=body.querySelector('#rName').value.trim();
    const dob=body.querySelector('#rDob').value;
    const err=body.querySelector('#rErr'); err.textContent='';
    if(!/^[a-z0-9_.]{3,20}$/.test(username)){ err.textContent='Username must be 3–20 chars (a–z, 0–9, _ .).'; return; }
    if(!display_name){ err.textContent='Enter your display name.'; return; }
    if(!dob){ err.textContent='Enter your date of birth.'; return; }
    const btn=body.querySelector('#rGo'); btn.disabled=true; btn.textContent='Creating...';
    try{
      let avatar_url;
      if(avatarFile){ const u=await api.uploadFile(avatarFile,'image'); avatar_url=u.url; }
      const d=await api.post('/api/auth/register',{...draft,username,display_name,dob,avatar_url});
      toast('Account created! Now verify your '+(draft.contact_type==='email'?'email':'phone')+'.','ok');
      otpStep(body,{contact:draft.contact,password:draft.password},'register',d.dev_otp);
    }catch(e){
      err.textContent=e.message; btn.disabled=false; btn.textContent='Create account';
    }
  };
}

/* ---------- OTP ---------- */
function wireOtp(body){
  const boxes=[...body.querySelectorAll('#otpBoxes input')];
  boxes.forEach((b,i)=>{
    b.oninput=()=>{ b.value=b.value.replace(/\D/g,'').slice(0,1); b.classList.toggle('filled',!!b.value);
      if(b.value&&i<5) boxes[i+1].focus(); };
    b.onkeydown=e=>{ if(e.key==='Backspace'&&!b.value&&i>0) boxes[i-1].focus(); };
    b.onpaste=e=>{ e.preventDefault();
      const t=(e.clipboardData.getData('text')||'').replace(/\D/g,'').slice(0,6);
      t.split('').forEach((ch,j)=>{ if(boxes[j]){ boxes[j].value=ch; boxes[j].classList.add('filled'); } });
      if(t.length) boxes[Math.min(t.length,5)].focus(); };
  });
}
function readOtp(body){ return [...body.querySelectorAll('#otpBoxes input')].map(b=>b.value).join(''); }

function otpStep(body,{contact},mode,devOtp){
  body.innerHTML=`
    <div class="steps"><i class="on"></i><i class="on"></i><i class="on"></i></div>
    <h2 class="sect">Check your ${mode==='register'?'inbox':'messages'}</h2>
    <p class="small muted">Enter the 6-digit code we sent to <b>${esc(contact)}</b>.</p>
    <div class="otpboxes" id="otpBoxes">${'<input inputmode="numeric" maxlength="1" aria-label="digit">'.repeat(6)}</div>
    ${devOtp?`<div class="devotp">Dev mode code: <b>${esc(devOtp)}</b></div>`:''}
    <div class="err small" id="oErr" style="color:var(--red);margin-bottom:10px"></div>
    <button class="btn primary block" id="oGo">Verify</button>
    <div class="center mt"><button class="linklike small" id="oResend">Didn't get it? Resend code</button></div>`;
  wireOtp(body);
  body.querySelector('#otpBoxes input').focus();
  let lastDev=devOtp;
  body.querySelector('#oResend').onclick=async ev=>{
    ev.target.disabled=true;
    try{ const d=await api.post('/api/auth/resend-otp',{contact});
      toast('Code resent.','ok'); lastDev=d.dev_otp;
      if(d.dev_otp){ let el=body.querySelector('.devotp'); if(!el){ el=document.createElement('div'); el.className='devotp'; body.querySelector('#oGo').before(el);} el.innerHTML=`Dev mode code: <b>${esc(d.dev_otp)}</b>`; }
    }catch(e){ toast(e.message,'err'); }
    setTimeout(()=>ev.target.disabled=false,15000);
  };
  body.querySelector('#oGo').onclick=async()=>{
    const code=readOtp(body), err=body.querySelector('#oErr'); err.textContent='';
    if(code.length<6){ err.textContent='Enter all 6 digits.'; return; }
    const btn=body.querySelector('#oGo'); btn.disabled=true; btn.textContent='Verifying...';
    try{
      const d=await api.post('/api/auth/verify-otp',{contact,code});
      auth.setSession(d.token,d.user);
      toast('Verified! Welcome to Naija Wave 🌊','ok');
      location.hash='#/home';
    }catch(e){ err.textContent=e.message; btn.disabled=false; btn.textContent='Verify'; }
  };
}
