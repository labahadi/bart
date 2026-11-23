'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase, photoUrl } from '@/lib/supabase';
import { uploadPhoto } from '@/lib/photos';
import { bannedMatch } from '@/lib/banned';
import { screenText } from '@/lib/screen';
import { CATEGORIES, type Category, type Tier, friendlyError } from '@/lib/trade';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/Icon';
import { PostLiveDog } from '@/components/Mascot';
import { safeBack, withParam } from '@/lib/returnTo';

const CONDITIONS = ['New', 'Like new', 'Good condition', 'Well loved'];
const TIER_OPTIONS: [Tier, string][] = [['S', 'a coffee-ish'], ['M', 'a textbook-ish'], ['L', 'a fridge-ish']];

// The listing form, used to post a new item and to edit one you already posted.
export function ListingForm({ editId }: { editId?: string }) {
  const { me } = useAuth();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<Category>('dorm');
  const [tier, setTier] = useState<Tier>('M');
  const [condition, setCondition] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [wants, setWants] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [posted, setPosted] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!editId);
  const [locked, setLocked] = useState(false);
  // Opened from a trade (/post?back=...): posting goes straight back to it with the new item picked
  const [back, setBack] = useState<string | null>(null);
  useEffect(() => { setBack(safeBack(new URLSearchParams(window.location.search).get('back'))); }, []);

  // New listing from the ISO board: start with the wanted item's name
  useEffect(() => {
    if (editId) return;
    const t = new URLSearchParams(window.location.search).get('title');
    if (t) setTitle(t.slice(0, 80));
  }, [editId]);

  // Editing: fill the form with the listing as it is now
  useEffect(() => {
    if (!editId || !me) return;
    supabase.from('listings').select('*').eq('id', editId).maybeSingle().then(({ data }) => {
      if (!data || data.owner_id !== me.id) { router.replace(`/item/${editId}`); return; }
      setTitle(data.title); setCategory(data.category); setTier(data.tier === 'Skill' ? 'M' : data.tier);
      setCondition(data.condition); setDescription(data.description ?? ''); setWants(data.wants ?? '');
      setPhotos(data.photo_paths ?? []);
      setLocked(data.status === 'in_trade' || data.status === 'traded');
      setLoading(false);
    });
  }, [editId, me, router]);

  const banned = bannedMatch(title) ?? bannedMatch(description) ?? bannedMatch(wants);
  const canPost = title.trim().length > 2 && !banned && !busy && !uploading;

  async function addPhotos(files: FileList | null) {
    if (!files || !me) return;
    setUploading(true); setError('');
    try {
      const room = 4 - photos.length;
      const paths: string[] = [];
      for (const f of Array.from(files).slice(0, room)) paths.push(await uploadPhoto(me.id, f));
      setPhotos([...photos, ...paths]);
    } catch (e) {
      setError(`Photo upload failed: ${friendlyError(e)}`);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function submit() {
    if (!canPost) return;
    setBusy(true); setError('');
    const fields = {
      title: title.trim(),
      description: description.trim() || null,
      category,
      tier: category === 'skills' ? 'Skill' : tier,
      condition: category === 'skills' ? null : condition,
      wants: wants.trim() || null,
      photo_paths: photos,
    };
    const problem = await screenText(fields.title, fields.description, fields.wants);
    if (problem) { setBusy(false); setError(problem); return; }
    const { data: saved, error } = editId
      ? await supabase.from('listings').update(fields).eq('id', editId).select('id').single()
      : await supabase.from('listings').insert(fields).select('id').single();
    setBusy(false);
    if (error) setError(friendlyError(error));
    else if (editId) router.replace(`/item/${editId}`);
    else if (back && saved) router.replace(withParam(back, 'added', saved.id));
    else setPosted(title.trim());
  }

  if (loading) return <div className="center-screen"><div className="spinner" /></div>;

  if (locked) {
    return (
      <main className="screen no-nav" style={{ alignItems: 'center', textAlign: 'center', paddingTop: 120 }}>
        <h1 className="title-push">In a trade</h1>
        <p className="body">Items can&apos;t be edited once they&apos;re in a trade.</p>
        <Link href={`/item/${editId}`} className="btn">Back</Link>
      </main>
    );
  }

  if (posted) {
    return (
      <main className="screen no-nav" style={{ alignItems: 'center', textAlign: 'center', paddingTop: 100 }}>
        <PostLiveDog />
        <h1 className="display" style={{ fontSize: 28 }}>It&apos;s live!</h1>
        <p className="body">{posted} is posted. We&apos;ll fetch you some offers.</p>
        <Link href="/" className="btn">Back to feed</Link>
        <button className="text-btn" onClick={() => {
          setPosted(null); setTitle(''); setDescription(''); setWants(''); setPhotos([]); setCondition(null);
        }}>Post another</button>
      </main>
    );
  }

  const isSkill = category === 'skills';
  return (
    <>
      <main className="screen no-nav">
        <div className="spread">
          <button className="icon-btn" aria-label="Close" onClick={() => router.push(editId ? `/item/${editId}` : back ?? '/')}><Icon name="close" size={20} /></button>
          <h1 className="display" style={{ fontSize: 20 }}>{editId ? 'Edit listing' : 'Add to your closet'}</h1>
          <span style={{ width: 44 }} />
        </div>
        {back && !editId && (
          <p className="meta" style={{ textAlign: 'center', marginTop: -8 }}>Once it&apos;s posted, you&apos;ll go right back to your trade.</p>
        )}

        <div className="segmented">
          <button className={!isSkill ? 'on' : ''} onClick={() => isSkill && setCategory('dorm')}>An item</button>
          <button className={isSkill ? 'on' : ''} onClick={() => setCategory('skills')}>A skill</button>
        </div>

        {/* Photos */}
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
        {photos.length === 0 ? (
          <button className="photo-cta" onClick={() => fileInput.current?.click()} disabled={uploading}>
            <span className="photo-cta-icon">{uploading ? <div className="spinner" /> : <Icon name="camera" size={28} />}</span>
            {uploading ? 'Uploading…' : 'Add photos'}
            <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.85 }}>Up to 4</span>
          </button>
        ) : (
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {photos.map((p) => (
              <div key={p} style={{ position: 'relative', width: 84, height: 84 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl(p)} alt="" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 20 }} />
                <button aria-label="Remove photo" onClick={() => setPhotos(photos.filter((x) => x !== p))}
                  style={{ position: 'absolute', top: -6, right: -6, width: 26, height: 26, borderRadius: 999, border: '2px solid #fff', background: 'var(--navy)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                  <Icon name="close" size={13} stroke={2.6} />
                </button>
              </div>
            ))}
            {photos.length < 4 && (
              <button onClick={() => fileInput.current?.click()} disabled={uploading} aria-label="Add photo"
                style={{ width: 84, height: 84, borderRadius: 20, border: '2px dashed var(--dashed)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>
                {uploading ? <div className="spinner" /> : <Icon name="plus" />}
              </button>
            )}
          </div>
        )}

        <label className={`field${banned && bannedMatch(title) ? ' invalid' : ''}`}>
          <span>{isSkill ? 'What can you teach or do?' : 'What is it?'}</span>
          <input maxLength={80} placeholder={isSkill ? '1 hr of Python help' : 'Mini fridge'} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {banned && (
          <div className="alert">
            <Icon name="warning" size={18} />
            <span>&quot;{banned.term}&quot; isn&apos;t allowed on bart.</span>
          </div>
        )}

        {isSkill ? (
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--pink-text)', margin: 0 }}>
            Tutoring is fine. Graded work isn&apos;t.
          </p>
        ) : (
          <>
            <div>
              <p className="label">Category</p>
              <div className="chips wrap">
                {CATEGORIES.filter((c) => c.id !== 'skills').map((c) => (
                  <button key={c.id} className={`chip ${category === c.id ? 'on' : ''}`} onClick={() => setCategory(c.id)}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="label">Trade value</p>
              <div className="tier-pick">
                {TIER_OPTIONS.map(([t, hint]) => (
                  <button key={t} className={tier === t ? 'on' : ''} onClick={() => setTier(t)} aria-pressed={tier === t}>
                    <b>{t}</b><span>{hint}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="label">Condition</p>
              <div className="chips wrap">
                {CONDITIONS.map((c) => (
                  <button key={c} className={`chip ${condition === c ? 'on' : ''}`} onClick={() => setCondition(condition === c ? null : c)}>{c}</button>
                ))}
              </div>
            </div>
          </>
        )}

        <label className="field">
          <span>Would trade for</span>
          <input maxLength={120} placeholder="Desk lamp, snacks, a coffee..." value={wants} onChange={(e) => setWants(e.target.value)} />
        </label>

        <label className="field">
          <span>Details (optional)</span>
          <textarea rows={3} maxLength={600} placeholder="Size, how old it is, anything worth knowing"
            value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>

        <p className="row" style={{ gap: 8, fontSize: 13, color: 'var(--text-2)', margin: 0 }}>
          <span style={{ color: 'var(--blue)', display: 'inline-flex' }}><Icon name="shield" size={18} /></span>
          Photos and text are checked against the house rules
        </p>

        {error && <div className="alert"><Icon name="warning" size={18} />{error}</div>}
      </main>
      <div className="action-bar">
        <button className="btn ink" disabled={!canPost} onClick={submit}>
          {!banned && !busy && !editId && <Icon name="plus" size={20} stroke={2.6} />}
          {banned ? 'Not allowed' : busy ? 'Saving…' : editId ? 'Save' : 'Add to closet'}
        </button>
      </div>
    </>
  );
}
