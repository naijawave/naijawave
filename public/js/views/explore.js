/* Naija Wave — explore: search (people/posts/hashtags) + trending + suggested. */
import { api } from '../api.js';
import { postCard, userRow, followBtn, skelPosts, emptyState, errCard, toast, esc, fmtNum } from '../ui.js';

export async function render(view){
  view.innerHTML=`<div class="page" style="padding-top:0">
    <div class="searchbar"><input id="q" class="input" placeholder="Search people, waves, #hashtags..." autocomplete="off"></div>
    <div id="res"></div>
    <div id="hub"></div>
  </div>`;
  const q=view.querySelector('#q'), res=view.querySelector('#res'), hub=view.querySelector('#hub');
  let t=null, tab='all';

  q.oninput=()=>{
    clearTimeout(t);
    t=setTimeout(()=>doSearch(q.value.trim()),350);
  };
  async function doSearch(term){
    if(!term){ res.innerHTML=''; hub.style.display=''; return; }
    hub.style.display='none';
    res.innerHTML=`<div class="tabs"><button data-t="all" class="${tab==='all'?'active':''}">All</button>
      <button data-t="people" class="${tab==='people'?'active':''}">People</button>
      <button data-t="posts" class="${tab==='posts'?'active':''}">Waves</button>
      <button data-t="hashtags" class="${tab==='hashtags'?'active':''}">Tags</button></div><div id="rbody">${skelPosts(2)}</div>`;
    res.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{ tab=b.dataset.t; doSearch(term); });
    const body=res.querySelector('#rbody');
    try{
      const d=await api.get('/api/search?q='+encodeURIComponent(term)+'&type='+tab);
      let h='';
      const users=(d.users||[]).filter(u=>tab==='all'||tab==='people');
      const posts=(d.posts||[]).filter(p=>tab==='all'||tab==='posts');
      const tags=(d.hashtags||[]).filter(x=>tab==='all'||tab==='hashtags');
      if(tab==='all'||tab==='people') h+=users.map(u=>userRow(u,followBtn(u.username,false))).join('');
      if(tab==='all'||tab==='hashtags') h+=tags.map(x=>`<a class="trow" href="#/tag/${esc(String(x.tag||x).replace('#',''))}">
        <div><div class="tt">#${esc(String(x.tag||x).replace('#',''))}</div>${x.posts_count!=null?`<div class="tc">${fmtNum(x.posts_count)} waves</div>`:''}</div></a>`).join('');
      if(tab==='all'||tab==='posts') h+=posts.map(p=>postCard(p)).join('');
      body.innerHTML=h||emptyState('No results',`Nothing found for "<b>${esc(term)}</b>". Try another spelling.`);
    }catch(err){ body.innerHTML=errCard('Search failed. '+err.message,()=>doSearch(term)); }
  }

  // hub
  hub.innerHTML=skelPosts(3);
  try{
    const [ex,tr]=await Promise.all([
      api.get('/api/explore'),
      api.get('/api/hashtags/trending').catch(()=>[]),
    ]);
    const tags=Array.isArray(tr)?tr:(tr.items||[]);
    hub.innerHTML=`
      <div class="cath">🔥 Trending in Naija</div>
      <div>${tags.slice(0,8).map(t=>`<a class="trow" href="#/tag/${esc(String(t.tag).replace('#',''))}">
        <div style="flex:1"><div class="tt">#${esc(String(t.tag).replace('#',''))}</div>
        <div class="tc">${fmtNum(t.posts_count||0)} waves${t.category?' · '+esc(t.category):''}</div></div></a>`).join('')||'<p class="muted small" style="padding:0 12px">No trends yet.</p>'}</div>
      <div class="cath">👥 Who to follow</div>
      <div>${(ex.suggested_users||[]).slice(0,5).map(u=>userRow(u,followBtn(u.username,false))).join('')}</div>
      <div class="cath">🌊 Popular waves</div>
      <div id="pop"></div>`;
    const pop=hub.querySelector('#pop');
    (ex.popular_posts||[]).forEach(p=>{ const t=document.createElement('div'); t.innerHTML=postCard(p); pop.appendChild(t.firstChild); });
  }catch(err){ hub.innerHTML=errCard('Could not load Explore. '+err.message,()=>render(view)); }
}
