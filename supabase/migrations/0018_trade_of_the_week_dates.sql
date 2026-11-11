-- Trade of the Week shows its dates, and never goes blank:
-- if nothing shared this week (Monday to Sunday, Philadelphia time) has a like yet,
-- last week's winner stays up, labeled as last week's.

create or replace function featured_trade()
returns table (post_id uuid, week_start date, last_week boolean)
language sql stable security definer set search_path = public as $$
  with wk as (
    select (date_trunc('week', now() at time zone 'America/New_York'))::date as this_monday
  ),
  ranked as (
    select p.id,
           (date_trunc('week', p.created_at at time zone 'America/New_York'))::date as monday,
           (select count(*) from post_likes l where l.post_id = p.id) as likes,
           p.created_at
      from feed_posts p, wk
     where p.created_at at time zone 'America/New_York' >= wk.this_monday - 7
  )
  select r.id, r.monday, r.monday < wk.this_monday
    from ranked r, wk
   where r.likes > 0
   order by r.monday desc, r.likes desc, r.created_at asc
   limit 1
$$;

revoke execute on function featured_trade() from public, anon;
grant execute on function featured_trade() to authenticated;
