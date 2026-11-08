-- bart: report review screen for the team
-- Run after 0001 and 0002. Then make yourself a reviewer (see the bottom of this file).

-- Who can review reports. Add your team's accounts here.
create table reviewers (
  user_id  uuid primary key references profiles (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table reviewers enable row level security;
-- Nobody can read or change this list from the app; manage it in the Supabase dashboard.

create or replace function is_reviewer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from reviewers where user_id = auth.uid())
$$;

-- One row per reported listing, with everything a reviewer needs to decide.
-- Reporters stay anonymous: their identities are never returned.
create or replace function report_queue(p_include_reviewed boolean default false)
returns table (
  listing_id     uuid,
  title          text,
  description    text,
  wants          text,
  category       listing_category,
  tier           trade_tier,
  photo_paths    text[],
  listing_status listing_status,
  owner_name     text,
  owner_reported int,
  report_count   int,
  open_count     int,
  reasons        report_reason[],
  details        text[],
  first_reported timestamptz,
  last_reported  timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_reviewer() then raise exception 'Only bart reviewers can see reports.'; end if;
  return query
  select l.id, l.title, l.description, l.wants, l.category, l.tier, l.photo_paths, l.status,
         coalesce(p.first_name, 'Student') || coalesce(' ' || p.last_initial || '.', ''),
         -- how many of this person's listings have ever been reported
         (select count(distinct r2.listing_id)::int from reports r2 join listings l2 on l2.id = r2.listing_id
           where l2.owner_id = l.owner_id),
         count(*)::int,
         count(*) filter (where not r.reviewed)::int,
         array_agg(distinct r.reason),
         array_remove(array_agg(r.details order by r.created_at), null),
         min(r.created_at),
         max(r.created_at)
  from reports r
  join listings l on l.id = r.listing_id
  join profiles p on p.id = l.owner_id
  group by l.id, p.first_name, p.last_initial
  having p_include_reviewed or bool_or(not r.reviewed)
  order by bool_or(not r.reviewed) desc, count(*) filter (where not r.reviewed) desc, max(r.created_at) desc;
end $$;

-- Decide on a reported listing: 'keep' puts it back on the feed, 'remove' takes it down.
-- Either way, its reports are marked reviewed.
create or replace function resolve_report(p_listing uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_reviewer() then raise exception 'Only bart reviewers can do this.'; end if;
  if p_action = 'keep' then
    update listings set status = 'active' where id = p_listing and status = 'removed';
  elsif p_action = 'remove' then
    update listings set status = 'removed' where id = p_listing and status in ('active', 'removed');
  else
    raise exception 'Unknown action';
  end if;
  update reports set reviewed = true where listing_id = p_listing;
end $$;

revoke execute on function is_reviewer(), report_queue(boolean), resolve_report(uuid, text) from public, anon;
grant execute on function is_reviewer(), report_queue(boolean), resolve_report(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Make yourself a reviewer: sign up in the app first, then run this once with your email.
--
-- insert into reviewers (user_id)
--   select id from auth.users where email = 'you@wharton.upenn.edu';
-- ---------------------------------------------------------------------------
