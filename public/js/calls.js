/* Naija Wave — voice/video calls over WebRTC (API.md §10). */
import { api, sock } from './api.js';
import { toast, esc, av } from './ui.js';

let iceServers=[{urls:'stun:stun.l.google.com:19302'}];
let cur=null; // active call session

async function getIce(){
  try{ const d=await api.get('/api/config?_='+Date.now()); if(d.ice_servers?.length) iceServers=d.ice_servers; }
  catch{}
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
  const pc=new RTCPeerConnection({iceServers});
  // Attach handlers BEFORE createOffer/setLocalDescription — ICE gathering
  // starts there, and candidates gathered before the handler is set are lost.
  pc.onicecandidate=e=>{ if(e.candidate) sock.emit('call:ice',{call_id,to_user_id:other.id,candidate:e.candidate}); };
  pc.ontrack=e=>{ const v=document.getElementById('cvRemote')||document.getElementById('cvRemoteAudio'); if(v){ v.srcObject=e.streams[0]; v.play?.().catch(()=>{}); } };
  pc.onconnectionstatechange=()=>{ if(pc.connectionState==='failed') callFail('Connection failed — check your network.'); };
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
  const pc=new RTCPeerConnection({iceServers});
  // Attach handlers BEFORE setRemoteDescription — the remote track / ICE can
  // arrive as soon as the descriptions are set.
  pc.onicecandidate=e=>{ if(e.candidate) sock.emit('call:ice',{call_id:cur.call_id,to_user_id:cur.other.id,candidate:e.candidate}); };
  pc.ontrack=e=>{ const v=document.getElementById('cvRemote')||document.getElementById('cvRemoteAudio'); if(v){ v.srcObject=e.streams[0]; v.play?.().catch(()=>{}); } };
  pc.onconnectionstatechange=()=>{ if(pc.connectionState==='failed') callFail('Connection failed — check your network.'); };
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
      <div class="callbtns">
        <button class="cbtn" id="cMute" aria-label="Mute"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v4"/></svg><small>Mute</small></button>
        ${video?`<button class="cbtn" id="cCam" aria-label="Camera"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg><small>Camera</small></button>
        <button class="cbtn" id="cFlip" aria-label="Flip camera"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7"/><path d="M21 12a9 9 0 0 1-15 6.7"/><path d="M18 2v4h-4"/><path d="M6 22v-4h4"/></svg><small>Flip</small></button>`:''}
        <button class="cbtn" id="cSpk" aria-label="Speaker"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg><small>Speaker</small></button>
        <button class="cbtn decline" id="cEnd" aria-label="End call"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M23 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.5 2.9.7a2 2 0 0 1 1.6 2z" transform="rotate(135 12 12)"/></svg></button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  // Speaker routing (setSinkId) is missing on older iOS Safari and present-
  // but-broken on newer iOS — it exists yet throws when called. iOS routes
  // call audio itself anyway (earpiece for voice, speaker for video), so
  // hide the button on all iPhones/iPads, and anywhere the remote audio
  // element can't actually do it.
  const isiOS=/iPhone|iPad|iPod/.test(navigator.userAgent||'');
  const remoteEl=ov.querySelector('#cvRemote')||ov.querySelector('#cvRemoteAudio');
  if(isiOS||!remoteEl||typeof remoteEl.setSinkId!=='function') ov.querySelector('#cSpk')?.remove();
  if(cur?.stream&&video){ const lv=ov.querySelector('#cvLocal'); if(lv) lv.srcObject=cur.stream; }
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
    const v=ov.querySelector('#cvRemote')||ov.querySelector('#cvRemoteAudio');
    if(v&&typeof v.setSinkId==='function'){
      try{ await v.setSinkId(''); e.currentTarget.classList.toggle('off'); toast('Speaker toggled.','ok'); }
      catch{ toast('Speaker control not supported on this device.','err'); }
    }else toast('Your phone handles the speaker automatically — use Control Center to switch audio during a call.','err');
  };
  ov.querySelector('#cEnd').onclick=()=>{ if(cur?.accepted) logCall('completed',callSecs()); endCall(false); };
}

function callSecs(){ return cur?.startT?Math.round((Date.now()-cur.startT)/1000):0; }
function logCall(status,duration_sec){
  if(!cur?.other) return;
  api.post('/api/calls/log',{other_user_id:cur.other.id,kind:cur.kind,duration_sec,status}).catch(()=>{});
}
function endCall(silent){
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
