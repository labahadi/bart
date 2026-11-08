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

export async function uploadPhoto(userId: string, file: File): Promise<string> {
  const blob = await shrink(file);
  const path = `${userId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from('listing-photos').upload(path, blob, {
    contentType: blob.type || 'image/jpeg', upsert: false,
  });
  if (error) throw error;
  return path;
}
