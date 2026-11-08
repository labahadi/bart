-- bart: counter offers and photos in chat
-- Run after 0001–0003 in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- Counter offers
-- A pending offer now has a "turn": the person who needs to answer it.
-- It starts with the owner. Whoever's turn it is can accept, decline, or counter;
-- a counter changes what the sender gives and passes the turn to the other person.
-- ---------------------------------------------------------------------------
alter table offers
  add column awaiting      uuid references profiles (id),
  add column counter_count int not null default 0,
  add column countered_by  uuid references profiles (id);

-- Turn for an offer (old offers have no "awaiting", so it's the owner's turn)
create or replace function offer_turn(o offers) returns uuid
language sql immutable as $$ select coalesce(o.awaiting, o.to_user) $$;

create or replace function respond_offer(p_offer uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare o offers;
begin
  select * into o from offers where id = p_offer for update;
  if o.id is null or auth.uid() not in (o.from_user, o.to_user) then raise exception 'Offer not found'; end if;
  if o.status <> 'pending' then raise exception 'This offer was already answered.'; end if;

  if p_action = 'cancel' then
    if auth.uid() <> o.from_user then raise exception 'Only the sender can cancel.'; end if;
    update offers set status = 'cancelled', updated_at = now() where id = p_offer;
    return;
  end if;

  if auth.uid() <> offer_turn(o) then raise exception 'It''s the other person''s turn to answer.'; end if;

  if p_action = 'decline' then
    update offers set status = 'declined', updated_at = now() where id = p_offer;
  elsif p_action = 'accept' then
    if exists (select 1 from listings where id = o.listing_id and status <> 'active')
       or exists (select 1 from offer_items oi join listings l on l.id = oi.listing_id
                  where oi.offer_id = p_offer and l.status <> 'active') then
      raise exception 'One of these items is already in another trade.';
    end if;
    update offers set status = 'accepted', meet_spot = coalesce(meet_spot, suggested_spot), updated_at = now()
     where id = p_offer;
    update listings set status = 'in_trade'
     where id = o.listing_id or id in (select listing_id from offer_items where offer_id = p_offer);
    update offers x set status = 'declined', updated_at = now()
     where x.status = 'pending' and x.id <> p_offer
       and (x.listing_id in (select o.listing_id union select listing_id from offer_items where offer_id = p_offer)
            or exists (select 1 from offer_items xi
                       where xi.offer_id = x.id
                         and xi.listing_id in (select o.listing_id union select listing_id from offer_items where offer_id = p_offer)));
  else
    raise exception 'Unknown action';
  end if;
end $$;

-- Counter: pick which of the sender's items (and which sweeteners) the trade should be
create or replace function counter_offer(p_offer uuid, p_items uuid[], p_sweeteners text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  o offers;
  v_names text;
  v_sweet text[];
begin
  select * into o from offers where id = p_offer for update;
  if o.id is null or auth.uid() not in (o.from_user, o.to_user) then raise exception 'Offer not found'; end if;
  if o.status <> 'pending' then raise exception 'This offer was already answered.'; end if;
  if auth.uid() <> offer_turn(o) then raise exception 'It''s the other person''s turn to answer.'; end if;
  if o.counter_count >= 6 then raise exception 'That''s a lot of back and forth. Chat it out, then accept or decline.'; end if;

  if coalesce(cardinality(p_items), 0) = 0 then raise exception 'Pick at least one item.'; end if;
  -- Items always come from the sender's closet
  if exists (select 1 from unnest(p_items) i
             where not exists (select 1 from listings l
                               where l.id = i and l.owner_id = o.from_user and l.status = 'active')) then
    raise exception 'You can only pick items that are still in their closet.';
  end if;

  v_sweet := (select coalesce(array_agg(s), '{}') from unnest(coalesce(p_sweeteners, '{}')) s
              where s in ('Coffee on me', 'Help moving it', 'Class notes'));

  delete from offer_items where offer_id = p_offer;
  insert into offer_items (offer_id, listing_id) select p_offer, unnest(p_items);
  update offers
     set sweeteners = v_sweet,
         awaiting = case when auth.uid() = o.to_user then o.from_user else o.to_user end,
         counter_count = counter_count + 1,
         countered_by = auth.uid(),
         updated_at = now()
   where id = p_offer;

  -- Leave a note in the chat so both people see what changed
  select string_agg(l.title, ' + ' order by l.title) into v_names from listings l where l.id = any (p_items);
  insert into messages (offer_id, sender_id, body)
  values (p_offer, auth.uid(),
          'Countered: ' || v_names ||
          case when cardinality(v_sweet) > 0 then ' + ' || lower(array_to_string(v_sweet, ' + ')) else '' end);
end $$;

revoke execute on function counter_offer(uuid, uuid[], text[]), offer_turn(offers) from public, anon;
grant execute on function counter_offer(uuid, uuid[], text[]), offer_turn(offers) to authenticated;

-- ---------------------------------------------------------------------------
-- Photos in chat
-- A message can be text, a photo, or both. Photos live in a private bucket that
-- only the two people in that trade can open.
-- ---------------------------------------------------------------------------
alter table messages alter column body drop not null;
alter table messages drop constraint if exists messages_body_check;
alter table messages add column image_path text;
alter table messages add constraint messages_has_content check (
  (body is not null and char_length(body) between 1 and 1000) or (body is null and image_path is not null)
);
-- A photo must be stored in this trade's folder
alter table messages add constraint messages_image_in_trade_folder check (
  image_path is null or image_path like offer_id::text || '/%'
);

-- Storage (only exists on Supabase, so it's skipped when testing on plain Postgres)
do $storage$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('chat-photos', 'chat-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
    on conflict (id) do nothing;

    execute $p$
      create policy "chat photos: trade parties upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'chat-photos' and exists (
        select 1 from public.offers o
        where o.id::text = (storage.foldername(name))[1]
          and auth.uid() in (o.from_user, o.to_user)
          and o.status in ('pending', 'accepted')))
    $p$;
    execute $p$
      create policy "chat photos: trade parties view" on storage.objects for select to authenticated
      using (bucket_id = 'chat-photos' and exists (
        select 1 from public.offers o
        where o.id::text = (storage.foldername(name))[1]
          and auth.uid() in (o.from_user, o.to_user)))
    $p$;
  end if;
end $storage$;
