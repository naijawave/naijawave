/* Naija Wave — Videos: TikTok, Instagram and YouTube videos added by LINK
   only (embedded player, no upload, no cap). This is where videos are ADDED;
   the home feed is where they are seen mixed in with posts. */
import { api, auth } from '../api.js';
import { toast, esc, emptyState, errCard, skelPosts, confirmDlg } from '../ui.js';
import { videoCard, bindVideoPlayers, unbindVideoPlayers } from './videos-shared.js';

const PAGE = 20;

export async function render(view) {
  view.innerHTML = `<div class="page" style="padding-top:0">
    <div style="padding:16px 12px 4px"><h1 class="sect" style="margin:0">🎬 Videos</h1>
    <p class="small muted">Videos shared by the community — TikTok, Instagram and YouTube. Paste any video link to add one. It plays right here and in the home feed, no uploads, as many as you like.</p></div>
    <form id="tkForm" class="card tight" style="margin:4px 12px 12px">
      <div class="field" style="margin-bottom:8px">
        <input id="tkUrl" class="input" placeholder="Paste a TikTok, Instagram or YouTube video link..." autocomplete="off" required>
      </div>
      <div class="field" style="margin-bottom:10px">
        <input id="tkTitle" class="input" placeholder="Title (optional)" maxlength="120" autocomplete="off">
      </div>
      <button class="btn primary block" type="submit">+ Add video</button>
    </form>
    <div id="tkList"></div>
    <button id="tkMore" class="loadmore hidden">Load more</button>
  </div>`;

  const list = view.querySelector('#tkList'), more = view.querySelector('#tkMore');
  const form = view.querySelector('#tkForm'), urlIn = view.querySelector('#tkUrl'), titleIn = view.querySelector('#tkTitle');
  const me = auth.me;
  let offset = 0, hasMore = true, loading = false;

  // Deep link from search: #/videos?v=<id> scrolls to that video.
  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  const highlightId = params.get('v');

  form.onsubmit = async (e) => {
    e.preventDefault();
    const url = urlIn.value.trim();
    if (!url) return;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const d = await api.post('/api/videos', { url, title: titleIn.value.trim() });
      urlIn.value = ''; titleIn.value = '';
      if (d.created) {
        const t = document.createElement('div');
        t.innerHTML = videoCard(d.video, me);
        list.prepend(t.firstChild);
        bindVideoPlayers(list);
        toast('Video added 🎬', 'ok');
      } else {
        toast('That video is already here');
        const el = list.querySelector(`[data-video="${d.video.id}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch (err) { toast(err.message, 'err'); }
    btn.disabled = false;
  };

  list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    const ok = await confirmDlg('Remove this video?', 'It will be taken off the Videos page and the home feed. The original link itself is not affected.', 'Remove', true);
    if (!ok) return;
    try {
      await api.del('/api/videos/' + b.dataset.del);
      b.closest('[data-video]')?.remove();
      toast('Video removed', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  });

  async function load(reset) {
    if (loading || (!reset && !hasMore)) return;
    loading = true;
    if (reset) { offset = 0; hasMore = true; list.innerHTML = skelPosts(3); }
    try {
      const d = await api.get(`/api/videos?limit=${PAGE}&offset=${offset}`);
      if (reset) list.innerHTML = '';
      if (!d.items.length && offset === 0) {
        list.innerHTML = emptyState('No videos yet', 'Be the first — paste a TikTok, Instagram or YouTube link above and it will play right here 🎬');
      }
      d.items.forEach(v => {
        const t = document.createElement('div');
        t.innerHTML = videoCard(v, me);
        list.appendChild(t.firstChild);
      });
      bindVideoPlayers(list);
      hasMore = !!d.has_more;
      more.classList.toggle('hidden', !hasMore);
      offset += d.items.length;
      if (highlightId) {
        const el = list.querySelector(`[data-video="${CSS.escape(highlightId)}"]`);
        if (el) {
          el.scrollIntoView({ block: 'center' });
          el.style.outline = '2px solid var(--blue2)';
          el.style.borderRadius = '14px';
          setTimeout(() => { el.style.outline = ''; }, 2500);
        }
      }
    } catch (err) {
      if (offset === 0) list.innerHTML = errCard('Could not load videos. ' + err.message, () => load(true));
    }
    loading = false;
  }
  more.onclick = () => load(false);
  load(true);

  return () => unbindVideoPlayers();
}
