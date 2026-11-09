-- bart: "misc" category, new meetup spots, custom meetup places, meetups until 8 PM
-- Run after 0001–0010 in the Supabase SQL Editor.

-- New category (shown as "Misc"; "dorm" is now labeled "Dorm supplies" in the app)
alter type listing_category add value if not exists 'misc';

-- Meetup spots
update safe_spots set name = 'Van Pelt Library', short_name = 'Van Pelt', sort = 1 where id = 'van-pelt';
update safe_spots set name = 'Houston Hall',     short_name = 'Houston Hall', sort = 2 where id = 'houston';
update safe_spots set name = 'Rodin lobby',      short_name = 'Rodin lobby', sort = 3 where id = 'rodin';
insert into safe_spots (id, name, short_name, walk_min, sort) values
  ('harnwell',   'Harnwell lobby', 'Harnwell lobby', 0, 4),
  ('stommons',   'Stommons',       'Stommons',       0, 5),
  ('mcclelland', 'McClelland',     'McClelland',     0, 6)
on conflict (id) do update set name = excluded.name, short_name = excluded.short_name, sort = excluded.sort;

-- A meetup can be at a listed spot, or a custom place the app's server has checked is on Penn's campus
alter table offers add column if not exists meet_custom text check (meet_custom is null or char_length(meet_custom) between 2 and 80);

-- Daytime and evening: meetups can start between 10 AM and 8 PM (Philadelphia time)
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
  update offers set meet_spot = p_spot, meet_custom = null, meet_at = p_at, updated_at = now() where id = p_offer;
end $$;

-- Custom place: only the app's server can call this, after its campus check
create or replace function set_meetup_custom(p_offer uuid, p_user uuid, p_place text, p_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare
  o offers;
  local_hour int := extract(hour from p_at at time zone 'America/New_York');
begin
  -- Act as this student for the rest of the call (so notifications and checks know who did it)
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  select * into o from offers where id = p_offer for update;
  if o.id is null or p_user not in (o.from_user, o.to_user) then raise exception 'Offer not found'; end if;
  if is_suspended(p_user) then raise exception 'Your account is paused, so you can''t do this right now.'; end if;
  if o.status <> 'accepted' then raise exception 'Set a meetup after the offer is accepted.'; end if;
  if p_at < now() then raise exception 'Pick a time in the future.'; end if;
  if local_hour < 10 or local_hour > 20 then raise exception 'Meetups are between 10 AM and 8 PM.'; end if;
  if blocked_anywhere(p_place) is not null then raise exception 'Pick a different place.'; end if;
  update offers set meet_spot = null, meet_custom = trim(p_place), meet_at = p_at, updated_at = now() where id = p_offer;
end $$;

revoke execute on function set_meetup_custom(uuid, uuid, text, timestamptz) from public, anon, authenticated;
do $grant$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function set_meetup_custom(uuid, uuid, text, timestamptz) to service_role;
  end if;
end $grant$;
