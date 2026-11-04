/* Naija Wave — Naija Pulse: real trending topics by category. */
import { api } from '../api.js';
import { skelPosts, emptyState, errCard, esc, fmtNum } from '../ui.js';

export async function render(view){
  view.innerHTML=`<div class="page" style="padding-top:0">
    <div style="padding:16px 12px 4px;display:flex;align-items:center;gap:12px">
      <div><h1 class="sect" style="margin:0">Naija Pulse 🇳🇬</h1>
      <p class="small muted">What Nigeria is actually talking about — ranked by real wave activity.</p></div>
      <div class="eqbars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
    </div>
    <div class="chips" id="chips"></div>
    <div id="topics"></div>
  </div>`;
  const chips=view.querySelector('#chips'), topics=view.querySelector('#topics');
  topics.innerHTML=skelPosts(3);
  try{
    const d=await api.get('/api/pulse');
    const cats=d.categories||[];
    if(!cats.length){ topics.innerHTML=emptyState('Pulse is quiet','No trending topics yet — start the conversation 🌊'); return; }
    let active=0;
    chips.innerHTML=cats.map((c,i)=>`<button class="chip ${i===0?'active':''}" data-c="${i}">${esc(c.name)}</button>`).join('');
    function show(i){
      active=i;
      chips.querySelectorAll('.chip').forEach((b,j)=>b.classList.toggle('active',j===i));
      const c=cats[i], ts=c.topics||[];
      const max=Math.max(...ts.map(t=>t.posts_count||0),1);
      topics.innerHTML = ts.length ? ts.map(t=>`
        <a class="topiccard" href="#/tag/${esc(String(t.tag).replace('#',''))}" style="display:block">
          <div class="tt">#${esc(String(t.tag).replace('#',''))}</div>
          <div class="tc">${fmtNum(t.posts_count||0)} waves</div>
          <div class="spark" aria-hidden="true">${Array.from({length:16},(_,k)=>`<i style="height:${Math.max(12,Math.round((t.posts_count||1)/max*100))}%"></i>`).join('')}</div>
          ${t.sample_post?`<div class="small muted" style="margin-top:8px">“${esc((t.sample_post.text||'').slice(0,90))}...”</div>`:''}
        </a>`).join('')
        : emptyState('Nothing here yet','No trending topics in '+esc(c.name)+' right now.');
    }
    chips.querySelectorAll('.chip').forEach(b=>b.onclick=()=>show(+b.dataset.c));
    show(0);
  }catch(err){ topics.innerHTML=errCard('Could not load Naija Pulse. '+err.message,()=>render(view)); }
}
