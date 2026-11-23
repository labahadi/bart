'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Icon } from './Icon';
import { Badge, useNotifications } from './Notifications';
import { photoUrl } from '@/lib/supabase';
import { CATEGORY_ICON, artColors, artColorsFor, type Category, type Listing, type Profile, initial } from '@/lib/trade';
import { SoftIcon, type SoftIconName } from './SoftIcon';
import { useSaved } from '@/lib/saves';

// The brand-kit logo (horizontal, color). Drawn as shapes, so no font is needed.
export function Logo({ height = 30 }: { height?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/bart-logo-horizontal-color.svg" alt="bart" style={{ height, width: 'auto' }} />;
}

// Home, Find, Wanted, Campus, Chats. Your profile and "Add to your closet" live on Home now.
// The bar lives in the app shell (AuthProvider), so it stays put between tabs and the black
// pill slides to the tab you tap instead of the whole bar redrawing.
const TAB_PATHS = ['/', '/find', '/wanted', '/campus', '/trades'];

export function BottomNav() {
  const path = usePathname();
  const { counts, unread } = useNotifications();
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number; animate: boolean; key: string } | null>(null);
  const show = TAB_PATHS.includes(path);

  // Measure the open tab (to the fraction of a pixel) and put the pill exactly behind it.
  // On a tab change the pill pops up from the tab's own center, so it's centered the whole time.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) { setPill(null); return; }
    const place = () => {
      const on = nav.querySelector<HTMLElement>('a.on');
      if (!on) return;
      const x = on.getBoundingClientRect().left - nav.getBoundingClientRect().left - nav.clientLeft;
      const w = on.getBoundingClientRect().width;
      setPill((p) => ({ x, w, animate: p !== null && p.key !== path ? true : (p?.animate ?? false), key: path }));
    };
    place();
    // Re-measure when the font finishes loading or the window changes size
    const ro = new ResizeObserver(place);
    ro.observe(nav);
    nav.querySelectorAll('a').forEach((a) => ro.observe(a, { box: 'border-box' }));
    return () => ro.disconnect();
  }, [path, show]);

  if (!show) return null;
  // Answers to your "Looking for" posts are campus notifications of kind 'iso'; they badge Wanted instead
  const wanted = unread.filter((n) => n.kind === 'iso').length;
  const item = (href: string, icon: SoftIconName, label: string, badge = 0) => {
    const on = href === '/' ? path === '/' : path.startsWith(href);
    return (
      <Link href={href} className={on ? 'on' : ''} aria-label={label} aria-current={on ? 'page' : undefined}>
        <span style={{ position: 'relative', display: 'inline-flex' }}><SoftIcon name={icon} size={23} detail={on ? 'var(--navy)' : 'var(--surface)'} /><Badge n={on ? 0 : badge} /></span>
        <span className="nav-label">{label}</span>
      </Link>
    );
  };
  return (
    <nav className="nav" aria-label="Main" ref={navRef}>
      {pill && (
        <span key={pill.key} className={`nav-pill${pill.animate ? ' animate' : ''}`} aria-hidden="true"
          style={{ left: pill.x, width: pill.w }} />
      )}
      {item('/', 'home', 'Home')}
      {item('/find', 'search', 'Find')}
      {item('/wanted', 'megaphone', 'Wanted', wanted)}
      {item('/campus', 'people', 'Campus', Math.max(0, counts.campus - wanted))}
      {item('/trades', 'chat', 'Chats', counts.trades)}
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
// A profile photo when there is one (photo = profiles.avatar_path), otherwise the first initial
export function Avatar({ profile, size = 40, solid, photo }: {
  profile?: Profile | null; size?: number; solid?: 'blue' | 'pink'; photo?: string | null;
}) {
  // Anyone's profile photo shows wherever their profile was loaded with avatar_path
  photo = photo ?? profile?.avatar_path;
  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photoUrl(photo)} alt="" className="avatar" style={{ width: size, height: size, objectFit: 'cover' }} />;
  }
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

// Items without a photo show their category's picture: a soft card with a big circle in the
// top-right corner and the picture in the opposite color (see artColors in lib/trade).
const ART_HEX = { blue: 'var(--blue)', pink: 'var(--pink)' } as const;
export function ItemArt({ category, colors, size = 54, corner = true }: {
  category: Category; colors?: readonly [string, string]; size?: number; corner?: boolean;
}) {
  const [card, fg] = colors ?? artColorsFor(category);
  return (
    <>
      {corner && <span className={`art-corner art-corner-${card}`} aria-hidden="true" />}
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <SoftIcon name={CATEGORY_ICON[category]} size={size} color={ART_HEX[fg as 'blue' | 'pink']} detail={`var(--${card}-tint)`} />
      </span>
    </>
  );
}

export function ItemImage({ listing, colors, iconSize = 54 }: {
  listing: Pick<Listing, 'category' | 'photo_paths'>; colors?: readonly [string, string]; iconSize?: number;
}) {
  if (listing.photo_paths?.length) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photoUrl(listing.photo_paths[0])} alt="" loading="lazy" />;
  }
  return <ItemArt category={listing.category} colors={colors} size={iconSize} />;
}

export function ItemThumb({ item, size = 48, radius = 12 }: {
  item: Pick<Listing, 'category' | 'photo_paths'> | null; size?: number; radius?: number;
}) {
  const cat = item?.category ?? 'dorm';
  return (
    <span className={`tint-${artColorsFor(cat)[0]}`} style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      {item?.photo_paths?.length
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={photoUrl(item.photo_paths[0])} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <ItemArt category={cat} size={Math.round(size * 0.55)} corner={size >= 64} />}
    </span>
  );
}

// position = the card's spot in its grid, so no-photo cards alternate colors and neighbors never match
export function ListingCard({ listing, mine, position = 0 }: { listing: Listing; mine?: boolean; position?: number }) {
  const { ids, toggle } = useSaved();
  const colors = artColors(position);
  const photo = !!listing.photo_paths?.length;
  const saved = ids.has(listing.id);
  return (
    <Link href={`/item/${listing.id}`} className="listing-card">
      <div className={`img ${photo ? '' : `tint-${colors[0]}`}`}>
        <ItemImage listing={listing} colors={colors} />
        <span className="tier">{listing.tier}</span>
        {mine
          ? <span className="corner pill ink" style={{ fontSize: 11 }}>Yours</span>
          : (
            <button className={`card-heart${saved ? ' on' : ''}`} aria-label={saved ? 'Unsave item' : 'Save item'} aria-pressed={saved}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(listing.id); }}>
              <Icon name="heart" size={15} fill={saved ? 'currentColor' : 'none'} stroke={2.2} />
            </button>
          )}
      </div>
      <div className="bd">
        <div className="t">{listing.title}</div>
        {listing.wants && <div className="meta">For {listing.wants}</div>}
      </div>
    </Link>
  );
}

export function Loading() {
  return <div className="center-screen"><div className="spinner" /></div>;
}

// Tap a person's name or photo to see their profile (closet, rating, trades)
export function ProfileLink({ id, children, style }: { id?: string | null; children: React.ReactNode; style?: React.CSSProperties }) {
  if (!id) return <>{children}</>;
  return (
    <Link href={`/u/${id}`} onClick={(e) => e.stopPropagation()} style={{ color: 'inherit', ...style }}>
      {children}
    </Link>
  );
}
