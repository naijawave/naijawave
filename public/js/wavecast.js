/* Naija Wave — WAVECAST: the signature voice-wave experience (DESIGN.md §9). */
import { api } from './api.js';
import { toast, esc, fmtDur } from './ui.js';

const MAX_SEC=120;
const MIME_CHAIN=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus','audio/ogg'];

/* openWavecast(onSend) — onSend(media, durationSec) after user taps "Send wave" */
export function openWavecast(onSend){
  if(!navigator.mediaDevices?.getUserMedia){ return micError('Your browser does not support microphone recording.'); }
  if(typeof MediaRecorder==='undefined'){ return micError('Voice recording is not supported on this device.'); }

  const ov=document.createElement('div'); ov.className='wcov'; ov.setAttribute('role','dialog');
  ov.setAttribute('aria-label','Wavecast voice recorder');
  ov.innerHTML=`
    <button class="iconbtn xbtn" id="wcX" aria-label="Close" style="position:absolute;top:14px;right:14px;color:var(--ink2)">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
    <div id="wcBody" style="display:flex;flex-direction:column;align-items:center"></div>`;
  document.body.appendChild(ov);
  const body=ov.querySelector('#wcBody');
  ov.querySelector('#wcX').onclick=()=>{ stopAll(); ov.remove(); };

  let stream=null, rec=null, actx=null, analyser=null, srcNode=null, chunks=[], raf=null;
  let state='starting', startT=0, elapsed=0, tickT=null, waveData=[];
  let audioEl=null, blobUrl=null, durationSec=0, speed=1;

  body.innerHTML=`<div class="wcstate">Starting microphone...</div>`;
  navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}})
    .then(s=>{ stream=s; begin(); })
    .catch(err=>{ ov.remove(); micError(err?.name==='NotAllowedError'
      ? 'Microphone access was denied. Please allow microphone access in your browser settings to send a Wavecast.'
      : 'Could not start the microphone. ('+(err?.message||'unknown error')+')'); });

  function micError(msg){
    const d=document.createElement('div'); d.className='wcov'; d.setAttribute('role','alert');
    d.innerHTML=`<div class="wcerror"><h3>🎙️ Microphone unavailable</h3><p>${esc(msg)}</p>
      <button class="btn primary" id="meOk">OK</button></div>`;
    document.body.appendChild(d);
    d.querySelector('#meOk').onclick=()=>d.remove();
  }

  function begin(){
    state='rec';
    const mime=MIME_CHAIN.find(m=>{ try{return MediaRecorder.isTypeSupported(m)}catch{return false} })||'';
    try{ rec=new MediaRecorder(stream, mime?{mimeType:mime}:undefined); }
    catch(e){ ov.remove(); micError('Could not start recording on this device.'); return; }
    rec.ondataavailable=e=>{ if(e.data.size) chunks.push(e.data); };
    rec.onstop=()=>finishPreview();
    rec.start(250);

    // live analyser → orb reacts to voice
    actx=new (window.AudioContext||window.webkitAudioContext)();
    srcNode=actx.createMediaStreamSource(stream);
    analyser=actx.createAnalyser(); analyser.fftSize=256;
    srcNode.connect(analyser);
    const buf=new Uint8Array(analyser.frequencyBinCount);
    waveData=new Array(48).fill(0);

    body.innerHTML=`
      <div class="wcorb"><div class="orbring r1"></div><div class="orbring r2"></div><div class="orbring r3"></div><div class="orb" id="wcOrb"></div></div>
      <div class="wctimer" id="wcTimer">0:00</div>
      <div class="wcstate">● Recording your wave</div>
      <canvas class="wcwave" id="wcLive"></canvas>
      <div class="wcbtns">
        <button class="wcdiscard" id="wcDiscard" aria-label="Discard"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
        <button class="wcstop" id="wcStop" aria-label="Stop and preview"><svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg></button>
      </div>
      <div class="small muted" style="margin-top:10px">Max ${fmtDur(MAX_SEC)} — tap ■ to preview</div>`;
    const orb=body.querySelector('#wcOrb'), live=body.querySelector('#wcLive');
    startT=Date.now();
    tickT=setInterval(()=>{
      elapsed=(Date.now()-startT)/1000;
      body.querySelector('#wcTimer').textContent=fmtDur(elapsed);
      if(elapsed>=MAX_SEC) stopRec();
    },250);
    const loop=()=>{
      if(state!=='rec') return;
      analyser.getByteTimeDomainData(buf);
      let sum=0; for(let i=0;i<buf.length;i++){ const v=(buf[i]-128)/128; sum+=v*v; }
      const amp=Math.min(1,Math.sqrt(sum/buf.length)*3.2);
      orb.style.transform=`scale(${1+amp*0.35})`;
      orb.style.boxShadow=`0 0 ${60+amp*80}px rgba(46,124,246,${.45+amp*.4}),0 0 ${120+amp*60}px rgba(0,194,255,${.2+amp*.25}),inset 0 0 40px rgba(232,185,74,.25)`;
      // live waveform strip
      waveData.push(amp); if(waveData.length>48) waveData.shift();
      drawLive(live,waveData,elapsed/MAX_SEC);
      raf=requestAnimationFrame(loop);
    };
    loop();
    body.querySelector('#wcStop').onclick=stopRec;
    body.querySelector('#wcDiscard').onclick=()=>{ stopAll(); ov.remove(); toast('Wave discarded.'); };
  }

  function drawLive(cv,data,prog){
    const dpr=Math.min(devicePixelRatio||1,2), w=cv.clientWidth||380, h=64;
    cv.width=w*dpr; cv.height=h*dpr;
    const x=cv.getContext('2d'); x.scale(dpr,dpr); x.clearRect(0,0,w,h);
    const n=data.length, bw=w/48;
    for(let i=0;i<n;i++){
      const bh=4+data[i]*(h-10);
      x.fillStyle=i/48<=prog?'#00C2FF':'rgba(46,124,246,.55)';
      x.beginPath(); x.roundRect(i*bw+1,(h-bh)/2,bw-2,bh,3); x.fill();
    }
  }

  function stopRec(){
    if(state!=='rec') return;
    state='preview';
    clearInterval(tickT); cancelAnimationFrame(raf);
    durationSec=Math.min(elapsed,MAX_SEC);
    try{ rec.stop(); }catch{}
    stream?.getTracks().forEach(t=>t.stop());
  }

  function finishPreview(){
    const blob=new Blob(chunks,{type:rec.mimeType||'audio/webm'});
    chunks=[];
    blobUrl=URL.createObjectURL(blob);
    audioEl=new Audio(blobUrl);
    body.classList.add('wcpreview');
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    body.innerHTML=`
      <div class="wcorb"><div class="orb" id="wcOrb"></div></div>
      <div class="wctimer" id="wcTimer">${fmtDur(durationSec)}</div>
      <div class="wcstate">Preview your wave</div>
      <div class="scrub"><input type="range" id="wcScrub" min="0" max="1000" value="0" aria-label="Scrub"></div>
      <div class="wcspeed" id="wcSpeed">
        ${['1x','1.5x','2x'].map((s,i)=>`<button class="${i===0?'active':''}" data-s="${s}">${s}</button>`).join('')}
      </div>
      ${SR?'<button class="trbtn" id="wcTr">✨ Transcribe preview</button><div class="trtext hidden" id="wcTrT" style="max-width:380px;text-align:center"></div>':''}
      <div class="wcbtns">
        <button class="wcdiscard" id="wcRe" aria-label="Re-record" title="Re-record"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg></button>
        <button class="orbmini" id="wcPlay" style="width:76px;height:76px" aria-label="Play"><svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
        <button class="wcdiscard" id="wcDiscard2" aria-label="Discard" title="Discard"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
      </div>
      <button class="wcsend big" id="wcSend" style="margin-top:18px">Send wave 🌊</button>`;
    const orb=body.querySelector('#wcOrb'), play=body.querySelector('#wcPlay'),
      scrub=body.querySelector('#wcScrub'), timer=body.querySelector('#wcTimer');
    const setIcon=p=>play.innerHTML=p
      ?'<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>'
      :'<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    audioEl.playbackRate=speed;
    audioEl.ontimeupdate=()=>{ if(audioEl.duration){ scrub.value=Math.round(audioEl.currentTime/audioEl.duration*1000); timer.textContent=fmtDur(audioEl.currentTime); } };
    audioEl.onended=()=>{ setIcon(false); orb.classList.remove('playing'); orb.style.transform='scale(1)'; };
    audioEl.onplay=()=>{ setIcon(true); orb.classList.add('playing'); };
    audioEl.onpause=()=>{ setIcon(false); orb.classList.remove('playing'); orb.style.transform='scale(1)'; };
    play.onclick=()=>{ audioEl.paused?audioEl.play():audioEl.pause(); };
    scrub.oninput=()=>{ if(audioEl.duration) audioEl.currentTime=scrub.value/1000*audioEl.duration; };
    body.querySelectorAll('#wcSpeed button').forEach(b=>b.onclick=()=>{
      body.querySelectorAll('#wcSpeed button').forEach(x=>x.classList.remove('active'));
      b.classList.add('active'); speed=parseFloat(b.dataset.s); audioEl.playbackRate=speed;
    });
    body.querySelector('#wcRe').onclick=()=>{ cleanup(); ov.remove(); openWavecast(onSend); };
    body.querySelector('#wcDiscard2').onclick=()=>{ cleanup(); ov.remove(); toast('Wave discarded.'); };
    const trB=body.querySelector('#wcTr');
    if(trB) trB.onclick=()=>{
      const box=body.querySelector('#wcTrT'); box.classList.remove('hidden');
      box.textContent='🎙️ Play the preview aloud so transcription can hear it...';
      try{
        const rec2=new SR(); rec2.lang='en-NG'; rec2.interimResults=false;
        rec2.onresult=ev=>{ box.textContent='“'+[...ev.results].map(r=>r[0].transcript).join(' ')+'”'; };
        rec2.onerror=()=>{ box.textContent='Could not transcribe. Try again in a quieter place.'; };
        rec2.start(); audioEl.currentTime=0; audioEl.play().catch(()=>{});
        setTimeout(()=>{ try{rec2.stop()}catch{} },Math.min(20000,durationSec*1000+3000));
      }catch{ box.textContent='Transcription unavailable.'; }
    };
    body.querySelector('#wcSend').onclick=async()=>{
      const btn=body.querySelector('#wcSend'); btn.disabled=true; btn.textContent='Sending...';
      try{
        const media=await api.uploadVoice(blob, durationSec);
        cleanup(); ov.remove();
        toast('Wave sent 🌊','ok');
        await onSend(media, durationSec);
      }catch(err){ toast('Could not send wave: '+err.message,'err'); btn.disabled=false; btn.textContent='Send wave 🌊'; }
    };
  }

  function cleanup(){
    try{audioEl?.pause()}catch{}
    if(blobUrl) URL.revokeObjectURL(blobUrl);
  }
  function stopAll(){
    clearInterval(tickT); cancelAnimationFrame(raf);
    try{rec&&state==='rec'&&rec.stop()}catch{}
    stream?.getTracks().forEach(t=>t.stop());
    try{actx?.close()}catch{}
    cleanup();
  }
}
