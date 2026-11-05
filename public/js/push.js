/* Naija Wave — Web Push (call alerts): service worker + subscription.
   The phone buzzes when someone calls even with the app closed, as long as
   alerts are turned on here. On iPhone this needs Naija Wave added to the
   Home Screen first (iOS only delivers web alerts to installed apps). */
import { api, auth } from './api.js';
import { toast } from './ui.js';

let swReg = null;
let vapidKey = null;

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    swReg = await navigator.serviceWorker.register('/sw.js');
    return swReg;
  } catch { return null; }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) out[i] = rawData.charCodeAt(i);
  return out;
}

async function getVapidKey() {
  if (vapidKey) return vapidKey;
  const d = await api.get('/api/push/vapid-public-key');
  vapidKey = d.publicKey;
  return vapidKey;
}

export async function isPushEnabled() {
  if (!pushSupported()) return false;
  try {
    const reg = swReg || await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch { return false; }
}

// Turn call alerts on. Call from a tap — browsers only allow the
// notification prompt after a user gesture.
export async function enableCallAlerts() {
  if (!pushSupported()) { toast('Push alerts are not supported on this browser.', 'err'); return false; }
  if (!auth.loggedIn()) { toast('Log in first.', 'err'); return false; }
  try {
    if (!swReg) swReg = await registerSW();
    if (!swReg) { toast('Could not start the app worker.', 'err'); return false; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      toast('Allow notifications to get call alerts. On iPhone, add Naija Wave to your Home Screen first.', 'err');
      return false;
    }
    const key = await getVapidKey();
    const sub = await swReg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
    await api.post('/api/push/subscribe', { subscription: sub.toJSON() });
    toast('Call alerts on — your phone will buzz when someone calls, even with the app closed.', 'ok');
    return true;
  } catch (e) {
    toast('Could not turn on call alerts.', 'err');
    return false;
  }
}

export async function disableCallAlerts() {
  try {
    const reg = swReg || await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    } else {
      await api.post('/api/push/unsubscribe', {}).catch(() => {});
    }
    toast('Call alerts off.', 'ok');
    return true;
  } catch {
    toast('Could not turn off call alerts.', 'err');
    return false;
  }
}

// After login: if alerts were already allowed, quietly (re)subscribe so
// they keep working. Never shows a permission prompt.
export async function ensurePushSubscribed() {
  if (!pushSupported() || !auth.loggedIn()) return false;
  if (Notification.permission !== 'granted') return false;
  try {
    if (!swReg) swReg = await registerSW();
    if (!swReg) return false;
    const existing = await swReg.pushManager.getSubscription();
    if (existing) {
      await api.post('/api/push/subscribe', { subscription: existing.toJSON() }).catch(() => {});
      return true;
    }
    const key = await getVapidKey();
    const sub = await swReg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
    await api.post('/api/push/subscribe', { subscription: sub.toJSON() });
    return true;
  } catch { return false; }
}
