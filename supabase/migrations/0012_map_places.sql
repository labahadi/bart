-- bart: meetup places from Google Maps
-- Run after 0001–0011 in the Supabase SQL Editor.
--
-- "Somewhere else on campus" now searches Google Maps. The app's server looks up the exact
-- location, checks it's inside the campus boundary below, works out the walking time from
-- Locust Walk at 37th, and marks street addresses as pickups.

alter table offers
  add column if not exists meet_address  text check (meet_address is null or char_length(meet_address) <= 200),
  add column if not exists meet_lat      double precision,
  add column if not exists meet_lng      double precision,
  add column if not exists meet_walk_min int check (meet_walk_min is null or meet_walk_min between 0 and 120),
  add column if not exists meet_pickup   boolean not null default false;

-- The campus boundary: roughly 30th St to 40th St (plus a block), Market St to Baltimore Ave.
-- To change it, edit these four numbers here AND in src/lib/campus.ts.
create or replace function on_campus(lat double precision, lng double precision) returns boolean
language sql immutable as $$
  select lat between 39.9460 and 39.9585 and lng between -75.2060 and -75.1815
$$;

-- Picking a listed spot clears any map place
create or replace function set_meetup(p_offer uuid, p_spot text, p_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare
  o offers;
  local_hour int := extract(hour from p_at at time zone 'America/New_York');
begin
  select * into o from offers where id = p_offer for update;
  if o.id is null or auth.uid() not in (o.from_user, o.to_user) then raise exception 'Offer not found'; end if;
  if o.status <> 'accepted' then raise exception 'Set a meetup after the offer is accepted.'; end if;
  if not exists (select 1 from safe_spots where id = p_spot) then raise exception 'Pick a spot from the list.'; end if;
  if p_at < now() then raise exception 'Pick a time in the future.'; end if;
  if local_hour < 10 or local_hour > 20 then raise exception 'Meetups are between 10 AM and 8 PM.'; end if;
  update offers
     set meet_spot = p_spot, meet_custom = null, meet_address = null, meet_lat = null, meet_lng = null,
         meet_walk_min = null, meet_pickup = false, meet_at = p_at, updated_at = now()
   where id = p_offer;
end $$;

-- A place from Google Maps: only the app's server can call this, after looking it up
drop function if exists set_meetup_custom(uuid, uuid, text, timestamptz);
create or replace function set_meetup_place(
  p_offer uuid, p_user uuid, p_name text, p_address text, p_lat double precision, p_lng double precision,
  p_walk_min int, p_pickup boolean, p_at timestamptz
) returns void language plpgsql security definer set search_path = public as $$
declare
  o offers;
  local_hour int := extract(hour from p_at at time zone 'America/New_York');
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  select * into o from offers where id = p_offer for update;
  if o.id is null or p_user not in (o.from_user, o.to_user) then raise exception 'Offer not found'; end if;
  if is_suspended(p_user) then raise exception 'Your account is paused, so you can''t do this right now.'; end if;
  if o.status <> 'accepted' then raise exception 'Set a meetup after the offer is accepted.'; end if;
  if p_at < now() then raise exception 'Pick a time in the future.'; end if;
  if local_hour < 10 or local_hour > 20 then raise exception 'Meetups are between 10 AM and 8 PM.'; end if;
  if p_lat is null or p_lng is null or not on_campus(p_lat, p_lng) then raise exception 'That place is off campus.'; end if;
  if blocked_anywhere(p_name) is not null then raise exception 'Pick a different place.'; end if;
  update offers
     set meet_spot = null, meet_custom = left(trim(p_name), 80), meet_address = left(p_address, 200),
         meet_lat = p_lat, meet_lng = p_lng, meet_walk_min = p_walk_min, meet_pickup = coalesce(p_pickup, false),
         meet_at = p_at, updated_at = now()
   where id = p_offer;
end $$;

revoke execute on function set_meetup_place(uuid, uuid, text, text, double precision, double precision, int, boolean, timestamptz)
  from public, anon, authenticated;
do $grant$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function set_meetup_place(uuid, uuid, text, text, double precision, double precision, int, boolean, timestamptz) to service_role;
  end if;
end $grant$;
