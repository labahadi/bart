'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase, getSafeSpots, type SafeSpot } from '@/lib/supabase';
import { OFFER_SELECT, friendlyError, type Offer } from '@/lib/trade';
import { Icon } from '@/components/Icon';
import { Loading, PushHeader } from '@/components/ui';

const TZ = 'America/New_York';
// Meetups start between 10 AM and 8 PM
const SLOTS: { h: number; label: string; off?: boolean }[] = [
  { h: 10, label: '10 AM' }, { h: 12, label: '12 PM' }, { h: 14, label: '2 PM' },
  { h: 16, label: '4 PM' }, { h: 18, label: '6 PM' }, { h: 20, label: '8 PM' },
];
const CUSTOM = 'custom';

// Philadelphia calendar date parts for a Date
function nyParts(d: Date) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(d).reduce<Record<string, string>>((a, x) => ({ ...a, [x.type]: x.value }), {});
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, wd: p.weekday };
}

// The instant that is `hour`:00 Philadelphia time on the given date (handles daylight saving)
function nyInstant(y: number, m: number, d: number, hour: number) {
  let t = Date.UTC(y, m - 1, d, hour + 5);
  for (let i = 0; i < 2; i++) {
    const p = nyParts(new Date(t));
    const diff = (Date.UTC(p.y, p.m - 1, p.d, p.h) - Date.UTC(y, m - 1, d, hour)) / 3600000;
    t -= diff * 3600000;
  }
  return new Date(t);
}

export default function Meetup() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [spots, setSpots] = useState<SafeSpot[]>([]);
  const [dayIdx, setDayIdx] = useState(0);
  const [hour, setHour] = useState<number | null>(null);
  const [spot, setSpot] = useState<string | null>(null);
  const [custom, setCustom] = useState('');              // what they've typed
  const [results, setResults] = useState<{ placeId: string; name: string; detail: string }[]>([]);
  const [picked, setPicked] = useState<{ placeId: string; name: string; detail: string } | null>(null);
  const [info, setInfo] = useState<{ walkMin: number | null; pickup: boolean; address: string } | null>(null);
  const [checking, setChecking] = useState(false);
  // One Google search session per place picked (keeps searches cheap)
  const [session, setSession] = useState(() => Math.random().toString(36).slice(2) + Date.now().toString(36));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Today plus the next 6 days, Philadelphia time
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => nyParts(new Date(Date.now() + i * 86400000))), []);

  useEffect(() => {
    (async () => {
      const [{ data }, s] = await Promise.all([
        supabase.from('offers').select(OFFER_SELECT).eq('id', id).single(),
        getSafeSpots(),
      ]);
      const o = data as unknown as Offer;
      setOffer(o); setSpots(s);
      setSpot(o?.meet_spot ?? o?.suggested_spot ?? s[0]?.id ?? null);
    })();
  }, [id]);

  // Search Google Maps as they type (only places on campus come back)
  useEffect(() => {
    if (spot !== CUSTOM || picked || custom.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch(`/api/places?q=${encodeURIComponent(custom.trim())}&session=${session}`, {
        headers: { authorization: `Bearer ${sess.session?.access_token ?? ''}` },
      }).catch(() => null);
      const json = res ? await res.json().catch(() => ({})) : {};
      if (!res?.ok) { setError(json.error ?? "Couldn't search places."); return; }
      setError(''); setResults(json.results ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [custom, spot, picked, session]);

  async function pick(p: { placeId: string; name: string; detail: string }) {
    setPicked(p); setResults([]); setInfo(null); setChecking(true); setError('');
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch('/api/meetup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${sess.session?.access_token ?? ''}` },
      body: JSON.stringify({ offerId: id, placeId: p.placeId, name: p.name, session, check: true }),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setChecking(false);
    if (!res?.ok) { setError(json.error ?? "Couldn't check that place."); setPicked(null); return; }
    setInfo({ walkMin: json.walkMin, pickup: json.pickup, address: json.address });
  }

  function clearPick() {
    setPicked(null); setInfo(null); setCustom('');
    setSession(Math.random().toString(36).slice(2) + Date.now().toString(36));
  }

  if (!offer) return <Loading />;

  const day = days[dayIdx];
  const slotTime = (h: number) => nyInstant(day.y, day.m, day.d, h);
  const isPast = (h: number) => slotTime(h).getTime() < Date.now() + 30 * 60 * 1000;
  const spotName = spot === CUSTOM ? picked?.name : spots.find((s) => s.id === spot)?.short_name;
  const slotLabel = SLOTS.find((s) => s.h === hour)?.label;

  async function save() {
    if (hour === null || !spot) return;
    setBusy(true); setError('');
    const at = slotTime(hour).toISOString();
    let placeName = spots.find((s) => s.id === spot)?.name ?? '';
    if (spot === CUSTOM) {
      if (!picked) { setBusy(false); return; }
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch('/api/meetup', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${sess.session?.access_token ?? ''}` },
        body: JSON.stringify({ offerId: id, placeId: picked.placeId, name: picked.name, session, at }),
      }).catch(() => null);
      const json = res ? await res.json().catch(() => ({})) : {};
      if (!res?.ok) { setBusy(false); setError(json.error ?? "Couldn't save that place. Try again."); return; }
      placeName = json.pickup ? `${json.name} (pickup)` : json.name;
    } else {
      const { error } = await supabase.rpc('set_meetup', { p_offer: id, p_spot: spot, p_at: at });
      if (error) { setBusy(false); setError(friendlyError(error)); return; }
    }
    setBusy(false);
    // Drop a note in the chat so the other person sees the change
    await supabase.from('messages').insert({ offer_id: id, body: `Meetup set: ${day.wd} ${day.m}/${day.d}, ${slotLabel} at ${placeName}` });
    router.replace(`/trades/${id}`);
  }

  return (
    <>
      <main className="screen no-nav">
        <PushHeader title="Meetup" back={`/trades/${id}`} />

        <div>
          <p className="label">Day</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
            {days.map((d, i) => (
              <button key={i} onClick={() => { setDayIdx(i); setHour(null); }}
                style={{ height: 64, borderRadius: 12, border: dayIdx === i ? 'none' : '1px solid var(--border)', background: dayIdx === i ? 'var(--ink)' : 'var(--surface)', color: dayIdx === i ? '#fff' : 'var(--ink)', padding: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{d.wd}</div>
                <div style={{ fontFamily: 'var(--display)', fontSize: 20, fontWeight: 700 }}>{d.d}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="label">Time</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {SLOTS.map((s) => {
              const disabled = s.off || isPast(s.h);
              const on = hour === s.h;
              return (
                <button key={s.h} disabled={disabled} onClick={() => setHour(s.h)}
                  style={{ height: 46, borderRadius: 12, fontSize: s.off ? 11 : 14, fontWeight: 600,
                    background: on ? 'var(--blue)' : disabled ? 'var(--border-soft)' : 'var(--surface)',
                    color: on ? '#fff' : disabled ? 'var(--muted)' : 'var(--ink)',
                    border: on ? 'none' : s.off ? '1px dashed var(--dashed)' : '1px solid var(--border)' }}>
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="label">Where</p>
          <div className="stack" style={{ gap: 10 }}>
            {spots.map((s) => (
              <button key={s.id} className={`check-row ${spot === s.id ? 'on' : ''}`} style={{ minHeight: 50 }}
                onClick={() => setSpot(s.id)} role="radio" aria-checked={spot === s.id}>
                <span className="radio" />
                <span className="row-title grow">{s.name}</span>
              </button>
            ))}
            <button className={`check-row ${spot === CUSTOM ? 'on' : ''}`} style={{ minHeight: 50 }}
              onClick={() => setSpot(CUSTOM)} role="radio" aria-checked={spot === CUSTOM}>
              <span className="radio" />
              <span className="row-title grow">Somewhere else on campus</span>
            </button>
            {spot === CUSTOM && !picked && (
              <div className="stack" style={{ gap: 6 }}>
                <input className="input" autoFocus placeholder="Search a place or address on campus" maxLength={80}
                  value={custom} onChange={(e) => setCustom(e.target.value)} />
                {results.map((r) => (
                  <button key={r.placeId} onClick={() => pick(r)} className="check-row" style={{ minHeight: 48, border: '1px solid var(--border-soft)' }}>
                    <span style={{ color: 'var(--muted)', display: 'inline-flex' }}><Icon name="pin" size={18} /></span>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="row-title" style={{ display: 'block' }}>{r.name}</span>
                      <span className="row-sub" style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.detail}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {spot === CUSTOM && picked && (
              <div className="card stack" style={{ gap: 6 }}>
                <div className="spread">
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{picked.name}</span>
                  <button className="text-btn" style={{ padding: 0 }} onClick={clearPick}>Change</button>
                </div>
                {checking && <span className="meta">Checking…</span>}
                {info && (
                  <span className="row" style={{ gap: 8 }}>
                    {info.walkMin != null && <span className="pill soft">{info.walkMin} min walk</span>}
                    {info.pickup && <span className="pill pink-tint">Pickup</span>}
                  </span>
                )}
                {info?.pickup && (
                  <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Meet at the door or in the lobby. Bring a friend if you can.</span>
                )}
              </div>
            )}
          </div>
        </div>

        {error && <div className="alert"><Icon name="warning" size={18} />{error}</div>}
      </main>
      <div className="action-bar">
        <button className="btn pink" disabled={hour === null || !spot || (spot === CUSTOM && (!picked || !info)) || busy} onClick={save}>
          {busy ? 'Saving…' : hour === null ? 'Pick a time' : spot === CUSTOM && !picked ? 'Pick a place' : `${day.wd} ${slotLabel}${spotName ? ` · ${spotName}` : ''}`}
        </button>
      </div>
    </>
  );
}
