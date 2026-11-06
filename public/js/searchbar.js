/* Naija Wave — global search bar (header on mobile, sidebar on desktop).
   Debounced search across people, waves, hashtags and videos on Naija Wave,
   plus web results from outside the site, with a grouped dropdown.
   Tapping an internal result navigates; tapping a web result opens a new tab. */
import { api } from './api.js';
import { av, esc, timeAgo } from './ui.js';

let wired = false;

export function initGlobalSearch() {
  if (wired) return;
  wired = true;
  document.querySelectorAll('[data-gsearch]').forEach(wrap => wire(wrap));
  // Tapping anywhere else, or navigating, closes every dropdown.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-gsearch]')) closeAll();
  });
  window.addEventListener('hashchange', closeAll);
}

function closeAll() {
  document.querySelectorAll('[data-gsearch] .gdrop').forEach(d => {
    d.classList.add('hidden');
    d.innerHTML = '';
  });
}

function wire(wrap) {
  const input = wrap.querySelector('input');
  const clearBtn = wrap.querySelector('.gclear');
  const drop = wrap.querySelector('.gdrop');
  let t = null;

  function close() { drop.classList.add('hidden'); drop.innerHTML = ''; }

  input.addEventListener('input', () => {
    clearBtn.classList.toggle('hidden', !input.value);
    clearTimeout(t);
    const q = input.value.trim();
    if (q.length < 2) { close(); return; }
    t = setTimeout(() => runSearch(q), 300);
  });
  input.addEventListener('focus', () => { if (drop.innerHTML) drop.classList.remove('hidden'); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; clearBtn.classList.add('hidden'); close(); input.blur(); }
  });
  clearBtn.addEventListener('click', () => {
    input.value = ''; clearBtn.classList.add('hidden'); close(); input.focus();
  });
  // Keep focus while the user taps a result (so blur can't eat the tap).
  drop.addEventListener('mousedown', (e) => e.preventDefault());

  async function runSearch(q) {
    try {
      const [d, w] = await Promise.all([
        api.get('/api/search?q=' + encodeURIComponent(q) + '&type=all'),
        // Web results are best-effort: a failure just means no web group.
        fetch('/api/search/web?q=' + encodeURIComponent(q))
          .then(r => (r.ok ? r.json() : { results: [] })).catch(() => ({ results: [] })),
      ]);
      if (input.value.trim() !== q) return; // stale — user already typed more
      renderDrop(d, q, (w && w.results) || []);
    } catch { close(); }
  }

  function renderDrop(d, q, web) {
    const users = d.users || [], posts = d.posts || [], tags = d.hashtags || [], videos = d.videos || [];
    if (!users.length && !posts.length && !tags.length && !videos.length && !web.length) {
      drop.innerHTML = `<div class="gempty">No results for “${esc(q)}”</div>`;
    } else {
      let h = '';
      if (users.length) h += `<div class="ghead">People</div>` + users.slice(0, 4).map(u =>
        `<a class="grow" href="#/profile/${esc(u.username)}">${av(u, 'xs')}
          <span class="gmain"><b>${esc(u.display_name)}</b><span class="gsub">@${esc(u.username)}</span></span></a>`).join('');
      if (posts.length) h += `<div class="ghead">Waves</div>` + posts.slice(0, 4).map(p =>
        `<a class="grow" href="#/post/${p.id}">
          <span class="gmain"><span class="gtext">${esc((p.text || '').slice(0, 90) || 'Wave')}</span>
          <span class="gsub">@${esc(p.author?.username || '')} · ${timeAgo(p.created_at)}</span></span></a>`).join('');
      if (tags.length) h += `<div class="ghead">Tags</div>` + tags.slice(0, 4).map(x => {
        const tag = String(x.tag || x).replace('#', '');
        return `<a class="grow" href="#/tag/${esc(tag)}">
          <span class="gmain"><b>#${esc(tag)}</b><span class="gsub">${x.posts_count != null ? x.posts_count + ' waves' : ''}</span></span></a>`;
      }).join('');
      if (videos.length) h += `<div class="ghead">Videos</div>` + videos.slice(0, 4).map(v => {
        const plat = v.platform === 'youtube' ? 'YouTube' : v.platform === 'instagram' ? 'Instagram' : 'TikTok';
        return `<a class="grow" href="#/videos?v=${v.id}"><span class="gplay">▶</span>
          <span class="gmain"><span class="gtext">${esc(v.title || plat + ' video')}</span>
          <span class="gsub">${plat} · @${esc(v.user?.username || '')}</span></span></a>`;
      }).join('');
      if (web.length) h += `<div class="ghead">🌐 From the web</div>` + web.slice(0, 3).map(r =>
        `<a class="grow" href="${esc(r.url)}" target="_blank" rel="noopener">
          <span class="gmain"><span class="gtext">${esc(r.title)}</span>
          <span class="gsub">${esc((r.snippet || '').slice(0, 90))}${r.source ? ' · ' + esc(r.source) : ''}</span></span></a>`).join('');
      h += `<a class="grow gmore" href="#/explore?q=${encodeURIComponent(q)}">See all results in Explore →</a>`;
      drop.innerHTML = h;
    }
    drop.classList.remove('hidden');
  }
}
