-- bart: photo storage and live chat
-- Run after 0001_core.sql. These pieces only exist on Supabase, so they live in their own file.

-- Listing photos: anyone with the link can view them; you can only upload into your own folder
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy "photos: upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "photos: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Live chat and live trade updates
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table offers;
