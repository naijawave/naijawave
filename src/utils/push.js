// Web Push (call alerts): VAPID keys + sending.
// VAPID keys are generated once on first boot and stored in the `settings`
// table, so nobody has to paste keys into a dashboard. The public key is
// served via /api/config for the browser to subscribe with.
const webpush = require('web-push');
const db = require('../db');

const VAPID_SUBJECT = 'https://naijawave.onrender.com';
let vapidReady = null;

async function getVapidKeys() {
  if (vapidReady) return vapidReady;
  vapidReady = (async () => {
    const pub = await db.get("SELECT value FROM settings WHERE key = 'vapid_public_key'");
    const priv = await db.get("SELECT value FROM settings WHERE key = 'vapid_private_key'");
    if (pub && priv) return { publicKey: pub.value, privateKey: priv.value };
    const keys = webpush.generateVAPIDKeys();
    await db.run("INSERT INTO settings (key, value) VALUES ('vapid_public_key', $1) ON CONFLICT (key) DO NOTHING", keys.publicKey);
    await db.run("INSERT INTO settings (key, value) VALUES ('vapid_private_key', $1) ON CONFLICT (key) DO NOTHING", keys.privateKey);
    return keys;
  })();
  return vapidReady;
}

async function initPush() {
  try {
    const keys = await getVapidKeys();
    webpush.setVapidDetails(VAPID_SUBJECT, keys.publicKey, keys.privateKey);
    console.log('[push] VAPID ready');
    return keys;
  } catch (e) {
    console.error('[push] VAPID init failed:', e.message);
    return null;
  }
}

async function getVapidPublicKey() {
  const keys = await getVapidKeys();
  return keys.publicKey;
}

// Send a push notification to every device a user has enabled alerts on.
// Payload is a small JSON object { title, body, url, tag }.
// Failures for a single device (e.g. expired subscription) remove that row.
async function sendPushToUser(userId, payload) {
  try {
    await initPush();
    const subs = await db.all('SELECT * FROM push_subscriptions WHERE user_id = $1', userId);
    if (!subs.length) return 0;
    let sent = 0;
    for (const s of subs) {
      const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 60 });
        sent++;
      } catch (e) {
        // 404/410 = subscription gone (app uninstalled / permission revoked)
        if (e.statusCode === 404 || e.statusCode === 410) {
          await db.run('DELETE FROM push_subscriptions WHERE id = $1', s.id).catch(() => {});
        }
      }
    }
    return sent;
  } catch (e) {
    console.error('[push] send failed:', e.message);
    return 0;
  }
}

module.exports = { initPush, getVapidPublicKey, sendPushToUser };
