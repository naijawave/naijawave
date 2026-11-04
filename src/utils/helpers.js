// Shared helpers: validation, serialization, hashtags, notifications
const crypto = require('crypto');

const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9]{7,15}$/;

function normalizeContact(contact, type) {
  contact = String(contact || '').trim();
  if (type === 'email') return contact.toLowerCase();
  // normalize phone: strip spaces/dashes; keep leading +
  let p = contact.replace(/[\s\-()]/g, '');
  if (/^0\d{10}$/.test(p)) p = '+234' + p.slice(1); // Nigerian convenience
  return p;
}

function validContact(contact, type) {
  if (type === 'email') return EMAIL_RE.test(contact);
  return PHONE_RE.test(contact);
}

function ageFromDob(dob) {
  const d = new Date(dob);
  if (isNaN(d)) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, display_name: u.display_name,
    avatar_url: u.avatar_url || null, cover_url: u.cover_url || null,
    bio: u.bio || '', location: u.location || '', website: u.website || '',
    verification: u.verification || 'none', is_founder: !!u.is_founder,
    role: u.role, status: u.status, created_at: u.created_at,
  };
}

function maskContact(contact, type) {
  if (!contact) return null;
  if (type === 'email') {
    const [a, b] = contact.split('@');
    return (a.slice(0, 2) + '•••@' + b);
  }
  return contact.slice(0, 4) + ' ••• ' + contact.slice(-2);
}

function extractHashtags(text) {
  const tags = new Set();
  const re = /#([\p{L}\p{N}_]{2,40})/gu;
  let m;
  while ((m = re.exec(text || ''))) tags.add(m[1].toLowerCase());
  return [...tags].slice(0, 10);
}

function extractMentions(text) {
  const names = new Set();
  const re = /@([a-z0-9_.]{3,20})/gi;
  let m;
  while ((m = re.exec(text || ''))) names.add(m[1].toLowerCase());
  return [...names].slice(0, 10);
}

function linkify(text) { return text; } // client-side rendering concern

function prefsOf(u) {
  try { return JSON.parse(u.prefs || '{}'); } catch { return {}; }
}

function newOtpCode() {
  return String(crypto.randomInt(100000, 999999));
}

function escLike(s) { return String(s).replace(/[%_\\]/g, c => '\\' + c); }

module.exports = {
  USERNAME_RE, normalizeContact, validContact, ageFromDob,
  publicUser, maskContact, extractHashtags, extractMentions,
  prefsOf, newOtpCode, escLike,
};
