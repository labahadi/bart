// Adding something to your closet in the middle of a trade:
// the trade sends you to /post?back=<trade screen>, and posting sends you back with ?added=<new item>.

// Only our own pages, never another site
export function safeBack(path: string | null): string | null {
  return path && path.startsWith('/') && !path.startsWith('//') ? path : null;
}

// The link to the closet form from a trade screen, remembering what was already picked
export function addToClosetHref(here: string, picked: string[]) {
  const back = picked.length ? `${here}?picked=${picked.join(',')}` : here;
  return `/post?back=${encodeURIComponent(back)}`;
}

export function withParam(path: string, key: string, value: string) {
  return `${path}${path.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;
}

// Back on the trade screen: what was picked before, plus the item just added (then tidy the URL)
export function takeReturnedPicks(): string[] | null {
  const q = new URLSearchParams(window.location.search);
  if (!q.has('picked') && !q.has('added')) return null;
  const ids = [...(q.get('picked') ?? '').split(','), q.get('added') ?? ''].filter(Boolean);
  window.history.replaceState(null, '', window.location.pathname);
  return Array.from(new Set(ids));
}
