-- Trade of the Week is only ever this week's (Monday to Sunday, Philadelphia time):
-- the most-voted trade shared this week (ties go to the one shared first).
-- If nothing has been shared this week, there's no Trade of the Week and the app says so.
-- (last_week stays in the result so older app versions keep working; it's always false now.)
create or replace function featured_trade()
returns table (post_id uuid, week_start date, last_week boolean)
language sql stable security definer set search_path = public as $$
  with wk as (
    select (date_trunc('week', now() at time zone 'America/New_York'))::date as this_monday
  )
  select p.id, wk.this_monday, false
    from feed_posts p, wk
   where (p.created_at at time zone 'America/New_York')::date >= wk.this_monday
     and not blocked_with(p.author_id)
   order by (select count(*) from post_likes l where l.post_id = p.id) desc, p.created_at asc
   limit 1
$$;

revoke execute on function featured_trade() from public, anon;
grant execute on function featured_trade() to authenticated;
notify pgrst, 'reload schema';
