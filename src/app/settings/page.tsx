'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { blockedAnywhere } from '@/lib/banned';
import { uploadAvatar } from '@/lib/photos';
import { friendlyError, HOUSE_RULES } from '@/lib/trade';
import { linkCalendar, linkResult, myCalendar, unlinkCalendar } from '@/lib/calendar';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/Icon';
import { Avatar, PushHeader } from '@/components/ui';

// Settings: opened from the gear on Home (and "Edit profile" on your profile)
export default function Settings() {
  const { me, refresh } = useAuth();
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
  const [showRules, setShowRules] = useState(false);

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
  }, []);

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
    setNameNote({ ok: true, text: 'Name saved.' });
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  const section = (title: string) => <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: 'var(--muted)', marginBottom: -6 }}>{title}</div>;

  return (
    <main className="screen no-nav">
      <PushHeader title="Settings" back="/" />

      {section('PROFILE')}
      <div className="card stack" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 12 }}>
          <Avatar profile={me} size={56} solid="pink" photo={me.avatar_path} />
          <span className="grow" style={{ fontSize: 14, fontWeight: 600 }}>Profile photo</span>
          {me.avatar_path && (
            <button className="text-btn" style={{ padding: '0 6px', color: 'var(--muted)' }} disabled={photoBusy} onClick={removePhoto}>Remove</button>
          )}
          <button className="chip" style={{ borderColor: 'var(--blue)', color: 'var(--blue)', borderWidth: 1.5 }} disabled={photoBusy}
            onClick={() => fileRef.current?.click()}>
            {photoBusy ? 'Checking…' : me.avatar_path ? 'Change' : 'Add photo'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickPhoto} />
        </div>
        {photoNote && <p className="meta" style={{ margin: 0, fontWeight: 600, color: photoNote.ok ? 'var(--ink)' : 'var(--error)' }}>{photoNote.text}</p>}

        <div style={{ borderTop: '1px solid var(--border-soft)' }} />

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
        <p className="meta" style={{ margin: 0 }}>Shown as &quot;{first.trim() || 'First'}{lastInitial.trim() ? ` ${lastInitial.trim().toUpperCase()}.` : ''}&quot;. First names are one word.</p>
        {nameChanged && (
          <button className="btn small" disabled={!nameOk || nameBusy} onClick={saveName}>{nameBusy ? 'Saving…' : 'Save name'}</button>
        )}
        {nameNote && <p className="meta" style={{ margin: 0, fontWeight: 600, color: nameNote.ok ? 'var(--ink)' : 'var(--error)' }}>{nameNote.text}</p>}
      </div>

      {section('CONNECTED')}
      <div className="card stack" style={{ gap: 8 }}>
        <div className="spread">
          <span className="row" style={{ gap: 12, fontWeight: 600, fontSize: 14 }}>
            <span style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--blue-tint)', color: 'var(--blue-dark)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="calendar" size={18} />
            </span>
            Google Calendar
          </span>
          {calendar === undefined ? null : calendar ? (
            <button className="chip" disabled={calBusy}
              onClick={async () => { setCalBusy(true); await unlinkCalendar(); setCalendar(null); setCalBusy(false); setCalNote(null); }}>
              Unlink
            </button>
          ) : (
            <button className="chip" style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }} disabled={calBusy}
              onClick={async () => { setCalBusy(true); const err = await linkCalendar('/settings'); if (err) { setCalNote({ ok: false, text: err }); setCalBusy(false); } }}>
              Link
            </button>
          )}
        </div>
        <p className="meta" style={{ margin: 0 }}>
          {calendar ? `Linked to ${calendar.account_email}. bart only sees when you're busy.` : 'Optional. Shows when you and the other person are both free.'}
        </p>
        {calNote && <p className="meta" style={{ margin: 0, color: calNote.ok ? 'var(--ink)' : 'var(--error)', fontWeight: 600 }}>{calNote.text}</p>}
      </div>

      {section('ACCOUNT')}
      <div className="card stack" style={{ gap: 0, padding: '0 14px' }}>
        <button className="spread" onClick={() => setShowRules(!showRules)}
          style={{ minHeight: 48, background: 'none', border: 'none', padding: 0, fontSize: 14, fontWeight: 600, width: '100%' }}>
          House rules <span className="meta" style={{ fontSize: 16 }}>{showRules ? '−' : '›'}</span>
        </button>
        {showRules && (
          <div className="stack" style={{ gap: 8, paddingBottom: 12 }}>
            {HOUSE_RULES.map(([t, sub]) => (
              <div key={t}><div className="row-title">{t}</div><div className="row-sub">{sub}</div></div>
            ))}
          </div>
        )}
        {reviewer && (
          <Link href="/admin/reports" className="spread" style={{ minHeight: 48, color: 'var(--ink)', borderTop: '1px solid var(--border-soft)', fontSize: 14, fontWeight: 600 }}>
            <span className="row" style={{ gap: 10 }}><Icon name="flag" size={18} /> Review reports</span>
            <span className="meta" style={{ fontSize: 16 }}>›</span>
          </Link>
        )}
      </div>

      <button className="text-btn" style={{ color: 'var(--error)', alignSelf: 'center', display: 'flex', gap: 6, alignItems: 'center' }} onClick={signOut}>
        <Icon name="logout" size={18} /> Sign out
      </button>
    </main>
  );
}
