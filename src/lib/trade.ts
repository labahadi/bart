// Product rules shared across screens

export type Tier = 'S' | 'M' | 'L' | 'Skill';
export type Category = 'textbooks' | 'dorm' | 'clothes' | 'tickets' | 'skills';

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'textbooks', label: 'Textbooks' },
  { id: 'dorm', label: 'Dorm' },
  { id: 'clothes', label: 'Clothes' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'skills', label: 'Skills' },
];

export const categoryLabel = (c: Category) => CATEGORIES.find((x) => x.id === c)?.label ?? c;

export const CATEGORY_ICON = {
  textbooks: 'book', dorm: 'lamp', clothes: 'shirt', tickets: 'ticket', skills: 'code',
} as const;

export const CATEGORY_TINT: Record<Category, string> = {
  textbooks: 'tint-pink', dorm: 'tint-blue', clothes: 'tint-green', tickets: 'tint-blue', skills: 'tint-pink',
};

export const SWEETENERS = ['Coffee on me', 'Help moving it', 'Class notes'] as const;

// Fairness meter: S = 1, M = 2, L = 3 (Skill counts as M), each sweetener = 0.5.
// Compared with the item you're asking for: within half a point = Balanced.
export const TIER_POINTS: Record<Tier, number> = { S: 1, M: 2, L: 3, Skill: 2 };

export function fairness(target: Tier, offered: Tier[], sweeteners: number) {
  const goal = TIER_POINTS[target];
  const total = offered.reduce((sum, t) => sum + TIER_POINTS[t], 0) + sweeteners * 0.5;
  const label = total < goal - 0.5 ? 'A bit light' : total > goal + 0.5 ? 'Generous' : 'Balanced';
  const color = label === 'A bit light' ? 'var(--warn)' : label === 'Generous' ? 'var(--pink)' : 'var(--blue)';
  return { total, label, color, fill: Math.min(1, total / (goal * 2)) };
}

export type Profile = { id: string; first_name: string | null; last_initial: string | null };
export const displayName = (p?: Profile | null) =>
  p ? `${p.first_name ?? 'Student'}${p.last_initial ? ` ${p.last_initial}.` : ''}` : 'Student';
export const initial = (p?: Profile | null) => (p?.first_name?.[0] ?? '?').toUpperCase();

export type Listing = {
  id: string; owner_id: string; title: string; description: string | null; category: Category;
  tier: Tier; condition: string | null; wants: string | null; photo_paths: string[];
  status: 'active' | 'in_trade' | 'traded' | 'removed'; created_at: string;
};

export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'completed';
export type Offer = {
  id: string; listing_id: string; from_user: string; to_user: string; sweeteners: string[];
  suggested_spot: string | null; status: OfferStatus; meet_spot: string | null; meet_at: string | null;
  from_confirmed: boolean; to_confirmed: boolean; created_at: string;
  awaiting: string | null; counter_count: number; countered_by: string | null;
  listing: Pick<Listing, 'id' | 'title' | 'tier' | 'category'> | null;
  from: Profile | null; to: Profile | null;
  items: { listing: Pick<Listing, 'id' | 'title' | 'tier'> | null }[];
};

// One query shape for offers, used by the inbox and the chat
export const OFFER_SELECT = `*,
  listing:listings!offers_listing_id_fkey(id,title,tier,category),
  from:profiles!offers_from_user_fkey(id,first_name,last_initial),
  to:profiles!offers_to_user_fkey(id,first_name,last_initial),
  items:offer_items(listing:listings(id,title,tier))`;

// Whose turn it is to answer a pending offer (starts with the owner; a counter passes it back)
export const turnOf = (o: Offer) => o.awaiting ?? o.to_user;

export function offerGives(o: Offer) {
  const things = o.items.map((i) => i.listing?.title).filter(Boolean) as string[];
  return [...things, ...o.sweeteners.map((s) => s.toLowerCase())].join(' + ');
}

// Turn Postgres error text into something a student should read
export function friendlyError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/Database error saving new user|upenn\.edu/i.test(msg)) return "Use your upenn.edu email so we know you're a student.";
  if (/row-level security/i.test(msg)) return "You don't have permission to do that.";
  // Supabase: "For security purposes, you can only request this after 42 seconds."
  const wait = msg.match(/after (\d+) seconds?/i);
  if (wait) return `Your last code is still good. You can ask for a new one in ${wait[1]} seconds.`;
  if (/email rate limit/i.test(msg)) return "We've sent a lot of codes this hour. Use the last code we sent, or try again in a few minutes.";
  if (/rate limit|too many/i.test(msg)) return 'Lots of tries in a row. Give it a minute, then try again.';
  if (/expired|invalid|otp/i.test(msg)) return `That code didn't work. Check it, or send a new one. (${msg})`;
  return msg.replace(/^ERROR:\s*/, '');
}
