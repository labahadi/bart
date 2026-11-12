-- bart: blocking people, and phone push notifications
--
-- Blocking someone:
--   - ends any open trade between you (it's cancelled),
--   - stops new offers, messages and "I have this" answers between you, either way,
--   - hides each other's listings, Campus posts, comments and Looking-for posts.
-- They aren't told they were blocked. You can unblock from Settings → Blocked people.
--
-- Push: each phone or browser that turns on notifications saves a subscription here.
-- When a notification is created, a Supabase webhook calls /api/push, which sends it
-- (unless it's quiet hours for that person: 11 PM to 8 AM).

-- ---------------------------------------------------------------------------
-- Blocking
-- ---------------------------------------------------------------------------
create table if not exists blocks (
  blocker_id uuid not null references profiles (id) on delete cascade,
  blocked_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table blocks enable row level security;
-- You can see who you blocked (never who blocked you). Changes go through block_user/unblock_user.
drop policy if exists "blocks: own" on blocks;
create policy "blocks: own" on blocks for select to authenticated using (blocker_id = auth.uid());

-- Has either person blocked the other?
create or replace function blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a))
$$;

-- Between me and someone else
create or replace function blocked_with(p_other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_other is not null and auth.uid() is not null and blocked_between(auth.uid(), p_other)
$$;

create or replace function block_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_user is null or p_user = auth.uid() then raise exception 'You can''t block yourself.'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'Person not found'; end if;
  insert into blocks (blocker_id, blocked_id) values (auth.uid(), p_user) on conflict do nothing;
  -- End anything open between you
  update offers set status = 'cancelled', updated_at = now()
   where status in ('pending', 'accepted')
     and ((from_user = auth.uid() and to_user = p_user) or (from_user = p_user and to_user = auth.uid()));
end $$;

create or replace function unblock_user(p_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from blocks where blocker_id = auth.uid() and blocked_id = p_user
$$;

create or replace function my_blocks()
returns table (user_id uuid, first_name text, last_initial text, blocked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.blocked_id, p.first_name, p.last_initial, b.created_at
    from blocks b join profiles p on p.id = b.blocked_id
   where b.blocker_id = auth.uid()
   order by b.created_at desc
$$;

revoke execute on function blocked_between(uuid, uuid), blocked_with(uuid), block_user(uuid), unblock_user(uuid), my_blocks() from public, anon;
grant execute on function blocked_with(uuid), block_user(uuid), unblock_user(uuid), my_blocks() to authenticated;

-- No new offers, counters, accepts or messages between blocked people (covers the server too)
create or replace function offers_block_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status not in ('cancelled', 'declined') and blocked_between(new.from_user, new.to_user) then
    raise exception 'You can''t trade with this person.';
  end if;
  return new;
end $$;
drop trigger if exists offers_block_check on offers;
create trigger offers_block_check before insert or update on offers
  for each row execute function offers_block_check();

create or replace function messages_block_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o offers;
begin
  select * into o from offers where id = new.offer_id;
  if o.id is not null and blocked_between(o.from_user, o.to_user) then
    raise exception 'You can''t message this person.';
  end if;
  return new;
end $$;
drop trigger if exists messages_block_check on messages;
create trigger messages_block_check before insert on messages
  for each row execute function messages_block_check();

create or replace function iso_answers_block_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if blocked_between(new.responder_id, (select author_id from iso_posts where id = new.iso_id)) then
    raise exception 'You can''t answer this post.';
  end if;
  return new;
end $$;
drop trigger if exists iso_answers_block_check on iso_responses;
create trigger iso_answers_block_check before insert on iso_responses
  for each row execute function iso_answers_block_check();

-- Hide each other's stuff
drop policy if exists "listings: read" on listings;
create policy "listings: read" on listings for select to authenticated using (
  (status = 'active' and not is_suspended(owner_id) and not blocked_with(owner_id))
  or owner_id = auth.uid()
  or exists (
    select 1 from offers o
    where (o.listing_id = listings.id
           or exists (select 1 from offer_items oi where oi.offer_id = o.id and oi.listing_id = listings.id))
      and auth.uid() in (o.from_user, o.to_user)
  )
);

drop policy if exists "feed: read" on feed_posts;
create policy "feed: read" on feed_posts for select to authenticated using (not blocked_with(author_id));
drop policy if exists "comments: read" on post_comments;
create policy "comments: read" on post_comments for select to authenticated using (not blocked_with(author_id));
drop policy if exists "iso: read" on iso_posts;
create policy "iso: read" on iso_posts for select to authenticated using (not blocked_with(author_id));

create or replace function campus_feed(p_limit int default 50)
returns table (
  id uuid, offer_id uuid, author_id uuid, author_first text, author_initial text,
  gave text, got text, note text, created_at timestamptz,
  like_count int, comment_count int, liked boolean
)
language sql stable security definer set search_path = public as $$
  select p.id, p.offer_id, p.author_id, pr.first_name, pr.last_initial,
         p.gave, p.got, p.note, p.created_at,
         (select count(*)::int from post_likes l where l.post_id = p.id),
         (select count(*)::int from post_comments c where c.post_id = p.id and not blocked_with(c.author_id)),
         exists (select 1 from post_likes l where l.post_id = p.id and l.user_id = auth.uid())
  from feed_posts p join profiles pr on pr.id = p.author_id
  where auth.uid() is not null and not blocked_with(p.author_id)
  order by p.created_at desc
  limit least(coalesce(p_limit, 50), 100)
$$;

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
       and not blocked_with(p.author_id)
  )
  select r.id, r.monday, r.monday < wk.this_monday
    from ranked r, wk
   where r.likes > 0
   order by r.monday desc, r.likes desc, r.created_at asc
   limit 1
$$;

-- ---------------------------------------------------------------------------
-- Push notifications
-- ---------------------------------------------------------------------------
create table if not exists push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references profiles (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);
alter table push_subscriptions enable row level security;
drop policy if exists "push: own" on push_subscriptions;
create policy "push: own" on push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists "push: remove own" on push_subscriptions;
create policy "push: remove own" on push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- Save this phone/browser for push (a shared device moves to whoever turned it on last)
create or replace function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000 then raise exception 'That device can''t get notifications.'; end if;
  insert into push_subscriptions (endpoint, user_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
end $$;
revoke execute on function save_push_subscription(text, text, text) from public, anon;
grant execute on function save_push_subscription(text, text, text) to authenticated;

-- Quiet hours (11 PM to 8 AM, Philadelphia time): on unless they turn it off
alter table profiles add column if not exists quiet_hours boolean not null default true;
