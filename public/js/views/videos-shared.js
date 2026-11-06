/* Naija Wave — shared video cards (TikTok / Instagram / YouTube).
   One videoCard() used by the home feed AND the Videos page, so they render
   identically. Videos play MUTED automatically once scrolled into view and
   stop when scrolled away (IntersectionObserver, lazy iframe src, only one
   playing at a time). Instagram has no autoplay-capable video iframe, so it
   renders the official Instagram embed instead — it plays when the user taps
   it. Every card has an "Open in ..." button to the original app. */
import { av, esc, tick, timeAgo } from '../ui.js';

export const PLATFORM_LABEL = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube' };
const PLATFORM_ICON = { tiktok: '🎵', instagram: '📸', youtube: '▶️' };

function playerSrc(platform, id, muted) {
  const m = muted ? 1 : 0;
  if (platform === 'youtube') return `https://www.youtube.com/embed/${esc(id)}?autoplay=1&mute=${m}&playsinline=1&rel=0`;
  return `https://www.tiktok.com/player/v1/${esc(id)}?autoplay=1&mute=${m}&playsinline=1`;
}

function placeholderHTML(v) {
  const label = PLATFORM_LABEL[v.platform] || 'Video';
  return `<div class="video-ph"><span class="video-ph-icon">${PLATFORM_ICON[v.platform] || '▶️'}</span><span>${label} video</span><span class="small muted">Scrolls into view to play</span></div>`;
}

function playerHTML(v) {
  if (v.platform === 'instagram') {
    return `<div class="video-player" data-platform="instagram" data-videoid="${esc(v.video_id)}" data-url="${esc(v.url)}">${placeholderHTML(v)}</div>`;
  }
  const ratio = v.platform === 'youtube' ? '16/9' : '9/16';
  return `<div class="video-player" data-platform="${esc(v.platform)}" data-videoid="${esc(v.video_id)}" data-url="${esc(v.url)}" data-muted="1" style="aspect-ratio:${ratio}">${placeholderHTML(v)}<button class="video-mute hidden" aria-label="Unmute">🔇</button></div>`;
}

export function videoCard(v, me) {
  const u = v.user || {};
  const canDelete = me && (me.id === u.id || ['admin', 'founder'].includes(me.role));
  const label = PLATFORM_LABEL[v.platform] || 'Video';
  return `<article class="post video-card" data-video="${v.id}" style="display:block">
    <div style="display:flex;align-items:center;gap:10px">
      <a href="#/profile/${esc(u.username)}">${av(u)}</a>
      <div style="flex:1;min-width:0">
        <a class="pname" href="#/profile/${esc(u.username)}">${esc(u.display_name)} ${tick(u.verification)}</a>
        <span class="pmeta">@${esc(u.username)} · ${timeAgo(v.created_at)}</span>
      </div>
      <span class="video-badge">${PLATFORM_ICON[v.platform] || '▶️'} ${label}</span>
      ${canDelete ? `<button class="linklike small" data-del="${v.id}" style="color:var(--red)">Delete</button>` : ''}
    </div>
    ${v.title ? `<div class="ptext">${esc(v.title)}</div>` : ''}
    ${playerHTML(v)}
    <a class="btn block video-open" href="${esc(v.url)}" target="_blank" rel="noopener">Open in ${label} ↗</a>
  </article>`;
}

/* ---------- Scroll autoplay (muted, one at a time) ---------- */
let io = null;
let active = null;
let muteWired = false;
let visWired = false;

function ensureObserver() {
  if (io) return io;
  io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting && en.intersectionRatio >= 0.3) activate(en.target);
      else if (!en.isIntersecting) deactivate(en.target);
    });
  }, { threshold: [0, 0.3, 0.6] });
  return io;
}

export function bindVideoPlayers(root) {
  const obs = ensureObserver();
  (root || document).querySelectorAll('.video-player:not([data-bound])').forEach((el) => {
    el.dataset.bound = '1';
    obs.observe(el);
  });
  initMuteToggle();
  initVisibilityStop();
}

export function unbindVideoPlayers() {
  if (io) { io.disconnect(); io = null; }
  if (active) { deactivate(active); active = null; }
}

function activate(el) {
  if (active && active !== el) deactivate(active);
  active = el;
  const platform = el.dataset.platform;
  if (platform === 'instagram') { loadInstagram(el); return; }
  let frame = el.querySelector('iframe');
  if (!frame) {
    frame = document.createElement('iframe');
    frame.setAttribute('frameborder', '0');
    frame.setAttribute('allow', 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture');
    frame.setAttribute('allowfullscreen', '');
    frame.title = platform === 'youtube' ? 'YouTube video' : 'TikTok video';
    el.appendChild(frame);
    el.querySelector('.video-ph')?.remove();
  }
  const muted = el.dataset.muted !== '0';
  const src = playerSrc(platform, el.dataset.videoid, muted);
  if (frame.getAttribute('src') !== src) frame.src = src;
  el.querySelector('.video-mute')?.classList.remove('hidden');
}

function deactivate(el) {
  if (active === el) active = null;
  // Instagram embeds don't autoplay with sound — leave them as they are.
  if (el.dataset.platform === 'instagram') return;
  const frame = el.querySelector('iframe');
  if (frame) frame.remove();
  if (!el.querySelector('.video-ph')) {
    const ph = document.createElement('div');
    ph.className = 'video-ph';
    ph.innerHTML = `<span class="video-ph-icon">${PLATFORM_ICON[el.dataset.platform] || '▶️'}</span><span>${PLATFORM_LABEL[el.dataset.platform] || 'Video'} video</span><span class="small muted">Scrolls into view to play</span>`;
    el.prepend(ph);
  }
  el.querySelector('.video-mute')?.classList.add('hidden');
}

/* Tap the speaker to unmute (a tap is a user gesture, so browsers allow
   sound after it). Tap again to mute. TikTok/YouTube only. */
function initMuteToggle() {
  if (muteWired) return;
  muteWired = true;
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.video-mute');
    if (!btn) return;
    const player = btn.closest('.video-player');
    const frame = player?.querySelector('iframe');
    if (!player || !frame) return;
    const nowMuted = player.dataset.muted !== '0';
    player.dataset.muted = nowMuted ? '0' : '1';
    btn.textContent = nowMuted ? '🔊' : '🔇';
    btn.setAttribute('aria-label', nowMuted ? 'Mute' : 'Unmute');
    frame.src = playerSrc(player.dataset.platform, player.dataset.videoid, !nowMuted);
  });
}

/* Stop playback when the tab/app is hidden (saves battery). */
function initVisibilityStop() {
  if (visWired) return;
  visWired = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && active) deactivate(active);
  });
}

/* ---------- Instagram official embed (no autoplay possible) ---------- */
function loadInstagram(el) {
  if (el.dataset.igLoaded) return;
  el.dataset.igLoaded = '1';
  const url = el.dataset.url;
  const bq = document.createElement('blockquote');
  bq.className = 'instagram-media';
  bq.setAttribute('data-instgrm-permalink', url);
  bq.setAttribute('data-instgrm-version', '14');
  bq.innerHTML = `<a href="${esc(url)}" target="_blank" rel="noopener">View on Instagram</a>`;
  el.querySelector('.video-ph')?.remove();
  el.appendChild(bq);
  ensureIgScript(() => {
    try { window.instgrm?.Embeds?.process(); } catch { /* embed.js will handle it */ }
  });
}

function ensureIgScript(cb) {
  if (window.instgrm?.Embeds) { cb(); return; }
  const existing = document.querySelector('script[data-ig-embed]');
  if (existing) { existing.addEventListener('load', cb); return; }
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.instagram.com/embed.js';
  s.dataset.igEmbed = '1';
  s.onload = cb;
  document.head.appendChild(s);
}
