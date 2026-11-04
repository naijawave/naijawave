/* Naija Wave — hashtag feed. */
import { api } from '../api.js';
import { postCard, skelPosts, emptyState, errCard, esc } from '../ui.js';

export async function render(view,{tag}){
  view.innerHTML=`<div class="page" style="padding-top:0">
    <div style="padding:16px 12px 8px"><h1 class="sect" style="margin:0">#${esc(tag)}</h1></div>
    <div id="posts"></div><button id="more" class="loadmore hidden">Load more</button>
  </div>`;
  const posts=view.querySelector('#posts'), more=view.querySelector('#more');
  let page=1, hasMore=true, loading=false;
  async function load(reset){
    if(loading||(!reset&&!hasMore)) return;
    loading=true;
    if(reset){ page=1; hasMore=true; posts.innerHTML=skelPosts(3); }
    try{
      const d=await api.get(`/api/hashtags/${encodeURIComponent(tag)}?page=${page}&limit=20`);
      if(reset) posts.innerHTML='';
      if(!d.items.length&&page===1) posts.innerHTML=emptyState('No waves here','Nobody has used #'+esc(tag)+' yet. Be the first 🌊');
      d.items.forEach(p=>{ const t=document.createElement('div'); t.innerHTML=postCard(p); posts.appendChild(t.firstChild); });
      hasMore=!!d.has_more; more.classList.toggle('hidden',!hasMore); page++;
    }catch(err){ if(page===1) posts.innerHTML=errCard('Could not load this tag. '+err.message,()=>load(true)); }
    loading=false;
  }
  more.onclick=()=>load(false);
  load(true);
}
