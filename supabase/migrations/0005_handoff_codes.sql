-- bart: finishing a trade in person with a QR code or a 4-digit code
-- Run after 0001–0004 in the Supabase SQL Editor.
--
-- How it works: at the meetup, one person taps "Show my code". The other person scans
-- the QR code with their phone camera (or types the 4 digits). That completes the trade
-- for both of them. The person entering the code can't see it in the app, so completing
-- the trade means they were actually standing in front of each other.

create table handoff_codes (
  offer_id   uuid not null references offers (id) on delete cascade,
  shower_id  uuid not null references profiles (id) on delete cascade,
  code       text not null,
  expires_at timestamptz not null,
  attempts   int  not null default 0,
  primary key (offer_id, shower_id)
);
alter table handoff_codes enable row level security;
-- No policies: nobody can read codes directly. Only the functions below touch this table.

-- Show my code (makes a new one if I don't have a current one). Codes last 10 minutes.
create or replace function handoff_code(p_offer uuid)
returns table (code text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare o offers;
begin
  select * into o from offers where id = p_offer;
  if o.id is null or auth.uid() not in (o.from_user, o.to_user) then raise exception 'Offer not found'; end if;
  if o.status <> 'accepted' then raise exception 'This trade isn''t active.'; end if;

  delete from handoff_codes h where h.offer_id = p_offer and h.shower_id = auth.uid()
    and (h.expires_at < now() + interval '1 minute' or h.attempts >= 5);
  insert into handoff_codes (offer_id, shower_id, code, expires_at)
  values (p_offer, auth.uid(), lpad(floor(random() * 10000)::int::text, 4, '0'), now() + interval '10 minutes')
  on conflict (offer_id, shower_id) do nothing;

  return query select h.code, h.expires_at from handoff_codes h
               where h.offer_id = p_offer and h.shower_id = auth.uid();
end $$;

-- Enter (or scan) the other person's code. Returns 'completed', 'wrong', 'expired' or 'locked'.
-- Returns instead of raising errors so that wrong attempts are still counted.
create or replace function confirm_handoff(p_offer uuid, p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare
  o offers;
  h handoff_codes;
begin
  select * into o from offers where id = p_offer for update;
  if o.id is null or auth.uid() not in (o.from_user, o.to_user) then raise exception 'Offer not found'; end if;
  if o.status = 'completed' then return 'completed'; end if;
  if o.status <> 'accepted' then raise exception 'This trade isn''t active.'; end if;

  -- The code must come from the *other* person
  select * into h from handoff_codes
   where offer_id = p_offer and shower_id <> auth.uid() and expires_at > now()
   for update;
  if h.offer_id is null then return 'expired'; end if;
  if h.attempts >= 5 then return 'locked'; end if;

  if h.code <> trim(coalesce(p_code, '')) then
    update handoff_codes set attempts = attempts + 1 where offer_id = h.offer_id and shower_id = h.shower_id;
    return case when h.attempts + 1 >= 5 then 'locked' else 'wrong' end;
  end if;

  update offers set from_confirmed = true, to_confirmed = true, status = 'completed', updated_at = now()
   where id = p_offer;
  update listings set status = 'traded'
   where id = o.listing_id or id in (select listing_id from offer_items where offer_id = p_offer);
  delete from handoff_codes where offer_id = p_offer;
  return 'completed';
end $$;

revoke execute on function handoff_code(uuid), confirm_handoff(uuid, text) from public, anon;
grant execute on function handoff_code(uuid), confirm_handoff(uuid, text) to authenticated;
