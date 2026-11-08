import { supabase } from './supabase';

// Shrink phone photos to at most 1600px on the long side before upload.
// Keeps uploads under the 5 MB limit and the feed fast on campus Wi-Fi.
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read photo'))), 'image/jpeg', 0.82));
  } catch {
    return file; // browser couldn't decode it; upload as-is
  }
}

// Every photo goes through the server, which checks it before storing it (src/app/api/photo/route.ts)
async function sendToCheck(form: FormData) {
  const { data } = await supabase.auth.getSession();
  const res = await fetch('/api/photo', {
    method: 'POST', body: form, headers: { authorization: `Bearer ${data.session?.access_token ?? ''}` },
  }).catch(() => null);
  if (!res) throw new Error("Couldn't reach bart. Check your connection.");
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Photo upload failed.');
  return json;
}

export async function uploadPhoto(_userId: string, file: File): Promise<string> {
  const form = new FormData();
  form.append('file', await shrink(file), 'photo.jpg');
  form.append('kind', 'listing');
  return (await sendToCheck(form)).path as string;
}

// Chat photos: the server checks it, stores it privately, and adds it to the chat
export async function uploadChatPhoto(offerId: string, file: File) {
  const form = new FormData();
  form.append('file', await shrink(file), 'photo.jpg');
  form.append('kind', 'chat');
  form.append('offerId', offerId);
  return (await sendToCheck(form)).message as { id: string; sender_id: string; body: string | null; image_path: string | null; created_at: string };
}
