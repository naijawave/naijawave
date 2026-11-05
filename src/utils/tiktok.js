// Resolve TikTok short links (vm.tiktok.com / vt.tiktok.com) to full video URLs
// so they embed as players. Best-effort: on any failure the text is
// returned unchanged and the short link still works as a normal link.
const SHORT_RE = /https?:\/\/(?:vm|vt)\.tiktok\.com\/[A-Za-z0-9_-]+\/?/g;
const FULL_RE = /tiktok\.com\/@[\w.-]+\/video\/(\d+)/;

async function resolveTikTokLinks(text) {
  const input = String(text || '');
  const links = [...new Set(input.match(SHORT_RE) || [])];
  if (!links.length) return input;
  let out = input;
  for (const link of links) {
    try {
      const res = await fetch(link, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          Accept: 'text/html',
        },
        signal: AbortSignal.timeout(4000),
      });
      const finalUrl = (res.url || '').split('?')[0];
      if (FULL_RE.test(finalUrl)) {
        out = out.split(link).join(finalUrl);
      }
    } catch {
      // leave the short link as-is
    }
  }
  return out;
}

module.exports = { resolveTikTokLinks };
