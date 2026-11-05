/* Naija Wave — voice/video calls over WebRTC (API.md §10). */
import { api, sock } from './api.js';
import { toast, esc, av } from './ui.js';

let iceServers=[{urls:'stun:stun.l.google.com:19302'}];
let cur=null; // active call session
// Keep the remote audio actually playing. On iOS, play() can fail silently
// (autoplay lock) even though the track arrived — so retry it on a timer
// and on any tap, until the element is really playing.
let playRetryT=null;
function ensureRemotePlays(){
  const v=document.getElementById('cvRemote')||document.getElementById('cvRemoteAudio');
  if(!v) return;
  if(webAudioOn){
    // Web Audio is playing the sound; just keep the video picture playing
    // (stay muted so the sound doesn't double).
    if(v.tagName==='VIDEO'){ v.muted=true; if(v.paused) v.play?.().catch(()=>{}); }
    return;
  }
  v.muted=false; v.volume=1;
  if(v.paused){ v.play?.().catch(()=>{}); }
}
function startPlayRetry(){ stopPlayRetry(); ensureRemotePlays(); playRetryT=setInterval(ensureRemotePlays,1000); }
function stopPlayRetry(){ if(playRetryT){ clearInterval(playRetryT); playRetryT=null; } }

/* ---- Remote audio through Web Audio (real loudspeaker path) ----
   A plain <audio> element on iOS is treated as a phone-call earpiece
   stream. Routing the remote track through an AudioContext plays it as
   media, which is how you get it out loud. Also feeds a live level
   meter so you can SEE the other person's voice arriving. */
let actx=null, remoteAnalyser=null, levelT=null, webAudioOn=false;
function getAudioCtx(){
  if(!actx){ try{ actx=new (window.AudioContext||window.webkitAudioContext)(); }catch{ actx=null; } }
  if(actx && actx.state==='suspended') actx.resume().catch(()=>{});
  return actx;
}
function routeRemoteAudio(stream){
  try{
    const ctx=getAudioCtx();
    if(!ctx) return false;
    const src=ctx.createMediaStreamSource(stream);
    remoteAnalyser=ctx.createAnalyser(); remoteAnalyser.fftSize=256;
    src.connect(remoteAnalyser); remoteAnalyser.connect(ctx.destination);
    // Mute the element so the same audio doesn't play twice.
    const v=document.getElementById('cvRemote')||document.getElementById('cvRemoteAudio');
    if(v) v.muted=true;
    webAudioOn=true;
    startLevelMeter();
    return true;
  }catch{ webAudioOn=false; return false; }
}
function startLevelMeter(){
  stopLevelMeter();
  const bar=document.getElementById('cLevelBar');
  if(!bar||!remoteAnalyser) return;
  const data=new Uint8Array(remoteAnalyser.frequencyBinCount);
  levelT=setInterval(()=>{
    if(!remoteAnalyser) return;
    remoteAnalyser.getByteTimeDomainData(data);
    let peak=0;
    for(let i=0;i<data.length;i++){ const v=Math.abs(data[i]-128)/128; if(v>peak) peak=v; }
    bar.style.width=Math.min(100,Math.round(peak*300))+'%';
    bar.style.background=peak>0.04?'#22c55e':'#334155';
  },120);
}
function stopLevelMeter(){ if(levelT){ clearInterval(levelT); levelT=null; } remoteAnalyser=null; }
// Diagnostic state for the call screen (helps see where a call breaks).
let diag={relay:false,track:false};

async function getIce(){
  try{ const d=await api.get('/api/config?_='+Date.now()); if(d.ice_servers?.length) iceServers=d.ice_servers; }
  catch{}
}
// Update the small status line on the call screen (if it exists).
function setDiag(){
  const el=document.getElementById('cDiag');
  if(!el) return;
  const pc=cur?.pc;
  el.textContent=`ICE: ${pc?.iceConnectionState||'?'} · Net: ${pc?.connectionState||'?'} · Relay: ${diag.relay?'yes':'no'} · Track: ${diag.track?'yes':'no'}`;
}
function attachDiag(pc){
  // Only adds the ICE-state listener (safe — nothing else uses it).
  // The candidate/connection handlers are NOT touched here; the diag
  // updates live inside those handlers so they keep working.
  pc.oniceconnectionstatechange=()=>setDiag();
}
const uuid=()=> (crypto.randomUUID?crypto.randomUUID():'c'+Date.now()+Math.random().toString(16).slice(2));

/* ================= caller ================= */
// Get mic (+camera for video). If the camera is blocked/missing, fall back
// to audio-only so the call still works instead of failing outright.
async function getCallMedia(kind){
  const wantVideo=kind==='video';
  try{
    return { stream: await navigator.mediaDevices.getUserMedia({audio:true, video: wantVideo?{facingMode:{ideal:'user'}}:false}), kind };
  }catch(e){
    if(wantVideo){
      try{
        const s=await navigator.mediaDevices.getUserMedia({audio:true, video:false});
        toast('Camera unavailable ('+(e.name||'blocked')+') — continuing as voice call.','err');
        return { stream: s, kind:'voice' };
      }catch(e2){ throw e2; }
    }
    throw e;
  }
}
export async function startCall(other, kind='voice'){
  if(cur){ toast('You are already on a call.','err'); return; }
  wireCalls();
  await getIce();
  let stream;
  try{ ({ stream, kind } = await getCallMedia(kind)); }
  catch(e){ toast('Could not access microphone/camera ('+(e.name||'blocked')+'). Check permissions.','err'); return; }

  const call_id=uuid();
  diag={relay:false,track:false};
  const pc=new RTCPeerConnection({iceServers});
  // Attach handlers BEFORE createOffer/setLocalDescription — ICE gathering
  // starts there, and candidates gathered before the handler is set are lost.
  pc.onicecandidate=e=>{ if(e.candidate){ if(/ relay /.test(e.candidate.candidate)) diag.relay=true; setDiag(); sock.emit('call:ice',{call_id,to_user_id:other.id,candidate:e.candidate}); } };
  pc.ontrack=e=>{ diag.track=true; setDiag(); const stream=e.streams[0]; const v=document.getElementById('cvRemote')||document.getElementById('cvRemoteAudio'); if(v){ if(v.tagName==='VIDEO'){ v.muted=true; } v.srcObject=stream; v.play?.().catch(()=>{}); } if(!routeRemoteAudio(stream)) ensureRemotePlays(); };
  pc.onconnectionstatechange=()=>{ setDiag(); if(pc.connectionState==='failed') callFail('Connection failed — check your network.'); };
  attachDiag(pc);
  stream.getTracks().forEach(t=>pc.addTrack(t,stream));
  const offer=await pc.createOffer(); await pc.setLocalDescription(offer);

  cur={call_id,other,kind,pc,stream,role:'caller',accepted:false,startT:null,timer:null,iceQ:[]};

  showCallingUI(other,kind,false);
  const acked=await new Promise(res=>{
    const ok=sock.emit('call:invite',{to_user_id:other.id,kind,sdp_offer:pc.localDescription,call_id},ack=>res(ack));
    if(!ok) res({error:'SELF_OFFLINE'});
    setTimeout(()=>res({error:'TIMEOUT'}),15000);
  });
  if(!acked||acked.error){
    endCall(true);
    // OFFLINE from the server means the *other* person has no open socket
    // (the server already logs a missed call + notifies them). SELF_OFFLINE
    // means our own socket never connected — only then is it our connection.
    const name=other.display_name||other.username||'They';
    toast(acked?.error==='OFFLINE'?`${name} isn't in the app right now — they'll see a missed call.`
      :acked?.error==='SELF_OFFLINE'?'You are offline — check your connection and try again.'
      :'Could not reach user. They may be offline.','err');
    return;
  }
  // 30s no-answer
  cur.noAnsT=setTimeout(()=>{
    if(cur&&!cur.accepted){ logCall('missed',0); toast('No answer.','err'); endCall(true); }
  },30000);
}

function callFail(msg){
  toast(msg,'err');
  if(cur) logCall('completed',callSecs());
  endCall(true);
}

/* ================= callee ================= */
export function handleIncoming({from_user, kind, sdp_offer, call_id}){
  if(cur){ sock.emit('call:reject',{call_id,to_user_id:from_user.id,reason:'busy'}); return; }
  cur={call_id,other:from_user,kind,role:'callee',offer:sdp_offer,ringT:null};
  const ov=document.createElement('div'); ov.className='callov'; ov.id='callOv';
  ov.innerHTML=`
    <div class="callav"><div class="pulse-ring"></div>${av(from_user,'lg')}</div>
    <div class="callname">${esc(from_user.display_name)}</div>
    <div class="callkind">${kind==='video'?'📹 Incoming video call':'📞 Incoming voice call'}</div>
    <div class="callbtns">
      <button class="cbtn decline" id="cDec" aria-label="Decline"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M23 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.5 2.9.7a2 2 0 0 1 1.6 2z" transform="rotate(135 12 12)"/></svg></button>
      <button class="cbtn accept" id="cAcc" aria-label="Accept"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.5 2.9.7a2 2 0 0 1 1.6 2z"/></svg></button>
    </div>`;
  document.body.appendChild(ov);
  ring(ov);
  ov.querySelector('#cDec').onclick=()=>{ sock.emit('call:reject',{call_id,to_user_id:cur.other.id}); clearTimeout(cur.ringT); ov.remove(); cur=null; };
  ov.querySelector('#cAcc').onclick=()=>acceptCall(ov);
  cur.ringT=setTimeout(()=>{ // 30s no answer → missed
    if(cur&&cur.call_id===call_id&&cur.role==='callee'&&!cur.accepted){
      sock.emit('call:missed',{call_id,to_user_id:cur.other.id});
      ov.remove(); cur=null;
      toast('Missed call from '+from_user.display_name);
    }
  },30000);
}
function ring(ov){
  // Proper repeating ringtone (beep-beep every 2s) until answered/declined/timeout.
  try{
    const a=new AudioContext(); a.resume&&a.resume().catch(()=>{});
    const play=()=>{ try{
      const o=a.createOscillator(), g=a.createGain();
      o.connect(g); g.connect(a.destination); o.frequency.value=440;
      const t=a.currentTime;
      g.gain.setValueAtTime(0.0001,t);
      g.gain.exponentialRampToValueAtTime(0.07,t+0.05);
      g.gain.exponentialRampToValueAtTime(0.0001,t+0.4);
      g.gain.exponentialRampToValueAtTime(0.07,t+0.55);
      g.gain.exponentialRampToValueAtTime(0.0001,t+0.9);
      o.start(t); o.stop(t+1);
    }catch{} };
    play();
    const iv=setInterval(()=>{ if(!document.getElementById('callOv')){ clearInterval(iv); try{a.close()}catch{} return; } play(); },2000);
    cur.ringIv=iv;
  }catch{}
}

async function acceptCall(ov){
  clearTimeout(cur.ringT); clearInterval(cur.ringIv);
  await getIce();
  let stream;
  try{ const m=await getCallMedia(cur.kind); stream=m.stream; cur.kind=m.kind; }
  catch(e){ toast('Could not access microphone/camera ('+(e.name||'blocked')+').','err'); sock.emit('call:reject',{call_id:cur.call_id,to_user_id:cur.other.id,reason:'media'}); ov.remove(); cur=null; return; }
  diag={relay:false,track:false};
  const pc=new RTCPeerConnection({iceServers});
  // Attach handlers BEFORE setRemoteDescription — the remote track / ICE can
  // arrive as soon as the descriptions are set.
  pc.onicecandidate=e=>{ if(e.candidate){ if(/ relay /.test(e.candidate.candidate)) diag.relay=true; setDiag(); sock.emit('call:ice',{call_id:cur.call_id,to_user_id:cur.other.id,candidate:e.candidate}); } };
  pc.ontrack=e=>{ diag.track=true; setDiag(); const stream=e.streams[0]; const v=document.getElementById('cvRemote')||document.getElementById('cvRemoteAudio'); if(v){ if(v.tagName==='VIDEO'){ v.muted=true; } v.srcObject=stream; v.play?.().catch(()=>{}); } if(!routeRemoteAudio(stream)) ensureRemotePlays(); };
  pc.onconnectionstatechange=()=>{ setDiag(); if(pc.connectionState==='failed') callFail('Connection failed — check your network.'); };
  attachDiag(pc);
  stream.getTracks().forEach(t=>pc.addTrack(t,stream));
  await pc.setRemoteDescription(new RTCSessionDescription(cur.offer));
  const answer=await pc.createAnswer(); await pc.setLocalDescription(answer);
  Object.assign(cur,{pc,stream,accepted:true,startT:Date.now()});
  // flush queued ICE
  (cur.iceQ||[]).forEach(c=>pc.addIceCandidate(new RTCIceCandidate(c)).catch(()=>{})); cur.iceQ=[];
  sock.emit('call:accept',{call_id:cur.call_id,to_user_id:cur.other.id,sdp_answer:pc.localDescription});
  ov.remove();
  showCallingUI(cur.other,cur.kind,true);
}

/* ================= shared: wire signalling ================= */
let wired=false;
export function wireCalls(){
  if(wired) return; wired=true;
  sock.on('call:accepted',async({call_id,sdp_answer})=>{
    if(!cur||cur.call_id!==call_id||cur.role!=='caller') return;
    clearTimeout(cur.noAnsT);
    try{ await cur.pc.setRemoteDescription(new RTCSessionDescription(sdp_answer)); }
    catch{ callFail('Could not establish the call.'); return; }
    cur.accepted=true; cur.startT=Date.now();
    showCallingUI(cur.other,cur.kind,true);
  });
  sock.on('call:rejected',({call_id})=>{
    if(!cur||cur.call_id!==call_id) return;
    clearTimeout(cur.noAnsT);
    toast('Call declined.','err'); logCall('rejected',0); endCall(true);
  });
  sock.on('call:ice',async({call_id,candidate})=>{
    if(!cur||cur.call_id!==call_id||!cur.pc){ if(cur&&cur.call_id===call_id){(cur.iceQ=cur.iceQ||[]).push(candidate);} return; }
    try{ await cur.pc.addIceCandidate(new RTCIceCandidate(candidate)); }catch{}
  });
  sock.on('call:ended',({call_id})=>{
    if(!cur||cur.call_id!==call_id) return;
    toast('Call ended.');
    if(cur.accepted) logCall('completed',callSecs());
    endCall(true);
  });
}

/* ================= active call UI ================= */
function showCallingUI(other,kind,connected){
  document.getElementById('callOv')?.remove();
  const ov=document.createElement('div'); ov.className='callov'; ov.id='callOv';
  const video=kind==='video';
  ov.innerHTML=`
    ${video?`<div class="callvideos"><video id="cvRemote" class="remote" autoplay playsinline></video><video id="cvLocal" class="local" autoplay playsinline muted></video></div>`:`<audio id="cvRemoteAudio" autoplay playsinline></audio>`}
    <div class="callui">
      ${video?'':'<div class="callav">'+av(other,'lg')+'</div>'}
      <div class="callname">${esc(other.display_name)}</div>
      <div class="callkind" id="cState">${connected?(kind==='video'?'Video call':'Voice call'):'Ringing...'}</div>
      <div class="calldur" id="cDur">0:00</div>
      <div class="calldiag" id="cDiag" style="font-size:11px;opacity:.65;margin-top:4px">ICE: … · Net: … · Relay: … · Track: …</div>
      <div style="width:180px;height:6px;background:#1e293b;border-radius:3px;margin:8px auto 0;overflow:hidden"><div id="cLevelBar" style="height:100%;width:0%;background:#334155;border-radius:3px"></div></div>
      <div style="font-size:10px;opacity:.5;margin-top:2px">their voice level</div>
      <div class="callbtns">
        <button class="cbtn" id="cMute" aria-label="Mute"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v4"/></svg><small>Mute</small></button>
        ${video?`<button class="cbtn" id="cCam" aria-label="Camera"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg><small>Camera</small></button>
        <button class="cbtn" id="cFlip" aria-label="Flip camera"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7"/><path d="M21 12a9 9 0 0 1-15 6.7"/><path d="M18 2v4h-4"/><path d="M6 22v-4h4"/></svg><small>Flip</small></button>`:''}
        <button class="cbtn" id="cSpk" aria-label="Speaker"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg><small>Speaker</small></button>
        <button class="cbtn decline" id="cEnd" aria-label="End call"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M23 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.5 2.9.7a2 2 0 0 1 1.6 2z" transform="rotate(135 12 12)"/></svg></button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  setDiag(); // show the current ICE/connection state right away
  if(connected) startPlayRetry();
  // Tapping anywhere on the call screen retries playback (a tap is a user
  // gesture, which is what iOS needs to unlock audio).
  ov.addEventListener('pointerdown',()=>{ getAudioCtx(); ensureRemotePlays(); });
  // Speaker button: on iOS, setSinkId doesn't exist, so the button can't
  // switch outputs the Android way — but it CAN unlock/resume the audio
  // (a tap is a user gesture) and route it out loud via Web Audio. So
  // keep it on iPhones now; only hide it if there's no remote element.
  const remoteEl=ov.querySelector('#cvRemote')||ov.querySelector('#cvRemoteAudio');
  if(!remoteEl) ov.querySelector('#cSpk')?.remove();
  if(cur?.stream&&video){ const lv=ov.querySelector('#cvLocal'); if(lv){ lv.srcObject=cur.stream; lv.play?.().catch(()=>{}); } }
  // duration ticker
  const durEl=ov.querySelector('#cDur'), stEl=ov.querySelector('#cState');
  cur.durT=setInterval(()=>{
    if(cur?.startT){ durEl.textContent=fmtDur((Date.now()-cur.startT)/1000); }
    else durEl.textContent='0:00';
  },1000);

  const track=(k)=>cur?.stream?.getTracks().find(t=>t.kind===k);
  ov.querySelector('#cMute').onclick=e=>{
    const t=track('audio'); if(!t) return;
    t.enabled=!t.enabled; e.currentTarget.classList.toggle('off',!t.enabled);
  };
  const camB=ov.querySelector('#cCam');
  if(camB) camB.onclick=e=>{ const t=track('video'); if(!t) return; t.enabled=!t.enabled; e.currentTarget.classList.toggle('off',!t.enabled); };
  const flipB=ov.querySelector('#cFlip');
  if(flipB) flipB.onclick=async e=>{
    const vt=track('video'); if(!vt) return;
    const facing=vt.getSettings().facingMode==='user'?'environment':'user';
    try{
      const ns=await navigator.mediaDevices.getUserMedia({video:{facingMode:facing},audio:false});
      const nt=ns.getVideoTracks()[0];
      const sender=cur.pc.getSenders().find(s=>s.track?.kind==='video');
      if(sender) await sender.replaceTrack(nt);
      vt.stop(); cur.stream.removeTrack(vt); cur.stream.addTrack(nt);
      ov.querySelector('#cvLocal').srcObject=cur.stream;
      toast('Camera flipped.','ok');
    }catch{ toast('Could not flip camera on this device.','err'); }
  };
  const spkB=ov.querySelector('#cSpk');
  if(spkB) spkB.onclick=async e=>{
    // Resume the audio engine (a tap unlocks it on iOS) and re-route the
    // remote sound out loud. On Android Chrome, also try the system output.
    getAudioCtx(); ensureRemotePlays();
    const v=ov.querySelector('#cvRemote')||ov.querySelector('#cvRemoteAudio');
    if(v&&typeof v.setSinkId==='function'){
      try{ await v.setSinkId(''); e.currentTarget.classList.toggle('off'); toast('Speaker toggled.','ok'); return; }
      catch{ /* fall through to the iOS guidance below */ }
    }
    e.currentTarget.classList.toggle('off');
    toast('Speaker on — if it is still quiet, swipe down for Control Center and set the audio output to iPhone Speaker.','ok');
  };
  ov.querySelector('#cEnd').onclick=()=>{ if(cur?.accepted) logCall('completed',callSecs()); endCall(false); };
}

function callSecs(){ return cur?.startT?Math.round((Date.now()-cur.startT)/1000):0; }
function logCall(status,duration_sec){
  if(!cur?.other) return;
  api.post('/api/calls/log',{other_user_id:cur.other.id,kind:cur.kind,duration_sec,status}).catch(()=>{});
}
function endCall(silent){
  stopPlayRetry(); stopLevelMeter(); webAudioOn=false;
  if(cur){
    clearTimeout(cur.noAnsT); clearTimeout(cur.ringT); clearInterval(cur.ringIv); clearInterval(cur.durT);
    if(!silent&&cur.role==='caller'&&!cur.accepted) sock.emit('call:end',{call_id:cur.call_id,to_user_id:cur.other.id});
    else if(!silent&&cur.accepted) sock.emit('call:end',{call_id:cur.call_id,to_user_id:cur.other.id});
    try{cur.pc?.close()}catch{}
    cur.stream?.getTracks().forEach(t=>t.stop());
  }
  cur=null;
  document.getElementById('callOv')?.remove();
}
function fmtDur(s){ s=Math.max(0,Math.round(s)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }
