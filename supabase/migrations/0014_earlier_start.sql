-- Meetups can start as early as 7:30 AM (still no later than 8:00 PM).
create or replace function meetup_time_ok(p_at timestamptz) returns void language plpgsql stable as $$
declare
  t time := (p_at at time zone 'America/New_York')::time;
begin
  if p_at is null then raise exception 'Pick a time.'; end if;
  if p_at < now() - interval '5 minutes' then raise exception 'That time already passed.'; end if;
  if p_at > now() + interval '14 days' then raise exception 'Pick a time in the next two weeks.'; end if;
  if t < time '07:30' or t > time '20:00' then raise exception 'Meetups are between 7:30 AM and 8 PM.'; end if;
end $$;
