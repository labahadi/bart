'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { blockedAnywhere } from '@/lib/banned';
import { uploadAvatar } from '@/lib/photos';
import { classYears, friendlyError, HOUSE_RULES } from '@/lib/trade';
import { linkCalendar, linkResult, myCalendar, unlinkCalendar } from '@/lib/calendar';
import { disablePush, enablePush, pushState, type PushState } from '@/lib/push';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/Icon';
import { Avatar, PushHeader } from '@/components/ui';

// Settings: opened from the gear on Home (and "Edit profile" on your profile)
export default function Settings() {
  const { me, session, refresh } = useAuth();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoNote, setPhotoNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [first, setFirst] = useState('');
  const [lastInitial, setLastInitial] = useState('');
  const [nameNote, setNameNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [nameBusy, setNameBusy] = useState(false);
  const [calendar, setCalendar] = useState<{ account_email: string } | null | undefined>(undefined);
  const [calBusy, setCalBusy] = useState(false);
  const [calNote, setCalNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [reviewer, setReviewer] = useState(false);
  const [yearBusy, setYearBusy] = useState(false);
  const [yearError, setYearError] = useState('');
  const [showRules, setShowRules] = useState(false);
  const [open, setOpen] = useState<'name' | 'year' | null>(null);
  const [push, setPush] = useState<PushState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushNote, setPushNote] = useState('');
  const [quiet, setQuiet] = useState<boolean | null>(null);
  const [blockedCount, setBlockedCount] = useState<number | null>(null);

  useEffect(() => {
    if (!me) return;
    setFirst(me.first_name ?? '');
    setLastInitial(me.last_initial ?? '');
  }, [me]);

  // Coming back from Google: say how it went, then tidy the address bar
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('calendar');
    if (code) { setCalNote(linkResult(code)); window.history.replaceState(null, '', '/settings'); }
    myCalendar().then(setCalendar);
    supabase.rpc('is_reviewer').then(({ data }) => setReviewer(data === true));
    pushState().then(setPush).catch(() => setPush('unsupported'));
    supabase.rpc('my_blocks').then(({ data }) => setBlockedCount(data ? (data as unknown[]).length : 0));
  }, []);

  useEffect(() => {
    if (!me) return;
    supabase.from('profiles').select('quiet_hours').eq('id', me.id).maybeSingle()
      .then(({ data }) => setQuiet((data as { quiet_hours?: boolean } | null)?.quiet_hours ?? true));
  }, [me]);

  if (!me) return null;

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoBusy(true); setPhotoNote(null);
    try {
      await uploadAvatar(file);
      await refresh();
      setPhotoNote({ ok: true, text: 'Photo updated.' });
    } catch (err) {
      setPhotoNote({ ok: false, text: (err as Error).message });
    }
    setPhotoBusy(false);
  }

  async function removePhoto() {
    setPhotoBusy(true); setPhotoNote(null);
    const { error } = await supabase.from('profiles').update({ avatar_path: null }).eq('id', me!.id);
    if (error) setPhotoNote({ ok: false, text: friendlyError(error) }); else await refresh();
    setPhotoBusy(false);
  }

  const nameChanged = first.trim() !== (me.first_name ?? '') || lastInitial.trim().toUpperCase() !== (me.last_initial ?? '');
  const nameOk = first.trim().length >= 1 && !/\s/.test(first.trim()) && /^[a-z]$/i.test(lastInitial.trim()) && !blockedAnywhere(first);

  async function saveName() {
    setNameBusy(true); setNameNote(null);
    const { error } = await supabase.from('profiles')
      .update({ first_name: first.trim(), last_initial: lastInitial.trim().toUpperCase() }).eq('id', me!.id);
    setNameBusy(false);
    if (error) { setNameNote({ ok: false, text: friendlyError(error) }); return; }
    await refresh();
    setNameNote(null); setOpen(null);
  }

  // Tap a year to set it; tap it again to clear it
  async function saveYear(y: string) {
    const next = me!.class_year === y ? null : y;
    setYearBusy(true); setYearError('');
    const { error } = await supabase.from('profiles').update({ class_year: next }).eq('id', me!.id);
    setYearBusy(false);
    if (error) setYearError(friendlyError(error)); else await refresh();
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  async function togglePush() {
    setPushBusy(true); setPushNote('');
    if (push === 'on') { await disablePush(); setPush('off'); }
    else {
      const err = await enablePush();
      if (err) setPushNote(err);
      setPush(await pushState().catch(() => 'unsupported' as PushState));
    }
    setPushBusy(false);
  }

  async function toggleQuiet() {
    const next = !(quiet ?? true);
    setQuiet(next);
    const { error } = await supabase.from('profiles').update({ quiet_hours: next }).eq('id', me!.id);
    if (error) setQuiet(!next);
  }

  const section = (title: string) => <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: 'var(--muted)', marginBottom: -6 }}>{title}</div>;
  const divider = <div style={{ borderTop: '1px solid var(--border-soft)' }} />;
  const rowStyle: React.CSSProperties = { minHeight: 52, background: 'none', border: 'none', padding: 0, width: '100%', fontSize: 15, fontWeight: 600, color: 'var(--ink)' };
  const value = (text: string) => <span className="row" style={{ gap: 6, fontSize: 15, fontWeight: 400, color: 'var(--text-2, var(--muted))' }}>{text}<Icon name="chevron" size={14} /></span>;
  const toggle = (on: boolean, onClick: () => void, label: string, disabled?: boolean) => (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick}
      style={{ width: 52, height: 32, borderRadius: 999, border: 'none', padding: 3, flexShrink: 0, background: on ? 'var(--blue)' : 'var(--border)', transition: 'background .2s', opacity: disabled ? 0.6 : 1 }}>
      <span style={{ display: 'block', width: 26, height: 26, borderRadius: 999, background: '#fff', transform: on ? 'translateX(20px)' : 'none', transition: 'transform .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
    </button>
  );
  const year = me.class_year ? (me.class_year === 'Grad' ? 'Grad' : `\u2019${me.class_year.slice(2)}`) : 'Add';

  return (
    <main className="screen no-nav">
      <PushHeader title="Settings" back="/" />

      {section('PROFILE')}
      <div className="card stack" style={{ gap: 0, padding: '4px 16px' }}>
        <div className="row" style={{ gap: 12, minHeight: 76 }}>
          <Avatar profile={me} size={56} solid="pink" photo={me.avatar_path} />
          <span className="grow" style={{ fontSize: 15, fontWeight: 600 }}>Profile photo</span>
          {me.avatar_path && (
            <button className="text-btn" style={{ padding: '0 6px', color: 'var(--muted)' }} disabled={photoBusy} onClick={removePhoto}>Remove</button>
          )}
          <button className="chip" style={{ borderColor: 'var(--blue)', color: 'var(--blue)', borderWidth: 1.5 }} disabled={photoBusy}
            onClick={() => fileRef.current?.click()}>
            {photoBusy ? 'Checking…' : me.avatar_path ? 'Change' : 'Add photo'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickPhoto} />
        </div>
        {photoNote && <p className="meta" style={{ margin: '0 0 10px', fontWeight: 600, color: photoNote.ok ? 'var(--ink)' : 'var(--error)' }}>{photoNote.text}</p>}

        {divider}
        <button className="spread" style={rowStyle} onClick={() => setOpen(open === 'name' ? null : 'name')}>
          Name {value(`${me.first_name ?? ''}${me.last_initial ? ` ${me.last_initial}.` : ''}`)}
        </button>
        {open === 'name' && (
          <div className="stack" style={{ gap: 10, paddingBottom: 14 }}>
            <div className="row" style={{ gap: 8 }}>
              <label className="grow stack" style={{ gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>
                First name
                <input className="input" style={{ height: 44 }} maxLength={40} value={first} onChange={(e) => setFirst(e.target.value)} />
              </label>
              <label className="stack" style={{ gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--muted)', width: 90 }}>
                Last initial
                <input className="input" style={{ height: 44, textAlign: 'center' }} maxLength={1} value={lastInitial} onChange={(e) => setLastInitial(e.target.value)} />
              </label>
            </div>
            {nameChanged && (
              <button className="btn small" disabled={!nameOk || nameBusy} onClick={saveName}>{nameBusy ? 'Saving…' : 'Save name'}</button>
            )}
            {nameNote && <p className="meta" style={{ margin: 0, fontWeight: 600, color: nameNote.ok ? 'var(--ink)' : 'var(--error)' }}>{nameNote.text}</p>}
          </div>
        )}

        {divider}
        <button className="spread" style={rowStyle} onClick={() => setOpen(open === 'year' ? null : 'year')}>
          Class year {value(year)}
        </button>
        {open === 'year' && (
          <div className="stack" style={{ gap: 8, paddingBottom: 14 }}>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {[...classYears(), 'Grad'].map((y) => {
                const on = me.class_year === y;
                return (
                  <button key={y} className="chip" disabled={yearBusy} onClick={() => saveYear(y)} aria-pressed={on}
                    style={on ? { background: 'var(--ink)', color: '#fff', borderColor: 'var(--ink)' } : undefined}>
                    {y === 'Grad' ? 'Grad' : `\u2019${y.slice(2)}`}
                  </button>
                );
              })}
            </div>
            {yearError && <p className="error-text" style={{ margin: 0 }}>{yearError}</p>}
          </div>
        )}
      </div>

      {section('CONNECTED')}
      <div className="card stack" style={{ gap: 8 }}>
        <div className="spread" style={{ gap: 12 }}>
          <span className="row" style={{ gap: 12, minWidth: 0 }}>
            <span style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--blue-tint)', color: 'var(--blue-dark)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon name="calendar" size={18} />
            </span>
            <span className="stack" style={{ gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Google Calendar</span>
              <span className="meta" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {calendar ? calendar.account_email : 'Shows when you\u2019re both free'}
              </span>
            </span>
          </span>
          {calendar === undefined ? null : calendar ? (
            <button className="chip" disabled={calBusy}
              onClick={async () => { setCalBusy(true); await unlinkCalendar(); setCalendar(null); setCalBusy(false); setCalNote(null); }}>
              Unlink
            </button>
          ) : (
            <button className="chip" style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)', fontWeight: 700 }} disabled={calBusy}
              onClick={async () => { setCalBusy(true); const err = await linkCalendar('/settings'); if (err) { setCalNote({ ok: false, text: err }); setCalBusy(false); } }}>
              Link
            </button>
          )}
        </div>
        {calNote && <p className="meta" style={{ margin: 0, color: calNote.ok ? 'var(--ink)' : 'var(--error)', fontWeight: 600 }}>{calNote.text}</p>}
      </div>

      {section('NOTIFICATIONS')}
      <div className="card stack" style={{ gap: 0, padding: '4px 16px' }}>
        <div className="spread" style={{ minHeight: 64, gap: 12 }}>
          <span className="stack" style={{ gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Push notifications</span>
            <span className="meta">Offers, messages, meetups</span>
          </span>
          {toggle(push === 'on', togglePush, 'Push notifications', pushBusy || push === null)}
        </div>
        {(pushNote || push === 'install' || push === 'blocked') && (
          <p className="meta" style={{ margin: '0 0 12px', fontWeight: 600, color: 'var(--error)' }}>
            {pushNote || (push === 'install' ? 'On iPhone, add bart to your Home Screen first: Share → Add to Home Screen.' : 'Notifications are blocked for bart in your phone or browser settings.')}
          </p>
        )}
        {divider}
        <div className="spread" style={{ minHeight: 64, gap: 12 }}>
          <span className="stack" style={{ gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Quiet hours</span>
            <span className="meta">No pings 11 PM to 8 AM</span>
          </span>
          {toggle(quiet ?? true, toggleQuiet, 'Quiet hours', quiet === null)}
        </div>
      </div>

      {section('PRIVACY + ACCOUNT')}
      <div className="card stack" style={{ gap: 0, padding: '0 16px' }}>
        <Link href="/settings/blocked" className="spread" style={{ ...rowStyle, display: 'flex' }}>
          Blocked people {value(blockedCount === null ? '' : String(blockedCount))}
        </Link>
        {divider}
        <button className="spread" style={rowStyle} onClick={() => setShowRules(!showRules)}>
          House rules <span style={{ color: 'var(--muted)', display: 'inline-flex', transform: showRules ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }}><Icon name="chevron" size={14} /></span>
        </button>
        {showRules && (
          <div className="stack" style={{ gap: 8, paddingBottom: 12 }}>
            {HOUSE_RULES.map(([t, sub]) => (
              <div key={t}><div className="row-title">{t}</div><div className="row-sub">{sub}</div></div>
            ))}
          </div>
        )}
        {divider}
        <div className="spread" style={{ ...rowStyle, display: 'flex' }}>
          Email <span style={{ fontSize: 15, fontWeight: 400, color: 'var(--text-2, var(--muted))' }}>{session?.user.email}</span>
        </div>
        {reviewer && (
          <>
            {divider}
            <Link href="/admin/reports" className="spread" style={{ ...rowStyle, display: 'flex' }}>
              <span className="row" style={{ gap: 10 }}><Icon name="flag" size={18} /> Review reports</span>
              <Icon name="chevron" size={14} />
            </Link>
          </>
        )}
      </div>

      <button className="text-btn" style={{ color: 'var(--error)', alignSelf: 'center', fontWeight: 700 }} onClick={signOut}>
        Sign out
      </button>
    </main>
  );
}
