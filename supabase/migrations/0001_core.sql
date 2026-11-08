-- bart: core schema for the closed beta
-- Run this once in the Supabase SQL editor (or with `supabase db push`).
--
-- Design notes
-- * Emails and phone numbers live only in auth.users, which the app can never read.
--   Other students only ever see a first name and last initial.
-- * Every change to an offer goes through a function below, so a trade can only move
--   pending -> accepted/declined -> completed, and only the right person can move it.
-- * Row level security (RLS) is on for every table. A table with RLS on and no policy
--   for an action blocks that action for everyone using the app.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type listing_category as enum ('textbooks', 'dorm', 'clothes', 'tickets', 'skills');
create type trade_tier       as enum ('S', 'M', 'L', 'Skill');
create type listing_status   as enum ('active', 'in_trade', 'traded', 'removed');
create type offer_status     as enum ('pending', 'accepted', 'declined', 'cancelled', 'completed');
create type report_reason    as enum ('banned_item', 'scam', 'unsafe_meetup', 'harassment', 'other');

-- ---------------------------------------------------------------------------
-- Safe Spots (fixed list; edit the seed rows to change it)
-- ---------------------------------------------------------------------------
create table safe_spots (
  id         text primary key,
  name       text not null,
  short_name text not null,
  walk_min   int  not null,
  sort       int  not null default 0
);

insert into safe_spots (id, name, short_name, walk_min, sort) values
  ('van-pelt', 'Van Pelt Library lobby', 'Van Pelt lobby', 5, 1),
  ('houston',  'Houston Hall',           'Houston Hall',   4, 2),
  ('rodin',    'Rodin lobby',            'Rodin lobby',    7, 3);

-- ---------------------------------------------------------------------------
-- Profiles: one row per student, created automatically at sign-up
-- ---------------------------------------------------------------------------
create table profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  first_name        text check (first_name is null or char_length(first_name) between 1 and 40),
  last_initial      text check (last_initial is null or last_initial ~ '^[A-Z]$'),
  rules_accepted_at timestamptz,
  created_at        timestamptz not null default now()
);

-- Only Penn addresses can create an account. Penn uses subdomains
-- (wharton.upenn.edu, seas.upenn.edu, sas.upenn.edu), so those count too.
create or replace function is_penn_email(addr text) returns boolean
language sql immutable as $$
  select lower(coalesce(addr, '')) ~ '^[^@\s]+@([a-z0-9-]+\.)*upenn\.edu$'
$$;

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_penn_email(new.email) then
    raise exception 'Use your upenn.edu email so we know you''re a student.';
  end if;
  insert into profiles (id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Banned-item check (the same list runs in the app as you type, in src/lib/banned.ts)
-- Matches whole words, plus plural "s"/"es", so "incredible" does not trip "edible".
-- ---------------------------------------------------------------------------
create table banned_terms (
  term text primary key,
  kind text not null
);

insert into banned_terms (term, kind) values
  ('answer key', 'academic'), ('answers', 'academic'), ('exam', 'academic'),
  ('midterm', 'academic'), ('problem set', 'academic'), ('homework', 'academic'),
  ('essay writing', 'academic'),
  ('adderall', 'drugs'), ('weed', 'drugs'), ('vape', 'drugs'), ('edible', 'drugs'),
  ('alcohol', 'alcohol'), ('beer', 'alcohol'), ('vodka', 'alcohol'),
  ('fake id', 'IDs'),
  ('gun', 'weapons'), ('knife', 'weapons'),
  ('nude', 'adult content'), ('hookup', 'adult content');

create or replace function banned_match(txt text) returns text
language sql stable security definer set search_path = public as $$
  select term from banned_terms
  where lower(coalesce(txt, '')) ~ ('\m' || term || '(s|es)?\M')
  order by length(term) desc
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Listings
-- ---------------------------------------------------------------------------
create table listings (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references profiles (id) on delete cascade default auth.uid(),
  title       text not null check (char_length(title) between 3 and 80),
  description text check (description is null or char_length(description) <= 600),
  category    listing_category not null default 'dorm',
  tier        trade_tier not null default 'M',
  condition   text check (condition is null or char_length(condition) <= 30),
  wants       text check (wants is null or char_length(wants) <= 120),
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 4),
  status      listing_status not null default 'active',
  created_at  timestamptz not null default now()
);

create index listings_feed_idx  on listings (status, created_at desc);
create index listings_owner_idx on listings (owner_id);

-- Runs as the caller (not security definer) so it can tell a student's own edit
-- apart from an edit made by the trade functions below.
create or replace function listings_before_write() returns trigger
language plpgsql set search_path = public as $$
declare hit text;
begin
  hit := coalesce(banned_match(new.title), banned_match(new.description), banned_match(new.wants));
  if hit is not null then
    raise exception 'Can''t post this. "%" matches our banned list.', hit;
  end if;
  -- Skills always use the Skill tier
  if new.category = 'skills' then new.tier := 'Skill'; end if;
  if new.category <> 'skills' and new.tier = 'Skill' then new.tier := 'M'; end if;
  -- Owners can't hand a listing to someone else or flip it to "traded" themselves
  if tg_op = 'UPDATE' and current_user = 'authenticated' then
    new.owner_id := old.owner_id;
    if old.status = 'removed' and new.status <> 'removed' then
      raise exception 'This listing is under review by the bart team.';
    end if;
    if new.status in ('traded', 'in_trade') and new.status is distinct from old.status then
      raise exception 'Trades update this status automatically.';
    end if;
  end if;
  return new;
end $$;

create trigger listings_check
  before insert or update on listings
  for each row execute function listings_before_write();

-- ---------------------------------------------------------------------------
-- Saved items (the wishlist on the Me tab)
-- ---------------------------------------------------------------------------
create table saves (
  user_id    uuid not null references profiles (id) on delete cascade default auth.uid(),
  listing_id uuid not null references listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

-- ---------------------------------------------------------------------------
-- Offers: "I'll give you these items (+ sweeteners) for your listing"
-- ---------------------------------------------------------------------------
create table offers (
  id               uuid primary key default gen_random_uuid(),
  listing_id       uuid not null references listings (id) on delete cascade,
  from_user        uuid not null references profiles (id) on delete cascade,
  to_user          uuid not null references profiles (id) on delete cascade,
  sweeteners       text[] not null default '{}',
  suggested_spot   text references safe_spots (id),
  status           offer_status not null default 'pending',
  meet_spot        text references safe_spots (id),
  meet_at          timestamptz,
  from_confirmed   boolean not null default false,
  to_confirmed     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (from_user <> to_user)
);

create index offers_from_idx on offers (from_user, created_at desc);
create index offers_to_idx   on offers (to_user, created_at desc);

create table offer_items (
  offer_id   uuid not null references offers (id) on delete cascade,
  listing_id uuid not null references listings (id) on delete cascade,
  primary key (offer_id, listing_id)
);

-- ---------------------------------------------------------------------------
-- Messages (chat lives inside a trade)
-- ---------------------------------------------------------------------------
create table messages (
  id         uuid primary key default gen_random_uuid(),
  offer_id   uuid not null references offers (id) on delete cascade,
  sender_id  uuid not null references profiles (id) on delete cascade default auth.uid(),
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index messages_offer_idx on messages (offer_id, created_at);

-- ---------------------------------------------------------------------------
-- Ratings and reports
-- ---------------------------------------------------------------------------
create table ratings (
  offer_id   uuid not null references offers (id) on delete cascade,
  rater_id   uuid not null references profiles (id) on delete cascade,
  ratee_id   uuid not null references profiles (id) on delete cascade,
  stars      int  not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (offer_id, rater_id)
);

create table reports (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references listings (id) on delete cascade,
  reporter_id uuid not null references profiles (id) on delete cascade default auth.uid(),
  reason      report_reason not null,
  details     text check (details is null or char_length(details) <= 1000),
  reviewed    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (listing_id, reporter_id)
);

-- Three reports from different students hides a listing for everyone until the team reviews it
create or replace function reports_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from reports where listing_id = new.listing_id and not reviewed) >= 3 then
    update listings set status = 'removed' where id = new.listing_id and status = 'active';
  end if;
  return new;
end $$;

create trigger reports_hide
  after insert on reports
  for each row execute function reports_after_insert();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table profiles     enable row level security;
alter table safe_spots   enable row level security;
alter table banned_terms enable row level security;
alter table listings     enable row level security;
alter table saves        enable row level security;
alter table offers       enable row level security;
alter table offer_items  enable row level security;
alter table messages     enable row level security;
alter table ratings      enable row level security;
alter table reports      enable row level security;

-- Signed-in students can see each other's first name and initial (no emails exist in this table)
create policy "profiles: read" on profiles for select to authenticated using (true);
create policy "profiles: edit own" on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "safe spots: read"   on safe_spots   for select to authenticated using (true);
create policy "banned terms: read" on banned_terms for select to authenticated using (true);

-- Feed: everyone sees active listings; you also see your own whatever their status;
-- people in a trade can see the items in it.
create policy "listings: read" on listings for select to authenticated using (
  status = 'active'
  or owner_id = auth.uid()
  or exists (
    select 1 from offers o
    where (o.listing_id = listings.id
           or exists (select 1 from offer_items oi where oi.offer_id = o.id and oi.listing_id = listings.id))
      and auth.uid() in (o.from_user, o.to_user)
  )
);
create policy "listings: create own" on listings for insert to authenticated
  with check (owner_id = auth.uid()
              and exists (select 1 from profiles p where p.id = auth.uid() and p.rules_accepted_at is not null));
create policy "listings: edit own" on listings for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "saves: own" on saves for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Offers, offer items and messages are visible only to the two people in the trade.
-- There are no insert/update policies: the functions below are the only way in.
create policy "offers: parties read" on offers for select to authenticated
  using (auth.uid() in (from_user, to_user));
create policy "offer items: parties read" on offer_items for select to authenticated
  using (exists (select 1 from offers o where o.id = offer_id and auth.uid() in (o.from_user, o.to_user)));

create policy "messages: parties read" on messages for select to authenticated
  using (exists (select 1 from offers o where o.id = offer_id and auth.uid() in (o.from_user, o.to_user)));
create policy "messages: parties send" on messages for insert to authenticated
  with check (sender_id = auth.uid()
              and exists (select 1 from offers o
                          where o.id = offer_id
                            and auth.uid() in (o.from_user, o.to_user)
                            and o.status in ('pending', 'accepted')));

-- You can see the ratings you gave; averages come from trader_stats()
create policy "ratings: read own" on ratings for select to authenticated using (rater_id = auth.uid());

-- Reports are write-only from the app. The team reads them in the Supabase dashboard.
create policy "reports: file" on reports for insert to authenticated
  with check (reporter_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Functions the app calls (supabase.rpc('name', {...}))
-- ---------------------------------------------------------------------------

-- Finish sign-up: name + agree to the 4 house rules
create or replace function complete_signup(p_first_name text, p_last_initial text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update profiles
     set first_name = trim(p_first_name),
         last_initial = upper(left(trim(p_last_initial), 1)),
         rules_accepted_at = coalesce(rules_accepted_at, now())
   where id = auth.uid();
end $$;

-- Rating, completed trades and no-shows for a trader (public summary only)
create or replace function trader_stats(p_user uuid)
returns table (rating numeric, trades int)
language sql stable security definer set search_path = public as $$
  select
    (select round(avg(stars)::numeric, 1) from ratings where ratee_id = p_user),
    (select count(*)::int from offers where status = 'completed' and p_user in (from_user, to_user))
$$;

-- Send an offer for someone's listing using items from your own closet
create or replace function create_offer(
  p_listing uuid, p_my_items uuid[], p_sweeteners text[], p_spot text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_offer uuid;
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;

  select owner_id into v_owner from listings where id = p_listing and status = 'active';
  if v_owner is null then raise exception 'This listing is no longer available.'; end if;
  if v_owner = me then raise exception 'You can''t trade with yourself.'; end if;

  if coalesce(cardinality(p_my_items), 0) = 0 then
    raise exception 'Pick at least one item from your closet.';
  end if;
  if exists (select 1 from unnest(p_my_items) i
             where not exists (select 1 from listings l
                               where l.id = i and l.owner_id = me and l.status = 'active')) then
    raise exception 'You can only offer active items from your own closet.';
  end if;
  if exists (select 1 from offers where listing_id = p_listing and from_user = me and status = 'pending') then
    raise exception 'You already have a pending offer on this item.';
  end if;
  if p_spot is not null and not exists (select 1 from safe_spots where id = p_spot) then
    raise exception 'Pick a Safe Spot from the list.';
  end if;

  insert into offers (listing_id, from_user, to_user, sweeteners, suggested_spot)
  values (p_listing, me, v_owner,
          (select coalesce(array_agg(s), '{}') from unnest(coalesce(p_sweeteners, '{}')) s
            where s in ('Coffee on me', 'Help moving it', 'Class notes')),
          p_spot)
  returning id into v_offer;

  insert into offer_items (offer_id, listing_id) select v_offer, unnest(p_my_items);
  return v_offer;
end $$;

-- Owner accepts or declines; the sender can cancel while it's pending
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

  if auth.uid() <> o.to_user then raise exception 'Only the owner can answer this offer.'; end if;

  if p_action = 'decline' then
    update offers set status = 'declined', updated_at = now() where id = p_offer;
  elsif p_action = 'accept' then
    -- Everything in the trade must still be available
    if exists (select 1 from listings where id = o.listing_id and status <> 'active')
       or exists (select 1 from offer_items oi join listings l on l.id = oi.listing_id
                  where oi.offer_id = p_offer and l.status <> 'active') then
      raise exception 'One of these items is already in another trade.';
    end if;
    update offers set status = 'accepted', meet_spot = coalesce(meet_spot, suggested_spot), updated_at = now()
     where id = p_offer;
    update listings set status = 'in_trade'
     where id = o.listing_id or id in (select listing_id from offer_items where offer_id = p_offer);
    -- Other pending offers that involve any of these items can no longer happen
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

-- Set or change the meetup: Safe Spots only, daytime only (10 AM to 4 PM Philadelphia time)
create or replace function set_meetup(p_offer uuid, p_spot text, p_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare
  o offers;
  local_hour int := extract(hour from p_at at time zone 'America/New_York');
begin
  select * into o from offers where id = p_offer for update;
  if o.id is null or auth.uid() not in (o.from_user, o.to_user) then raise exception 'Offer not found'; end if;
  if o.status <> 'accepted' then raise exception 'Set a meetup after the offer is accepted.'; end if;
  if not exists (select 1 from safe_spots where id = p_spot) then raise exception 'Pick a Safe Spot from the list.'; end if;
  if p_at < now() then raise exception 'Pick a time in the future.'; end if;
  if local_hour < 10 or local_hour > 16 then raise exception 'Meetups are daytime only, for safety.'; end if;
  update offers set meet_spot = p_spot, meet_at = p_at, updated_at = now() where id = p_offer;
end $$;

-- Each person taps "Mark trade complete"; when both have, items are marked traded
create or replace function confirm_complete(p_offer uuid)
returns offer_status language plpgsql security definer set search_path = public as $$
declare o offers;
begin
  select * into o from offers where id = p_offer for update;
  if o.id is null or auth.uid() not in (o.from_user, o.to_user) then raise exception 'Offer not found'; end if;
  if o.status not in ('accepted', 'completed') then raise exception 'This trade isn''t active.'; end if;

  update offers
     set from_confirmed = from_confirmed or auth.uid() = from_user,
         to_confirmed   = to_confirmed   or auth.uid() = to_user,
         updated_at = now()
   where id = p_offer
  returning * into o;

  if o.from_confirmed and o.to_confirmed and o.status <> 'completed' then
    update offers set status = 'completed' where id = p_offer;
    update listings set status = 'traded'
     where id = o.listing_id or id in (select listing_id from offer_items where offer_id = p_offer);
    return 'completed';
  end if;
  return o.status;
end $$;

-- Rate the other person once you've marked the trade complete
create or replace function rate_trade(p_offer uuid, p_stars int)
returns void language plpgsql security definer set search_path = public as $$
declare o offers;
begin
  select * into o from offers where id = p_offer;
  if o.id is null or auth.uid() not in (o.from_user, o.to_user) then raise exception 'Offer not found'; end if;
  if not ((auth.uid() = o.from_user and o.from_confirmed) or (auth.uid() = o.to_user and o.to_confirmed)) then
    raise exception 'Mark the trade complete first.';
  end if;
  insert into ratings (offer_id, rater_id, ratee_id, stars)
  values (p_offer, auth.uid(), case when auth.uid() = o.from_user then o.to_user else o.from_user end, p_stars)
  on conflict (offer_id, rater_id) do update set stars = excluded.stars;
end $$;

-- Only signed-in users may call these
revoke execute on function complete_signup(text, text), trader_stats(uuid), create_offer(uuid, uuid[], text[], text),
  respond_offer(uuid, text), set_meetup(uuid, text, timestamptz), confirm_complete(uuid), rate_trade(uuid, int),
  banned_match(text)
  from public, anon;
grant execute on function complete_signup(text, text), trader_stats(uuid), create_offer(uuid, uuid[], text[], text),
  respond_offer(uuid, text), set_meetup(uuid, text, timestamptz), confirm_complete(uuid), rate_trade(uuid, int),
  banned_match(text)
  to authenticated;
