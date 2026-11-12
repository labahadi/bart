// Phone/browser push notifications, from the app's side.
import { supabase } from '@/lib/supabase';

const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

export type PushState = 'on' | 'off' | 'blocked' | 'unsupported' | 'install' | 'not-setup';

const isIOS = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

function keyBytes(base64: string) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

// Where this device stands right now
export async function pushState(): Promise<PushState> {
  if (!KEY) return 'not-setup';
  // iPhones only allow push for apps added to the Home Screen
  if (isIOS() && !standalone()) return 'install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

// Turn on for this device. Returns '' or a short reason it didn't work.
export async function enablePush(): Promise<string> {
  const state = await pushState();
  if (state === 'install') return 'Add bart to your Home Screen first: Share → Add to Home Screen.';
  if (state === 'unsupported') return "This browser can't get notifications.";
  if (state === 'not-setup') return "Notifications aren't set up yet.";
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'Notifications are blocked. Allow them for bart in your settings.';
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(KEY) });
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { error } = await supabase.rpc('save_push_subscription', { p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth });
  return error ? "Couldn't turn on notifications. Try again." : '';
}

// Turn off for this device
export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe().catch(() => {});
  }
}
