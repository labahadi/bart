'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase, getSafeSpots, type SafeSpot } from '@/lib/supabase';
import { OFFER_SELECT, friendlyError, type Offer } from '@/lib/trade';
import { Icon } from '@/components/Icon';
import { Loading, PushHeader } from '@/components/ui';

const TZ = 'America/New_York';
// Daytime only. 6 PM is listed but off: in Philadelphia it's dark by then for much of the school year.
const SLOTS = [
  { h: 10, label: '10 AM' }, { h: 12, label: '12 PM' }, { h: 14, label: '2 PM' },
  { h: 16, label: '4 PM' }, { h: 18, label: 'After dark', off: true },
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
  const [spots, setSpots] = useState<SafeSpot[]>([]);
  const [dayIdx, setDayIdx] = useState(0);
  const [hour, setHour] = useState<number | null>(null);
  const [spot, setSpot] = useState<string | null>(null);
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

  if (!offer) return <Loading />;

  const day = days[dayIdx];
  const slotTime = (h: number) => nyInstant(day.y, day.m, day.d, h);
  const isPast = (h: number) => slotTime(h).getTime() < Date.now() + 30 * 60 * 1000;
  const spotName = spots.find((s) => s.id === spot)?.short_name;
  const slotLabel = SLOTS.find((s) => s.h === hour)?.label;

  async function save() {
    if (hour === null || !spot) return;
    setBusy(true); setError('');
    const { error } = await supabase.rpc('set_meetup', { p_offer: id, p_spot: spot, p_at: slotTime(hour).toISOString() });
    setBusy(false);
    if (error) setError(friendlyError(error));
    else {
      // Drop a note in the chat so the other person sees the change
      await supabase.from('messages').insert({ offer_id: id, body: `Meetup set: ${day.wd} ${day.m}/${day.d}, ${slotLabel} at ${spots.find((s) => s.id === spot)?.name}` });
      router.replace(`/trades/${id}`);
    }
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
          <p className="label">Safe Spot</p>
          <div className="stack" style={{ gap: 10 }}>
            {spots.map((s) => (
              <button key={s.id} className={`check-row ${spot === s.id ? 'on' : ''}`} style={{ minHeight: 50 }}
                onClick={() => setSpot(s.id)} role="radio" aria-checked={spot === s.id}>
                <span className="radio" />
                <span className="row-title grow">{s.name}</span>
                <span className="meta">{s.walk_min} min</span>
              </button>
            ))}
          </div>
        </div>

        {error && <div className="alert"><Icon name="warning" size={18} />{error}</div>}
      </main>
      <div className="action-bar">
        <button className="btn pink" disabled={hour === null || !spot || busy} onClick={save}>
          {hour === null ? 'Pick a time' : `${day.wd} ${slotLabel} · ${spotName}`}
        </button>
      </div>
    </>
  );
}
