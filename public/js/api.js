/* Naija Wave — API client: fetch wrapper, auth state, socket. */
const API_BASE = '';

const store = {
  get token(){ try{ return localStorage.getItem('nw_token')||null; }catch{ return null; } },
  set token(v){ try{ v ? localStorage.setItem('nw_token',v) : localStorage.removeItem('nw_token'); }catch{} },
  get user(){ try{ return JSON.parse(localStorage.getItem('nw_user')||'null'); }catch{ return null; } },
  set user(v){ try{ v ? localStorage.setItem('nw_user',JSON.stringify(v)) : localStorage.removeItem('nw_user'); }catch{} },
};

async function req(method, path, body, opts={}){
  const headers = {};
  if(body !== undefined && !(body instanceof FormData)) headers['Content-Type']='application/json';
  const t = store.token;
  if(t && !opts.noAuth) headers['Authorization']='Bearer '+t;
  let res;
  try{
    res = await fetch(API_BASE+path,{ method, headers, body: body instanceof FormData?body:(body!==undefined?JSON.stringify(body):undefined) });
  }catch(e){
    const err=new Error('Network error. Check your connection and try again.'); err.code='NETWORK'; throw err;
  }
  const ctype=res.headers.get('content-type')||'';
  const data = ctype.includes('application/json') ? await res.json().catch(()=>({})) : {};
  if(!res.ok){
    const err=new Error(data.error || ('Request failed ('+res.status+')'));
    err.status=res.status; err.code=data.code||null; err.data=data;
    if(res.status===401 && t && !opts.keepToken){ logout(true); }
    throw err;
  }
  return data;
}
const get=(p,o)=>req('GET',p,undefined,o);
const post=(p,b,o)=>req('POST',p,b,o);
const patch=(p,b,o)=>req('PATCH',p,b,o);
const del=(p,o)=>req('DELETE',p,undefined,o);

async function uploadFile(file, kind){
  const fd=new FormData(); fd.append('file',file);
  if(kind) fd.append('kind',kind);
  return post('/api/uploads', fd);
}
async function uploadVoice(blob, durationSec){
  const fd=new FormData();
  fd.append('file', blob, 'wavecast-'+Date.now()+'.webm');
  fd.append('kind','voice');
  if(durationSec!=null) fd.append('duration', String(Math.round(durationSec)));
  return post('/api/uploads', fd);
}

/* ---------- auth state ---------- */
let me = store.user;
const authListeners=new Set();
function onAuthChange(fn){ authListeners.add(fn); return ()=>authListeners.delete(fn); }
function setSession(token, user){
  store.token=token; store.user=user; me=user;
  authListeners.forEach(f=>{try{f(!!token)}catch{}});
  connectSocket();
}
function logout(silent){
  store.token=null; store.user=null; me=null;
  disconnectSocket();
  authListeners.forEach(f=>{try{f(false)}catch{}});
  if(!silent) location.hash='#/welcome';
}
function loggedIn(){ return !!store.token; }
async function refreshMe(){
  if(!loggedIn()) return null;
  try{ const d=await get('/api/auth/me'); me=d.user; store.user=d.user; return me; }
  catch{ return me; }
}

/* ---------- socket ---------- */
let socket=null;
const sockListeners={}; // event -> Set(fn)
function onSock(ev,fn){ (sockListeners[ev]=sockListeners[ev]||new Set()).add(fn); return ()=>sockListeners[ev].delete(fn); }
function emitSock(ev,data,ack){ if(socket&&socket.connected){ socket.emit(ev,data,ack); return true; } return false; }
let offline=false;
function setOffline(v){
  if(offline===v) return; offline=v;
  document.getElementById('offlineBar')?.classList.toggle('hidden',!v);
  (sockListeners['__net']||new Set()).forEach(f=>{try{f(v)}catch{}});
}
function onNet(fn){ (sockListeners['__net']=sockListeners['__net']||new Set()).add(fn); return ()=>sockListeners['__net'].delete(fn); }

function connectSocket(){
  if(typeof io==='undefined'){ setTimeout(connectSocket,1500); return; }
  const t=store.token;
  if(!t) return;
  if(socket){ socket.auth={token:t}; if(!socket.connected) socket.connect(); return; }
  socket=io({ auth:{token:t}, reconnection:true, reconnectionAttempts:Infinity, reconnectionDelay:1000, reconnectionDelayMax:8000 });
  socket.on('connect',()=>setOffline(false));
  socket.on('disconnect',()=>setOffline(true));
  socket.on('connect_error',()=>setOffline(true));
  const fwd=['message:new','message:status','message:deleted','typing','presence','notification','conversation:read','call:incoming','call:accepted','call:rejected','call:ice','call:ended'];
  fwd.forEach(ev=>socket.on(ev,(d)=>{(sockListeners[ev]||new Set()).forEach(f=>{try{f(d)}catch{}});}));
}
function disconnectSocket(){ if(socket){ socket.disconnect(); socket=null; } setOffline(false); }

export const api={ get, post, patch, del, uploadFile, uploadVoice };
export const auth={ get me(){return me}, setSession, logout, loggedIn, refreshMe, onAuthChange };
export const sock={ on:onSock, emit:emitSock, onNet, connect:connectSocket, disconnect:disconnectSocket, get instance(){return socket} };
export { store };
