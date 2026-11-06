// Video links (TikTok / Instagram / YouTube): detect the platform and extract
// the platform's video ID from a URL, and build the canonical URL to open it in
// the original app. Videos are links/embeds only — no uploads.
const { extractTikTokId, resolveTikTokLinks } = require('./tiktok');

const PLATFORMS = ['tiktok', 'instagram', 'youtube'];
const PLATFORM_LABEL = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube' };

// ---------- YouTube ----------
// youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID,
// youtube.com/embed/ID, youtube.com/live/ID, music.youtube.com/watch?v=ID
const YT_ID = /[A-Za-z0-9_-]{11}/;
function extractYouTubeId(url) {
  const input = String(url || '').trim();
  if (!input) return null;
  let u;
  try { u = new URL(input.startsWith('http') ? input : 'https://' + input); }
  catch { return null; }
  const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
  if (host === 'youtu.be') {
    const id = u.pathname.split('/').filter(Boolean)[0] || '';
    return YT_ID.test(id) && id.length === 11 ? id : null;
  }
  if (host === 'youtube.com' || host === 'music.youtube.com' || host.endsWith('.youtube.com')) {
    const v = u.searchParams.get('v');
    if (v && YT_ID.test(v) && v.length === 11) return v;
    const parts = u.pathname.split('/').filter(Boolean);
    if ((parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') && parts[1]) {
      const id = parts[1];
      return YT_ID.test(id) && id.length === 11 ? id : null;
    }
  }
  return null;
}

// ---------- Instagram ----------
// instagram.com/p/SHORTCODE, /reel/SHORTCODE, /reels/ — shortcode is the ID.
// Returns { code, kind } where kind is 'p' or 'reel'.
const IG_RE = /instagram\.com\/(p|reel|reels)\/([A-Za-z0-9_-]+)/;
function extractInstagramId(url) {
  const input = String(url || '').trim();
  if (!input) return null;
  const m = input.match(IG_RE);
  if (!m) return null;
  return { code: m[2], kind: m[1] === 'p' ? 'p' : 'reel' };
}

// ---------- Detect any supported video link ----------
// Returns { platform, video_id, canonical } or null when the URL is not a
// supported video link. TikTok short links are resolved first.
async function detectVideo(url) {
  const input = String(url || '').trim();
  if (!input) return null;
  // TikTok (full URL or short link, resolved first).
  const tikId = await extractTikTokId(input);
  if (tikId) {
    const resolved = await resolveTikTokLinks(input).catch(() => input);
    const canonical = String(resolved || input).split('?')[0].slice(0, 500);
    return { platform: 'tiktok', video_id: tikId, canonical };
  }
  // YouTube.
  const ytId = extractYouTubeId(input);
  if (ytId) {
    return { platform: 'youtube', video_id: ytId, canonical: `https://www.youtube.com/watch?v=${ytId}` };
  }
  // Instagram.
  const ig = extractInstagramId(input);
  if (ig) {
    return { platform: 'instagram', video_id: ig.code, canonical: `https://www.instagram.com/${ig.kind}/${ig.code}/` };
  }
  return null;
}

module.exports = { PLATFORMS, PLATFORM_LABEL, extractYouTubeId, extractInstagramId, detectVideo };
