-- bart: Campus tab — trade feed, likes, comments, Trade of the Week, ISO board
-- Run after 0001–0006 in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- Trade feed: posts only come from completed trades (one post per trade)
-- ---------------------------------------------------------------------------
create table feed_posts (
  id         uuid primary key default gen_random_uuid(),
  offer_id   uuid not null unique references offers (id) on delete cascade,
  author_id  uuid not null references profiles (id) on delete cascade,
  gave       text not null,
  got        text not null,
  note       text check (note is null or char_length(note) between 1 and 140),
  created_at timestamptz not null default now()
);
create index feed_posts_recent_idx on feed_posts (created_at desc);

create table post_likes (
  post_id    uuid not null references feed_posts (id) on delete cascade,
  user_id    uuid not null references profiles (id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table post_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references feed_posts (id) on delete cascade,
  author_id  uuid not null references profiles (id) on delete cascade default auth.uid(),
  body       text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);
create index post_comments_post_idx on post_comments (post_id, created_at);

alter table feed_posts    enable row level security;
alter table post_likes    enable row level security;
alter table post_comments enable row level security;

create policy "feed: read" on feed_posts for select to authenticated using (true);
create policy "feed: delete own" on feed_posts for delete to authenticated using (author_id = auth.uid());
-- (posts are created only through share_trade below)

create policy "likes: read" on post_likes for select to authenticated using (true);
create policy "likes: own" on post_likes for insert to authenticated with check (user_id = auth.uid());
create policy "likes: unlike own" on post_likes for delete to authenticated using (user_id = auth.uid());

create policy "comments: read" on post_comments for select to authenticated using (true);
create policy "comments: write own" on post_comments for insert to authenticated
  with check (author_id = auth.uid() and banned_match(body) is null);
create policy "comments: delete own" on post_comments for delete to authenticated using (author_id = auth.uid());

-- Share a finished trade to the Campus feed, written from the sharer's side
create or replace function share_trade(p_offer uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o offers;
  v_offered text;
  v_target text;
  v_id uuid;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into o from offers where id = p_offer;
  if o.id is null or auth.uid() not in (o.from_user, o.to_user) then raise exception 'Offer not found'; end if;
  if o.status <> 'completed' then raise exception 'Only finished trades can be shared.'; end if;
  if exists (select 1 from feed_posts where offer_id = p_offer) then raise exception 'This trade is already on the feed.'; end if;
  if v_note is not null and banned_match(v_note) is not null then raise exception 'That note includes a banned word.'; end if;

  select string_agg(l.title, ' + ' order by l.title) into v_offered
    from offer_items oi join listings l on l.id = oi.listing_id where oi.offer_id = p_offer;
  select title into v_target from listings where id = o.listing_id;

  insert into feed_posts (offer_id, author_id, gave, got, note)
  values (p_offer, auth.uid(),
          case when auth.uid() = o.from_user then v_offered else v_target end,
          case when auth.uid() = o.from_user then v_target else v_offered end,
          left(v_note, 140))
  returning id into v_id;
  return v_id;
end $$;

-- The feed, newest first, with like and comment counts
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
         (select count(*)::int from post_comments c where c.post_id = p.id),
         exists (select 1 from post_likes l where l.post_id = p.id and l.user_id = auth.uid())
  from feed_posts p join profiles pr on pr.id = p.author_id
  where auth.uid() is not null
  order by p.created_at desc
  limit least(coalesce(p_limit, 50), 100)
$$;

-- Trade of the Week: most likes among posts since Monday (Philadelphia time); ties go to the earlier post
create or replace function trade_of_the_week()
returns uuid language sql stable security definer set search_path = public as $$
  select p.id
  from feed_posts p
  where p.created_at >= (date_trunc('week', now() at time zone 'America/New_York') at time zone 'America/New_York')
  order by (select count(*) from post_likes l where l.post_id = p.id) desc, p.created_at asc
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- ISO ("in search of") board
-- ---------------------------------------------------------------------------
create table iso_posts (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references profiles (id) on delete cascade default auth.uid(),
  want       text not null check (char_length(want) between 2 and 80),
  can_offer  text check (can_offer is null or char_length(can_offer) <= 120),
  open       boolean not null default true,
  created_at timestamptz not null default now()
);
create index iso_open_idx on iso_posts (open, created_at desc);

-- "I have this": point to an item in your closet
create table iso_responses (
  iso_id       uuid not null references iso_posts (id) on delete cascade,
  responder_id uuid not null references profiles (id) on delete cascade default auth.uid(),
  listing_id   uuid not null references listings (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (iso_id, responder_id)
);

alter table iso_posts     enable row level security;
alter table iso_responses enable row level security;

create policy "iso: read" on iso_posts for select to authenticated using (true);
create policy "iso: post own" on iso_posts for insert to authenticated
  with check (author_id = auth.uid()
              and banned_match(want) is null and banned_match(can_offer) is null
              and exists (select 1 from profiles p where p.id = auth.uid() and p.rules_accepted_at is not null));
create policy "iso: close own" on iso_posts for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "iso: delete own" on iso_posts for delete to authenticated using (author_id = auth.uid());

-- Only the person who posted the want, and the responder, can see a response
create policy "iso responses: read" on iso_responses for select to authenticated using (
  responder_id = auth.uid()
  or exists (select 1 from iso_posts i where i.id = iso_id and i.author_id = auth.uid())
);
create policy "iso responses: respond" on iso_responses for insert to authenticated with check (
  responder_id = auth.uid()
  and exists (select 1 from listings l where l.id = listing_id and l.owner_id = auth.uid() and l.status = 'active')
  and exists (select 1 from iso_posts i where i.id = iso_id and i.open and i.author_id <> auth.uid())
);
create policy "iso responses: take back" on iso_responses for delete to authenticated using (responder_id = auth.uid());

revoke execute on function share_trade(uuid, text), campus_feed(int), trade_of_the_week() from public, anon;
grant execute on function share_trade(uuid, text), campus_feed(int), trade_of_the_week() to authenticated;

-- Live like counts and new posts
do $rt$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table feed_posts, post_likes, post_comments;
  end if;
end $rt$;
