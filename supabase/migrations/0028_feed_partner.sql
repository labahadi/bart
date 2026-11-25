-- Campus posts show both people in the trade: "Elana K. traded with Jordan L."
-- Posts involving someone you've blocked (either person) stay hidden.
drop function if exists campus_feed(int);
create function campus_feed(p_limit int default 50)
returns table (
  id uuid, offer_id uuid, author_id uuid, author_first text, author_initial text, author_avatar text,
  partner_id uuid, partner_first text, partner_initial text, partner_avatar text,
  gave text, got text, note text, created_at timestamptz,
  like_count int, comment_count int, liked boolean
)
language sql stable security definer set search_path = public as $$
  select p.id, p.offer_id, p.author_id, pr.first_name, pr.last_initial, pr.avatar_path,
         pa.id, pa.first_name, pa.last_initial, pa.avatar_path,
         p.gave, p.got, p.note, p.created_at,
         (select count(*)::int from post_likes l where l.post_id = p.id),
         (select count(*)::int from post_comments c where c.post_id = p.id and not blocked_with(c.author_id)),
         exists (select 1 from post_likes l where l.post_id = p.id and l.user_id = auth.uid())
  from feed_posts p
  join profiles pr on pr.id = p.author_id
  left join offers o on o.id = p.offer_id
  left join profiles pa on pa.id = case when o.from_user = p.author_id then o.to_user else o.from_user end
  where auth.uid() is not null and not blocked_with(p.author_id) and (pa.id is null or not blocked_with(pa.id))
  order by p.created_at desc
  limit least(coalesce(p_limit, 50), 100)
$$;
revoke execute on function campus_feed(int) from public, anon;
grant execute on function campus_feed(int) to authenticated;
notify pgrst, 'reload schema';
