-- bart: keeping sexual content out (words, photos) and reporting chats
-- Run after 0001–0008 in the Supabase SQL Editor.
--
-- 1. Words: a list of terms blocked EVERYWHERE (chat, comments, names, notes), on top of the
--    listing-only list (exams, drugs...). Common disguises like "s3x" or "nud3s" are caught.
-- 2. Photos: phones can no longer upload photos directly. The app's server checks each photo
--    with AI first and only then stores it (see src/app/api/photo/route.ts).
-- 3. Chat reports: anyone in a trade can report the chat; reviewers see it and can delete messages.

-- ---------------------------------------------------------------------------
-- 1. Words
-- ---------------------------------------------------------------------------
alter table banned_terms add column everywhere boolean not null default false;

update banned_terms set everywhere = true where kind = 'adult content';

insert into banned_terms (term, kind, everywhere) values
  ('nudes', 'adult content', true), ('naked', 'adult content', true), ('sex', 'adult content', true),
  ('sexy', 'adult content', true), ('sexting', 'adult content', true), ('porn', 'adult content', true),
  ('porno', 'adult content', true), ('onlyfans', 'adult content', true), ('horny', 'adult content', true),
  ('nsfw', 'adult content', true), ('xxx', 'adult content', true), ('dick', 'adult content', true),
  ('cock', 'adult content', true), ('pussy', 'adult content', true), ('boobs', 'adult content', true),
  ('tits', 'adult content', true), ('titties', 'adult content', true), ('blowjob', 'adult content', true),
  ('handjob', 'adult content', true), ('orgasm', 'adult content', true), ('fetish', 'adult content', true),
  ('kinky', 'adult content', true), ('milf', 'adult content', true), ('thot', 'adult content', true),
  ('send pics', 'adult content', true), ('dick pic', 'adult content', true)
on conflict (term) do update set everywhere = true;

-- Undo common disguises: 0→o 1→i 3→e 4→a 5→s 7→t @→a $→s !→i, and stretched letters
-- ("nuuudes", "boooobs"). Returns the original text plus cleaned-up versions, so one
-- word-boundary check covers all of them.
create or replace function text_variants(txt text) returns text
language sql immutable as $$
  with t as (select translate(lower(coalesce(txt, '')), '013457@$!', 'oieastasi') as x)
  select lower(coalesce(txt, '')) || ' | ' || x
         || ' | ' || regexp_replace(x, '([a-z])\1{2,}', '\1', 'g')
         || ' | ' || regexp_replace(x, '([a-z])\1{2,}', '\1\1', 'g')
  from t
$$;

-- Listing-only + everywhere terms (used for listings and the ISO board)
create or replace function banned_match(txt text) returns text
language sql stable security definer set search_path = public as $$
  select term from banned_terms
  where text_variants(txt) ~ ('\m' || term || '(s|es)?\M')
  order by length(term) desc
  limit 1
$$;

-- Everywhere terms only (used for chat, comments, names, notes)
create or replace function blocked_anywhere(txt text) returns text
language sql stable security definer set search_path = public as $$
  select term from banned_terms
  where everywhere and text_variants(txt) ~ ('\m' || term || '(s|es)?\M')
  order by length(term) desc
  limit 1
$$;

grant execute on function blocked_anywhere(text) to authenticated;

-- Chat: no blocked words, and photos only come from the server's checked upload
drop policy "messages: parties send" on messages;
create policy "messages: parties send" on messages for insert to authenticated
  with check (sender_id = auth.uid()
              and image_path is null
              and blocked_anywhere(body) is null
              and exists (select 1 from offers o
                          where o.id = offer_id
                            and auth.uid() in (o.from_user, o.to_user)
                            and o.status in ('pending', 'accepted')));

-- Comments: everywhere list (so "after my exam" is fine in a comment)
drop policy "comments: write own" on post_comments;
create policy "comments: write own" on post_comments for insert to authenticated
  with check (author_id = auth.uid() and blocked_anywhere(body) is null);

-- Names
create or replace function profiles_check_name() returns trigger
language plpgsql set search_path = public as $$
begin
  if blocked_anywhere(new.first_name) is not null then
    raise exception 'Pick a different name.';
  end if;
  return new;
end $$;

create trigger profiles_name_check
  before insert or update of first_name on profiles
  for each row execute function profiles_check_name();

-- ---------------------------------------------------------------------------
-- 2. Photos: only the server (after the AI check) can upload
-- ---------------------------------------------------------------------------
create table photo_blocks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  kind       text not null,          -- 'chat' or 'listing'
  category   text,                   -- what the check found
  offer_id   uuid references offers (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table photo_blocks enable row level security;
-- No policies: written by the server, read by the team in the dashboard

do $storage$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    drop policy if exists "photos: upload to own folder" on storage.objects;
    drop policy if exists "chat photos: trade parties upload" on storage.objects;
    -- Reviewers can open chat photos in reported chats
    execute $p$
      create policy "chat photos: reviewers view" on storage.objects for select to authenticated
      using (bucket_id = 'chat-photos' and public.is_reviewer())
    $p$;
  end if;
end $storage$;

-- ---------------------------------------------------------------------------
-- 3. Chat reports
-- ---------------------------------------------------------------------------
create table chat_reports (
  id          uuid primary key default gen_random_uuid(),
  offer_id    uuid not null references offers (id) on delete cascade,
  reporter_id uuid not null references profiles (id) on delete cascade default auth.uid(),
  reason      text not null check (reason in ('sexual', 'harassment', 'scam', 'unsafe_meetup', 'other')),
  details     text check (details is null or char_length(details) <= 1000),
  reviewed    boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table chat_reports enable row level security;
create policy "chat reports: file" on chat_reports for insert to authenticated with check (
  reporter_id = auth.uid()
  and exists (select 1 from offers o where o.id = offer_id and auth.uid() in (o.from_user, o.to_user))
);

-- Reviewer queue: each reported chat with the two people and the latest messages
create or replace function chat_report_queue(p_include_reviewed boolean default false)
returns table (
  report_id uuid, offer_id uuid, reason text, details text, reviewed boolean, created_at timestamptz,
  reporter_name text, other_name text, other_id uuid, other_blocked_photos int, messages jsonb
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_reviewer() then raise exception 'Only bart reviewers can see reports.'; end if;
  return query
  select r.id, r.offer_id, r.reason, r.details, r.reviewed, r.created_at,
         first_name_of(r.reporter_id),
         first_name_of(case when r.reporter_id = o.from_user then o.to_user else o.from_user end),
         case when r.reporter_id = o.from_user then o.to_user else o.from_user end,
         (select count(*)::int from photo_blocks b
           where b.user_id = case when r.reporter_id = o.from_user then o.to_user else o.from_user end),
         coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'sender', first_name_of(m.sender_id),
                                                       'body', m.body, 'image_path', m.image_path, 'at', m.created_at)
                                    order by m.created_at)
                   from (select * from messages where messages.offer_id = r.offer_id order by created_at desc limit 30) m), '[]')
  from chat_reports r join offers o on o.id = r.offer_id
  where p_include_reviewed or not r.reviewed
  order by r.reviewed, r.created_at desc;
end $$;

create or replace function reviewer_delete_message(p_message uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_reviewer() then raise exception 'Only bart reviewers can do this.'; end if;
  delete from messages where id = p_message;
end $$;

create or replace function resolve_chat_report(p_report uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_reviewer() then raise exception 'Only bart reviewers can do this.'; end if;
  update chat_reports set reviewed = true where id = p_report;
end $$;

revoke execute on function chat_report_queue(boolean), reviewer_delete_message(uuid), resolve_chat_report(uuid) from public, anon;
grant execute on function chat_report_queue(boolean), reviewer_delete_message(uuid), resolve_chat_report(uuid) to authenticated;
