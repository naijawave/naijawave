// Naija Pulse: map hashtags -> categories using keyword rules.
// Trending counts always come from real DB activity (last 48h).
const CATEGORIES = [
  'Entertainment', 'Music', 'Football', 'Celebrity gist',
  'Politics & public affairs', 'Tech', 'Business', 'Lifestyle', 'Memes', 'General',
];

const RULES = [
  ['Music', ['music', 'afrobeats', 'afrobeat', 'song', 'album', 'wizkid', 'davido', 'burnaboy', 'rema', 'asake', 'ayrastarr', 'odumodublvck', 'spotify', 'audiomack', 'concert', 'tour', 'ep', 'single', 'video', 'freestyle']],
  ['Football', ['football', 'soccer', 'premierleague', 'epl', 'championsleague', 'ucl', 'arsenal', 'chelsea', 'manutd', 'mancity', 'liverpool', 'barcelona', 'realmadrid', 'supereagles', 'npfl', 'osimhen', 'lookman', 'worldcup', 'afcon']],
  ['Celebrity gist', ['gist', 'celebrity', 'gossip', 'nollywood', 'bbnaija', 'realitytv']],
  ['Politics & public affairs', ['politics', 'nigeria', 'lagos', 'abuja', 'election', 'inec', 'senate', 'governor', 'president', 'policy', 'protest', 'economy']],
  ['Tech', ['tech', 'startup', 'ai', 'fintech', 'crypto', 'coding', 'developer', 'app', 'gadget', 'iphone', 'android']],
  ['Business', ['business', 'money', 'hustle', 'entrepreneur', 'market', 'naira', 'investment', 'forex', 'job', 'career']],
  ['Lifestyle', ['lifestyle', 'fashion', 'food', 'travel', 'fitness', 'health', 'wedding', 'relationship', 'ootd']],
  ['Memes', ['meme', 'memes', 'funny', 'lol', 'comedy', 'skit', 'joke']],
  ['Entertainment', ['entertainment', 'movie', 'film', 'series', 'netflix', 'show', 'party', 'event']],
];

function categorize(tag) {
  const t = tag.toLowerCase();
  for (const [cat, keys] of RULES) {
    if (keys.some(k => t.includes(k))) return cat;
  }
  return 'General';
}

module.exports = { CATEGORIES, categorize };
