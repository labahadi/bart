'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { OFFER_SELECT, type Offer } from '@/lib/trade';
import { Icon } from '@/components/Icon';
import { Loading, PushHeader } from '@/components/ui';

const TZ = 'America/New_York';
// Meetups start between 10 AM and 8 PM
const SLOTS: { h: number; label: string; off?: boolean }[] = [
  { h: 10, label: '10 AM' }, { h: 12, label: '12 PM' }, { h: 14, label: '2 PM' },
  { h: 16, label: '4 PM' }, { h: 18, label: '6 PM' }, { h: 20, label: '8 PM' },
];

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
  const [dayIdx, setDayIdx] = useState(0);
  const [hour, setHour] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ placeId: string; name: string; detail: string }[]>([]);
  const [picked, setPicked] = useState<{ placeId: string; name: string; detail: string } | null>(null);
  const [walkMin, setWalkMin] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  // One Google search session per place picked (keeps searches cheap)
  const newSession = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const [session, setSession] = useState(newSession);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Today plus the next 6 days, Philadelphia time
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => nyParts(new Date(Date.now() + i * 86400000))), []);

  useEffect(() => {
    supabase.from('offers').select(OFFER_SELECT).eq('id', id).single()
      .then(({ data }) => setOffer(data as unknown as Offer));
  }, [id]);

  // Search Google Maps as they type (only places on campus come back)
  useEffect(() => {
    if (picked || query.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch(`/api/places?q=${encodeURIComponent(query.trim())}&session=${session}`, {
        headers: { authorization: `Bearer ${sess.session?.access_token ?? ''}` },
      }).catch(() => null);
      const json = res ? await res.json().catch(() => ({})) : {};
      if (!res?.ok) { setError(json.error ?? "Couldn't search places."); return; }
      setError(''); setResults(json.results ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [query, picked, session]);

  if (!offer) return <Loading />;

  const day = days[dayIdx];
  const slotTime = (h: number) => nyInstant(day.y, day.m, day.d, h);
  const isPast = (h: number) => slotTime(h).getTime() < Date.now() + 30 * 60 * 1000;
  const slotLabel = SLOTS.find((s) => s.h === hour)?.label;

  async function api(body: Record<string, unknown>) {
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch('/api/meetup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${sess.session?.access_token ?? ''}` },
      body: JSON.stringify({ offerId: id, session, ...body }),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    return { ok: !!res?.ok, json };
  }

  // Picking a result: the server checks it's on campus and works out the walk
  async function pick(p: { placeId: string; name: string; detail: string }) {
    setPicked(p); setResults([]); setWalkMin(null); setChecking(true); setError('');
    const { ok, json } = await api({ placeId: p.placeId, name: p.name, check: true });
    setChecking(false);
    if (!ok) { setError(json.error ?? "Couldn't check that place."); setPicked(null); return; }
    setWalkMin(json.walkMin ?? null);
  }

  function clearPick() {
    setPicked(null); setWalkMin(null); setQuery(''); setSession(newSession());
  }

  async function save() {
    if (hour === null || !picked) return;
    setBusy(true); setError('');
    const { ok, json } = await api({ placeId: picked.placeId, name: picked.name, at: slotTime(hour).toISOString() });
    setBusy(false);
    if (!ok) { setError(json.error ?? "Couldn't save that place. Try again."); return; }
    // Drop a note in the chat so the other person sees the change
    await supabase.from('messages').insert({ offer_id: id, body: `Meetup set: ${day.wd} ${day.m}/${day.d}, ${slotLabel} at ${json.name}` });
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
              const disabled = isPast(s.h);
              const on = hour === s.h;
              return (
                <button key={s.h} disabled={disabled} onClick={() => setHour(s.h)}
                  style={{ height: 46, borderRadius: 12, fontSize: 14, fontWeight: 600,
                    background: on ? 'var(--blue)' : disabled ? 'var(--border-soft)' : 'var(--surface)',
                    color: on ? '#fff' : disabled ? 'var(--muted)' : 'var(--ink)',
                    border: on ? 'none' : '1px solid var(--border)' }}>
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="label">Where</p>
          {!picked ? (
            <div className="stack" style={{ gap: 6 }}>
              <input className="input" placeholder="Search a place or address on campus" maxLength={80}
                value={query} onChange={(e) => setQuery(e.target.value)} />
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
          ) : (
            <div className="card spread" style={{ gap: 8 }}>
              <span className="stack" style={{ gap: 4 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{picked.name}</span>
                <span className="meta">{checking ? 'Checking…' : walkMin != null ? `${walkMin} min walk` : picked.detail}</span>
              </span>
              <button className="text-btn" style={{ padding: 0 }} onClick={clearPick}>Change</button>
            </div>
          )}
        </div>

        {error && <div className="alert"><Icon name="warning" size={18} />{error}</div>}
      </main>
      <div className="action-bar">
        <button className="btn pink" disabled={hour === null || !picked || checking || busy} onClick={save}>
          {busy ? 'Saving…' : hour === null ? 'Pick a time' : !picked ? 'Pick a place' : `${day.wd} ${slotLabel} · ${picked.name}`}
        </button>
      </div>
    </>
  );
}
