-- Meetups are proposed by one person and confirmed by the other,
-- and anyone can optionally link their Google Calendar to see when they're both free.

alter table offers
  add column if not exists meet_proposed_by uuid references profiles(id),
  add column if not exists meet_confirmed_at timestamptz;

-- Meetups already set before this change count as confirmed
update offers set meet_confirmed_at = coalesce(updated_at, now()) where meet_at is not null and meet_confirmed_at is null;

-- Setting or changing a meetup makes it a new proposal from you
create or replace function set_meetup(p_offer uuid, p_spot text, p_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare
  o offers;
begin
  select * into o from offers where id = p_offer for update;
  if o.id is null or auth.uid() not in (o.from_user, o.to_user) then raise exception 'Offer not found'; end if;
  if o.status <> 'accepted' then raise exception 'Set a meetup after the offer is accepted.'; end if;
  if not exists (select 1 from safe_spots where id = p_spot) then raise exception 'Pick a spot from the list.'; end if;
  perform meetup_time_ok(p_at);
  update offers
     set meet_spot = p_spot, meet_custom = null, meet_address = null, meet_lat = null, meet_lng = null,
         meet_walk_min = null, meet_pickup = false, meet_at = p_at,
         meet_proposed_by = auth.uid(), meet_confirmed_at = null, updated_at = now()
   where id = p_offer;
end $$;

create or replace function set_meetup_place(
  p_offer uuid, p_user uuid, p_name text, p_address text, p_lat double precision, p_lng double precision,
  p_walk_min int, p_pickup boolean, p_at timestamptz
) returns void language plpgsql security definer set search_path = public as $$
declare
  o offers;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  select * into o from offers where id = p_offer for update;
  if o.id is null or p_user not in (o.from_user, o.to_user) then raise exception 'Offer not found'; end if;
  if is_suspended(p_user) then raise exception 'Your account is paused, so you can''t do this right now.'; end if;
  if o.status <> 'accepted' then raise exception 'Set a meetup after the offer is accepted.'; end if;
  perform meetup_time_ok(p_at);
  if p_lat is null or p_lng is null or not on_campus(p_lat, p_lng) then raise exception 'That place is off campus.'; end if;
  if blocked_anywhere(p_name) is not null then raise exception 'Pick a different place.'; end if;
  update offers
     set meet_spot = null, meet_custom = left(trim(p_name), 80), meet_address = left(p_address, 200),
         meet_lat = p_lat, meet_lng = p_lng, meet_walk_min = p_walk_min, meet_pickup = coalesce(p_pickup, false),
         meet_at = p_at, meet_proposed_by = p_user, meet_confirmed_at = null, updated_at = now()
   where id = p_offer;
end $$;

-- The other person (not the one who proposed it) confirms
create or replace function confirm_meetup(p_offer uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  o offers;
begin
  select * into o from offers where id = p_offer for update;
  if o.id is null or auth.uid() not in (o.from_user, o.to_user) then raise exception 'Offer not found'; end if;
  if is_suspended(auth.uid()) then raise exception 'Your account is paused, so you can''t do this right now.'; end if;
  if o.status <> 'accepted' then raise exception 'This trade isn''t active.'; end if;
  if o.meet_at is null then raise exception 'There''s no meetup to confirm yet.'; end if;
  if o.meet_confirmed_at is not null then return; end if;
  if o.meet_proposed_by = auth.uid() then raise exception 'The other person confirms your proposal.'; end if;
  if o.meet_at < now() - interval '5 minutes' then raise exception 'That time already passed. Suggest a new one.'; end if;
  update offers set meet_confirmed_at = now(), updated_at = now() where id = p_offer;
end $$;

grant execute on function confirm_meetup(uuid) to authenticated;

create or replace function notify_offer_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor text := first_name_of(auth.uid());
  title text := (select l.title from listings l where l.id = new.listing_id);
  link  text := '/trades/' || new.id;
  p uuid;
begin
  if tg_op = 'INSERT' then
    perform notify(new.to_user, 'trades', 'offer', actor || ' sent an offer for your ' || title, link, new.id);
    return new;
  end if;

  if new.status is distinct from old.status then
    foreach p in array array[new.from_user, new.to_user] loop
      perform notify(p, 'trades', 'status',
        case new.status
          when 'accepted'  then actor || ' accepted the trade for ' || title
          when 'declined'  then 'The trade for ' || title || ' was declined'
          when 'cancelled' then actor || ' cancelled the offer for ' || title
          when 'completed' then 'Trade done: ' || title || '. Rate it and share it to Campus.'
          else 'Update on the trade for ' || title
        end, link, new.id);
    end loop;
  elsif new.counter_count > old.counter_count then
    perform notify(new.awaiting, 'trades', 'counter', actor || ' countered on ' || title, link, new.id);
  end if;

  -- A new or changed meetup is a proposal for the other person to confirm
  if new.meet_at is not null and (new.meet_at is distinct from old.meet_at
       or new.meet_proposed_by is distinct from old.meet_proposed_by
       or new.meet_custom is distinct from old.meet_custom or new.meet_spot is distinct from old.meet_spot)
     and new.meet_confirmed_at is null then
    foreach p in array array[new.from_user, new.to_user] loop
      perform notify(p, 'trades', 'meetup',
        actor || ' proposed a meetup: ' || to_char(new.meet_at at time zone 'America/New_York', 'Dy FMHH12:MI AM') || '. Confirm it?',
        link, new.id, true);
    end loop;
  end if;
  if new.meet_confirmed_at is not null and old.meet_confirmed_at is null then
    foreach p in array array[new.from_user, new.to_user] loop
      perform notify(p, 'trades', 'meetup',
        actor || ' confirmed the meetup: ' || to_char(new.meet_at at time zone 'America/New_York', 'Dy FMHH12:MI AM'),
        link, new.id, true);
    end loop;
  end if;
  return new;
end $$;


-- Meetup notes in the chat already have their own notification
create or replace function notify_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o offers;
begin
  if new.body like 'Countered: %' or new.body like 'Meetup set: %'
     or new.body like 'Meetup proposed: %' or new.body like 'Meetup confirmed: %' then return new; end if;
  select * into o from offers where id = new.offer_id;
  perform notify(case when new.sender_id = o.from_user then o.to_user else o.from_user end,
                 'trades', 'message',
                 first_name_of(new.sender_id) || ': ' || coalesce(left(new.body, 80), 'sent a photo'),
                 '/trades/' || new.offer_id, new.offer_id, true);
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Optional Google Calendar link. Only the app's server can read the tokens.
-- bart only ever asks Google for busy/free times, never event names or details.
-- ---------------------------------------------------------------------------
create table if not exists calendar_links (
  user_id       uuid primary key references profiles(id) on delete cascade,
  provider      text not null default 'google',
  account_email text not null,
  refresh_token text not null,
  created_at    timestamptz not null default now()
);
alter table calendar_links enable row level security;
revoke all on calendar_links from public;
do $r$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on calendar_links from anon, authenticated; end if;
end $r$;

-- Is my calendar linked? (never returns the token)
create or replace function my_calendar() returns table (provider text, account_email text)
language sql stable security definer set search_path = public as $$
  select provider, account_email from calendar_links where user_id = auth.uid()
$$;
grant execute on function my_calendar() to authenticated;

-- ---------------------------------------------------------------------------
-- "Share with a friend": a private link a friend can open without an account.
-- It shows only the time, the place, your first name and what you're swapping,
-- always the latest plan, and stops working a day after the meetup.
-- ---------------------------------------------------------------------------
create table if not exists meetup_shares (
  token      text primary key,
  offer_id   uuid not null references offers(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (offer_id, user_id)
);
alter table meetup_shares enable row level security;

create or replace function share_meetup(p_offer uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  o offers;
  t text;
begin
  select * into o from offers where id = p_offer;
  if o.id is null or auth.uid() not in (o.from_user, o.to_user) then raise exception 'Offer not found'; end if;
  if o.meet_at is null then raise exception 'Set a meetup first.'; end if;
  select token into t from meetup_shares where offer_id = p_offer and user_id = auth.uid();
  if t is null then
    t := replace(gen_random_uuid()::text, '-', '');
    insert into meetup_shares (token, offer_id, user_id) values (t, p_offer, auth.uid());
  end if;
  return t;
end $$;
grant execute on function share_meetup(uuid) to authenticated;

create or replace function shared_meetup(p_token text)
returns table (first_name text, meet_at timestamptz, place text, address text, lat double precision, lng double precision,
               confirmed boolean, gives text, gets text)
language sql stable security definer set search_path = public as $$
  select p.first_name, o.meet_at,
         coalesce(o.meet_custom, sp.name), coalesce(o.meet_address, sp.name || ', Philadelphia, PA 19104'),
         o.meet_lat, o.meet_lng, o.meet_confirmed_at is not null,
         case when s.user_id = o.from_user then items.titles else l.title end,
         case when s.user_id = o.from_user then l.title else items.titles end
    from meetup_shares s
    join offers o on o.id = s.offer_id
    join profiles p on p.id = s.user_id
    join listings l on l.id = o.listing_id
    left join safe_spots sp on sp.id = o.meet_spot
    left join lateral (
      select string_agg(il.title, ', ') as titles
        from offer_items oi join listings il on il.id = oi.listing_id where oi.offer_id = o.id
    ) items on true
   where s.token = p_token
     and o.status in ('accepted', 'completed')
     and o.meet_at is not null
     and o.meet_at > now() - interval '1 day'
$$;
grant execute on function shared_meetup(text) to anon, authenticated;
