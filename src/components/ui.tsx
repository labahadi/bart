'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Icon } from './Icon';
import { Badge, useNotifications } from './Notifications';
import { photoUrl } from '@/lib/supabase';
import { CATEGORY_ICON, CATEGORY_TINT, type Listing, type Profile, initial } from '@/lib/trade';

// The brand-kit logo (horizontal, color). Drawn as shapes, so no font is needed.
export function Logo({ height = 30 }: { height?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/bart-logo-horizontal-color.svg" alt="bart" style={{ height, width: 'auto' }} />;
}

export function BottomNav() {
  const path = usePathname();
  const { counts } = useNotifications();
  const item = (href: string, icon: 'home' | 'people' | 'chat' | 'person', label: string, badge = 0) => {
    const on = href === '/' ? path === '/' : path.startsWith(href);
    return (
      <Link href={href} className={on ? 'on' : ''}>
        <span style={{ position: 'relative', display: 'inline-flex' }}><Icon name={icon} size={22} /><Badge n={badge} /></span>
        {label}
      </Link>
    );
  };
  return (
    <nav className="nav" aria-label="Main">
      {item('/', 'home', 'Home')}
      {item('/campus', 'people', 'Campus', counts.campus)}
      <Link href="/post" aria-label="Post an item">
        <span className="plus"><Icon name="plus" size={24} stroke={2.4} /></span>
      </Link>
      {item('/trades', 'chat', 'Chats', counts.trades)}
      {item('/me', 'person', 'Me', counts.me)}
    </nav>
  );
}

export function PushHeader({ title, back, right }: {
  title: string; back?: string; right?: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <div className="push-header">
      <button className="icon-btn" aria-label="Back" onClick={() => (back ? router.push(back) : router.back())}>
        <Icon name="back" size={20} stroke={2.2} />
      </button>
      <h1 className="title-push grow">{title}</h1>
      {right}
    </div>
  );
}

const AVATAR_TINTS = ['var(--pink-tint)', 'var(--green-tint)', 'var(--blue-tint)'];
export function Avatar({ profile, size = 40, solid }: { profile?: Profile | null; size?: number; solid?: 'blue' | 'pink' }) {
  // Stable tint per person
  const n = (profile?.id ?? '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const style: React.CSSProperties = solid
    ? { background: `var(--${solid})`, color: '#fff' }
    : { background: AVATAR_TINTS[n % 3], color: 'var(--ink)' };
  return (
    <span className="avatar" style={{ ...style, width: size, height: size, fontSize: size * 0.4 }}>
      {initial(profile)}
    </span>
  );
}

export function ItemImage({ listing, iconSize = 38 }: { listing: Pick<Listing, 'category' | 'photo_paths'>; iconSize?: number }) {
  if (listing.photo_paths?.length) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photoUrl(listing.photo_paths[0])} alt="" loading="lazy" />;
  }
  return <Icon name={CATEGORY_ICON[listing.category]} size={iconSize} stroke={1.6} />;
}

export function ItemThumb({ item, size = 48, radius = 12 }: {
  item: Pick<Listing, 'category' | 'photo_paths'> | null; size?: number; radius?: number;
}) {
  const cat = item?.category ?? 'dorm';
  return (
    <span className={CATEGORY_TINT[cat]} style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {item?.photo_paths?.length
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={photoUrl(item.photo_paths[0])} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <Icon name={CATEGORY_ICON[cat]} size={Math.round(size * 0.5)} stroke={1.6} />}
    </span>
  );
}

export function ListingCard({ listing, mine }: { listing: Listing; mine?: boolean }) {
  return (
    <Link href={`/item/${listing.id}`} className="listing-card">
      <div className={`img ${CATEGORY_TINT[listing.category]}`}>
        <ItemImage listing={listing} />
        <span className="tier">{listing.tier}</span>
        {mine && <span className="corner pill ink" style={{ fontSize: 11 }}>Yours</span>}
      </div>
      <div className="bd">
        <div className="t">{listing.title}</div>
        {listing.wants && <div className="meta">Wants: {listing.wants}</div>}
        <div className="meta-blue">✓ Verified</div>
      </div>
    </Link>
  );
}

export function Loading() {
  return <div className="center-screen"><div className="spinner" /></div>;
}
