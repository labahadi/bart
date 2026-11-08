'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase, photoUrl } from '@/lib/supabase';
import { uploadPhoto } from '@/lib/photos';
import { bannedMatch } from '@/lib/banned';
import { CATEGORIES, type Category, type Tier, friendlyError } from '@/lib/trade';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/Icon';

const CONDITIONS = ['New', 'Like new', 'Good condition', 'Well loved'];

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
    const { error } = editId
      ? await supabase.from('listings').update(fields).eq('id', editId)
      : await supabase.from('listings').insert(fields);
    setBusy(false);
    if (error) setError(friendlyError(error));
    else if (editId) router.replace(`/item/${editId}`);
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
        <span style={{ width: 88, height: 88, borderRadius: 999, background: 'var(--pink)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={40} stroke={2.4} />
        </span>
        <h1 className="display" style={{ fontSize: 28 }}>It&apos;s live!</h1>
        <p className="body">{posted}</p>
        <Link href="/" className="btn">Back to feed</Link>
        <button className="text-btn" onClick={() => {
          setPosted(null); setTitle(''); setDescription(''); setWants(''); setPhotos([]); setCondition(null);
        }}>Post another</button>
      </main>
    );
  }

  return (
    <>
      <main className="screen no-nav">
        <div className="spread">
          <button className="icon-btn" aria-label="Close" onClick={() => router.push(editId ? `/item/${editId}` : '/')}><Icon name="close" size={20} /></button>
          <h1 className="display" style={{ fontSize: 20 }}>{editId ? 'Edit listing' : 'New listing'}</h1>
          <span style={{ width: 44 }} />
        </div>

        {/* Photos */}
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
        {photos.length === 0 ? (
          <button onClick={() => fileInput.current?.click()} disabled={uploading}
            style={{ height: 112, background: 'var(--surface)', border: '2px dashed var(--dashed)', borderRadius: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--text-2)', fontSize: 14, fontWeight: 600 }}>
            {uploading ? <div className="spinner" /> : <Icon name="camera" />}
            {uploading ? 'Uploading…' : 'Add up to 4 photos'}
          </button>
        ) : (
          <div className="row" style={{ gap: 8 }}>
            {photos.map((p) => (
              <div key={p} style={{ position: 'relative', width: 76, height: 76 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl(p)} alt="" style={{ width: 76, height: 76, objectFit: 'cover', borderRadius: 12 }} />
                <button aria-label="Remove photo" onClick={() => setPhotos(photos.filter((x) => x !== p))}
                  style={{ position: 'absolute', top: -6, right: -6, width: 24, height: 24, borderRadius: 999, border: 'none', background: 'var(--ink)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                  <Icon name="close" size={14} stroke={2.6} />
                </button>
              </div>
            ))}
            {photos.length < 4 && (
              <button onClick={() => fileInput.current?.click()} disabled={uploading} aria-label="Add photo"
                style={{ width: 76, height: 76, borderRadius: 12, border: '2px dashed var(--dashed)', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>
                {uploading ? <div className="spinner" /> : <Icon name="plus" />}
              </button>
            )}
          </div>
        )}

        <div>
          <label className="label" htmlFor="title" style={{ display: 'block' }}>What are you trading?</label>
          <input id="title" className={`input ${banned && bannedMatch(title) ? 'invalid' : ''}`} maxLength={80}
            placeholder="Mini fridge" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        {banned && (
          <div className="alert">
            <Icon name="warning" size={18} />
            <span>&quot;{banned.term}&quot; isn&apos;t allowed on bart.</span>
          </div>
        )}

        <div>
          <p className="label">Category</p>
          <div className="chips wrap">
            {CATEGORIES.map((c) => (
              <button key={c.id} className={`chip ${category === c.id ? 'on' : ''}`} style={{ height: 38 }} onClick={() => setCategory(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
          {category === 'skills' && (
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--pink-text)', margin: '8px 0 0' }}>
              Tutoring is fine. Graded work isn&apos;t.
            </p>
          )}
        </div>

        {category !== 'skills' && (
          <>
            <div>
              <p className="label">Trade value</p>
              <div className="segmented">
                {(['S', 'M', 'L'] as Tier[]).map((t) => (
                  <button key={t} className={tier === t ? 'on' : ''} onClick={() => setTier(t)}>
                    {t} · {t === 'S' ? 'small' : t === 'M' ? 'medium' : 'large'}
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

        <div>
          <label className="label" htmlFor="desc" style={{ display: 'block' }}>Details</label>
          <textarea id="desc" className="input" rows={3} maxLength={600} placeholder="Optional"
            value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div>
          <label className="label" htmlFor="wants" style={{ display: 'block' }}>What do you want for it?</label>
          <input id="wants" className="input" maxLength={120} placeholder="Desk lamp, snacks, a coffee..."
            value={wants} onChange={(e) => setWants(e.target.value)} />
        </div>

        {error && <div className="alert"><Icon name="warning" size={18} />{error}</div>}
      </main>
      <div className="action-bar">
        <button className={`btn ${editId ? '' : 'pink'}`} disabled={!canPost} onClick={submit}>
          {banned ? 'Not allowed' : busy ? 'Saving…' : editId ? 'Save' : 'Post'}
        </button>
      </div>
    </>
  );
}
