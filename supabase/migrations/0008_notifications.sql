-- bart: notifications (badges on the tabs + the Activity list)
-- Run after 0001–0007 in the Supabase SQL Editor.
--
-- Notifications are created by the database itself when something happens, so the app
-- can't forget to send one. Repeats collapse: ten messages from Jordan are one notification.

create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  tab        text not null check (tab in ('trades', 'campus', 'me')),
  kind       text not null,
  body       text not null,
  link       text not null,
  ref        uuid,               -- the trade, post, ISO or listing it's about
  count      int  not null default 1,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);
create index notifications_unread_idx on notifications (user_id) where read_at is null;

alter table notifications enable row level security;
create policy "notifications: own" on notifications for select to authenticated using (user_id = auth.uid());
create policy "notifications: clear own" on notifications for delete to authenticated using (user_id = auth.uid());
-- (created only by the triggers below; marked read through mark_read)

create or replace function first_name_of(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select first_name from profiles where id = p), 'Someone')
$$;

-- Send one notification (never to the person who did the thing).
-- collapse: if there's already an unread one of this kind about the same thing, refresh it instead.
create or replace function notify(p_user uuid, p_tab text, p_kind text, p_body text, p_link text, p_ref uuid,
                                  p_collapse boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  if p_collapse then
    update notifications set body = p_body, count = count + 1, created_at = now()
     where user_id = p_user and kind = p_kind and ref is not distinct from p_ref and read_at is null;
    if found then return; end if;
  end if;
  insert into notifications (user_id, tab, kind, body, link, ref) values (p_user, p_tab, p_kind, p_body, p_link, p_ref);
end $$;

-- Mark read: everything on a tab, everything about one trade/post, or everything
create or replace function mark_read(p_tab text default null, p_ref uuid default null)
returns void language sql security definer set search_path = public as $$
  update notifications set read_at = now()
   where user_id = auth.uid() and read_at is null
     and (p_tab is null or tab = p_tab)
     and (p_ref is null or ref = p_ref)
$$;

-- ---------------------------------------------------------------------------
-- Trades: offers, counters, answers, meetups, finished trades
-- ---------------------------------------------------------------------------
create or replace function notify_offer_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor text := first_name_of(auth.uid());
  title text := (select l.title from listings l where l.id = new.listing_id);
  link  text := '/trades/' || new.id;
  p uuid;
begin
  if tg_op = 'INSERT' then
    perform notify(new.to_user, 'trades', 'offer', actor || ' sent an offer for your ' || title, link, new.id);
    return new;
  end if;

  if new.status is distinct from old.status then
    foreach p in array array[new.from_user, new.to_user] loop
      perform notify(p, 'trades', 'status',
        case new.status
          when 'accepted'  then actor || ' accepted the trade for ' || title
          when 'declined'  then 'The trade for ' || title || ' was declined'
          when 'cancelled' then actor || ' cancelled the offer for ' || title
          when 'completed' then 'Trade done: ' || title || '. Rate it and share it to Campus.'
          else 'Update on the trade for ' || title
        end, link, new.id);
    end loop;
  elsif new.counter_count > old.counter_count then
    perform notify(new.awaiting, 'trades', 'counter', actor || ' countered on ' || title, link, new.id);
  end if;

  if new.meet_at is distinct from old.meet_at and new.meet_at is not null then
    foreach p in array array[new.from_user, new.to_user] loop
      perform notify(p, 'trades', 'meetup',
        actor || ' set the meetup: ' || to_char(new.meet_at at time zone 'America/New_York', 'Dy FMHH12 AM'),
        link, new.id, true);
    end loop;
  end if;
  return new;
end $$;

create trigger offers_notify
  after insert or update on offers
  for each row execute function notify_offer_change();

create or replace function notify_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o offers;
begin
  -- Counter and meetup notes already have their own notification
  if new.body like 'Countered: %' or new.body like 'Meetup set: %' then return new; end if;
  select * into o from offers where id = new.offer_id;
  perform notify(case when new.sender_id = o.from_user then o.to_user else o.from_user end,
                 'trades', 'message',
                 first_name_of(new.sender_id) || ': ' || coalesce(left(new.body, 80), 'sent a photo'),
                 '/trades/' || new.offer_id, new.offer_id, true);
  return new;
end $$;

create trigger messages_notify
  after insert on messages
  for each row execute function notify_message();

-- ---------------------------------------------------------------------------
-- Campus: likes, comments, ISO answers
-- ---------------------------------------------------------------------------
create or replace function notify_like() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  author uuid := (select author_id from feed_posts where id = new.post_id);
  others int := coalesce((select count from notifications
                          where user_id = author and kind = 'like' and ref = new.post_id and read_at is null), 0);
begin
  perform notify(author, 'campus', 'like',
    first_name_of(new.user_id) ||
      case when others = 0 then '' when others = 1 then ' and 1 other' else ' and ' || others || ' others' end ||
      ' liked your trade',
    '/campus', new.post_id, true);
  return new;
end $$;

create trigger likes_notify
  after insert on post_likes
  for each row execute function notify_like();

create or replace function notify_comment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify((select author_id from feed_posts where id = new.post_id), 'campus', 'comment',
    first_name_of(new.author_id) || ' commented: ' || left(new.body, 80), '/campus', new.post_id, true);
  return new;
end $$;

create trigger comments_notify
  after insert on post_comments
  for each row execute function notify_comment();

create or replace function notify_iso_response() returns trigger
language plpgsql security definer set search_path = public as $$
declare i iso_posts;
begin
  select * into i from iso_posts where id = new.iso_id;
  perform notify(i.author_id, 'campus', 'iso',
    first_name_of(new.responder_id) || ' has ' || (select title from listings where id = new.listing_id) || ' for your ISO',
    '/campus', new.iso_id);
  return new;
end $$;

create trigger iso_responses_notify
  after insert on iso_responses
  for each row execute function notify_iso_response();

-- ---------------------------------------------------------------------------
-- Me: an item you saved was traded or taken down
-- ---------------------------------------------------------------------------
create or replace function notify_savers() returns trigger
language plpgsql security definer set search_path = public as $$
declare s record;
begin
  if new.status in ('traded', 'removed') and new.status is distinct from old.status then
    for s in select user_id from saves where listing_id = new.id and user_id <> new.owner_id loop
      perform notify(s.user_id, 'me', 'saved',
        new.title || case when new.status = 'traded' then ' was traded' else ' was taken down' end,
        '/me', new.id);
    end loop;
  end if;
  return new;
end $$;

create trigger listings_notify_savers
  after update on listings
  for each row execute function notify_savers();

revoke execute on function notify(uuid, text, text, text, text, uuid, boolean), first_name_of(uuid) from public, anon, authenticated;
revoke execute on function mark_read(text, uuid) from public, anon;
grant execute on function mark_read(text, uuid) to authenticated;

do $rt$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table notifications;
  end if;
end $rt$;
