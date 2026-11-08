-- bart: pausing accounts (1 day, 3 days, 7 days, or until further notice)
-- Run after 0001–0009 in the Supabase SQL Editor.
--
-- While paused, a person can't post, offer, counter, accept, message, comment, like, share or
-- send photos, and their listings are hidden from everyone. They can still read their chats
-- and report someone.

create table suspensions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  until      timestamptz,                 -- null = until further notice
  reason     text not null check (char_length(reason) between 3 and 300),
  created_by uuid references profiles (id),
  lifted_at  timestamptz,
  created_at timestamptz not null default now()
);
create index suspensions_user_idx on suspensions (user_id);

alter table suspensions enable row level security;
-- You can see your own pauses (for the banner); reviewers use the functions below
create policy "suspensions: own" on suspensions for select to authenticated using (user_id = auth.uid());

create or replace function is_suspended(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from suspensions
                 where user_id = p_user and lifted_at is null and (until is null or until > now()))
$$;
grant execute on function is_suspended(uuid) to authenticated;

-- Block actions by a paused account. Runs on every write, including through the trade functions.
create or replace function block_if_suspended() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid();
begin
  -- Photo messages are written by the server on someone's behalf
  if actor is null and tg_table_name = 'messages' then actor := new.sender_id; end if;
  if actor is not null and is_suspended(actor) then
    raise exception 'Your account is paused, so you can''t do this right now.';
  end if;
  return new;
end $$;

create trigger listings_block_paused      before insert or update on listings      for each row execute function block_if_suspended();
create trigger offers_block_paused        before insert or update on offers        for each row execute function block_if_suspended();
create trigger messages_block_paused      before insert on messages               for each row execute function block_if_suspended();
create trigger comments_block_paused      before insert on post_comments          for each row execute function block_if_suspended();
create trigger likes_block_paused         before insert on post_likes             for each row execute function block_if_suspended();
create trigger feed_block_paused          before insert on feed_posts             for each row execute function block_if_suspended();
create trigger iso_block_paused           before insert on iso_posts              for each row execute function block_if_suspended();
create trigger iso_answers_block_paused   before insert on iso_responses          for each row execute function block_if_suspended();

-- Hide a paused person's listings from everyone else
drop policy "listings: read" on listings;
create policy "listings: read" on listings for select to authenticated using (
  (status = 'active' and not is_suspended(owner_id))
  or owner_id = auth.uid()
  or exists (
    select 1 from offers o
    where (o.listing_id = listings.id
           or exists (select 1 from offer_items oi where oi.offer_id = o.id and oi.listing_id = listings.id))
      and auth.uid() in (o.from_user, o.to_user)
  )
);

-- ---------------------------------------------------------------------------
-- Reviewer tools
-- ---------------------------------------------------------------------------

-- Pause someone. p_days: 1, 3, 7, or null for until further notice.
create or replace function pause_account(p_user uuid, p_days int, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_until timestamptz := case when p_days is null then null else now() + make_interval(days => p_days) end;
begin
  if not is_reviewer() then raise exception 'Only bart reviewers can do this.'; end if;
  if p_user = auth.uid() then raise exception 'You can''t pause yourself.'; end if;
  if p_days is not null and p_days not in (1, 3, 7) then raise exception 'Pick 1, 3 or 7 days, or until further notice.'; end if;
  insert into suspensions (user_id, until, reason, created_by) values (p_user, v_until, trim(p_reason), auth.uid());
  perform notify(p_user, 'me', 'paused',
    'Your account is paused ' ||
      coalesce('until ' || to_char(v_until at time zone 'America/New_York', 'Dy Mon FMDD, FMHH12 AM'), 'until further notice') ||
      '. Reason: ' || trim(p_reason),
    '/me', null);
end $$;

-- Pause whoever posted a reported listing
create or replace function pause_listing_owner(p_listing uuid, p_days int, p_reason text)
returns void language sql security definer set search_path = public as $$
  select pause_account((select owner_id from listings where id = p_listing), p_days, p_reason)
$$;

create or replace function lift_pause(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_reviewer() then raise exception 'Only bart reviewers can do this.'; end if;
  update suspensions set lifted_at = now() where user_id = p_user and lifted_at is null;
  perform notify(p_user, 'me', 'unpaused', 'Your account is active again.', '/me', null);
end $$;

-- Everyone currently paused
create or replace function paused_accounts()
returns table (user_id uuid, name text, until timestamptz, reason text, past_pauses int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_reviewer() then raise exception 'Only bart reviewers can see this.'; end if;
  return query
  select s.user_id,
         coalesce(p.first_name, 'Student') || coalesce(' ' || p.last_initial || '.', ''),
         s.until, s.reason,
         (select count(*)::int from suspensions x where x.user_id = s.user_id)
  from suspensions s join profiles p on p.id = s.user_id
  where s.lifted_at is null and (s.until is null or s.until > now())
  order by s.created_at desc;
end $$;

-- How many times someone has been paused (shown on report cards)
create or replace function pause_count(p_user uuid) returns int
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_reviewer() then return 0; end if;
  return (select count(*)::int from suspensions where user_id = p_user);
end $$;

create or replace function listing_owner_pauses(p_listing uuid) returns int
language sql stable security definer set search_path = public as $$
  select pause_count((select owner_id from listings where id = p_listing))
$$;

revoke execute on function pause_account(uuid, int, text), pause_listing_owner(uuid, int, text), lift_pause(uuid),
  paused_accounts(), pause_count(uuid), listing_owner_pauses(uuid) from public, anon;
grant execute on function pause_account(uuid, int, text), pause_listing_owner(uuid, int, text), lift_pause(uuid),
  paused_accounts(), pause_count(uuid), listing_owner_pauses(uuid) to authenticated;
