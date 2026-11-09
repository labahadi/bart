'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { OFFER_SELECT, type Offer } from '@/lib/trade';
import { Icon } from '@/components/Icon';
import { Loading, PushHeader } from '@/components/ui';
import { useAuth } from '@/components/AuthProvider';
import { clock, hhmm, nyInstant, nyParts } from '@/lib/time';
import { clash, freeTimes, linkCalendar, linkResult, type FreeTimes } from '@/lib/calendar';

// "16:15" -> "4:15 PM"
function label12(t: string) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export default function Meetup() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const { me } = useAuth();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [dayIdx, setDayIdx] = useState(0);
  const [time, setTime] = useState(''); // "HH:MM", 24-hour
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
  const [cal, setCal] = useState<FreeTimes | null>(null);
  const [calNote] = useState(() => linkResult(search.get('calendar')));

  // Today plus the next 6 days, Philadelphia time
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => nyParts(new Date(Date.now() + i * 86400000))), []);

  useEffect(() => {
    supabase.from('offers').select(OFFER_SELECT).eq('id', id).single()
      .then(({ data }) => setOffer(data as unknown as Offer));
  }, [id]);

  // Free times for the chosen day (only if someone linked a calendar)
  useEffect(() => {
    const d = days[dayIdx];
    const date = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    let live = true;
    setCal(null);
    freeTimes(id, date).then((t) => { if (live) setCal(t); });
    return () => { live = false; };
  }, [id, dayIdx, days]);

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
  const at = time ? nyInstant(day.y, day.m, day.d, +time.slice(0, 2), +time.slice(3, 5)) : null;
  // Any minute from 7:30 AM to 8:00 PM, and not already over (a few minutes of slack, so "now" works)
  const timeProblem = !at ? '' : time < '07:30' || time > '20:00' ? 'Meetups are between 7:30 AM and 8 PM.'
    : at.getTime() < Date.now() - 5 * 60 * 1000 ? 'That time already passed.' : '';
  const timeOk = !!at && !timeProblem;
  const otherName = (offer.from_user === me?.id ? offer.to : offer.from)?.first_name ?? 'They';
  const conflict = at && timeOk ? clash(at, cal, otherName) : null;
  const anyLinked = !!cal && (cal.me.linked || cal.them.linked);
  const freeLabel = cal?.me.linked && cal.them.linked ? 'Free for both of you' : cal?.me.linked ? "You're free" : `${otherName} is free`;
  const timeLabel = time ? label12(time) : '';

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
    if (!timeOk || !at || !picked) return;
    setBusy(true); setError('');
    const { ok, json } = await api({ placeId: picked.placeId, name: picked.name, at: at.toISOString() });
    setBusy(false);
    if (!ok) { setError(json.error ?? "Couldn't save that place. Try again."); return; }
    // Drop a note in the chat so the other person sees the change
    await supabase.from('messages').insert({ offer_id: id, body: `Meetup proposed: ${day.wd} ${day.m}/${day.d}, ${timeLabel} at ${json.name}` });
    router.replace(`/trades/${id}`);
  }

  return (
    <>
      <main className="screen no-nav">
        <PushHeader title="Propose a meetup" back={`/trades/${id}`} />

        <div>
          <p className="label">Day</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
            {days.map((d, i) => (
              <button key={i} onClick={() => setDayIdx(i)}
                style={{ height: 64, borderRadius: 12, border: dayIdx === i ? 'none' : '1px solid var(--border)', background: dayIdx === i ? 'var(--ink)' : 'var(--surface)', color: dayIdx === i ? '#fff' : 'var(--ink)', padding: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{d.wd}</div>
                <div style={{ fontFamily: 'var(--display)', fontSize: 20, fontWeight: 700 }}>{d.d}</div>
              </button>
            ))}
          </div>
        </div>

        {calNote && (
          <div className={calNote.ok ? 'toast' : 'alert'}>
            {!calNote.ok && <Icon name="warning" size={18} />}{calNote.text}
          </div>
        )}

        {anyLinked ? (
          <div>
            <p className="label">{freeLabel}</p>
            {cal!.free.length === 0 ? (
              <p className="meta" style={{ margin: 0 }}>No open time this day. Try another day.</p>
            ) : (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {cal!.free.map((w) => (
                  <button key={w.start} className="pill" onClick={() => setTime(hhmm(w.start))}
                    style={{ height: 36, padding: '0 12px', fontSize: 13, fontWeight: 600, background: 'var(--lime)', color: 'var(--ink)', border: 'none' }}>
                    {clock(w.start)} – {clock(w.until ?? w.end)}
                  </button>
                ))}
              </div>
            )}
            {!cal!.me.linked && !cal!.off && (
              <button className="text-btn" style={{ padding: 0, marginTop: 8 }}
                onClick={async () => setError(await linkCalendar(`/trades/${id}/meetup`))}>Link your Google Calendar too</button>
            )}
          </div>
        ) : cal && !cal.off && (
          <button className="text-btn" style={{ padding: 0, alignSelf: 'flex-start' }}
            onClick={async () => setError(await linkCalendar(`/trades/${id}/meetup`))}>
            <Icon name="calendar" size={16} /> Link your Google Calendar to see free times
          </button>
        )}

        <div>
          <label className="label" htmlFor="time" style={{ display: 'block' }}>Time</label>
          <input id="time" type="time" className={`input ${timeProblem ? 'invalid' : ''}`} min="07:30" max="20:00"
            value={time} onChange={(e) => setTime(e.target.value)} style={{ height: 52, fontSize: 17 }} />
          <p className={timeProblem ? 'error-text' : 'meta'} style={{ marginTop: 6, ...(conflict && !timeProblem ? { color: 'var(--warn)', fontWeight: 600 } : {}) }}>{timeProblem || conflict || 'Any time from 7:30 AM to 8 PM'}</p>
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
        <button className="btn pink" disabled={!timeOk || !picked || checking || busy} onClick={save}>
          {busy ? 'Sending…' : !timeOk ? 'Pick a time' : !picked ? 'Pick a place' : `Propose ${day.wd} ${timeLabel} · ${picked.name}`}
        </button>
      </div>
    </>
  );
}
