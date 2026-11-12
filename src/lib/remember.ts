// "Keep me signed in". Supabase keeps people signed in by default; if they untick it,
// we sign them out the next time the browser (or the Home Screen app) is reopened.
// A cookie with no expiry date disappears when the browser closes, which is the signal.
const FLAG = 'bart-remember';
const ALIVE = 'bart-alive';

export function rememberSignIn(remember: boolean) {
  try {
    localStorage.setItem(FLAG, remember ? '1' : '0');
    if (!remember) document.cookie = `${ALIVE}=1; path=/; SameSite=Lax`;
  } catch {}
}

// True when this visit should start signed out (they chose not to stay signed in, and the browser was closed since)
export function shouldForgetSession() {
  try {
    if (localStorage.getItem(FLAG) !== '0') return false;
    return !document.cookie.split('; ').some((c) => c.startsWith(`${ALIVE}=`));
  } catch { return false; }
}

export function clearRemember() {
  try { localStorage.removeItem(FLAG); document.cookie = `${ALIVE}=; path=/; max-age=0`; } catch {}
}
