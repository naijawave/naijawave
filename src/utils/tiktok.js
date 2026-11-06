// Resolve TikTok short links (vm.tiktok.com / vt.tiktok.com) to full video URLs
// so they embed as players. Best-effort: on any failure the text is
// returned unchanged and the short link still works as a normal link.
const SHORT_RE = /https?:\/\/(?:vm|vt)\.tiktok\.com\/[A-Za-z0-9_-]+\/?|https?:\/\/(?:www\.)?tiktok\.com\/t\/[A-Za-z0-9]+\/?/g;
const FULL_RE = /tiktok\.com\/@[\w.-]+\/video\/(\d+)/;

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  Accept: 'text/html',
};

// Follow one short link to its final URL (or return null on any failure).
async function resolveShortLink(link) {
  try {
    const res = await fetch(link, {
      redirect: 'follow',
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(4000),
    });
    const finalUrl = (res.url || '').split('?')[0];
    return FULL_RE.test(finalUrl) ? finalUrl : null;
  } catch {
    return null;
  }
}

async function resolveTikTokLinks(text) {
  const input = String(text || '');
  const links = [...new Set(input.match(SHORT_RE) || [])];
  if (!links.length) return input;
  let out = input;
  for (const link of links) {
    const finalUrl = await resolveShortLink(link);
    if (finalUrl) out = out.split(link).join(finalUrl);
  }
  return out;
}

// Extract the numeric TikTok video ID from a full URL
// (tiktok.com/@user/video/ID) or a short link (vm/vt.tiktok.com, tiktok.com/t/…),
// resolving short links first. Returns the ID string, or null if none found.
async function extractTikTokId(url) {
  const input = String(url || '').trim();
  if (!input) return null;
  const full = input.match(FULL_RE);
  if (full) return full[1];
  const short = input.match(SHORT_RE);
  if (short) {
    const finalUrl = await resolveShortLink(short[0]);
    if (finalUrl) {
      const m = finalUrl.match(FULL_RE);
      if (m) return m[1];
    }
  }
  return null;
}

module.exports = { resolveTikTokLinks, extractTikTokId };
