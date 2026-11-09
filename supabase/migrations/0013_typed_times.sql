-- Meetup times are typed in now, to the minute.
-- Allowed: from right now (a few minutes of slack for typing) up to 8:00 PM, starting at 10:00 AM.
create or replace function meetup_time_ok(p_at timestamptz) returns void language plpgsql stable as $$
declare
  t time := (p_at at time zone 'America/New_York')::time;
begin
  if p_at is null then raise exception 'Pick a time.'; end if;
  if p_at < now() - interval '5 minutes' then raise exception 'That time already passed.'; end if;
  if p_at > now() + interval '14 days' then raise exception 'Pick a time in the next two weeks.'; end if;
  if t < time '10:00' or t > time '20:00' then raise exception 'Meetups are between 10 AM and 8 PM.'; end if;
end $$;

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
         meet_walk_min = null, meet_pickup = false, meet_at = p_at, updated_at = now()
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
         meet_at = p_at, updated_at = now()
   where id = p_offer;
end $$;
