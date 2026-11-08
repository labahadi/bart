-- bart: owners can edit their listings, but not once the item is in a trade
-- Run after 0001–0005 in the Supabase SQL Editor.

create or replace function listings_lock_in_trade() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated'
     and old.status in ('in_trade', 'traded')
     and (new.title, new.description, new.category, new.tier, new.condition, new.wants, new.photo_paths)
         is distinct from
         (old.title, old.description, old.category, old.tier, old.condition, old.wants, old.photo_paths) then
    raise exception 'This item is in a trade, so it can''t be edited.';
  end if;
  return new;
end $$;

create trigger listings_lock
  before update on listings
  for each row execute function listings_lock_in_trade();
