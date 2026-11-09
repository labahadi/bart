'use client';

// What a friend sees when you share your meetup: the plan (always the latest),
// where it is, and a quick look at what bart is. No account needed.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { directionsUrl } from '@/lib/campus';
import { Icon } from '@/components/Icon';
import { Loading, Logo } from '@/components/ui';

type Shared = {
  first_name: string; meet_at: string; place: string; address: string;
  lat: number | null; lng: number | null; confirmed: boolean; gives: string | null; gets: string | null;
};


export default function SharedMeetup() {
  const { token } = useParams<{ token: string }>();
  const [plan, setPlan] = useState<Shared | null | undefined>(undefined);

  useEffect(() => {
    supabase.rpc('shared_meetup', { p_token: token }).then(({ data }) => setPlan((data as Shared[] | null)?.[0] ?? null));
  }, [token]);

  if (plan === undefined) return <Loading />;

  const when = plan && new Date(plan.meet_at);
  const day = when?.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric' });
  const time = when?.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

  return (
    <main style={{ padding: '32px 20px 40px', display: 'flex', flexDirection: 'column', gap: 16, minHeight: '100dvh' }}>
      <Logo height={30} />

      {!plan ? (
        <h1 className="display" style={{ fontSize: 26, marginTop: 12 }}>This link has expired</h1>
      ) : (
        <>
          <h1 className="display" style={{ fontSize: 30, lineHeight: 1.08, marginTop: 12 }}>
            {plan.first_name} is meeting someone from <span style={{ color: 'var(--pink)' }}>bart</span>
          </h1>

          <div style={{ background: 'var(--ink)', color: '#fff', borderRadius: 18, padding: 18 }} className="stack">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <span style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--lime)', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="pin" size={20} />
              </span>
              <div className="grow stack" style={{ gap: 4 }}>
                <span style={{ fontSize: 17, fontWeight: 700 }}>{day}, {time}</span>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{plan.place}</span>
                {plan.address && plan.address !== plan.place && <span style={{ fontSize: 13, color: 'var(--dark-sub)' }}>{plan.address}</span>}
                <span style={{ fontSize: 12, fontWeight: 600, color: plan.confirmed ? 'var(--lime)' : 'var(--pink-bright)', marginTop: 2 }}>
                  {plan.confirmed ? 'Confirmed' : 'Not confirmed yet'}
                </span>
              </div>
            </div>
            <a href={directionsUrl({ name: plan.address || plan.place, lat: plan.lat, lng: plan.lng })} target="_blank" rel="noreferrer"
              className="btn" style={{ background: 'var(--lime)', color: 'var(--ink)' }}>
              Open in Maps
            </a>
          </div>

          {plan.gives && plan.gets && (
            <div className="card row" style={{ gap: 10, fontSize: 14 }}>
              <span style={{ color: 'var(--pink)', display: 'inline-flex' }}><Icon name="swap" size={18} /></span>
              <span>Trading <b>{plan.gives}</b> for <b>{plan.gets}</b></span>
            </div>
          )}

        </>
      )}

      <div className="stack" style={{ gap: 10, marginTop: 'auto', paddingTop: 24, borderTop: '1px solid var(--border-soft)' }}>
        <span className="display" style={{ fontSize: 22 }}>Broke? So is everyone else.</span>
        <Link href="/login" className="btn pink" style={{ marginTop: 4 }}>Join with your Penn email</Link>
      </div>
    </main>
  );
}
