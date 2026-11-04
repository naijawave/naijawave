/* Naija Wave — post detail: full thread + replies. */
import { api, auth } from '../api.js';
import { postCard, commentHtml, commentComposer, skelPosts, errCard, toast, esc, openModal, confirmDlg, menuAt } from '../ui.js';
import { quoteSheet } from './home.js';

export async function render(view,{id}){
  view.innerHTML=`<div class="page" style="padding-top:0">
    <div style="display:flex;align-items:center;gap:8px;padding:12px">
      <button class="iconbtn" id="pBack" aria-label="Back"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg></button>
      <h1 class="sect" style="margin:0">Wave</h1>
      <button class="iconbtn" id="pMenu" style="margin-left:auto" aria-label="Post options"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg></button>
    </div>
    <div id="pmain"></div>
    <div id="pcomments" style="padding:0 4px"></div>
    <div id="pcomposer" style="position:sticky;bottom:calc(var(--tab-h) + 8px)"></div>
  </div>`;
  view.querySelector('#pBack').onclick=()=>history.back();
  const main=view.querySelector('#pmain'), cmount=view.querySelector('#pcomments');
  main.innerHTML=skelPosts(1);
  let post=null;
  try{
    const d=await api.get(`/api/posts/${id}`);
    post=d.post;
    main.innerHTML=postCard(post,{detail:true});
  }catch(err){ main.innerHTML=errCard('This wave could not be found. It may have been deleted.',()=>render(view,{id})); return; }

  view.querySelector('#pMenu').onclick=e=>{
    const r=e.currentTarget.getBoundingClientRect();
    const items=[
      {label:'💬 Quote this wave',fn:()=>quoteSheet(post)},
      {label:'🔗 Copy link',fn:async()=>{ try{await navigator.clipboard.writeText(location.href);toast('Link copied','ok')}catch{toast(location.href)} }},
    ];
    if(post.author?.id===auth.me.id||auth.me.is_founder)
      items.push({label:'🗑️ Delete wave',danger:true,fn:async()=>{
        if(!await confirmDlg('Delete this wave?','This cannot be undone.','Delete',true)) return;
        await api.del(`/api/posts/${id}`); toast('Wave deleted.','ok'); history.back();
      }});
    else items.push({label:'🚨 Report wave',danger:true,fn:()=>{
      const ov=openModal(`<h2>Report wave</h2><div class="field"><label>Reason</label><input id="pr" class="input" placeholder="e.g. Spam, harassment, misinformation"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="pgo">Report</button></div>`);
      ov.querySelector('#pgo').onclick=async()=>{
        try{ await api.post(`/api/posts/${id}/report`,{reason:ov.querySelector('#pr').value.trim()||'Reported'}); toast('Report sent.','ok'); }
        catch(err){ toast(err.message,'err'); }
        (await import('../ui.js')).closeOverlay();
      };
    }});
    menuAt(r.left-190,r.top+40,items);
  };

  // comments
  cmount.innerHTML='<div class="comments" style="border:none"><h3 class="sect">Replies</h3><div id="clist"></div></div>';
  const clist=cmount.querySelector('#clist');
  async function loadC(){
    clist.innerHTML=skelPosts(2);
    try{
      const d=await api.get(`/api/posts/${id}/comments?page=1&limit=50`);
      clist.innerHTML=d.items.length?'':'<p class="muted small" style="padding:8px 4px">No replies yet — start the conversation.</p>';
      d.items.forEach(c=>{
        const t=document.createElement('div'); t.innerHTML=commentHtml(c); clist.appendChild(t.firstChild);
        (c.replies||[]).forEach(r=>{ const k=clist.querySelector(`[data-comment="${c.id}"] .cchildren`); const x=document.createElement('div'); x.innerHTML=commentHtml(r,1); k?.appendChild(x.firstChild); });
      });
    }catch(err){ clist.innerHTML=errCard('Could not load replies.',loadC); }
  }
  // reply-to-reply wiring
  cmount.addEventListener('click',async e=>{
    const rb=e.target.closest('[data-creply]');
    if(rb){
      const ta=view.querySelector('#pcomposer textarea'); ta.focus();
      ta.dataset.parent=rb.dataset.creply; ta.placeholder='Replying... (tap send)';
      toast('Replying to a comment — type below.');
      return;
    }
    const vb=e.target.closest('[data-creplies]');
    if(vb){
      toast('Replies load with the thread.','');
    }
  });
  view.querySelector('#pcomposer').appendChild(commentComposer(async t=>{
    const ta=view.querySelector('#pcomposer textarea');
    const parent=ta.dataset.parent?+ta.dataset.parent:undefined;
    const d=await api.post(`/api/posts/${id}/comments`,{text:t,parent_id:parent});
    delete ta.dataset.parent; ta.placeholder='Write a reply...';
    const x=document.createElement('div'); x.innerHTML=commentHtml(d.comment,parent?1:0);
    if(parent){ const k=clist.querySelector(`[data-comment="${parent}"] .cchildren`); k?.appendChild(x.firstChild); }
    else clist.prepend(x.firstChild);
  }));
  loadC();
}
